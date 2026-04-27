'use strict';
const express  = require('express');
const db       = require('../db');
const { rankJobs, distLabel, distanceKm, calcApplicantMatchScore, rankApplicants } = require('../services/matchingEngine');
const { suggestCategory, generateTitle, suggestUrgent, getPriceGuide } = require('../services/smartAssist');
const {
    sendSelectionNotification,
    sendJobStartedNotification,
    sendJobCompletedNotification,
} = require('../services/notificationService');
const { trackEvent }              = require('../services/analyticsService');
const { findMatchingWorkers }     = require('../services/matchingService');
const { sendJobAlert, sendApplyAlert, sendDepartureReminder, sendContactAlert } = require('../services/kakaoService');
const { sortRecommendedJobs }          = require('../services/recommendationService');
const { reengageUnselectedApplicants } = require('../services/reengageService');
const { checkAndAutoSelect }           = require('../services/autoSelect');
const { calcV2Bonus }                  = require('../services/aiMatchV2');
const { getCallInfo }                  = require('../services/callService');
const { tryFireReminder }              = require('../services/reminderRecovery');
const { geocodeAddress }               = require('../services/geocodeService');
const { getDriveTime }                 = require('../services/directionService');
const { getDefaultImage }              = require('../utils/jobImages');
const { estimateDifficulty }           = require('../services/imageDifficultyService');
const { classifyImage }                = require('../services/imageJobTypeService');
const { sortJobs: aiSortJobs }        = require('../services/recommendService');
const { findNearestWorkers }          = require('../services/matchService');
const { createPayment, confirmPayment, refundPayment } = require('../services/paymentService');
// autoMatchService 통합 완료 — matchingService로 일원화됨

const router = express.Router();

// PHASE 29: apply rate limit — 동일 userId 1초 내 중복 요청 차단
const applyRateLimit = new Map();
const APPLY_RATE_MS  = 1000; // 1초

// ─── 유틸 ────────────────────────────────────────────────────
function newId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** DB row → JS object (정수 Boolean 정규화) */
/** 좌표 파싱 헬퍼 — null/''/NaN/string 모두 방어, 실제 좌표만 number로 반환 */
function _parseCoord(v) {
    if (v == null || v === '') return null;      // null / undefined / 빈 문자열
    const n = Number(v);
    return Number.isFinite(n) && n !== 0 ? n : null; // 0 좌표는 무효 처리
}

function normalizeJob(row) {
    if (!row) return null;
    return {
        ...row,
        isUrgent:     !!row.isUrgent,
        autoSelected: !!row.autoSelected,
        isUrgentPaid: !!row.isUrgentPaid,
        // DISTANCE_FIX: 좌표 명시적 노출 (null/빈문자열/NaN 완전 방어 + string→number 변환)
        latitude:  _parseCoord(row.latitude),
        longitude: _parseCoord(row.longitude),
    };
}

function normalizeWorker(row) {
    if (!row) return null;
    return {
        ...row,
        categories: typeof row.categories === 'string'
            ? JSON.parse(row.categories)
            : (row.categories || []),
        hasTractor: !!row.hasTractor,
        hasSprayer: !!row.hasSprayer,
        hasRotary:  !!row.hasRotary,
    };
}

/** 작업별 지원자 수 (DB 조회) */
function appCountForJob(jobId) {
    return db.prepare(
        "SELECT COUNT(*) as n FROM applications WHERE jobRequestId = ? AND status != 'cancelled'"
    ).get(jobId).n;
}

/** PHASE 22: 요청자(농민) 신뢰도 — 받은 후기 평균/건수 */
function getRequesterRating(requesterId) {
    const row = db.prepare(
        'SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews WHERE targetId = ?'
    ).get(requesterId);
    return {
        avgRating:   row && row.avg ? Math.round(row.avg * 10) / 10 : null,
        ratingCount: row ? row.cnt : 0,
    };
}

/** PHASE 26: farmImages JSON 파싱 헬퍼 */
function parseFarmImages(raw) {
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
}

/** 작업 응답 포맷 (거리 정보 + PHASE 22 신뢰도 + PHASE 26 밭 정보 포함) */
function jobView(job, opts = {}) {
    const { userLat, userLon } = opts;

    // DISTANCE_FIX: 좌표 없거나 NaN이면 거리 계산 금지
    const canCalcDist = (
        userLat && userLon &&
        job.latitude  != null && Number.isFinite(job.latitude)  &&
        job.longitude != null && Number.isFinite(job.longitude)
    );
    const dist = canCalcDist
        ? distanceKm(userLat, userLon, job.latitude, job.longitude)
        : null;
    // NaN 방어 (Haversine이 NaN 반환 시 null 처리)
    const distSafe = (dist != null && Number.isFinite(dist)) ? dist : null;

    const { avgRating, ratingCount } = getRequesterRating(job.requesterId);
    const farmImages = parseFarmImages(job.farmImages);
    return {
        ...job,
        applicationCount: appCountForJob(job.id),
        distKm:      distSafe !== null ? Math.round(distSafe * 10) / 10 : null,
        distLabel:   distSafe !== null ? distLabel(distSafe) : null,
        avgRating,
        ratingCount,
        // PHASE 26
        farmImages,
        thumbUrl:    farmImages[0] || job.imageUrl || null,
    };
}

// ─── 특정 경로 먼저 (/:id 보다 앞에 정의) ─────────────────────

// ─── GET /api/jobs/my/jobs ────────────────────────────────────
router.get('/my/jobs', (req, res) => {
    const { userId } = req.query;
    const rows = db.prepare(
        'SELECT * FROM jobs WHERE requesterId = ? ORDER BY createdAt DESC'
    ).all(userId);
    const myJobs = rows.map(r => jobView(normalizeJob(r)));
    console.log(`[JOB_LIST_MY_POSTED] userId=${userId} count=${myJobs.length}`);
    return res.json({ ok: true, jobs: myJobs });
});

// ─── GET /api/jobs/my/applications ───────────────────────────
router.get('/my/applications', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.json({ ok: true, applications: [] });

    // PHASE 21+22 fix: workerId in applications = raw userId (not workers.id)
    // 직접 userId로 조회 → guest / worker_TIMESTAMP 모두 정상 동작
    const apps = db.prepare(
        'SELECT * FROM applications WHERE workerId = ? ORDER BY createdAt DESC'
    ).all(userId);

    const result = apps.map(a => {
        const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(a.jobRequestId);

        // Phase 7: 선택된 지원자에게 농민 연락처 공개
        let farmerContact = null;
        if ((a.status === 'selected' || a.status === 'completed') && jobRow) {
            const farmerUser = db.prepare('SELECT phone, name FROM users WHERE id = ?').get(jobRow.requesterId);
            if (farmerUser) {
                farmerContact = {
                    farmerName:  jobRow.requesterName || farmerUser.name,
                    farmerPhone: farmerUser.phone,
                };
            }
        }

        // PHASE 22: 작성한 후기 정보
        const review = db.prepare(
            'SELECT rating, comment FROM reviews WHERE jobId = ? AND reviewerId = ?'
        ).get(a.jobRequestId, userId);

        return {
            ...a,
            job:          jobRow ? jobView(normalizeJob(jobRow)) : null,
            farmerContact,
            review:       review || null,
        };
    });

    return res.json({ ok: true, applications: result });
});

// ─── GET /api/jobs/my/notifications — PHASE 26 탭바 배지 카운트 ──
router.get('/my/notifications', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.json({ ok: true, pendingApps: 0, selectedApps: 0 });

    // 농민용: 내 공고에 대기 중인 지원자 수 (status='applied')
    const pendingRow = db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM applications a
        JOIN jobs j ON j.id = a.jobRequestId
        WHERE j.requesterId = ? AND a.status = 'applied'
    `).get(userId);

    // 작업자용: 내 지원 중 선택된 것 (status='selected')
    const selectedRow = db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM applications
        WHERE workerId = ? AND status = 'selected'
    `).get(userId);

    return res.json({
        ok:          true,
        pendingApps: pendingRow?.cnt  || 0,
        selectedApps: selectedRow?.cnt || 0,
    });
});

// ─── POST /api/jobs/smart-assist ─────────────────────────────
router.post('/smart-assist', (req, res) => {
    const { text, category, locationText, date, areaSize, areaUnit } = req.body;

    const suggestion  = suggestCategory(text || '');
    const resolvedCat = category || suggestion.category;
    const title       = resolvedCat
        ? generateTitle({ category: resolvedCat, locationText, date, areaSize, areaUnit })
        : null;
    const isUrgent   = suggestUrgent({ note: text || '', date });
    const priceGuide = resolvedCat
        ? getPriceGuide(resolvedCat, parseInt(areaSize), areaUnit)
        : null;

    return res.json({
        ok: true,
        suggestedCategory: suggestion.category,
        confidence:        suggestion.confidence,
        title,
        isUrgent,
        priceGuide,
    });
});

// ─── POST /api/jobs ───────────────────────────────────────────
router.post('/', async (req, res) => {
  try { // MAP_CORE: 전체 핸들러 try/catch — 비동기 throw 시 502 완전 차단
    // MAP_CORE: body 디버그 로그 (farmImages 제외)
    const { farmImages: _fi, ...bodyLog } = req.body || {};
    console.log('[API /jobs POST] body:', bodyLog);

    const {
        requesterId, requesterName, category, locationText,
        latitude, longitude,
        lat: bodyLat, lng: bodyLng,   // Phase 4: GPS 직접 전달
        date, timeSlot,
        areaSize, areaUnit, pay, note, imageUrl,
        farmImages: farmImagesRaw,   // PHASE 26: 다중 이미지 배열 (JSON string or array)
        farmAddress: farmAddressRaw, // PHASE MAP_FIX: 농지 주소 (지오코딩 소스)
        isUrgentPaid: isUrgentPaidRaw, // PHASE SCALE: 유료 긴급 공고
    } = req.body || {};

    if (!requesterId || !category || !locationText || !date) {
        return res.status(400).json({ ok: false, error: '필수 항목이 빠졌어요.' });
    }

    // PHASE MAP_FIX: 농지 주소 품질 검증 — 너무 짧은 입력 차단 (쓰레기 입력 방지)
    if (farmAddressRaw && farmAddressRaw.trim().length < 5) {
        return res.status(400).json({ ok: false, error: '농지 주소가 너무 짧아요. 예: "경기 화성시 서신면" 형식으로 입력해주세요.' });
    }

    // LOCATION_FIX: 우선순위 — farmAddress(농지주소) > GPS(현재위치)
    // 이유: GPS = 농민의 집일 수 있음. farmAddress가 있으면 반드시 농지 좌표 사용.
    let resolvedLat = null;
    let resolvedLng = null;

    const rawLat = parseFloat(bodyLat ?? latitude);
    const rawLng = parseFloat(bodyLng ?? longitude);
    const hasFarmAddress = farmAddressRaw && farmAddressRaw.trim().length >= 5;

    if (hasFarmAddress) {
        // ① 농지 주소 있음 → 지오코딩 필수 (GPS 완전 무시)
        const geo = await geocodeAddress(farmAddressRaw.trim());
        if (geo) {
            resolvedLat = geo.lat;
            resolvedLng = geo.lng;
            console.log(`[SERVER_COORD_FARMADDR] "${farmAddressRaw.trim()}" → (${resolvedLat}, ${resolvedLng})`);
            console.log(`[GEO_QUALITY] source=farmAddress addr="${farmAddressRaw.trim()}" lat=${resolvedLat.toFixed(4)} lng=${resolvedLng.toFixed(4)} addrLen=${farmAddressRaw.trim().length} normalized=${geo.normalized ?? false} precision=${geo.precision ?? 'full'}`);
        } else {
            // 지오코딩 실패 → 등록 거부 (GPS로 대체하지 않음)
            console.warn(`[SERVER_GEOCODE_FAIL] "${farmAddressRaw.trim()}" → 좌표 획득 실패, 등록 거부`);
            return res.status(400).json({
                ok: false,
                error: `"${farmAddressRaw.trim()}" 주소의 위치를 찾을 수 없어요. 시·군·읍·면·리 형식으로 더 정확하게 입력해주세요. 예) 경기 포천시 창수면 오가리`,
            });
        }
    } else if (Number.isFinite(rawLat) && Number.isFinite(rawLng)) {
        // ② 농지 주소 없음 + GPS 있음 → GPS 사용 (현장에서 직접 등록하는 경우)
        resolvedLat = rawLat;
        resolvedLng = rawLng;
        console.log('[SERVER_COORD_GPS]', locationText, resolvedLat, resolvedLng);
        console.log(`[GEO_QUALITY] source=GPS locationText="${locationText}" lat=${resolvedLat.toFixed(4)} lng=${resolvedLng.toFixed(4)}`);
    } else {
        // ③ 둘 다 없음 → 등록 거부
        console.warn('[SERVER_COORD_REQUIRED]', locationText, '→ lat/lng 없음 + farmAddress 없음, 등록 거부');
        return res.status(400).json({
            ok: false,
            error: '위치 좌표가 필요해요. GPS를 허용하거나 농지 주소를 입력해주세요.',
        });
    }

    const isUrgent   = suggestUrgent({ note: note || '', date });
    const id         = newId('job');
    const farmAddress = farmAddressRaw ? farmAddressRaw.trim() : null;

    // PHASE 26: areaPyeong — areaUnit이 '평'이면 areaSize를 그대로 사용, 아니면 null
    const parsedArea = parseInt(areaSize) || null;
    const resolvedUnit = areaUnit || '평';
    const areaPyeong   = (parsedArea && resolvedUnit === '평') ? parsedArea : null;

    // PHASE 26: farmImages — JSON 배열 문자열로 저장
    let farmImagesStr = null;
    if (farmImagesRaw) {
        const arr = Array.isArray(farmImagesRaw) ? farmImagesRaw : JSON.parse(farmImagesRaw);
        if (arr.length > 0) farmImagesStr = JSON.stringify(arr);
    }

    const row = {
        id, requesterId,
        requesterName: requesterName || '농민',
        category, locationText,
        latitude:  resolvedLat,
        longitude: resolvedLng,
        date, timeSlot: timeSlot || '협의',
        areaSize:  parsedArea,
        areaUnit:  resolvedUnit,
        pay:       pay || null,
        note:      note    || '',
        // VISUAL_JOB_LITE: imageUrl 없으면 카테고리별 기본 이미지 자동 적용
        imageUrl:  (imageUrl && imageUrl.trim()) ? imageUrl : getDefaultImage(category),
        isUrgent:  isUrgent ? 1 : 0,
        status:    'open',
        createdAt: new Date().toISOString(),
        // PHASE 26
        areaPyeong,
        farmImages: farmImagesStr,
        // PHASE MAP_FIX
        farmAddress,
        // PHASE SCALE: 유료 긴급 공고 (결제 완료 시 1)
        isUrgentPaid: isUrgentPaidRaw ? 1 : 0,
    };

    db.prepare(`
        INSERT INTO jobs
        (id, requesterId, requesterName, category, locationText,
         latitude, longitude, date, timeSlot, areaSize, areaUnit,
         pay, note, imageUrl, isUrgent, status, createdAt,
         areaPyeong, farmImages, farmAddress, isUrgentPaid)
        VALUES
        (@id, @requesterId, @requesterName, @category, @locationText,
         @latitude, @longitude, @date, @timeSlot, @areaSize, @areaUnit,
         @pay, @note, @imageUrl, @isUrgent, @status, @createdAt,
         @areaPyeong, @farmImages, @farmAddress, @isUrgentPaid)
    `).run(row);

    console.log(`[JOB_CREATED] id=${id} category=${category} location=${locationText} lat=${resolvedLat ?? 'none'} lng=${resolvedLng ?? 'none'} urgent=${isUrgent}`);
    trackEvent('job_created', { jobId: id, userId: requesterId, meta: { category } });

    // Phase 11: 미선택 지원자 재매칭 알림 (비동기, fail-safe)
    setImmediate(() => {
        reengageUnselectedApplicants({ id, category, locationText, date, requesterId });
    });

    // PHASE IMAGE_DIFFICULTY_AI: 이미지 → 난이도 점수 비동기 분석 후 DB 갱신
    setImmediate(async () => {
        try {
            const finalImageUrl = (imageUrl && imageUrl.trim()) ? imageUrl : null;
            const difficulty = await estimateDifficulty(finalImageUrl, category);
            db.prepare('UPDATE jobs SET difficulty = ? WHERE id = ?').run(difficulty, id);
            console.log(`[DIFFICULTY] job=${id} category=${category} difficulty=${difficulty.toFixed(2)}`);
        } catch (e) {
            console.warn('[DIFFICULTY_ERROR]', e.message);
        }
    });

    // PHASE IMAGE_JOBTYPE_AI: 이미지 → 작업유형 자동 분류 + 태그
    setImmediate(async () => {
        try {
            const finalImageUrl = (imageUrl && imageUrl.trim()) ? imageUrl : null;
            const r = await classifyImage(finalImageUrl);
            if (!r.type) return;          // 분류 불가 → 원값 유지
            const safeTags = Array.isArray(r.tags) ? r.tags : [];
            db.prepare('UPDATE jobs SET autoJobType = ?, tags = ? WHERE id = ?')
              .run(r.type, JSON.stringify(safeTags), id);
            console.log(`[JOBTYPE_AI] job=${id} autoJobType=${r.type} tags=${r.tags}`);
        } catch (e) {
            console.error('[JOBTYPE_FAIL]', e.message);
        }
    });

    // ── PHASE MATCH_ENGINE_UNIFY: 단일 호출 통합 매칭 ───────────────
    // findMatchingWorkers 내부에서 단일 패스로 처리:
    //   GPS 경로: 5km 내 (카테고리 일치 OR 3km 이내 근거리 fallback)
    //   No-GPS: 카테고리 + locationText 폴백
    setImmediate(async () => {
        try {
            const jobForMatch = {
                id, category, locationText,
                lat: resolvedLat, lng: resolvedLng,
                latitude: resolvedLat, longitude: resolvedLng,
            };
            const targets = findMatchingWorkers(jobForMatch, { radiusKm: 5, nearFieldKm: 3 });
            if (targets.length === 0) {
                console.log(`[MATCH_ALERT] no matching workers for job=${id}`);
                return;
            }
            console.log(`[MATCH_ALERT] job=${id} notifying ${targets.length}명`);
            for (const t of targets) {
                await sendJobAlert(t, { id, category, locationText, pay: pay || null, date });
            }
        } catch (e) {
            console.error('[MATCH_ALERT_ERROR]', e.message);
        }
    });

    return res.status(201).json({ ok: true, job: jobView(normalizeJob(row)) });

  } catch (e) {
    // MAP_CORE: 최상위 catch — async 핸들러 내 미처리 throw → 502 방지
    console.error('[JOB_CREATE_FATAL]', e.message, e.stack?.split('\n')[1] || '');
    if (!res.headersSent) {
        return res.status(500).json({ ok: false, error: '서버 오류가 발생했어요. 잠시 후 다시 시도해주세요.' });
    }
  }
});

// ─── GET /api/jobs ────────────────────────────────────────────
router.get('/', (req, res) => {
    const { category, date, lat, lon, radius = 200, recommended } = req.query;
    const userLat = lat ? parseFloat(lat) : null;
    const userLon = lon ? parseFloat(lon) : null;

    // PHASE SCALE: 활성 스폰서 공고 jobId 집합
    const now = Date.now();
    const sponsoredIds = new Set(
        db.prepare('SELECT jobId FROM sponsored_jobs WHERE expiresAt > ?').all(now).map(r => r.jobId)
    );

    // Phase 8: closed 제외 (공개 목록에서 마감 일자리 노출 안 함)
    const allJobs = db.prepare("SELECT * FROM jobs WHERE status != 'closed'").all().map(normalizeJob);

    // Phase 6: recommended=1 → 추천 정렬 (오늘→거리→일당→최신)
    if (recommended === '1') {
        const openJobs = allJobs.filter(j => j.status === 'open');
        const sorted   = sortRecommendedJobs(openJobs, { lat: userLat, lng: userLon });
        const withView = sorted
            .map(j => ({
                ...jobView(j, { userLat, userLon }),
                isToday:     j.isToday,
                distanceKm:  j.distanceKm,
                payValue:    j.payValue,
                isSponsored: sponsoredIds.has(j.id),
            }))
            // PHASE SCALE: 스폰서 → 유료긴급 → 기존 순서 유지
            .sort((a, b) => {
                const aScore = (a.isSponsored ? 2 : 0) + (a.isUrgentPaid ? 1 : 0);
                const bScore = (b.isSponsored ? 2 : 0) + (b.isUrgentPaid ? 1 : 0);
                return bScore - aScore; // stable sort — 동점이면 기존 순서 유지
            });
        console.log(`[RECOMMEND_LIST] userLat=${userLat ?? 'n/a'} userLng=${userLon ?? 'n/a'} count=${withView.length}`);
        return res.json({ ok: true, jobs: withView, recommended: true });
    }

    const ranked = rankJobs(allJobs, {
        category, date,
        userLat, userLon,
        radiusKm: parseFloat(radius),
    })
        .map(j => ({ ...jobView(j, { userLat, userLon }), isSponsored: sponsoredIds.has(j.id) }))
        // PHASE SCALE: 스폰서 → 유료긴급 → 기존 순서 유지
        .sort((a, b) => {
            const aScore = (a.isSponsored ? 2 : 0) + (a.isUrgentPaid ? 1 : 0);
            const bScore = (b.isSponsored ? 2 : 0) + (b.isUrgentPaid ? 1 : 0);
            return bScore - aScore;
        });

    console.log(`[JOB_LIST_VIEWED] count=${ranked.length} category=${category || 'all'} gps=${lat ? 'on' : 'off'}`);
    return res.json({ ok: true, jobs: ranked });
});

// ─── GET /api/jobs/recommended — PHASE_AI_MATCHING_MAP_V1 ────
// AI 가중치 추천: dist 60% + pay 20% + recency 20%
// ?lat=&lng=  GPS 좌표 (선택 — 없으면 pay+recency만)
router.get('/recommended', (req, res) => {
    const { lat, lng } = req.query;
    const uLat = lat ? parseFloat(lat) : null;
    const uLng = lng ? parseFloat(lng) : null;
    const user = (uLat && isFinite(uLat) && uLng && isFinite(uLng))
        ? { lat: uLat, lng: uLng }
        : null;

    const rows = db.prepare("SELECT * FROM jobs WHERE status = 'open'").all().map(normalizeJob);
    const sorted = aiSortJobs(rows, user);

    const result = sorted.map(j => ({
        ...jobView(j, { userLat: user?.lat, userLon: user?.lng }),
        _aiScore: j._aiScore,
        distKm:   j.distKm,
        payValue: j.payValue,
    }));

    console.log(`[RECOMMENDED] lat=${uLat ?? 'n/a'} lng=${uLng ?? 'n/a'} count=${result.length}`);
    return res.json({ ok: true, jobs: result, count: result.length });
});

// ─── GET /api/jobs/nearby — PHASE NEARBY_MATCH ───────────────
// 사용자 위치 기준 반경 N km 내 open 일자리 (JS Haversine — SQLite trig 없음)
router.get('/nearby', (req, res) => {
    const { lat, lng, radius = '3' } = req.query;

    if (!lat || !lng) {
        return res.status(400).json({ ok: false, error: 'lat, lng 파라미터가 필요해요.' });
    }

    const userLat  = parseFloat(lat);
    const userLon  = parseFloat(lng);        // jobs.js 내부 관례: userLon
    const radiusKm = Math.min(parseFloat(radius) || 3, 50); // 최대 50km 캡

    if (!Number.isFinite(userLat) || !Number.isFinite(userLon)) {
        return res.status(400).json({ ok: false, error: '유효하지 않은 좌표예요.' });
    }

    // 좌표 있는 open 작업 전체 조회 (trig 없으므로 JS에서 필터)
    const rows = db.prepare(`
        SELECT * FROM jobs
        WHERE  status    = 'open'
          AND  latitude  IS NOT NULL
          AND  longitude IS NOT NULL
    `).all();

    // Haversine 거리 계산 → 반경 내 필터 → 거리 오름차순
    const nearby = rows
        .map(r => {
            const job  = normalizeJob(r);
            const dist = distanceKm(userLat, userLon, job.latitude, job.longitude);
            return jobView(job, { userLat, userLon });
        })
        .filter(j => j.distKm !== null && j.distKm <= radiusKm)
        .sort((a, b) => a.distKm - b.distKm)
        .slice(0, 50);

    console.log(`[NEARBY_JOBS] lat=${userLat} lng=${userLon} radius=${radiusKm}km → ${nearby.length}건`);
    return res.json({ ok: true, jobs: nearby, count: nearby.length, radiusKm });
});

// ─── GET /api/jobs/map ────────────────────────────────────────
// 지도 마커용 경량 데이터 (open + 실제 GPS 좌표만)
// GEO_AI_PAID: isSponsored + aiScore 포함, 스폰서 우선 정렬
router.get('/map', (req, res) => {
    const { lat, lon } = req.query;
    const userLat = lat ? parseFloat(lat) : null;
    const userLon = lon ? parseFloat(lon) : null;
    const today   = new Date().toISOString().slice(0, 10);
    const now     = Date.now();

    const rows = db.prepare(`
        SELECT id, category, locationText, pay, date, latitude, longitude,
               isUrgent, isUrgentPaid, areaPyeong, areaSize, areaUnit,
               farmImages, imageUrl, farmAddress, difficulty
        FROM   jobs
        WHERE  status   = 'open'
          AND  latitude  IS NOT NULL
          AND  longitude IS NOT NULL
          AND  NOT (latitude = 37.5 AND longitude = 127.0)
    `).all().map(r => ({ ...r, isUrgent: !!r.isUrgent, isUrgentPaid: !!r.isUrgentPaid }));

    // 스폰서 ID 셋 (만료 안 된 것만)
    const sponsoredIds = new Set(
        db.prepare('SELECT jobId FROM sponsored_jobs WHERE expiresAt > ?').all(now).map(r => r.jobId)
    );

    const markers = rows.map(job => {
        const dist = (userLat && userLon)
            ? distanceKm(userLat, userLon, job.latitude, job.longitude)
            : null;
        const imgs     = parseFarmImages(job.farmImages);
        const thumbUrl = imgs[0] || job.imageUrl || null;
        const isSpon   = sponsoredIds.has(job.id);
        const isToday  = !!(job.date && job.date.slice(0, 10) === today);

        // ── AI 추천 점수 계산 (GEO_AI_PAID) ──
        // 스폰서(+50) > 급구유료(+35) > 급구(+20) > 오늘(+15) > 거리 근접(최대+20)
        let aiScore = 0;
        if (isSpon)              aiScore += 50;
        if (job.isUrgentPaid)    aiScore += 35;
        if (job.isUrgent)        aiScore += 20;
        if (isToday)             aiScore += 15;
        if (dist !== null)       aiScore += Math.max(0, 20 - Math.floor(dist));
        // 난이도 낮을수록 접근성 ↑ (+최대 10)
        if (job.difficulty != null) aiScore += Math.round((1 - job.difficulty) * 10);

        return {
            id:           job.id,
            category:     job.category,
            locationText: job.locationText,
            pay:          job.pay   || null,
            date:         job.date,
            lat:          job.latitude,
            lng:          job.longitude,
            isToday,
            isUrgent:     job.isUrgent,
            isUrgentPaid: job.isUrgentPaid,
            isSponsored:  isSpon,
            aiScore,
            distKm:       dist !== null ? Math.round(dist * 10) / 10 : null,
            areaPyeong:   job.areaPyeong || null,
            thumbUrl,
            farmAddress:  job.farmAddress || null,
        };
    });

    // GEO_AI_PAID: AI 점수 내림차순 정렬 (스폰서 자동 상단)
    markers.sort((a, b) => b.aiScore - a.aiScore);

    console.log(`[MAP_DATA_FETCH] count=${markers.length} sponsored=${[...sponsoredIds].length} gps=${userLat ? 'on' : 'off'}`);
    return res.json({ ok: true, markers });
});

// ─── GET /api/jobs/:id/match — PHASE_AI_MATCHING_MAP_V1 ──────
// 작업 기준 가장 가까운 작업자 TOP 5
router.get('/:id/match', (req, res) => {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    const job = normalizeJob(row);

    // 좌표 있는 작업자(users role='worker') 조회
    const workers = db.prepare(
        "SELECT id, name, lat, lng, phone, categories FROM users WHERE role = 'worker' AND lat IS NOT NULL AND lng IS NOT NULL"
    ).all();

    const matches = findNearestWorkers(job, workers, 5);
    return res.json({
        ok: true,
        jobId:   job.id,
        matches: matches.map(m => ({
            workerId: m.worker.id,
            name:     m.worker.name,
            phone:    m.worker.phone,
            distKm:   m.distKm,
        })),
    });
});

// ─── GET /api/jobs/:id ────────────────────────────────────────
// PHASE DRIVE_TIME V2: 단건 상세 조회 — 실제 경로 이동시간 포함 (async)
router.get('/:id', async (req, res) => {
    try {
        const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
        if (!row) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

        const job = jobView(normalizeJob(row));

        // 사용자 위치 (query: ?lat=&lon=)
        const userLat = parseFloat(req.query.lat) || null;
        const userLon = parseFloat(req.query.lon) || null;

        // 실제 경로 이동시간 — Kakao API 키 없거나 좌표 없으면 null (fail-safe)
        let driveMin    = null;
        let driveSource = 'estimate'; // 'kakao' | 'estimate'
        if (
            userLat && userLon &&
            Number.isFinite(job.latitude) && Number.isFinite(job.longitude)
        ) {
            const kakaoMin = await getDriveTime(
                { lat: userLat, lng: userLon },
                { lat: job.latitude, lng: job.longitude }
            );
            if (kakaoMin != null) {
                driveMin    = kakaoMin;
                driveSource = 'kakao';
            }
        }

        return res.json({ ok: true, job: { ...job, driveMin, driveSource } });
    } catch (e) {
        console.error('[JOB_DETAIL_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '상세 조회 중 오류가 발생했어요.' });
    }
});

// ─── POST /api/jobs/:id/apply ─────────────────────────────────
router.post('/:id/apply', (req, res) => {
    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    // Phase 8: 상태별 차단 메시지 + 로그 분리
    if (job.status === 'closed') {
        console.log(`[JOB_APPLY_BLOCKED_CLOSED] jobId=${job.id}`);
        return res.status(400).json({ ok: false, error: '마감된 일자리입니다.' });
    }
    if (job.status === 'matched') {
        return res.status(400).json({ ok: false, error: '이미 연결이 완료된 일자리입니다.' });
    }
    if (job.status !== 'open') {
        return res.status(400).json({ ok: false, error: '현재 지원을 받지 않는 작업이에요.' });
    }

    const { workerId, message = '' } = req.body;
    if (!workerId) return res.status(400).json({ ok: false, error: 'workerId가 필요해요.' });

    // PHASE 29: rate limit — 1초 내 동일 workerId 중복 호출 차단
    const now = Date.now();
    const lastAt = applyRateLimit.get(workerId) || 0;
    if (now - lastAt < APPLY_RATE_MS) {
        return res.status(429).json({ ok: false, error: '잠시 후 다시 시도해주세요.' });
    }
    applyRateLimit.set(workerId, now);
    // 메모리 누수 방지: 5분 지난 항목 주기적 정리 (최대 1만 개 이상 시)
    if (applyRateLimit.size > 10000) {
        const cutoff = now - 300000;
        for (const [k, v] of applyRateLimit) { if (v < cutoff) applyRateLimit.delete(k); }
    }

    // 중복 지원 방지
    const already = db.prepare(
        'SELECT id FROM applications WHERE jobRequestId = ? AND workerId = ?'
    ).get(job.id, workerId);
    if (already) return res.status(409).json({ ok: false, error: '이미 지원했어요.' });

    const id  = newId('app');
    const app = {
        id, jobRequestId: job.id, workerId, message,
        status: 'applied', createdAt: new Date().toISOString(),
    };
    db.prepare(`
        INSERT INTO applications (id, jobRequestId, workerId, message, status, createdAt)
        VALUES (@id, @jobRequestId, @workerId, @message, @status, @createdAt)
    `).run(app);

    console.log(`[APPLY] jobId=${job.id} workerId=${workerId}`);
    console.log(`[JOB_APPLIED] jobId=${job.id} workerId=${workerId}`);
    trackEvent('job_applied', { jobId: job.id, userId: workerId, meta: { category: job.category } });

    // Phase 12: 재유입 지원 추적 — 이 workerId가 해당 job의 reengage_alert 대상이었는지 확인
    try {
        const wasReengaged = db.prepare(
            "SELECT id FROM analytics WHERE event = 'reengage_alert' AND jobId = ? AND userId = ? LIMIT 1"
        ).get(job.id, workerId);
        if (wasReengaged) {
            trackEvent('reengage_apply_returned', {
                jobId:  job.id,
                userId: workerId,
                meta:   { category: job.category },
            });
            console.log(`[REENGAGE_APPLY_RETURNED] jobId=${job.id} workerId=${workerId}`);
        }
    } catch (e) {
        console.error('[REENGAGE_APPLY_CHECK_ERROR]', e.message);
    }

    // Phase 17: 농민에게 즉시 알림 — setImmediate로 응답 지연 없음 (fire-and-forget)
    setImmediate(() => {
        try {
            const farmer = db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(job.requesterId);
            const worker = db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(workerId);
            sendApplyAlert({ job, worker: worker || { id: workerId, name: '지원자' }, farmer: farmer || null });
        } catch (e) {
            console.error('[APPLY_ALERT_ERROR]', e.message);
        }
    });

    // DESIGN_V4: 지원 즉시 농민 연락처 공개 (InstantConnect 흐름 지원)
    let contactInfo = null;
    try {
        const farmer = db.prepare('SELECT name, phone FROM users WHERE id = ?').get(job.requesterId);
        if (farmer?.phone) {
            contactInfo = { farmerName: farmer.name || '농민', contact: farmer.phone };
        }
    } catch (e) { /* fail-safe: 연락처 없어도 지원은 완료 */ }

    // PHASE 29: 자동 선택 체크 — 지원자 ≥3명 AND 상위점수 ≥63점 이면 자동 매칭
    setImmediate(async () => {
        try {
            const result = await checkAndAutoSelect(job.id);
            if (!result.skipped) {
                console.log(`[AUTO_SELECT_TRIGGERED] jobId=${job.id} selected=${result.selected} score=${result.score}`);
            }
        } catch (e) {
            console.error('[AUTO_SELECT_TRIGGER_ERROR]', e.message);
        }
    });

    return res.status(201).json({ ok: true, application: app, ...contactInfo });
});

// ─── GET /api/jobs/:id/contact ────────────────────────────────
// Phase 20: 지원자(workerId)에게 농민 연락처 제공
// 보안: 반드시 해당 job에 지원한 workerId만 조회 가능
router.get('/:id/contact', (req, res) => {
    const { workerId } = req.query;
    if (!workerId) return res.status(400).json({ ok: false, error: 'workerId가 필요해요.' });

    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    // 지원 이력 확인 — 지원하지 않은 사용자는 연락처 조회 불가
    const application = db.prepare(
        'SELECT id, status FROM applications WHERE jobRequestId = ? AND workerId = ?'
    ).get(job.id, workerId);
    if (!application) {
        console.log(`[CONTACT_DENIED] jobId=${job.id} workerId=${workerId} reason=no_application`);
        return res.status(403).json({ ok: false, error: '지원한 작업의 연락처만 확인할 수 있어요.' });
    }

    // 농민 정보 조회
    const farmer = db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(job.requesterId);
    if (!farmer || !farmer.phone) {
        // 농민 계정이 없을 경우 job.requesterName만 반환
        return res.json({
            ok: true,
            name: job.requesterName || '농민',
            phoneMasked: null,
            phoneFull: null,
            noPhone: true,
        });
    }

    // 전화번호 부분 마스킹: 010-1234-5678 → 010-****-5678
    const raw = farmer.phone.replace(/[^0-9]/g, '');
    const phoneMasked = raw.length >= 8
        ? raw.replace(/(\d{3})(\d{4})(\d{4})/, '$1-****-$3')
        : '***-****-****';

    console.log(`[CONTACT_OK] jobId=${job.id} workerId=${workerId} farmer=${farmer.name}`);
    trackEvent('contact_revealed', { jobId: job.id, userId: workerId, meta: { category: job.category } });

    return res.json({
        ok: true,
        name: farmer.name,
        phoneMasked,
        phoneFull: farmer.phone,
        noPhone: false,
    });
});

// ─── POST /api/jobs/:id/contact — ACTION_BUTTON_SIMPLIFY_V2 ───
// 연락 시도 로그: contactCount 증가 + lastContactAt 갱신
// auth 불필요 — 클라이언트 fire-and-forget 방식
router.post('/:id/contact', (req, res) => {
    const now = new Date().toISOString();
    const result = db.prepare(`
        UPDATE jobs
        SET lastContactAt = ?,
            contactCount  = COALESCE(contactCount, 0) + 1
        WHERE id = ?
    `).run(now, req.params.id);

    if (result.changes === 0) {
        return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    }

    const row = db.prepare('SELECT id, contactCount, lastContactAt FROM jobs WHERE id = ?').get(req.params.id);
    console.log(`[CONTACT_ATTEMPT] jobId=${req.params.id} contactCount=${row?.contactCount}`);
    return res.json({ ok: true, contactCount: row?.contactCount });
});

// ─── POST /api/jobs/:id/contact-apply — CONTACT_TO_MATCH_AUTOFLOW_V1 ───
// 연락 클릭 → 자동 지원 생성 + 상태 전환 + Kakao 알림
// idempotent: 동일 workerId 중복 호출 시 already:true 반환
router.post('/:id/contact-apply', async (req, res) => {
    const jobId    = req.params.id;
    const workerId = req.body?.workerId || 'anonymous';
    const now      = new Date().toISOString();

    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    // ── 중복 방지 (idempotent) ─────────────────────────────────────
    // 이미 in_progress/matched/done/closed 이고 같은 workerId면 이미 처리됨
    if (
        (job.status === 'in_progress' || job.status === 'matched') &&
        job.selectedWorkerId === workerId
    ) {
        console.log(`[CONTACT_APPLY_SKIP] jobId=${jobId} workerId=${workerId} reason=already_matched`);
        return res.json({ ok: true, already: true, status: job.status });
    }

    // 다른 작업자가 이미 진행 중이면 거부
    if (job.status === 'in_progress' && job.selectedWorkerId && job.selectedWorkerId !== workerId) {
        return res.status(409).json({ ok: false, error: '이미 다른 작업자가 진행 중이에요.' });
    }

    // ── 1. applications 레코드 생성 ───────────────────────────────
    const appId = `app-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const existingApp = db.prepare(
        "SELECT id FROM applications WHERE jobRequestId = ? AND workerId = ? AND status != 'cancelled'"
    ).get(jobId, workerId);

    if (!existingApp) {
        db.prepare(`
            INSERT INTO applications (id, jobRequestId, workerId, message, status, createdAt)
            VALUES (?, ?, ?, ?, 'pending', ?)
        `).run(appId, jobId, workerId, '바로 연락하기 (자동 지원)', now);
        console.log(`[CONTACT_APPLY_APP] appId=${appId} jobId=${jobId} workerId=${workerId}`);
    }

    // ── 2. job 상태 → matched (농민이 작업 시작 버튼 누를 수 있도록) ─
    db.prepare(`
        UPDATE jobs
        SET status           = 'matched',
            selectedWorkerId = ?,
            contactRevealed  = 1,
            appliedAt        = ?,
            scheduledAt      = ?,
            contactCount     = COALESCE(contactCount, 0) + 1,
            lastContactAt    = ?
        WHERE id = ?
    `).run(workerId, now, now, now, jobId);

    console.log(`[CONTACT_APPLY_DONE] jobId=${jobId} workerId=${workerId} status=matched`);

    // ── 3. Kakao 알림 (농민에게) — fail-safe ─────────────────────
    const farmer = db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(job.requesterId);
    sendContactAlert(
        { ...job, farmerPhone: farmer?.phone },
        { id: workerId, name: req.body?.workerName || '작업자' }
    ).catch(() => {});

    return res.json({ ok: true, already: false, status: 'matched' });
});

// ─── POST /api/jobs/:id/reschedule — PHASE_COMPLETE_SETTLEMENT_WS_V1 ───
// 일정 변경 + Kakao 알림 + WS 브로드캐스트
router.post('/:id/reschedule', (req, res) => {
    const jobId       = req.params.id;
    const { scheduledAt, requesterId } = req.body;

    if (!scheduledAt) return res.status(400).json({ ok: false, error: 'scheduledAt이 필요해요.' });

    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    db.prepare('UPDATE jobs SET scheduledAt = ? WHERE id = ?').run(scheduledAt, jobId);

    // Kakao 알림 (콘솔 MOCK)
    const msg = `[농촌일손]\n일정이 변경되었습니다.\n${job.category || '작업'} | ${job.locationText || ''}\n새 일정: ${scheduledAt}`;
    console.log(`[SCHEDULE_NOTIFY] jobId=${jobId} newDate=${scheduledAt}`);
    console.log(msg);

    // WS 브로드캐스트
    if (global.broadcast) {
        global.broadcast({ type: 'job_rescheduled', jobId, scheduledAt });
    }

    return res.json({ ok: true, scheduledAt });
});

// ─── GET /api/jobs/:id/applicants (PHASE 28: 스마트 매칭 정렬) ──
router.get('/:id/applicants', (req, res) => {
    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { requesterId } = req.query;
    if (requesterId && job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 요청만 볼 수 있어요.' });
    }

    // PHASE 28: idx_applications_job_created 인덱스 활용 — createdAt ASC (원본 순서)
    const apps = db.prepare(
        "SELECT * FROM applications WHERE jobRequestId = ? AND status != 'cancelled' ORDER BY createdAt ASC"
    ).all(job.id);

    // 지원자별 스코어 계산
    const raw = apps.map(a => {
        // BUG_FIX: workerId = user-xxx (workers 프로필 없이 지원한 경우) 대응
        // 1) workers.id 조회  2) workers.userId 조회  3) users 테이블 fallback
        let workerRow = db.prepare('SELECT * FROM workers WHERE id = ?').get(a.workerId)
                     || db.prepare('SELECT * FROM workers WHERE userId = ?').get(a.workerId);
        if (!workerRow) {
            const u = db.prepare(
                'SELECT id, name, phone, lat, lng, locationText, completedJobs, rating FROM users WHERE id = ?'
            ).get(a.workerId);
            if (u) workerRow = {
                id: a.workerId, userId: u.id,
                name: u.name || '작업자', phone: u.phone,
                baseLocationText: u.locationText || '', categories: '[]',
                hasTractor: 0, hasSprayer: 0, hasRotary: 0,
                completedJobs: u.completedJobs || 0, rating: u.rating || 0,
                availableTimeText: null, noshowCount: 0,
                ratingAvg: null, ratingCount: 0,
                latitude: u.lat, longitude: u.lng,
                locationUpdatedAt: null, activeNow: 0,
            };
        }
        const worker = normalizeWorker(workerRow);
        const dist = (job.latitude && job.longitude && worker?.latitude && worker?.longitude)
            ? distanceKm(job.latitude, job.longitude, worker.latitude, worker.longitude)
            : null;
        const distKm = dist !== null ? Math.round(dist * 10) / 10 : null;

        // 지원 속도 (job 등록 후 몇 분 만에 지원했는지)
        const jobMs    = new Date(job.createdAt).getTime();
        const appMs    = new Date(a.createdAt).getTime();
        const speedMins = Math.round(Math.max(0, (appMs - jobMs) / 60000));

        // PHASE 30: 리뷰 수 조회 → 평점 초기 보정에 사용
        const reviewCount = worker
            ? (db.prepare('SELECT COUNT(*) AS cnt FROM reviews WHERE targetId = ?').get(worker.id)?.cnt || 0)
            : 0;

        // PHASE 28+30 + AI_MATCH_V2: 매칭 점수 (worker 없으면 null)
        const baseScore = worker
            ? calcApplicantMatchScore(worker, a, job, distKm, reviewCount)
            : null;
        const v2Bonus  = worker ? calcV2Bonus(worker, job) : 0;
        const matchScore = baseScore !== null ? Math.round(baseScore + v2Bonus) : null;

        return {
            applicationId: a.id,
            status:        a.status,
            message:       a.message,
            createdAt:     a.createdAt,
            // PHASE 28
            matchScore,
            speedMins,
            worker: worker ? {
                id:               worker.id,
                name:             worker.name,
                baseLocationText: worker.baseLocationText,
                categories:       worker.categories,
                hasTractor:       worker.hasTractor,
                hasSprayer:       worker.hasSprayer,
                hasRotary:        worker.hasRotary,
                completedJobs:    worker.completedJobs,
                rating:           worker.rating,
                availableTimeText: worker.availableTimeText,
                noshowCount:      worker.noshowCount  || 0, // TRUST_SYSTEM
                ratingAvg:        worker.ratingAvg   ?? null, // REVIEW_UX
                ratingCount:      worker.ratingCount ?? 0,
                topTags:          (() => {
                    const tagRows = db.prepare(
                        'SELECT tags FROM reviews WHERE targetId = ? AND isPublic = 1 AND tags IS NOT NULL'
                    ).all(worker.id);
                    const freq = {};
                    tagRows.forEach(row => {
                        try {
                            const arr = JSON.parse(row.tags);
                            if (Array.isArray(arr)) arr.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
                        } catch {}
                    });
                    return Object.entries(freq)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([tag]) => tag);
                })(),
                distKm,
                distLabel:        dist !== null ? distLabel(dist) : null,
                // ACTIVE_NOW_RELIABILITY: 클라이언트 상대 시간 표시용
                locationUpdatedAt: worker.locationUpdatedAt ?? null,
                activeNow:         worker.activeNow         ?? 0,
                // AUTO_MATCH_NOTIFY: 선택 시각 (서버 기준) — 경과 시간 정확도 보장
                matchedAt: a.status === 'selected' ? (job.selectedAt ?? null) : null,
            } : null,
        };
    });

    // PHASE 28: matchScore 내림차순 정렬 + rank 부여
    const result = rankApplicants(raw);

    // TRACE: null worker 건수 추적 — worker 없는 지원서는 렌더 스킵됨
    const nullWorkerCount = result.filter(a => !a.worker).length;
    if (nullWorkerCount > 0) {
        console.warn(`[BROKEN_LINK][APPLICANTS] jobId=${job.id} nullWorkers=${nullWorkerCount}/${result.length} — workerIds=${raw.filter(a => !a.worker).map(a => a.applicationId).join(',')}`);
    }
    console.log(`[TRACE][APPLICANTS] jobId=${job.id} total=${result.length} nullWorkers=${nullWorkerCount} top=${result[0]?.worker?.name ?? 'none'} score=${result[0]?.matchScore ?? 'N/A'}`);
    console.log(`[APPLICANT_VIEWED_RANKED] jobId=${job.id} count=${result.length} top=${result[0]?.worker?.name ?? 'none'} score=${result[0]?.matchScore ?? 'N/A'}`);
    return res.json({ ok: true, applicants: result });
});

// ─── POST /api/jobs/:id/select-worker ─────────────────────────
router.post('/:id/select-worker', (req, res) => {
    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { requesterId, workerId } = req.body;
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 요청만 선택할 수 있어요.' });
    }

    // Phase 7: 스팸 방지 — 이미 선택이 완료된 작업이면 차단
    if (job.status === 'matched') {
        return res.status(400).json({ ok: false, error: '이미 작업자를 선택한 요청이에요.' });
    }

    // BUG_FIX: workerId = user-xxx 대응 (workers 프로필 없이 지원한 경우)
    let workerRowSel = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId)
                    || db.prepare('SELECT * FROM workers WHERE userId = ?').get(workerId);
    if (!workerRowSel) {
        const u = db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(workerId);
        if (u) workerRowSel = {
            id: workerId, userId: u.id,
            name: u.name || '작업자', phone: u.phone,
            categories: '[]', hasTractor: 0, hasSprayer: 0, hasRotary: 0,
            completedJobs: 0, rating: 0, noshowCount: 0,
        };
    }
    const worker = normalizeWorker(workerRowSel);
    console.log(`[TRACE][SELECT_WORKER] jobId=${req.params.id} workerId=${workerId} resolved=${worker ? worker.name : 'NULL'}`);
    if (!worker) {
        console.warn(`[BROKEN_LINK][SELECT_WORKER] workerId=${workerId} not found in workers or users`);
        return res.status(404).json({ ok: false, error: '작업자를 찾을 수 없어요.' });
    }

    // Phase 7: 실제 농민 연락처 조회
    const farmerUser = db.prepare('SELECT phone FROM users WHERE id = ?').get(job.requesterId);
    const farmerPhone = farmerUser?.phone || '010-0000-0000';

    // 트랜잭션: 상태 일괄 업데이트 + contactRevealed/selectedWorkerId 설정
    db.transaction(() => {
        db.prepare(
            "UPDATE jobs SET status = 'matched', contactRevealed = 1, selectedWorkerId = ?, selectedAt = ? WHERE id = ?"
        ).run(workerId, new Date().toISOString(), job.id);
        db.prepare("UPDATE applications SET status = 'selected' WHERE jobRequestId = ? AND workerId = ?").run(job.id, workerId);
        db.prepare("UPDATE applications SET status = 'rejected' WHERE jobRequestId = ? AND workerId != ?").run(job.id, workerId);

        // 연락처 영속화 (contacts 테이블)
        const contactId = 'contact-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        try {
            db.prepare(`
                INSERT OR IGNORE INTO contacts (id, jobId, farmerId, workerId, createdAt)
                VALUES (@id, @jobId, @farmerId, @workerId, @createdAt)
            `).run({
                id:        contactId,
                jobId:     job.id,
                farmerId:  job.requesterId,
                workerId:  workerId,
                createdAt: new Date().toISOString(),
            });
        } catch (_) { /* UNIQUE 충돌 시 무시 */ }
    })();

    console.log(`[CONTACT_STORED] jobId=${job.id} farmerId=${job.requesterId} workerId=${workerId}`);

    // 알림 훅 (콘솔 로그 → 카카오 알림톡으로 확장 가능)
    sendSelectionNotification(job, worker);

    console.log(`[JOB_MATCHED] jobId=${job.id} workerId=${workerId}`);
    console.log(`[SELECT_WORKER] jobId=${job.id} workerId=${workerId} farmerPhone=***${farmerPhone.slice(-4)}`);
    console.log(`[CONTACT_REVEALED] jobId=${job.id} farmer<->worker contactRevealed=1`);
    trackEvent('worker_selected', { jobId: job.id, userId: requesterId, meta: { workerId } });

    return res.json({
        ok: true,
        contact: {
            workerName:  worker.name,
            workerPhone: worker.phone,
            farmerName:  job.requesterName,
            farmerPhone,
            message: `${worker.name}님이 선택되었어요! 연락처를 확인하고 직접 연락해보세요.`,
        },
    });
});

// ─── POST /api/jobs/:id/connect-call (PHASE 29) ──────────────
// 농민 또는 선택된 작업자만 조회 가능 — 전화번호 반환
router.post('/:id/connect-call', (req, res) => {
    const { requestingUserId } = req.body;
    if (!requestingUserId) {
        return res.status(400).json({ ok: false, error: 'requestingUserId가 필요해요.' });
    }

    const result = getCallInfo(req.params.id, requestingUserId);
    if (!result.ok) {
        console.warn(`[BROKEN_LINK][CONNECT_CALL] jobId=${req.params.id} userId=${requestingUserId} error=${result.error}`);
        return res.status(403).json(result);
    }

    console.log(`[TRACE][CONNECT_CALL] jobId=${req.params.id} userId=${requestingUserId} farmerPhone=${result.farmerPhone ? '***'+result.farmerPhone.slice(-4) : 'null'} workerPhone=${result.workerPhone ? '***'+result.workerPhone.slice(-4) : 'null'}`);
    console.log(`[CONNECT_CALL] jobId=${req.params.id} userId=${requestingUserId}`);
    return res.json(result);
});

// ─── POST /api/jobs/:id/close ─────────────────────────────────
router.post('/:id/close', (req, res) => {
    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { requesterId } = req.body;
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 요청만 마감할 수 있어요.' });
    }
    if (job.status === 'closed') {
        return res.status(400).json({ ok: false, error: '이미 마감된 작업이에요.' });
    }

    db.prepare("UPDATE jobs SET status = 'closed', closedAt = ? WHERE id = ?")
      .run(new Date().toISOString(), job.id);

    // TRUST_SYSTEM: 노쇼 추적 — matched 상태에서 마감 = 작업자 노쇼로 간주
    if (job.status === 'matched' && job.selectedWorkerId) {
        try {
            db.prepare(
                'UPDATE workers SET noshowCount = COALESCE(noshowCount, 0) + 1 WHERE id = ?'
            ).run(job.selectedWorkerId);
            console.log(`[NOSHOW_TRACKED] jobId=${job.id} workerId=${job.selectedWorkerId}`);
        } catch (e) {
            console.warn('[NOSHOW_TRACK_FAIL]', e.message);
        }
    }

    console.log(`[JOB_CLOSED] id=${job.id} prevStatus=${job.status} farmer=${requesterId}`);
    trackEvent('job_closed', { jobId: job.id, userId: requesterId, meta: { prevStatus: job.status } });

    return res.json({ ok: true, status: 'closed' });
});

// ─── POST /api/jobs/:id/start ─────────────────────────────────
router.post('/:id/start', (req, res) => {
    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { requesterId } = req.body;
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 작업만 시작할 수 있어요.' });
    }
    if (job.status !== 'matched') {
        return res.status(400).json({ ok: false, error: `현재 상태(${job.status})에서는 시작할 수 없어요.` });
    }

    const startedAt = new Date().toISOString();
    db.prepare("UPDATE jobs SET status = 'in_progress', startedAt = ? WHERE id = ?").run(startedAt, job.id);

    // 선택된 작업자 조회 → 알림
    const selApp = db.prepare(
        "SELECT workerId FROM applications WHERE jobRequestId = ? AND status = 'selected'"
    ).get(job.id);
    if (selApp) {
        const worker = normalizeWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(selApp.workerId));
        if (worker) sendJobStartedNotification(job, worker);
    }

    console.log(`[JOB_STARTED] id=${job.id} startedAt=${startedAt}`);

    // PHASE 32: 10분 후 이탈 방지 독촉 알림
    // 아직 in_progress 상태면 작업자에게 "출발하셨나요?" 메시지
    const reminderJobId  = job.id;
    const reminderWorker = selApp
        ? normalizeWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(selApp.workerId))
        : null;

    if (reminderWorker) {
        setTimeout(async () => {
            try {
                await tryFireReminder(reminderJobId, reminderWorker);
            } catch (e) {
                console.error('[DEPARTURE_REMINDER_ERROR]', e.message);
            }
        }, 10 * 60 * 1000); // 10분
        console.log(`[DEPARTURE_REMINDER_SCHEDULED] jobId=${job.id} worker=${reminderWorker.name} in 10min`);
    }

    return res.json({ ok: true, status: 'in_progress', startedAt });
});

// ─── POST /api/jobs/:id/complete ──────────────────────────────
router.post('/:id/complete', (req, res) => {
    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { requesterId } = req.body;
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 작업만 완료할 수 있어요.' });
    }
    if (job.status !== 'in_progress') {
        return res.status(400).json({ ok: false, error: `현재 상태(${job.status})에서는 완료할 수 없어요.` });
    }

    // PHASE 30: 작업 시작 기록 없으면 완전 차단 — 시작 버튼 누르지 않은 경우
    if (!job.startedAt) {
        return res.status(400).json({ ok: false, error: '작업 시작 버튼을 먼저 눌러야 완료할 수 있어요.' });
    }

    // PHASE 30: 최소 작업 시간 10분 — 악용/실수 방지
    const MIN_WORK_MS = 10 * 60 * 1000; // 10분
    if (job.startedAt) {
        const elapsed = Date.now() - new Date(job.startedAt).getTime();
        if (elapsed < MIN_WORK_MS) {
            const remainSec = Math.ceil((MIN_WORK_MS - elapsed) / 1000);
            const remainMin = Math.ceil(remainSec / 60);
            console.log(`[COMPLETE_TOO_FAST] jobId=${job.id} elapsed=${Math.round(elapsed/1000)}s`);
            return res.status(400).json({
                ok: false,
                error: `작업 시작 후 최소 ${remainMin}분이 지나야 완료할 수 있어요.`,
                remainSec,
            });
        }
    }

    // PHASE_COMPLETE_SETTLEMENT_WS_V1: 정산 필드 + completedAt
    const completedAt = new Date().toISOString();
    const payNum = (() => {
        const raw = String(job.pay || '').replace(/[^0-9]/g, '');
        return raw ? parseInt(raw, 10) : null;
    })();

    db.prepare(`
        UPDATE jobs
        SET status      = 'done',
            completedAt = ?,
            paid        = 1,
            payAmount   = COALESCE(payAmount, ?)
        WHERE id = ?
    `).run(completedAt, payNum, job.id);

    // PHASE_ADMIN_DASHBOARD_AI_V2: 작업자 완료 통계 갱신
    if (job.selectedWorkerId) {
        try {
            const wRow = db.prepare('SELECT id, completedJobs FROM workers WHERE userId = ?').get(job.selectedWorkerId);
            if (wRow) {
                const newCompleted = (wRow.completedJobs || 0) + 1;
                const totalApps   = db.prepare(
                    "SELECT COUNT(*) AS n FROM applications WHERE workerId = ?"
                ).get(wRow.id)?.n || 1;
                const newSuccessRate = Math.round((newCompleted / Math.max(1, totalApps)) * 100) / 100;
                db.prepare('UPDATE workers SET completedJobs = ?, successRate = ? WHERE id = ?')
                  .run(newCompleted, newSuccessRate, wRow.id);
                console.log(`[WORKER_STATS] workerId=${wRow.id} completedJobs=${newCompleted} successRate=${newSuccessRate}`);
            }
        } catch (e) {
            console.warn('[WORKER_STATS_FAIL]', e.message);
        }
    }

    // 선택된 작업자 조회 → 알림
    const selApp = db.prepare(
        "SELECT workerId FROM applications WHERE jobRequestId = ? AND status = 'selected'"
    ).get(job.id);
    if (selApp) {
        const worker = normalizeWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(selApp.workerId));
        if (worker) sendJobCompletedNotification(job, worker);
    }

    console.log(`[JOB_COMPLETED] id=${job.id} payAmount=${payNum} paid=1`);
    // PHASE_PAYMENT_ESCROW_V1: 에스크로 정산 로그
    if (job.paymentStatus === 'paid') {
        console.log(`[SETTLEMENT_ESCROW] jobId=${job.id} paymentId=${job.paymentId} netAmount=${job.netAmount} fee=${job.fee} → 정산 완료`);
    } else {
        console.log(`[SETTLEMENT_WARNING] jobId=${job.id} paymentStatus=${job.paymentStatus ?? 'pending'} — 결제 없이 완료됨`);
    }
    console.log(`[SETTLEMENT] jobId=${job.id} payAmount=${payNum ?? 'unknown'} completedAt=${completedAt}`);
    trackEvent('job_completed', { jobId: job.id, userId: requesterId, meta: { category: job.category } });

    // WS 브로드캐스트
    if (global.broadcast) {
        global.broadcast({ type: 'job_completed', jobId: job.id, payAmount: payNum, completedAt });
    }

    return res.json({ ok: true, status: 'done', paid: true, payAmount: payNum, completedAt });
});

// ─── POST /api/jobs/:id/complete-work ────────────────────────
// PHASE 22: 작업자가 자신의 application을 'completed'로 처리
router.post('/:id/complete-work', (req, res) => {
    const { workerId } = req.body;
    if (!workerId) return res.status(400).json({ ok: false, error: 'workerId가 필요해요.' });

    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const app = db.prepare(
        'SELECT * FROM applications WHERE jobRequestId = ? AND workerId = ?'
    ).get(job.id, workerId);
    if (!app) return res.status(403).json({ ok: false, error: '지원 이력이 없어요.' });
    if (app.status === 'completed') {
        return res.status(400).json({ ok: false, error: '이미 완료 처리된 작업이에요.' });
    }

    db.prepare(
        "UPDATE applications SET status = 'completed', completedAt = ? WHERE id = ?"
    ).run(new Date().toISOString(), app.id);

    console.log(`[APP_COMPLETED] jobId=${job.id} workerId=${workerId}`);
    trackEvent('work_completed', { jobId: job.id, userId: workerId, meta: { category: job.category } });
    return res.json({ ok: true, status: 'completed' });
});

// ─── POST /api/jobs/:id/review ────────────────────────────────
// TRUST_SYSTEM: 양방향 리뷰 (농민↔작업자) + 태그 + 블라인드 공개
// - isPublic=0 으로 저장 → 양측 작성 완료 시 isPublic=1 자동 공개 (보복 방지)
router.post('/:id/review', (req, res) => {
    // backward compat: workerId OR reviewerId 둘 다 허용
    const {
        workerId,
        reviewerId:   reviewerIdParam,
        targetId:     targetIdParam,
        rating,
        review:       comment = '',
        tags:         tagsRaw,
        reviewerRole: reviewerRoleRaw,  // 'farmer' | 'worker'
    } = req.body;

    const reviewerId = reviewerIdParam || workerId;
    if (!reviewerId) return res.status(400).json({ ok: false, error: 'reviewerId가 필요해요.' });

    const r = parseInt(rating);
    if (!r || r < 1 || r > 5) {
        return res.status(400).json({ ok: false, error: '평점은 1~5 사이여야 해요.' });
    }

    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    // 작성 자격 확인: 농민 OR 선택된 작업자
    const isFarmer = job.requesterId  === reviewerId;
    const isWorker = job.selectedWorkerId === reviewerId;
    if (!isFarmer && !isWorker) {
        // 하위호환: completed application도 허용
        const app = db.prepare(
            "SELECT id FROM applications WHERE jobRequestId = ? AND workerId = ?"
        ).get(job.id, reviewerId);
        if (!app) return res.status(403).json({ ok: false, error: '이 작업에 참여한 분만 후기를 남길 수 있어요.' });
    }

    // targetId: 명시적 or 역할 추론 (농민 → 작업자, 작업자 → 농민)
    const targetId = targetIdParam
        || (isFarmer ? job.selectedWorkerId : job.requesterId);
    if (!targetId) return res.status(400).json({ ok: false, error: '대상을 특정할 수 없어요. targetId를 전달해주세요.' });

    // 중복 방지
    const existing = db.prepare(
        'SELECT id FROM reviews WHERE jobId = ? AND reviewerId = ?'
    ).get(job.id, reviewerId);
    if (existing) return res.status(409).json({ ok: false, error: '이미 후기를 작성했어요.' });

    // tags 직렬화
    const tagsStr = Array.isArray(tagsRaw)
        ? JSON.stringify(tagsRaw)
        : (tagsRaw ? String(tagsRaw) : null);

    // reviewerRole: 명시 or 역할 추론
    const reviewerRole = reviewerRoleRaw || (isFarmer ? 'farmer' : 'worker');

    const id = newId('rev');
    db.prepare(`
        INSERT INTO reviews (id, jobId, reviewerId, targetId, rating, comment, tags, reviewerRole, isPublic, createdAt)
        VALUES (@id, @jobId, @reviewerId, @targetId, @rating, @comment, @tags, @reviewerRole, 0, @createdAt)
    `).run({ id, jobId: job.id, reviewerId, targetId, rating: r, comment, tags: tagsStr, reviewerRole, createdAt: new Date().toISOString() });

    // 누적 평점 갱신: 농민→작업자(workers), 작업자→농민(users)
    if (reviewerRole === 'farmer') {
        // targetId = workers.id
        const w = db.prepare('SELECT id, ratingAvg, ratingCount FROM workers WHERE id = ?').get(targetId);
        if (w) {
            const oldAvg   = w.ratingAvg   ?? 0;
            const oldCount = w.ratingCount ?? 0;
            const newCount = oldCount + 1;
            const newAvg   = Math.round(((oldAvg * oldCount) + r) / newCount * 10) / 10;
            db.prepare('UPDATE workers SET ratingAvg = ?, ratingCount = ? WHERE id = ?')
              .run(newAvg, newCount, w.id);
            console.log(`[RATING_UPDATED] workers id=${w.id} newAvg=${newAvg} newCount=${newCount}`);
        }
    } else {
        // targetId = users.id (farmer)
        const u = db.prepare('SELECT id, rating, reviewCount FROM users WHERE id = ?').get(targetId);
        if (u) {
            const oldAvg   = u.rating      ?? 0;
            const oldCount = u.reviewCount ?? 0;
            const newCount = oldCount + 1;
            const newAvg   = Math.round(((oldAvg * oldCount) + r) / newCount * 10) / 10;
            db.prepare('UPDATE users SET rating = ?, reviewCount = ? WHERE id = ?')
              .run(newAvg, newCount, u.id);
            console.log(`[RATING_UPDATED] users id=${u.id} newAvg=${newAvg} newCount=${newCount}`);
        }
    }

    // BLIND_REVEAL: 상대방도 작성했으면 양쪽 동시 공개 (보복 방지)
    const otherReview = db.prepare(
        'SELECT id FROM reviews WHERE jobId = ? AND reviewerId != ? AND isPublic = 0'
    ).get(job.id, reviewerId);
    let revealed = false;
    if (otherReview) {
        db.prepare('UPDATE reviews SET isPublic = 1 WHERE jobId = ?').run(job.id);
        revealed = true;
        console.log(`[REVIEW_BLIND_REVEAL] jobId=${job.id} — 양측 작성 완료 → 공개`);
    }

    console.log(`[REVIEW_SUBMITTED] jobId=${job.id} reviewerId=${reviewerId} target=${targetId} rating=${r} role=${reviewerRole} blind=${!revealed}`);
    trackEvent('review_submitted', { jobId: job.id, userId: reviewerId, meta: { rating: r, reviewerRole } });
    return res.status(201).json({ ok: true, revealed, waitingForOther: !revealed });
});

// ─── GET /api/jobs/:id/reviews ────────────────────────────────
// TRUST_SYSTEM: 공개 리뷰 + 자기가 쓴 리뷰 (블라인드 대기 중 포함)
router.get('/:id/reviews', (req, res) => {
    const { userId } = req.query;
    const reviews = db.prepare(`
        SELECT r.id, r.reviewerId, r.targetId, r.rating, r.comment, r.tags,
               r.isPublic, r.createdAt,
               u.name AS reviewerName
        FROM   reviews r
        LEFT JOIN users u ON u.id = r.reviewerId
        WHERE  r.jobId = ?
          AND  (r.isPublic = 1 OR r.reviewerId = ?)
        ORDER BY r.createdAt DESC
    `).all(req.params.id, userId || '');

    // tags 파싱
    const parsed = reviews.map(rv => ({
        ...rv,
        tags: (() => { try { return rv.tags ? JSON.parse(rv.tags) : []; } catch { return []; } })(),
        isPublic: !!rv.isPublic,
        waitingForOther: !rv.isPublic,
    }));

    return res.json({ ok: true, reviews: parsed, count: parsed.length });
});

// ─── PHASE RETENTION: POST /api/jobs/:id/rematch ─────────────
// 완료된 작업 → 미선택 지원자에게 재매칭 알림
router.post('/:id/rematch', (req, res) => {
    const { requesterId } = req.body;
    if (!requesterId) return res.status(400).json({ ok: false, error: 'requesterId가 필요해요.' });

    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    if (job.requesterId !== requesterId) return res.status(403).json({ ok: false, error: '권한이 없어요.' });
    if (!['done', 'closed'].includes(job.status)) {
        return res.status(400).json({ ok: false, error: '완료 또는 마감된 작업에만 재매칭을 요청할 수 있어요.' });
    }

    // 미선택 지원자 조회 (selected 또는 cancelled 제외)
    const candidates = db.prepare(`
        SELECT a.workerId, w.name, w.phone
        FROM applications a
        LEFT JOIN workers w ON w.id = a.workerId
        WHERE a.jobRequestId = ?
          AND a.status = 'applied'
          AND a.workerId != ?
    `).all(job.id, job.selectedWorkerId || '');

    if (candidates.length === 0) {
        return res.json({ ok: true, message: '재매칭 가능한 지원자가 없습니다.', count: 0 });
    }

    // 알림 발송 (fire-and-forget, fail-safe)
    setImmediate(() => {
        try {
            const { sendSms } = require('../services/smsService');
            const msg = `[농촌 일손] ${job.category} 작업에 다시 연결 요청이 왔습니다! 확인해보세요.`;
            for (const c of candidates) {
                if (c.phone) sendSms(c.phone, msg).catch(() => {});
            }
        } catch (_) {}
    });

    console.log(`[REMATCH] jobId=${job.id} candidates=${candidates.length}`);
    return res.json({ ok: true, count: candidates.length, candidates: candidates.map(c => ({ workerId: c.workerId, name: c.name })) });
});

// ─── AUTO_MATCH: POST /api/jobs/:id/urgent ───────────────────
// 농민이 무료로 isUrgent=1 전환 → 매칭 점수 +100 boost → 더 많은 작업자에게 노출
// (향후 유료화 훅: isUrgentPaid 플래그로 분리)
router.post('/:id/urgent', (req, res) => {
    const { requesterId } = req.body || {};
    if (!requesterId) return res.status(400).json({ ok: false, error: 'requesterId가 필요해요.' });

    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '본인 공고만 긴급 전환 가능해요.' });
    }
    if (job.status !== 'open') {
        return res.status(400).json({ ok: false, error: '모집 중인 공고만 긴급 전환 가능해요.' });
    }
    if (job.isUrgent) {
        return res.json({ ok: true, alreadyUrgent: true });
    }

    db.prepare('UPDATE jobs SET isUrgent = 1 WHERE id = ?').run(job.id);
    console.log(`[JOB_URGENT] jobId=${job.id} requesterId=${requesterId}`);
    trackEvent('job_urgent', { jobId: job.id, userId: requesterId, meta: { category: job.category } });

    // 기존 지원자에게 "긴급 전환됐어요" 알림 재발송 (fire-and-forget)
    setImmediate(async () => {
        try {
            const apps = db.prepare(
                "SELECT a.workerId, w.phone, w.name FROM applications a LEFT JOIN workers w ON w.id = a.workerId WHERE a.jobRequestId = ? AND a.status = 'applied'"
            ).all(job.id);
            const updatedJob = { ...job, isUrgent: 1 };
            for (const a of apps) {
                if (a.phone) {
                    try {
                        await sendJobAlert(updatedJob, { phone: a.phone, name: a.name });
                    } catch (_) {}
                }
            }
            if (apps.length > 0) {
                console.log(`[URGENT_ALERT_SENT] jobId=${job.id} notified=${apps.length}명`);
            }
        } catch (e) {
            console.error('[URGENT_ALERT_ERROR]', e.message);
        }
    });

    return res.json({ ok: true, alreadyUrgent: false, notified: true });
});

// ─── AI_MATCH_V2: POST /api/jobs/:id/set-auto-assign ─────────
// 농민 opt-in 토글 — autoAssign=1 이어야 checkAndAutoSelect 실행됨
router.post('/:id/set-auto-assign', (req, res) => {
    const { requesterId, enable } = req.body || {};
    if (!requesterId) return res.status(400).json({ ok: false, error: 'requesterId가 필요해요.' });

    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 공고만 설정 가능해요.' });
    }

    const flag = enable ? 1 : 0;
    db.prepare('UPDATE jobs SET autoAssign = ? WHERE id = ?').run(flag, job.id);
    console.log(`[AUTO_ASSIGN_FLAG] jobId=${job.id} autoAssign=${flag}`);
    trackEvent('auto_assign_toggle', { jobId: job.id, userId: requesterId, meta: { enable: flag } });

    return res.json({ ok: true, autoAssign: flag });
});

// ─── AI_MATCH_V2: POST /api/jobs/:id/auto-assign ─────────────
// 농민이 명시적으로 "AI 자동 배정" 트리거
// checkAndAutoSelect(자동, 3명+조건)과 달리 1명도 가능, 농민이 직접 실행
router.post('/:id/auto-assign', (req, res) => {
    const { requesterId } = req.body || {};
    if (!requesterId) return res.status(400).json({ ok: false, error: 'requesterId가 필요해요.' });

    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 공고만 자동 배정 가능해요.' });
    }
    if (job.status !== 'open') {
        return res.status(400).json({ ok: false, error: '모집 중인 공고만 자동 배정 가능해요.' });
    }

    // 지원자 목록 (applied 상태만)
    const apps = db.prepare(
        "SELECT * FROM applications WHERE jobRequestId = ? AND status = 'applied' ORDER BY createdAt ASC"
    ).all(job.id);
    if (apps.length === 0) {
        return res.status(400).json({ ok: false, error: '지원자가 없어요. 잠시 후 다시 시도해주세요.' });
    }

    // V2 점수 계산 (기존 calcApplicantMatchScore + V2 보정)
    const scored = apps.map(a => {
        const worker = normalizeWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(a.workerId));
        if (!worker) return null;
        const dist = (job.latitude && job.longitude && worker.latitude && worker.longitude)
            ? distanceKm(job.latitude, job.longitude, worker.latitude, worker.longitude)
            : null;
        const distKmVal    = dist !== null ? Math.round(dist * 10) / 10 : null;
        const reviewCount  = db.prepare('SELECT COUNT(*) AS cnt FROM reviews WHERE targetId = ?').get(worker.id)?.cnt || 0;
        const baseScore    = calcApplicantMatchScore(worker, a, job, distKmVal, reviewCount);
        const v2Bonus      = calcV2Bonus(worker, job);
        const matchScore   = Math.round(baseScore + v2Bonus);
        return { app: a, worker, distKm: distKmVal, matchScore };
    }).filter(Boolean);

    if (scored.length === 0) {
        return res.status(400).json({ ok: false, error: '유효한 지원자 프로필이 없어요.' });
    }

    // 내림차순 정렬 → 최고 점수
    scored.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
    const top = scored[0];

    // 안전 가드 (soft — ratingAvg 없으면 패스)
    if (top.worker.ratingAvg !== null && top.worker.ratingAvg < 3.0) {
        return res.status(400).json({ ok: false, error: '추천 작업자의 평점이 낮아 자동 배정이 보류됐어요. 직접 선택해주세요.' });
    }
    if ((top.worker.noshowCount || 0) > 3) {
        return res.status(400).json({ ok: false, error: '노쇼 이력이 많아 자동 배정이 불가해요. 직접 선택해주세요.' });
    }

    const workerId   = top.worker.id;
    const farmerUser = db.prepare('SELECT phone FROM users WHERE id = ?').get(job.requesterId);
    const farmerPhone = farmerUser?.phone || '010-0000-0000';

    // 원자적 트랜잭션 (autoSelect와 동일 패턴)
    let didSelect = false;
    db.transaction(() => {
        const r = db.prepare(`
            UPDATE jobs
            SET status = 'matched', contactRevealed = 1,
                selectedWorkerId = ?, selectedAt = ?, autoSelected = 1
            WHERE id = ? AND status = 'open'
        `).run(workerId, new Date().toISOString(), job.id);

        if (r.changes === 0) return; // 이미 처리됨
        didSelect = true;

        db.prepare("UPDATE applications SET status = 'selected' WHERE jobRequestId = ? AND workerId = ?")
          .run(job.id, workerId);
        db.prepare("UPDATE applications SET status = 'rejected' WHERE jobRequestId = ? AND workerId != ?")
          .run(job.id, workerId);

        try {
            db.prepare(`
                INSERT OR IGNORE INTO contacts (id, jobId, farmerId, workerId, createdAt)
                VALUES (?,?,?,?,?)
            `).run(newId('contact'), job.id, job.requesterId, workerId, new Date().toISOString());
        } catch (_) {}
    })();

    if (!didSelect) {
        return res.status(409).json({ ok: false, error: '이미 다른 작업자가 선택됐어요.' });
    }

    console.log(`[AUTO_ASSIGN] jobId=${job.id} workerId=${workerId} score=${top.matchScore} dist=${top.distKm ?? '?'}km`);
    trackEvent('auto_assign', { jobId: job.id, userId: requesterId, meta: { workerId, score: top.matchScore } });

    // 카카오 알림 (fire-and-forget)
    setImmediate(() => { try { sendSelectionNotification(job, top.worker); } catch (_) {} });

    return res.json({
        ok: true,
        workerId,
        matchScore: top.matchScore,
        contact: {
            workerName:  top.worker.name,
            workerPhone: top.worker.phone,
            farmerPhone,
        },
    });
});

// ─── PHASE SCALE: POST /api/jobs/:id/sponsor ─────────────────
// 농민 자가 서비스 — 스폰서 등록 + isUrgentPaid 플래그 설정
// 결제 검증은 추후 PG 연동 시 구현 (테스트 모드: 호출 즉시 활성화)
router.post('/:id/sponsor', (req, res) => {
    const { requesterId, hours = 24, boost = 20, type = 'sponsored' } = req.body || {};
    if (!requesterId) return res.status(400).json({ ok: false, error: 'requesterId가 필요해요.' });

    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '본인 공고만 스폰서 등록 가능해요.' });
    }
    if (job.status !== 'open') {
        return res.status(400).json({ ok: false, error: '모집 중인 공고만 스폰서 등록 가능해요.' });
    }

    try {
        if (type === 'urgentPaid') {
            // 유료 긴급 공고 — isUrgentPaid 플래그만 설정 (상단 노출 없음, 배지만)
            db.prepare('UPDATE jobs SET isUrgentPaid = 1 WHERE id = ?').run(job.id);
            console.log(`[SPONSOR_URGENT_PAID] jobId=${job.id} requesterId=${requesterId}`);
            trackEvent('sponsor_urgent_paid', { jobId: job.id, userId: requesterId });
            return res.json({ ok: true, type: 'urgentPaid', message: '🔥 긴급 공고가 활성화되었어요!' });
        } else {
            // 스폰서드 상단 노출
            const expiresAt = Date.now() + Number(hours) * 3_600_000;
            db.prepare(
                'INSERT OR REPLACE INTO sponsored_jobs (jobId, boost, expiresAt) VALUES (?, ?, ?)'
            ).run(String(job.id), Number(boost), expiresAt);
            console.log(`[SPONSOR_REGISTERED] jobId=${job.id} boost=${boost} hours=${hours}`);
            trackEvent('sponsor_registered', { jobId: job.id, userId: requesterId, meta: { hours, boost } });
            return res.json({ ok: true, type: 'sponsored', expiresAt, message: '⭐ 스폰서 공고가 등록되었어요!' });
        }
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── POST /api/jobs/:id/pay ─────────────────────────────────────
// PHASE_PAYMENT_ESCROW_V1: 결제 예약 생성 (에스크로)
// 매칭 완료 후 농민이 결제 시작 → paymentStatus='reserved'
router.post('/:id/pay', (req, res) => {
    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    // 이미 결제된 경우
    if (job.paymentStatus === 'paid') {
        return res.json({ ok: true, already: true, paymentStatus: 'paid' });
    }
    // 이미 예약된 경우 — paymentId만 반환
    if (job.paymentStatus === 'reserved' && job.paymentId) {
        return res.json({
            ok: true,
            already: true,
            paymentStatus: 'reserved',
            payment: { paymentId: job.paymentId, fee: job.fee, net: job.netAmount },
        });
    }

    try {
        const payment = createPayment(job);

        db.prepare(`
            UPDATE jobs
            SET paymentStatus = 'reserved',
                paymentId     = ?,
                fee           = ?,
                netAmount     = ?
            WHERE id = ?
        `).run(payment.paymentId, payment.fee, payment.net, job.id);

        trackEvent('payment_reserved', { jobId: job.id, userId: req.body.requesterId || null });

        return res.json({
            ok:            true,
            paymentStatus: 'reserved',
            payment: {
                paymentId: payment.paymentId,
                amount:    payment.amount,
                fee:       payment.fee,
                net:       payment.net,
            },
        });
    } catch (e) {
        console.error('[PAYMENT_CREATE_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '결제 생성 오류: ' + e.message });
    }
});

// ─── POST /api/jobs/:id/pay/confirm ────────────────────────────
// PHASE_PAYMENT_ESCROW_V1: 결제 확정 → paymentStatus='paid'
// (실결제: PG 웹훅 수신 후 자동 호출)
router.post('/:id/pay/confirm', (req, res) => {
    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    if (!job.paymentId) {
        return res.status(400).json({ ok: false, error: '먼저 결제 요청을 생성해주세요. (/pay)' });
    }
    if (job.paymentStatus === 'paid') {
        return res.json({ ok: true, already: true, paymentStatus: 'paid' });
    }

    try {
        confirmPayment(job.paymentId);

        db.prepare("UPDATE jobs SET paymentStatus = 'paid' WHERE id = ?").run(job.id);

        console.log(`[PAYMENT_CONFIRMED] jobId=${job.id} paymentId=${job.paymentId} net=${job.netAmount}원`);
        trackEvent('payment_confirmed', { jobId: job.id, userId: req.body.requesterId || null });

        // WS 알림
        if (global.broadcast) {
            global.broadcast({ type: 'payment_confirmed', jobId: job.id, netAmount: job.netAmount });
        }

        return res.json({
            ok:            true,
            paymentStatus: 'paid',
            netAmount:     job.netAmount,
            fee:           job.fee,
        });
    } catch (e) {
        console.error('[PAYMENT_CONFIRM_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '결제 확정 오류: ' + e.message });
    }
});

// ─── POST /api/jobs/:id/refund ──────────────────────────────────
// PHASE_PAYMENT_ESCROW_V1: 환불 처리 (분쟁 대비)
router.post('/:id/refund', (req, res) => {
    const { requesterId } = req.body || {};
    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    if (!job.paymentId) {
        return res.status(400).json({ ok: false, error: '결제 내역이 없어요.' });
    }
    if (job.paymentStatus === 'refunded') {
        return res.json({ ok: true, already: true, paymentStatus: 'refunded' });
    }
    if (job.paymentStatus !== 'reserved' && job.paymentStatus !== 'paid') {
        return res.status(400).json({ ok: false, error: `현재 상태(${job.paymentStatus})는 환불 불가해요.` });
    }
    // 이미 완료된 작업은 환불 불가
    if (job.status === 'done') {
        return res.status(400).json({ ok: false, error: '완료된 작업은 환불할 수 없어요.' });
    }

    try {
        refundPayment(job.paymentId);

        db.prepare("UPDATE jobs SET paymentStatus = 'refunded' WHERE id = ?").run(job.id);

        console.log(`[PAYMENT_REFUNDED] jobId=${job.id} paymentId=${job.paymentId} requesterId=${requesterId || 'unknown'}`);
        trackEvent('payment_refunded', { jobId: job.id, userId: requesterId || null });

        return res.json({ ok: true, paymentStatus: 'refunded', paymentId: job.paymentId });
    } catch (e) {
        console.error('[PAYMENT_REFUND_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '환불 처리 오류: ' + e.message });
    }
});

module.exports = router;
