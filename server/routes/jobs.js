'use strict';
const express  = require('express');
const db       = require('../db');
const { rankJobs, distLabel, distanceKm, calcApplicantMatchScore, rankApplicants } = require('../services/matchingEngine');
const { suggestCategory, generateTitle, suggestUrgent, getPriceGuide } = require('../services/smartAssist');
const {
    sendSelectionNotification,
    sendJobStartedNotification,
    sendJobCompletedNotification,
    sendWorkerDepartedNotification,
    sendJobCompletedToFarmerNotification,
    sendPaymentDoneNotification,
} = require('../services/notificationService');
const { trackEvent }              = require('../services/analyticsService');
const { findMatchingWorkers }     = require('../services/matchingService');
const {
    sendJobAlert, sendApplyAlert, sendDepartureReminder, sendContactAlert,
    sendWorkerSelectedAlert, sendApplicantArrivedAlert,
} = require('../services/kakaoService');
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
const { calcRecommendScore }          = require('../services/matchScore');
const { getWeather }                  = require('../services/weatherService');
const { getContextFeatures }          = require('../services/contextFeature');
const { predictSuccess, buildExplain } = require('../services/successModel');
const { createPayment, confirmPayment, refundPayment } = require('../services/paymentService');
const { notifyOnStatus } = require('../utils/notify');

const router = express.Router();

// PHASE 29: apply rate limit — 동일 userId 1초 내 중복 요청 차단
const applyRateLimit = new Map();
const APPLY_RATE_MS  = 1000; // 1초

// nearby 결과 인메모리 캐시 (위치 소수점 2자리 기준, TTL 10초)
const _nearbyCache    = new Map();
const NEARBY_CACHE_MS = 10_000;

// ─── 유틸 ────────────────────────────────────────────────────
function newId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function _parseCoord(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n !== 0 ? n : null;
}

function normalizeJob(row) {
    if (!row) return null;
    return {
        ...row,
        status:       row.status === 'done' ? 'completed' : row.status,
        isUrgent:     !!row.isUrgent,
        autoSelected: !!row.autoSelected,
        isUrgentPaid: !!row.isUrgentPaid,
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

// ─── 상태 머신 ───────────────────────────────────────────────
const VALID_TRANSITIONS = {
    open:        ['matched', 'closed'],
    matched:     ['on_the_way', 'in_progress', 'closed'],
    on_the_way:  ['in_progress', 'closed'],
    in_progress: ['completed', 'closed'],
    completed:   ['closed'],
};

function checkTransition(from, to) {
    if (from === 'closed') return `이미 마감된 작업이에요.`;
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed) return `알 수 없는 상태입니다: ${from}`;
    if (!allowed.includes(to)) {
        return `'${from}' 상태에서 '${to}'(으)로 변경할 수 없어요.`;
    }
    return null;
}

async function logTransition(jobId, from, to, byUserId) {
    try {
        await db.prepare(
            'INSERT INTO status_logs (id, jobId, fromStatus, toStatus, byUserId, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
            `sl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            jobId, from, to, byUserId || 'system',
            new Date().toISOString()
        );
    } catch (_) {}
}

async function appCountForJob(jobId) {
    const row = await db.prepare(
        "SELECT COUNT(*) as n FROM applications WHERE jobRequestId = ? AND status != 'cancelled'"
    ).get(jobId);
    return row ? row.n : 0;
}

async function getRequesterRating(requesterId) {
    const row = await db.prepare(
        'SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews WHERE targetId = ?'
    ).get(requesterId);
    return {
        avgRating:   row && row.avg ? Math.round(row.avg * 10) / 10 : null,
        ratingCount: row ? row.cnt : 0,
    };
}

function parseFarmImages(raw) {
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
}

async function jobView(job, opts = {}) {
    const { userLat, userLon } = opts;

    const canCalcDist = (
        userLat && userLon &&
        job.latitude  != null && Number.isFinite(job.latitude)  &&
        job.longitude != null && Number.isFinite(job.longitude)
    );
    const dist = canCalcDist
        ? distanceKm(userLat, userLon, job.latitude, job.longitude)
        : null;
    const distSafe = (dist != null && Number.isFinite(dist)) ? dist : null;

    const { avgRating, ratingCount } = await getRequesterRating(job.requesterId);
    const applicationCount = await appCountForJob(job.id);
    const farmImages = parseFarmImages(job.farmImages);
    return {
        ...job,
        applicationCount,
        distKm:      distSafe !== null ? Math.round(distSafe * 10) / 10 : null,
        distLabel:   distSafe !== null ? distLabel(distSafe) : null,
        avgRating,
        ratingCount,
        farmImages,
        thumbUrl:    farmImages[0] || job.imageUrl || null,
    };
}

// ─── 특정 경로 먼저 (/:id 보다 앞에 정의) ─────────────────────

// ─── GET /api/jobs/my/jobs ────────────────────────────────────
router.get('/my/jobs', async (req, res) => {
    const { userId } = req.query;
    const rows = await db.prepare(
        'SELECT * FROM jobs WHERE requesterId = ? ORDER BY createdAt DESC'
    ).all(userId);
    const myJobs = await Promise.all(rows.map(r => jobView(normalizeJob(r))));
    console.log(`[JOB_LIST_MY_POSTED] userId=${userId} count=${myJobs.length}`);
    return res.json({ ok: true, jobs: myJobs });
});

// ─── GET /api/jobs/my/applications ───────────────────────────
router.get('/my/applications', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.json({ ok: true, applications: [] });

    const apps = await db.prepare(
        'SELECT * FROM applications WHERE workerId = ? ORDER BY createdAt DESC'
    ).all(userId);

    const result = await Promise.all(apps.map(async a => {
        const jobRow = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(a.jobRequestId);

        let farmerContact = null;
        if ((a.status === 'selected' || a.status === 'completed') && jobRow) {
            const farmerUser = await db.prepare('SELECT phone, name FROM users WHERE id = ?').get(jobRow.requesterId);
            if (farmerUser) {
                farmerContact = {
                    farmerName:  jobRow.requesterName || farmerUser.name,
                    farmerPhone: farmerUser.phone,
                };
            }
        }

        const review = await db.prepare(
            'SELECT rating, comment FROM reviews WHERE jobId = ? AND reviewerId = ?'
        ).get(a.jobRequestId, userId);

        return {
            ...a,
            job:          jobRow ? await jobView(normalizeJob(jobRow)) : null,
            farmerContact,
            review:       review || null,
        };
    }));

    return res.json({ ok: true, applications: result });
});

// ─── GET /api/jobs/match-stats ────────────────────────────────
// AI 추천 모델 정확도 통계 (Top-1 / Top-3 선택률)
// 내부 모니터링용 — 운영 중 모델 튜닝 기준 데이터
router.get('/match-stats', async (req, res) => {
    try {
        const rows = await db.prepare(`
            SELECT
                COUNT(*)                                              AS total_recommendations,
                COUNT(*) FILTER (WHERE selected = TRUE)              AS total_selected,
                COUNT(*) FILTER (WHERE rank = 1)                     AS top1_shown,
                COUNT(*) FILTER (WHERE rank = 1 AND selected)        AS top1_selected,
                COUNT(*) FILTER (WHERE rank <= 3)                    AS top3_shown,
                COUNT(*) FILTER (WHERE rank <= 3 AND selected)       AS top3_selected,
                COUNT(*) FILTER (WHERE viewed  = TRUE)               AS total_viewed,
                COUNT(*) FILTER (WHERE clicked = TRUE)               AS total_clicked,
                ROUND(AVG(predictedscore)::numeric, 3)               AS avg_predicted_score,
                ROUND(AVG(CASE WHEN selected THEN predictedscore END)::numeric, 3)
                                                                      AS avg_score_when_selected,
                ROUND(AVG(CASE WHEN selected AND selectedat IS NOT NULL
                          THEN EXTRACT(EPOCH FROM (selectedat - createdat)) END)::numeric, 1)
                                                                      AS avg_selection_seconds
            FROM match_logs
        `).get();

        const s = rows || {};
        const top1Rate  = s.top1_shown > 0 ? Math.round(s.top1_selected / s.top1_shown * 100) : null;
        const top3Rate  = s.top3_shown > 0 ? Math.round(s.top3_selected / s.top3_shown * 100) : null;
        const ctr       = s.total_viewed > 0 ? Math.round(s.total_clicked / s.total_viewed * 100) : null;
        const cvr       = s.total_clicked > 0 ? Math.round(s.total_selected / s.total_clicked * 100) : null;

        return res.json({
            ok: true,
            stats: {
                totalRecommendations: Number(s.total_recommendations || 0),
                totalSelected:        Number(s.total_selected        || 0),
                // Top 선택률
                top1SelectionRate:    top1Rate,  // % 목표: 60%+
                top3SelectionRate:    top3Rate,  // % 목표: 85~90%+
                // 노출 → 클릭 → 선택 퍼널
                funnel: {
                    viewed:  Number(s.total_viewed  || 0),
                    clicked: Number(s.total_clicked || 0),
                    selected: Number(s.total_selected || 0),
                    ctr:     ctr,   // 클릭률 %
                    cvr:     cvr,   // 선택 전환율 %
                },
                // 선택 속도 (초)
                avgSelectionSeconds: Number(s.avg_selection_seconds || 0),
                // 점수 분석
                avgPredictedScore:    Number(s.avg_predicted_score        || 0),
                avgScoreWhenSelected: Number(s.avg_score_when_selected    || 0),
                note: top1Rate === null ? '데이터 수집 중' :
                      top1Rate >= 60   ? '🟢 Top-1 목표 달성' :
                      top1Rate >= 40   ? '🟡 Top-1 개선 필요' : '🔴 모델 재조정 필요',
            },
        });
    } catch (e) {
        // match_logs 테이블 미생성 시 (마이그레이션 전)
        return res.json({ ok: true, stats: null, reason: 'match_logs 테이블 없음 — node migrate_optimize.js 실행 필요' });
    }
});

// ─── POST /api/jobs/:id/recommend-view ───────────────────────
// TOP3 패널이 화면에 노출됐을 때 프론트에서 호출 (viewed=true)
router.post('/:id/recommend-view', async (req, res) => {
    const jobId = req.params.id;
    db.prepare(`
        UPDATE match_logs SET viewed = TRUE
        WHERE  jobid = ? AND viewed = FALSE
    `).run(jobId).catch(() => {});
    return res.json({ ok: true });
});

// ─── POST /api/jobs/:id/recommend-click ──────────────────────
// "바로 선택" 버튼 클릭 시 호출 (clicked=true, 선택 확정 전)
router.post('/:id/recommend-click', async (req, res) => {
    const jobId   = req.params.id;
    const { workerId } = req.body;
    if (workerId) {
        db.prepare(`
            UPDATE match_logs SET clicked = TRUE
            WHERE  jobid = ? AND workerid = ? AND clicked = FALSE
        `).run(jobId, workerId).catch(() => {});
    }
    return res.json({ ok: true });
});

// ─── GET /api/jobs/my/notifications ──────────────────────────
router.get('/my/notifications', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.json({ ok: true, pendingApps: 0, selectedApps: 0 });

    const pendingRow = await db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM applications a
        JOIN jobs j ON j.id = a.jobRequestId
        WHERE j.requesterId = ? AND a.status = 'applied'
    `).get(userId);

    const selectedRow = await db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM applications
        WHERE workerId = ? AND status = 'selected'
    `).get(userId);

    return res.json({
        ok:           true,
        pendingApps:  pendingRow?.cnt  || 0,
        selectedApps: selectedRow?.cnt || 0,
    });
});

// ─── GET /api/jobs/my/notify-list ────────────────────────────
router.get('/my/notify-list', async (req, res) => {
    const { userId, limit = 20 } = req.query;
    if (!userId) return res.json({ ok: true, items: [] });
    try {
        const rows = await db.prepare(`
            SELECT id, type, message, jobId, createdAt, readAt
            FROM notify_log
            WHERE userId = ?
            ORDER BY createdAt DESC
            LIMIT ?
        `).all(userId, Number(limit));
        return res.json({ ok: true, items: rows });
    } catch (e) {
        return res.json({ ok: true, items: [] });
    }
});

// ─── POST /api/jobs/my/notify-read ───────────────────────────
router.post('/my/notify-read', async (req, res) => {
    const { userId, notifyId } = req.body;
    if (!userId) return res.json({ ok: false });
    try {
        if (notifyId) {
            await db.prepare("UPDATE notify_log SET readAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?").run(notifyId, userId);
        } else {
            await db.prepare("UPDATE notify_log SET readAt = CURRENT_TIMESTAMP WHERE userId = ? AND readAt IS NULL").run(userId);
        }
        return res.json({ ok: true });
    } catch (e) {
        return res.json({ ok: false });
    }
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
  try {
    const { farmImages: _fi, ...bodyLog } = req.body || {};
    console.log('[API /jobs POST] body:', bodyLog);

    const {
        requesterId, requesterName, category, locationText,
        latitude, longitude,
        lat: bodyLat, lng: bodyLng,
        date, timeSlot,
        areaSize, areaUnit, pay, note, imageUrl,
        farmImages: farmImagesRaw,
        farmAddress: farmAddressRaw,
        isUrgentPaid: isUrgentPaidRaw,
    } = req.body || {};

    if (!requesterId || !category || !locationText || !date) {
        return res.status(400).json({ ok: false, error: '필수 항목이 빠졌어요.' });
    }

    if (farmAddressRaw && farmAddressRaw.trim().length < 5) {
        return res.status(400).json({ ok: false, error: '농지 주소가 너무 짧아요. 예: "경기 화성시 서신면" 형식으로 입력해주세요.' });
    }

    let resolvedLat = null;
    let resolvedLng = null;

    const rawLat = parseFloat(bodyLat ?? latitude);
    const rawLng = parseFloat(bodyLng ?? longitude);
    const hasFarmAddress = farmAddressRaw && farmAddressRaw.trim().length >= 5;

    if (hasFarmAddress) {
        const geo = await geocodeAddress(farmAddressRaw.trim());
        if (geo) {
            resolvedLat = geo.lat;
            resolvedLng = geo.lng;
            console.log(`[SERVER_COORD_FARMADDR] "${farmAddressRaw.trim()}" → (${resolvedLat}, ${resolvedLng})`);
            console.log(`[GEO_QUALITY] source=farmAddress addr="${farmAddressRaw.trim()}" lat=${resolvedLat.toFixed(4)} lng=${resolvedLng.toFixed(4)} addrLen=${farmAddressRaw.trim().length} normalized=${geo.normalized ?? false} precision=${geo.precision ?? 'full'}`);
        } else {
            console.warn(`[SERVER_GEOCODE_FAIL] "${farmAddressRaw.trim()}" → 좌표 획득 실패, 등록 거부`);
            return res.status(400).json({
                ok: false,
                error: `"${farmAddressRaw.trim()}" 주소의 위치를 찾을 수 없어요. 시·군·읍·면·리 형식으로 더 정확하게 입력해주세요. 예) 경기 포천시 창수면 오가리`,
            });
        }
    } else if (Number.isFinite(rawLat) && Number.isFinite(rawLng)) {
        resolvedLat = rawLat;
        resolvedLng = rawLng;
        console.log('[SERVER_COORD_GPS]', locationText, resolvedLat, resolvedLng);
        console.log(`[GEO_QUALITY] source=GPS locationText="${locationText}" lat=${resolvedLat.toFixed(4)} lng=${resolvedLng.toFixed(4)}`);
    } else {
        console.warn('[SERVER_COORD_REQUIRED]', locationText, '→ lat/lng 없음 + farmAddress 없음, 등록 거부');
        return res.status(400).json({
            ok: false,
            error: '위치 좌표가 필요해요. GPS를 허용하거나 농지 주소를 입력해주세요.',
        });
    }

    const isUrgent   = suggestUrgent({ note: note || '', date });
    const id         = newId('job');
    const farmAddress = farmAddressRaw ? farmAddressRaw.trim() : null;

    const parsedArea = parseInt(areaSize) || null;
    const resolvedUnit = areaUnit || '평';
    const areaPyeong   = (parsedArea && resolvedUnit === '평') ? parsedArea : null;

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
        imageUrl:  (imageUrl && imageUrl.trim()) ? imageUrl : getDefaultImage(category),
        isUrgent:  isUrgent ? 1 : 0,
        status:    'open',
        createdAt: new Date().toISOString(),
        areaPyeong,
        farmImages: farmImagesStr,
        farmAddress,
        isUrgentPaid: isUrgentPaidRaw ? 1 : 0,
    };

    await db.prepare(`
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
    await trackEvent('job_created', { jobId: id, userId: requesterId, meta: { category } });

    setImmediate(async () => {
        await reengageUnselectedApplicants({ id, category, locationText, date, requesterId });
    });

    setImmediate(async () => {
        try {
            const finalImageUrl = (imageUrl && imageUrl.trim()) ? imageUrl : null;
            const difficulty = await estimateDifficulty(finalImageUrl, category);
            await db.prepare('UPDATE jobs SET difficulty = ? WHERE id = ?').run(difficulty, id);
            console.log(`[DIFFICULTY] job=${id} category=${category} difficulty=${difficulty.toFixed(2)}`);
        } catch (e) {
            console.warn('[DIFFICULTY_ERROR]', e.message);
        }
    });

    setImmediate(async () => {
        try {
            const finalImageUrl = (imageUrl && imageUrl.trim()) ? imageUrl : null;
            const r = await classifyImage(finalImageUrl);
            if (!r.type) return;
            const safeTags = Array.isArray(r.tags) ? r.tags : [];
            await db.prepare('UPDATE jobs SET autoJobType = ?, tags = ? WHERE id = ?')
              .run(r.type, JSON.stringify(safeTags), id);
            console.log(`[JOBTYPE_AI] job=${id} autoJobType=${r.type} tags=${r.tags}`);
        } catch (e) {
            console.error('[JOBTYPE_FAIL]', e.message);
        }
    });

    setImmediate(async () => {
        try {
            const jobForMatch = {
                id, category, locationText,
                lat: resolvedLat, lng: resolvedLng,
                latitude: resolvedLat, longitude: resolvedLng,
            };
            const targets = await findMatchingWorkers(jobForMatch, { radiusKm: 5, nearFieldKm: 3 });
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

    return res.status(201).json({ ok: true, job: await jobView(normalizeJob(row)) });

  } catch (e) {
    console.error('[JOB_CREATE_FATAL]', e.message, e.stack?.split('\n')[1] || '');
    if (!res.headersSent) {
        return res.status(500).json({ ok: false, error: '서버 오류가 발생했어요. 잠시 후 다시 시도해주세요.' });
    }
  }
});

// ─── GET /api/jobs ────────────────────────────────────────────
router.get('/', async (req, res) => {
    const { category, date, lat, lon, radius = 200, recommended } = req.query;
    const userLat = lat ? parseFloat(lat) : null;
    const userLon = lon ? parseFloat(lon) : null;

    const now = Date.now();
    const sponsoredIds = new Set(
        (await db.prepare('SELECT jobId FROM sponsored_jobs WHERE expiresAt > ?').all(now)).map(r => r.jobId)
    );

    const allJobs = (await db.prepare("SELECT * FROM jobs WHERE status != 'closed'").all()).map(normalizeJob);

    if (recommended === '1') {
        const openJobs = allJobs.filter(j => j.status === 'open');
        const sorted   = sortRecommendedJobs(openJobs, { lat: userLat, lng: userLon });
        const withView = await Promise.all(sorted.map(async j => ({
            ...await jobView(j, { userLat, userLon }),
            isToday:     j.isToday,
            distanceKm:  j.distanceKm,
            payValue:    j.payValue,
            isSponsored: sponsoredIds.has(j.id),
        })));
        withView.sort((a, b) => {
            const aScore = (a.isSponsored ? 2 : 0) + (a.isUrgentPaid ? 1 : 0);
            const bScore = (b.isSponsored ? 2 : 0) + (b.isUrgentPaid ? 1 : 0);
            return bScore - aScore;
        });
        console.log(`[RECOMMEND_LIST] userLat=${userLat ?? 'n/a'} userLng=${userLon ?? 'n/a'} count=${withView.length}`);
        return res.json({ ok: true, jobs: withView, recommended: true });
    }

    const rankedRaw = rankJobs(allJobs, {
        category, date,
        userLat, userLon,
        radiusKm: parseFloat(radius),
    });
    const ranked = await Promise.all(rankedRaw.map(async j => ({
        ...await jobView(j, { userLat, userLon }),
        isSponsored: sponsoredIds.has(j.id),
    })));
    ranked.sort((a, b) => {
        const aScore = (a.isSponsored ? 2 : 0) + (a.isUrgentPaid ? 1 : 0);
        const bScore = (b.isSponsored ? 2 : 0) + (b.isUrgentPaid ? 1 : 0);
        return bScore - aScore;
    });

    console.log(`[JOB_LIST_VIEWED] count=${ranked.length} category=${category || 'all'} gps=${lat ? 'on' : 'off'}`);
    return res.json({ ok: true, jobs: ranked });
});

// ─── GET /api/jobs/recommended ───────────────────────────────
router.get('/recommended', async (req, res) => {
    const { lat, lng } = req.query;
    const uLat = lat ? parseFloat(lat) : null;
    const uLng = lng ? parseFloat(lng) : null;
    const user = (uLat && isFinite(uLat) && uLng && isFinite(uLng))
        ? { lat: uLat, lng: uLng }
        : null;

    const rows = (await db.prepare("SELECT * FROM jobs WHERE status = 'open'").all()).map(normalizeJob);
    const sorted = aiSortJobs(rows, user);

    const result = await Promise.all(sorted.map(async j => ({
        ...await jobView(j, { userLat: user?.lat, userLon: user?.lng }),
        _aiScore: j._aiScore,
        distKm:   j.distKm,
        payValue: j.payValue,
    })));

    console.log(`[RECOMMENDED] lat=${uLat ?? 'n/a'} lng=${uLng ?? 'n/a'} count=${result.length}`);
    return res.json({ ok: true, jobs: result, count: result.length });
});

// ─── GET /api/jobs/nearby ─────────────────────────────────────
// 최적화:
//   1) DB-side distance_km() 함수로 SQL 레벨 반경 필터 (풀스캔 제거)
//   2) 인메모리 캐시 (위치 소수점 2자리, TTL 10초)
//   3) migrate_optimize.js 실행 후 idx_jobs_location 인덱스 활용
router.get('/nearby', async (req, res) => {
    const { lat, lng, radius = '3' } = req.query;

    if (!lat || !lng) {
        return res.status(400).json({ ok: false, error: 'lat, lng 파라미터가 필요해요.' });
    }

    const userLat  = parseFloat(lat);
    const userLon  = parseFloat(lng);
    const radiusKm = Math.min(parseFloat(radius) || 3, 50);

    if (!Number.isFinite(userLat) || !Number.isFinite(userLon)) {
        return res.status(400).json({ ok: false, error: '유효하지 않은 좌표예요.' });
    }

    // ── 캐시 조회 ─────────────────────────────────────────────
    const cacheKey = `nearby:${userLat.toFixed(2)}:${userLon.toFixed(2)}:${radiusKm}`;
    const cached   = _nearbyCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < NEARBY_CACHE_MS) {
        console.log(`[NEARBY_CACHE_HIT] key=${cacheKey} count=${cached.data.length}`);
        return res.json({ ok: true, jobs: cached.data, count: cached.data.length, radiusKm, cached: true });
    }

    // ── DB-side 필터 (distance_km 함수 사용) ──────────────────
    // $1=userLat, $2=userLon, $3=radiusKm (? 미사용 → db.js 변환 없이 통과)
    const rows = await db.prepare(`
        SELECT sub.*
        FROM (
            SELECT *,
                   distance_km($1, $2, latitude, longitude) AS _db_dist
            FROM   jobs
            WHERE  status    = 'open'
              AND  latitude  IS NOT NULL
              AND  longitude IS NOT NULL
        ) sub
        WHERE  sub._db_dist <= $3
        ORDER  BY sub._db_dist ASC
        LIMIT  50
    `).all(userLat, userLon, radiusKm);

    // ── jobView (평점·지원수·거리 포함) ──────────────────────────
    const nearby = await Promise.all(rows.map(async r => {
        const job = normalizeJob(r);
        return await jobView(job, { userLat, userLon });
    }));

    // ── 캐시 저장 ─────────────────────────────────────────────
    _nearbyCache.set(cacheKey, { data: nearby, ts: Date.now() });

    console.log(`[NEARBY_JOBS] lat=${userLat} lng=${userLon} radius=${radiusKm}km → ${nearby.length}건`);
    return res.json({ ok: true, jobs: nearby, count: nearby.length, radiusKm });
});

// ─── GET /api/jobs/map ────────────────────────────────────────
router.get('/map', async (req, res) => {
    const { lat, lon } = req.query;
    const userLat = lat ? parseFloat(lat) : null;
    const userLon = lon ? parseFloat(lon) : null;
    const today   = new Date().toISOString().slice(0, 10);
    const now     = Date.now();

    const rows = await db.prepare(`
        SELECT id, category, locationText, pay, date, latitude, longitude,
               isUrgent, isUrgentPaid, areaPyeong, areaSize, areaUnit,
               farmImages, imageUrl, farmAddress, difficulty
        FROM   jobs
        WHERE  status   = 'open'
          AND  latitude  IS NOT NULL
          AND  longitude IS NOT NULL
          AND  NOT (latitude = 37.5 AND longitude = 127.0)
    `).all();
    const jobsNorm = rows.map(r => ({ ...r, isUrgent: !!r.isUrgent, isUrgentPaid: !!r.isUrgentPaid }));

    const sponsoredIds = new Set(
        (await db.prepare('SELECT jobId FROM sponsored_jobs WHERE expiresAt > ?').all(now)).map(r => r.jobId)
    );

    const markers = jobsNorm.map(job => {
        const dist = (userLat && userLon)
            ? distanceKm(userLat, userLon, job.latitude, job.longitude)
            : null;
        const imgs     = parseFarmImages(job.farmImages);
        const thumbUrl = imgs[0] || job.imageUrl || null;
        const isSpon   = sponsoredIds.has(job.id);
        const isToday  = !!(job.date && job.date.slice(0, 10) === today);

        let aiScore = 0;
        if (isSpon)              aiScore += 50;
        if (job.isUrgentPaid)    aiScore += 35;
        if (job.isUrgent)        aiScore += 20;
        if (isToday)             aiScore += 15;
        if (dist !== null)       aiScore += Math.max(0, 20 - Math.floor(dist));
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

    markers.sort((a, b) => b.aiScore - a.aiScore);

    console.log(`[MAP_DATA_FETCH] count=${markers.length} sponsored=${[...sponsoredIds].length} gps=${userLat ? 'on' : 'off'}`);
    return res.json({ ok: true, markers });
});

// ─── GET /api/jobs/:id/match ──────────────────────────────────
router.get('/:id/match', async (req, res) => {
    const row = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    const job = normalizeJob(row);

    const workers = await db.prepare(
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
router.get('/:id', async (req, res) => {
    try {
        const row = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
        if (!row) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

        const job = await jobView(normalizeJob(row));

        const userLat = parseFloat(req.query.lat) || null;
        const userLon = parseFloat(req.query.lon) || null;

        let driveMin    = null;
        let driveSource = 'estimate';
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
router.post('/:id/apply', async (req, res) => {
    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

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

    // ── 자기 공고 지원 차단 ─────────────────────────────────────────
    // workerId는 workers.id 또는 users.id 둘 다 올 수 있음 → 양쪽 비교
    if (workerId === job.requesterId) {
        return res.status(400).json({ ok: false, error: '본인이 올린 공고에는 지원할 수 없어요.' });
    }
    const _wRow = await db.prepare('SELECT userId FROM workers WHERE id = ?').get(workerId);
    if (_wRow && _wRow.userId === job.requesterId) {
        return res.status(400).json({ ok: false, error: '본인이 올린 공고에는 지원할 수 없어요.' });
    }

    const now = Date.now();
    const lastAt = applyRateLimit.get(workerId) || 0;
    if (now - lastAt < APPLY_RATE_MS) {
        return res.status(429).json({ ok: false, error: '잠시 후 다시 시도해주세요.' });
    }
    applyRateLimit.set(workerId, now);
    if (applyRateLimit.size > 10000) {
        const cutoff = now - 300000;
        for (const [k, v] of applyRateLimit) { if (v < cutoff) applyRateLimit.delete(k); }
    }

    const already = await db.prepare(
        'SELECT id FROM applications WHERE jobRequestId = ? AND workerId = ?'
    ).get(job.id, workerId);
    if (already) return res.status(409).json({ ok: false, error: '이미 지원했어요.' });

    const id  = newId('app');
    const app = {
        id, jobRequestId: job.id, workerId, message,
        status: 'applied', createdAt: new Date().toISOString(),
    };
    await db.prepare(`
        INSERT INTO applications (id, jobRequestId, workerId, message, status, createdAt)
        VALUES (@id, @jobRequestId, @workerId, @message, @status, @createdAt)
    `).run(app);

    console.log(`[APPLY] jobId=${job.id} workerId=${workerId}`);
    console.log(`[JOB_APPLIED] jobId=${job.id} workerId=${workerId}`);
    await trackEvent('job_applied', { jobId: job.id, userId: workerId, meta: { category: job.category } });

    try {
        const wasReengaged = await db.prepare(
            "SELECT id FROM analytics WHERE event = 'reengage_alert' AND jobId = ? AND userId = ? LIMIT 1"
        ).get(job.id, workerId);
        if (wasReengaged) {
            await trackEvent('reengage_apply_returned', {
                jobId:  job.id,
                userId: workerId,
                meta:   { category: job.category },
            });
            console.log(`[REENGAGE_APPLY_RETURNED] jobId=${job.id} workerId=${workerId}`);
        }
    } catch (e) {
        console.error('[REENGAGE_APPLY_CHECK_ERROR]', e.message);
    }

    setImmediate(async () => {
        try {
            const farmer = await db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(job.requesterId);
            const worker = await db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(workerId);
            sendApplyAlert({ job, worker: worker || { id: workerId, name: '지원자' }, farmer: farmer || null });
        } catch (e) {
            console.error('[APPLY_ALERT_ERROR]', e.message);
        }
    });

    let contactInfo = null;
    try {
        const farmer = await db.prepare('SELECT name, phone FROM users WHERE id = ?').get(job.requesterId);
        if (farmer?.phone) {
            contactInfo = { farmerName: farmer.name || '농민', contact: farmer.phone };
        }
    } catch (e) { /* fail-safe */ }

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
router.get('/:id/contact', async (req, res) => {
    const { workerId } = req.query;
    if (!workerId) return res.status(400).json({ ok: false, error: 'workerId가 필요해요.' });

    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const application = await db.prepare(
        'SELECT id, status FROM applications WHERE jobRequestId = ? AND workerId = ?'
    ).get(job.id, workerId);
    if (!application) {
        console.log(`[CONTACT_DENIED] jobId=${job.id} workerId=${workerId} reason=no_application`);
        return res.status(403).json({ ok: false, error: '지원한 작업의 연락처만 확인할 수 있어요.' });
    }

    const farmer = await db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(job.requesterId);
    if (!farmer || !farmer.phone) {
        return res.json({
            ok: true,
            name: job.requesterName || '농민',
            phoneMasked: null,
            phoneFull: null,
            noPhone: true,
        });
    }

    const raw = farmer.phone.replace(/[^0-9]/g, '');
    const phoneMasked = raw.length >= 8
        ? raw.replace(/(\d{3})(\d{4})(\d{4})/, '$1-****-$3')
        : '***-****-****';

    console.log(`[CONTACT_OK] jobId=${job.id} workerId=${workerId} farmer=${farmer.name}`);
    await trackEvent('contact_revealed', { jobId: job.id, userId: workerId, meta: { category: job.category } });

    return res.json({
        ok: true,
        name: farmer.name,
        phoneMasked,
        phoneFull: farmer.phone,
        noPhone: false,
    });
});

// ─── POST /api/jobs/:id/cancel-apply ─────────────────────────
// 작업자가 지원을 취소합니다.
// 조건: job.status === 'open', applications.status === 'applied'
// 이미 selected 이후는 400 ALREADY_MATCHED
router.post('/:id/cancel-apply', async (req, res) => {
    const { workerId } = req.body;
    if (!workerId) return res.status(400).json({ ok: false, error: 'workerId가 필요해요.' });

    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    if (job.status !== 'open') {
        return res.status(400).json({ ok: false, code: 'ALREADY_MATCHED', error: '이미 매칭이 진행되어 지원을 취소할 수 없어요.' });
    }

    const app = await db.prepare(
        "SELECT * FROM applications WHERE jobRequestId = ? AND workerId = ? AND status != 'cancelled'"
    ).get(job.id, workerId);
    if (!app) return res.status(404).json({ ok: false, code: 'APPLICATION_NOT_FOUND', error: '지원 내역을 찾을 수 없어요.' });

    if (app.status === 'selected') {
        return res.status(400).json({ ok: false, code: 'ALREADY_MATCHED', error: '이미 선택된 상태라 취소할 수 없어요.' });
    }

    await db.prepare(
        "UPDATE applications SET status = 'cancelled' WHERE jobRequestId = ? AND workerId = ?"
    ).run(job.id, workerId);

    // WS: 농민 화면에서 실시간 반영
    try {
        if (global.emitToJob) global.emitToJob(job.id, {
            type: 'application_cancelled',
            jobId: job.id,
            workerId,
        });
    } catch (_) {}

    console.log(`[CANCEL_APPLY] jobId=${job.id} workerId=${workerId}`);
    return res.json({ ok: true });
});

// ─── POST /api/jobs/:id/contact ───────────────────────────────
router.post('/:id/contact', async (req, res) => {
    const now = new Date().toISOString();
    const result = await db.prepare(`
        UPDATE jobs
        SET lastContactAt = ?,
            contactCount  = COALESCE(contactCount, 0) + 1
        WHERE id = ?
    `).run(now, req.params.id);

    if (result.changes === 0) {
        return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    }

    const row = await db.prepare('SELECT id, contactCount, lastContactAt FROM jobs WHERE id = ?').get(req.params.id);
    console.log(`[CONTACT_ATTEMPT] jobId=${req.params.id} contactCount=${row?.contactCount}`);
    return res.json({ ok: true, contactCount: row?.contactCount });
});

// ─── POST /api/jobs/:id/contact-apply ────────────────────────
router.post('/:id/contact-apply', async (req, res) => {
    const jobId    = req.params.id;
    const workerId = req.body?.workerId || 'anonymous';
    const now      = new Date().toISOString();

    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    // 자기 공고 차단 (contact-apply 우회 경로)
    if (workerId && workerId !== 'anonymous') {
        if (workerId === job.requesterId) {
            return res.status(400).json({ ok: false, error: '본인이 올린 공고에는 지원할 수 없어요.' });
        }
        const _cw = await db.prepare('SELECT userId FROM workers WHERE id = ?').get(workerId);
        if (_cw && _cw.userId === job.requesterId) {
            return res.status(400).json({ ok: false, error: '본인이 올린 공고에는 지원할 수 없어요.' });
        }
    }

    if (
        (job.status === 'in_progress' || job.status === 'matched') &&
        job.selectedWorkerId === workerId
    ) {
        console.log(`[CONTACT_APPLY_SKIP] jobId=${jobId} workerId=${workerId} reason=already_matched`);
        return res.json({ ok: true, already: true, status: job.status });
    }

    if (job.status === 'in_progress' && job.selectedWorkerId && job.selectedWorkerId !== workerId) {
        return res.status(409).json({ ok: false, error: '이미 다른 작업자가 진행 중이에요.' });
    }

    const appId = `app-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const existingApp = await db.prepare(
        "SELECT id FROM applications WHERE jobRequestId = ? AND workerId = ? AND status != 'cancelled'"
    ).get(jobId, workerId);

    if (!existingApp) {
        await db.prepare(`
            INSERT INTO applications (id, jobRequestId, workerId, message, status, createdAt)
            VALUES (?, ?, ?, ?, 'pending', ?)
        `).run(appId, jobId, workerId, '바로 연락하기 (자동 지원)', now);
        console.log(`[CONTACT_APPLY_APP] appId=${appId} jobId=${jobId} workerId=${workerId}`);
    }

    // ── 원자적 업데이트 ───────────────────────────────────────────
    // 허용 조건:
    //   (a) open 공고이고 아무도 선택 안 됨 → 선착순 선택
    //   (b) 이미 이 작업자가 matched/in_progress → 멱등 허용
    const updated = await db.prepare(`
        UPDATE jobs
        SET status           = 'matched',
            selectedWorkerId = ?,
            contactRevealed  = 1,
            appliedAt        = ?,
            scheduledAt      = ?,
            contactCount     = COALESCE(contactCount, 0) + 1,
            lastContactAt    = ?
        WHERE id = ?
          AND (
                (status = 'open' AND selectedWorkerId IS NULL)
             OR (status IN ('matched', 'in_progress') AND selectedWorkerId = ?)
              )
    `).run(workerId, now, now, now, jobId, workerId);

    if (updated.changes === 0) {
        // 다른 작업자가 이미 선택된 상태
        console.warn(`[CONTACT_APPLY_RACE] jobId=${jobId} workerId=${workerId} — 이미 선택된 상태`);
        return res.status(409).json({ ok: false, error: '이미 다른 작업자가 연결된 공고예요.' });
    }

    console.log(`[CONTACT_APPLY_DONE] jobId=${jobId} workerId=${workerId} status=matched`);

    const farmer = await db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(job.requesterId);
    sendContactAlert(
        { ...job, farmerPhone: farmer?.phone },
        { id: workerId, name: req.body?.workerName || '작업자' }
    ).catch(() => {});

    return res.json({ ok: true, already: false, status: 'matched' });
});

// ─── POST /api/jobs/:id/reschedule ────────────────────────────
router.post('/:id/reschedule', async (req, res) => {
    const jobId       = req.params.id;
    const { scheduledAt, requesterId } = req.body;

    if (!scheduledAt) return res.status(400).json({ ok: false, error: 'scheduledAt이 필요해요.' });

    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    await db.prepare('UPDATE jobs SET scheduledAt = ? WHERE id = ?').run(scheduledAt, jobId);

    const msg = `[농촌일손]\n일정이 변경되었습니다.\n${job.category || '작업'} | ${job.locationText || ''}\n새 일정: ${scheduledAt}`;
    console.log(`[SCHEDULE_NOTIFY] jobId=${jobId} newDate=${scheduledAt}`);
    console.log(msg);

    if (global.broadcast) {
        global.broadcast({ type: 'job_rescheduled', jobId, scheduledAt });
    }

    return res.json({ ok: true, scheduledAt });
});

// ─── GET /api/jobs/:id/applicants ─────────────────────────────
router.get('/:id/applicants', async (req, res) => {
  try {
    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { requesterId } = req.query;
    if (requesterId && job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 요청만 볼 수 있어요.' });
    }

    const apps = await db.prepare(
        "SELECT * FROM applications WHERE jobRequestId = ? AND status != 'cancelled' ORDER BY createdAt ASC"
    ).all(job.id);

    const raw = await Promise.all(apps.map(async a => {
        let workerRow = await db.prepare('SELECT * FROM workers WHERE id = ?').get(a.workerId)
                     || await db.prepare('SELECT * FROM workers WHERE userId = ?').get(a.workerId);
        if (!workerRow) {
            const u = await db.prepare(
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

        const jobMs    = new Date(job.createdAt).getTime();
        const appMs    = new Date(a.createdAt).getTime();
        const speedMins = Math.round(Math.max(0, (appMs - jobMs) / 60000));

        const reviewCount = worker
            ? ((await db.prepare('SELECT COUNT(*) AS cnt FROM reviews WHERE targetId = ?').get(worker.id))?.cnt || 0)
            : 0;

        const baseScore = worker
            ? calcApplicantMatchScore(worker, a, job, distKm, reviewCount)
            : null;
        const v2Bonus  = worker ? calcV2Bonus(worker, job) : 0;
        const matchScore = baseScore !== null ? Math.round(baseScore + v2Bonus) : null;

        let topTags = [];
        if (worker) {
            const tagRows = await db.prepare(
                'SELECT tags FROM reviews WHERE targetId = ? AND isPublic = 1 AND tags IS NOT NULL'
            ).all(worker.id);
            const freq = {};
            tagRows.forEach(row => {
                try {
                    const arr = JSON.parse(row.tags);
                    if (Array.isArray(arr)) arr.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
                } catch {}
            });
            topTags = Object.entries(freq)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([tag]) => tag);
        }

        // ── successProb: matchScore 기반 경량 계산 (weather/ctx 없이) ──
        // matchScore 0~100 → 확률 35~95% 선형 매핑
        // worker.successRate(누적 완료율)가 있으면 +5pt 보정
        const successProb = matchScore !== null ? (() => {
            const base   = Math.round(35 + matchScore * 0.60);     // 0→35%, 100→95%
            const srBonus = (worker?.successRate ?? 0) > 0.7 ? 5 : 0;
            return Math.min(95, Math.max(35, base + srBonus));
        })() : null;

        return {
            applicationId: a.id,
            _workerId:     a.workerId,   // 진단용 — null worker 로그에서 실제 ID 확인
            status:        a.status,
            message:       a.message,
            createdAt:     a.createdAt,
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
                successRate:      worker.successRate ?? 0,
                availableTimeText: worker.availableTimeText,
                noshowCount:      worker.noshowCount  || 0,
                ratingAvg:        worker.ratingAvg   ?? null,
                ratingCount:      worker.ratingCount ?? 0,
                topTags,
                successProb,
                distKm,
                distLabel:        dist !== null ? distLabel(dist) : null,
                locationUpdatedAt: worker.locationUpdatedAt ?? null,
                activeNow:         worker.activeNow         ?? 0,
                matchedAt: a.status === 'selected' ? (job.selectedAt ?? null) : null,
            } : null,
        };
    }));

    const result = rankApplicants(raw);

    const nullWorkerCount = result.filter(a => !a.worker).length;
    if (nullWorkerCount > 0) {
        const broken = result.filter(a => !a.worker);
        console.warn(`[BROKEN_LINK][APPLICANTS] jobId=${job.id} nullWorkers=${nullWorkerCount}/${result.length}`);
        broken.forEach(a => console.warn(`  ↳ appId=${a.applicationId} workerId=${a._workerId} — workers/users 조회 실패`));
    }
    console.log(`[TRACE][APPLICANTS] jobId=${job.id} total=${result.length} nullWorkers=${nullWorkerCount} top=${result[0]?.worker?.name ?? 'none'} score=${result[0]?.matchScore ?? 'N/A'}`);
    console.log(`[APPLICANT_VIEWED_RANKED] jobId=${job.id} count=${result.length} top=${result[0]?.worker?.name ?? 'none'} score=${result[0]?.matchScore ?? 'N/A'}`);
    return res.json({ ok: true, applicants: result });
  } catch (err) {
    console.error('[APPLICANTS ERROR]', err.message || err);
    // ok: false → 개발자 추적 가능 / applicants: [] → UI는 정상 유지
    return res.json({ ok: false, applicants: [], error: 'DB_ERROR' });
  }
});

// ─── GET /api/jobs/:id/recommend-workers ──────────────────────
// 전체 workers DB에서 거리+평점+경험+날씨+시간대 기반 TOP 3 사전 추천
// (지원자가 없거나 적을 때도 농민에게 즉시 선택지 제공)
//
// AI v2 확장:
//   ① calcRecommendScore (거리·평점·경험·즉시가능)
//   ② predictSuccess     (날씨·시간대·지역·카테고리 일치)
//   → successProb (0~100%) 필드 추가 반환
//
// distance_km() DB 함수 우선, 미적용 시 JS Haversine fallback
// 동일 jobId 요청은 10초 캐싱
// ──────────────────────────────────────────────────────────────
const _recommendCache    = new Map();
const RECOMMEND_CACHE_MS = 10_000; // 10초

router.get('/:id/recommend-workers', async (req, res) => {
    const jobId = req.params.id;

    // ── 10초 jobId 캐시 ──────────────────────────────────────
    const cached = _recommendCache.get(jobId);
    if (cached && Date.now() - cached.ts < RECOMMEND_CACHE_MS) {
        return res.json({ ...cached.data, cached: true });
    }

    const job = normalizeJob(
        await db.prepare('SELECT id, latitude, longitude, category, autoJobType, date FROM jobs WHERE id = ?').get(jobId)
    );
    if (!job) return res.status(404).json({ ok: false, error: '공고를 찾을 수 없어요.' });
    if (!job.latitude || !job.longitude) {
        return res.json({ ok: true, workers: [], reason: 'no_job_location' });
    }

    const RADIUS_KM = 20;

    // ── 날씨 + 컨텍스트 (병렬) ───────────────────────────────
    const [weather, ctx] = await Promise.all([
        getWeather(job.latitude, job.longitude).catch(() => ({ rain: 0, temp: 20, wind: 1, source: 'fallback' })),
        Promise.resolve(getContextFeatures(job)),
    ]);

    // ── 작업자 목록 (DB-side 거리 필터, fallback 포함) ────────
    let rawRows;
    try {
        rawRows = await db.prepare(`
            SELECT *,
                   distance_km($1, $2, latitude, longitude) AS _rec_dist
            FROM   workers
            WHERE  latitude  IS NOT NULL
              AND  longitude IS NOT NULL
              AND  distance_km($1, $2, latitude, longitude) <= $3
        `).all(job.latitude, job.longitude, RADIUS_KM);
    } catch (_) {
        const all = await db.prepare(
            'SELECT * FROM workers WHERE latitude IS NOT NULL AND longitude IS NOT NULL'
        ).all();
        rawRows = all.map(w => ({
            ...w,
            _rec_dist: distanceKm(job.latitude, job.longitude, w.latitude, w.longitude),
        })).filter(w => w._rec_dist <= RADIUS_KM);
    }

    // ── 스코어링: TOP 10 계산, UI에는 TOP 3만 반환 ──────────────
    // TOP 10 전체를 match_logs에 저장 → "왜 안 선택됐나" 분석 가능
    const scored = rawRows
        .map(w => {
            const dist        = Math.round((Number(w._rec_dist) || 0) * 10) / 10;
            const worker      = normalizeWorker(w);
            const recScore    = calcRecommendScore(worker, dist);
            const successProb = predictSuccess(worker, job, weather, ctx, dist);
            const explain     = buildExplain(worker, job, weather, ctx, dist);
            return {
                ...worker,
                distKm:         dist,
                recommendScore: Math.round(recScore * 100),
                successProb:    Math.round(successProb * 100),
                explain,        // { reasons: string[], warn: string[] }
            };
        })
        .sort((a, b) => b.recommendScore - a.recommendScore);

    const top10 = scored.slice(0, 10);  // 로그용 (10명)
    const top3  = scored.slice(0, 3);   // UI 반환 (3명)

    const result = { ok: true, workers: top3, weather, ctx };
    _recommendCache.set(jobId, { data: result, ts: Date.now() });

    // ── match_logs TOP10 삽입 (비동기 fire-and-forget) ────────
    setImmediate(async () => {
        try {
            const now = new Date().toISOString();
            for (let i = 0; i < top10.length; i++) {
                const w     = top10[i];
                const logId = `mlog-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`;
                await db.prepare(`
                    INSERT INTO match_logs
                        (id, jobid, workerid, rank, predictedscore, recommentscore, createdat)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT DO NOTHING
                `).run(logId, jobId, w.id, i + 1,
                       (w.successProb || 0) / 100, w.recommendScore || 0, now);
            }
        } catch (_) {}
    });

    console.log(`[RECOMMEND_WORKERS] jobId=${jobId} radius=${RADIUS_KM}km pool=${rawRows.length}명 log=top${top10.length} show=top3 weather=${weather.source}`);
    return res.json(result);
});

// ─── POST /api/jobs/:id/select-worker ─────────────────────────
//
// 동시성 보장 구조:
//   1) 사전 검증 (소유권·상태) — SELECT (경량, 5개 컬럼만)
//   2) 트랜잭션 내부:
//      a) UPDATE … WHERE status='open' AND selectedWorkerId IS NULL RETURNING *
//         → PostgreSQL row-level lock → 선착순 1개만 rowCount=1
//         → rowCount=0 이면 ALREADY_SELECTED throw → ROLLBACK
//      b) UPDATE … RETURNING * 결과를 직접 사용 (2차 SELECT 불필요)
//      c) applications 상태 업데이트, contacts 저장, status_logs 기록
//         모두 같은 트랜잭션 — 롤백 시 전부 취소
//   3) 커밋 이후: WS emit, 알림, analytics (실패해도 선택 결과 불변)
// ──────────────────────────────────────────────────────────────
router.post('/:id/select-worker', async (req, res) => {
    const jobId = req.params.id;
    const { requesterId, workerId } = req.body;

    // ── STEP 1: 사전 검증 (소유권 + 상태 전이) ───────────────────
    const jobPre = normalizeJob(
        await db.prepare(
            'SELECT id, requesterId, status, selectedWorkerId, requesterName FROM jobs WHERE id = ?'
        ).get(jobId)
    );
    if (!jobPre) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    console.log(`[SELECT_WORKER_ATTEMPT] jobId=${jobId} status=${jobPre.status} selectedWorkerId=${jobPre.selectedWorkerId ?? 'null'} requesterId=${requesterId} workerId=${workerId}`);

    if (jobPre.requesterId !== requesterId) {
        console.warn(`[SELECT_WORKER_DENY] reason=not_owner jobRequesterId=${jobPre.requesterId} callerRequesterId=${requesterId}`);
        return res.status(403).json({ ok: false, error: '내 요청만 선택할 수 있어요.' });
    }

    const _selErr = checkTransition(jobPre.status, 'matched');
    if (_selErr) {
        console.warn(`[SELECT_WORKER_DENY] reason=invalid_transition status=${jobPre.status}`);
        return res.status(400).json({ ok: false, error: _selErr });
    }

    // ── STEP 2: 작업자 정보 조회 ──────────────────────────────────
    let workerRowSel = await db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId)
                    || await db.prepare('SELECT * FROM workers WHERE userId = ?').get(workerId);
    if (!workerRowSel) {
        const u = await db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(workerId);
        if (u) workerRowSel = {
            id: workerId, userId: u.id,
            name: u.name || '작업자', phone: u.phone,
            categories: '[]', hasTractor: 0, hasSprayer: 0, hasRotary: 0,
            completedJobs: 0, rating: 0, noshowCount: 0,
        };
    }
    const worker = normalizeWorker(workerRowSel);
    console.log(`[TRACE][SELECT_WORKER] jobId=${jobId} workerId=${workerId} resolved=${worker ? worker.name : 'NULL'}`);
    if (!worker) {
        console.warn(`[BROKEN_LINK][SELECT_WORKER] workerId=${workerId} not found in workers or users`);
        return res.status(404).json({ ok: false, error: '작업자를 찾을 수 없어요.' });
    }

    // ── 자기 자신 선택 차단 ─────────────────────────────────────────
    const _selWorkerUserId = worker.userId || workerId;
    if (jobPre.requesterId === _selWorkerUserId || jobPre.requesterId === workerId) {
        console.warn(`[SELECT_WORKER_DENY] reason=self_select jobId=${jobId} requesterId=${jobPre.requesterId}`);
        return res.status(400).json({ ok: false, error: '본인을 작업자로 선택할 수 없어요.' });
    }

    const farmerUser  = await db.prepare('SELECT phone FROM users WHERE id = ?').get(jobPre.requesterId);
    const farmerPhone = farmerUser?.phone || '010-0000-0000';

    // ── STEP 3: 원자적 트랜잭션 ───────────────────────────────────
    let matchedJob;
    try {
        await db.transaction(async () => {
            const now = new Date().toISOString();

            // ❶ 핵심 원자 UPDATE — RETURNING * 로 최신 행 즉시 획득
            //    WHERE 조건이 DB-level lock 역할:
            //    동시 요청 중 단 1개만 rows.length=1, 나머지는 0 → throw
            const rows = await db.prepare(`
                UPDATE jobs
                SET    status           = 'matched',
                       contactRevealed  = 1,
                       selectedWorkerId = ?,
                       selectedAt       = ?
                WHERE  id               = ?
                  AND  status           = 'open'
                  AND  selectedWorkerId IS NULL
                RETURNING *
            `).all(workerId, now, jobId);

            if (rows.length === 0) {
                throw Object.assign(
                    new Error('이미 다른 작업자가 선택되었거나 공고 상태가 변경됐어요.'),
                    { code: 'ALREADY_SELECTED' }
                );
            }

            matchedJob = rows[0]; // normalizeRow 이미 적용 (db.js all())

            // ❷ 지원자 상태 일괄 확정
            await db.prepare(
                "UPDATE applications SET status = 'selected' WHERE jobRequestId = ? AND workerId = ?"
            ).run(jobId, workerId);
            await db.prepare(
                "UPDATE applications SET status = 'rejected' WHERE jobRequestId = ? AND workerId != ?"
            ).run(jobId, workerId);

            // ❸ 연락처 저장
            const contactId = 'contact-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            await db.prepare(`
                INSERT INTO contacts (id, jobId, farmerId, workerId, createdAt)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING
            `).run(contactId, jobId, jobPre.requesterId, workerId, now);

            // ❹ 상태 전이 로그 (트랜잭션 내 — 롤백 시 함께 취소)
            const logId = 'slog-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            await db.prepare(`
                INSERT INTO status_logs (id, jobId, fromStatus, toStatus, byUserId, createdAt)
                VALUES (?, ?, ?, 'matched', ?, ?)
            `).run(logId, jobId, jobPre.status, requesterId, now);
        })();
    } catch (e) {
        if (e.code === 'ALREADY_SELECTED') {
            console.warn(`[SELECT_WORKER_RACE] jobId=${jobId} workerId=${workerId} — ${e.message}`);
            return res.status(409).json({ ok: false, error: e.message });
        }
        throw e;
    }

    // ── STEP 4: 커밋 이후 사이드 이펙트 ──────────────────────────
    // 실패해도 선택 결과는 이미 DB에 확정됨 → .catch() 처리
    if (typeof global.emitToJob === 'function') {
        global.emitToJob(jobId, { type: 'job_update', job: matchedJob });
    }
    notifyOnStatus(matchedJob, jobPre.status, 'matched').catch(() => {});
    sendSelectionNotification(matchedJob, worker);
    trackEvent('worker_selected', { jobId, userId: requesterId, meta: { workerId } }).catch(() => {});

    // ── match_logs 선택 확정 마킹 (AI 모델 정확도 추적) ─────────
    // 추천 목록에 있던 작업자 선택 시 selected=true + selectedAt 갱신
    db.prepare(`
        UPDATE match_logs
        SET    selected   = TRUE,
               selectedat = ?
        WHERE  jobid      = ?
          AND  workerid   = ?
          AND  selected   = FALSE
    `).run(new Date().toISOString(), jobId, workerId).catch(() => {});

    console.log(`[JOB_MATCHED] jobId=${jobId} workerId=${workerId}`);
    console.log(`[SELECT_WORKER] jobId=${jobId} workerId=${workerId} farmerPhone=***${farmerPhone.slice(-4)}`);
    console.log(`[CONTACT_REVEALED] jobId=${jobId} farmer<->worker contactRevealed=1`);
    console.log(`[CONTACT_STORED] jobId=${jobId} farmerId=${jobPre.requesterId} workerId=${workerId}`);

    // ── 카카오 알림: 선택 확정 시 양방향 알림 (fail-safe) ─────────
    setImmediate(async () => {
        try {
            const farmerUser = await db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(jobPre.requesterId);
            // ① 농민에게: "작업자 연결 완료"
            sendWorkerSelectedAlert({
                job:    matchedJob,
                worker: { id: workerId, name: worker.name, phone: worker.phone },
                farmer: farmerUser || { id: jobPre.requesterId, name: jobPre.requesterName, phone: farmerPhone },
                isAuto: false,
            }).catch(() => {});
            // ② 작업자에게: "선택됐어요" (arrived)
            sendApplicantArrivedAlert({
                job:    matchedJob,
                worker: { id: workerId, name: worker.name, phone: worker.phone },
                farmer: farmerUser || null,
            }).catch(() => {});
        } catch (e) {
            console.error('[SELECT_ALERT_ERROR]', e.message);
        }
    });

    return res.json({
        ok: true,
        contact: {
            workerName:  worker.name,
            workerPhone: worker.phone,
            farmerName:  jobPre.requesterName,
            farmerPhone,
            message: `${worker.name}님이 선택되었어요! 연락처를 확인하고 직접 연락해보세요.`,
        },
    });
});

// ─── POST /api/jobs/:id/unselect-worker ──────────────────────
// 농민이 선택된 작업자를 취소하고 공고를 다시 open으로 되돌립니다.
// 허용: matched, on_the_way
// 금지: in_progress, completed, closed, paid, reviewed
router.post('/:id/unselect-worker', async (req, res) => {
    const { requesterId } = req.body;
    if (!requesterId) return res.status(400).json({ ok: false, error: 'requesterId가 필요해요.' });

    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 공고만 변경할 수 있어요.' });
    }

    const FORBIDDEN = ['in_progress', 'completed', 'closed', 'paid', 'reviewed'];
    if (FORBIDDEN.includes(job.status)) {
        return res.status(400).json({ ok: false, code: 'CANNOT_UNSELECT_AFTER_START', error: '작업이 시작된 이후에는 선택을 취소할 수 없어요.' });
    }

    if (!job.selectedWorkerId) {
        return res.status(400).json({ ok: false, code: 'NO_SELECTED_WORKER', error: '선택된 작업자가 없어요.' });
    }

    const prevWorkerId = job.selectedWorkerId;

    // 공고를 open 으로 복구, 선택 정보 초기화
    await db.prepare(`
        UPDATE jobs
        SET status = 'open', selectedWorkerId = NULL, selectedAt = NULL
        WHERE id = ?
    `).run(job.id);

    // 선택됐던 작업자의 지원 상태도 applied 로 되돌림 (다시 지원 상태로)
    await db.prepare(
        "UPDATE applications SET status = 'applied' WHERE jobRequestId = ? AND workerId = ? AND status = 'selected'"
    ).run(job.id, prevWorkerId);

    // 나머지 rejected → applied 복구 (선택 취소 시 모두 재검토 가능)
    await db.prepare(
        "UPDATE applications SET status = 'applied' WHERE jobRequestId = ? AND status = 'rejected'"
    ).run(job.id);

    const updatedJob = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id));

    // WS: 모든 구독자에게 상태 변경 알림
    try {
        if (global.emitToJob) global.emitToJob(job.id, {
            type: 'job_update',
            job: { ...updatedJob, status: 'open', selectedWorkerId: null },
        });
    } catch (_) {}

    // 카카오 알림: 작업자에게 선택 취소 안내
    try {
        const workerRow = await db.prepare('SELECT * FROM workers WHERE id = ?').get(prevWorkerId)
                       || await db.prepare('SELECT * FROM workers WHERE userId = ?').get(prevWorkerId);
        if (workerRow?.phone) {
            const { sendJobMatchAlert } = require('../services/kakaoAlertService');
            await sendJobMatchAlert({
                jobId:       job.id + '_unselect',
                phone:       workerRow.phone,
                name:        workerRow.name,
                jobType:     job.category,
                locationText: job.locationText,
                pay:         job.pay,
                date:        job.date,
            }).catch(() => {});
        }
    } catch (_) {}

    console.log(`[UNSELECT_WORKER] jobId=${job.id} prevWorkerId=${prevWorkerId} → status=open`);
    return res.json({ ok: true, job: updatedJob });
});

// ─── POST /api/jobs/:id/connect-call ─────────────────────────
router.post('/:id/connect-call', async (req, res) => {
    const { requestingUserId } = req.body;
    if (!requestingUserId) {
        return res.status(400).json({ ok: false, error: 'requestingUserId가 필요해요.' });
    }

    const result = await getCallInfo(req.params.id, requestingUserId);
    if (!result.ok) {
        console.warn(`[BROKEN_LINK][CONNECT_CALL] jobId=${req.params.id} userId=${requestingUserId} error=${result.error}`);
        return res.status(403).json(result);
    }

    console.log(`[TRACE][CONNECT_CALL] jobId=${req.params.id} userId=${requestingUserId} farmerPhone=${result.farmerPhone ? '***'+result.farmerPhone.slice(-4) : 'null'} workerPhone=${result.workerPhone ? '***'+result.workerPhone.slice(-4) : 'null'}`);
    console.log(`[CONNECT_CALL] jobId=${req.params.id} userId=${requestingUserId}`);
    return res.json(result);
});

// ─── POST /api/jobs/:id/close ─────────────────────────────────
router.post('/:id/close', async (req, res) => {
    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { requesterId } = req.body;
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 요청만 마감할 수 있어요.' });
    }
    if (job.status === 'closed') {
        return res.status(400).json({ ok: false, error: '이미 마감된 작업이에요.' });
    }

    const _prevStatus = job.status;
    await db.prepare("UPDATE jobs SET status = 'closed', closedAt = ? WHERE id = ?")
      .run(new Date().toISOString(), job.id);
    await logTransition(job.id, _prevStatus, 'closed', requesterId);
    const _closedJob = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id));
    if (typeof global.emitToJob === 'function') global.emitToJob(job.id, { type: 'job_update', job: _closedJob });
    await notifyOnStatus(_closedJob || job, _prevStatus, 'closed');

    if (job.status === 'matched' && job.selectedWorkerId) {
        try {
            await db.prepare(
                'UPDATE workers SET noshowCount = COALESCE(noshowCount, 0) + 1 WHERE id = ?'
            ).run(job.selectedWorkerId);
            console.log(`[NOSHOW_TRACKED] jobId=${job.id} workerId=${job.selectedWorkerId}`);
        } catch (e) {
            console.warn('[NOSHOW_TRACK_FAIL]', e.message);
        }
    }

    console.log(`[JOB_CLOSED] id=${job.id} prevStatus=${job.status} farmer=${requesterId}`);
    await trackEvent('job_closed', { jobId: job.id, userId: requesterId, meta: { prevStatus: job.status } });

    return res.json({ ok: true, status: 'closed' });
});

// ─── POST /api/jobs/:id/on-the-way ────────────────────────────
router.post('/:id/on-the-way', async (req, res) => {
    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { workerId } = req.body;
    if (!workerId) return res.status(400).json({ ok: false, error: 'workerId 필요' });

    const _otwErr = checkTransition(job.status, 'on_the_way');
    if (_otwErr) return res.status(400).json({ ok: false, error: _otwErr });

    const selApp = await db.prepare(
        "SELECT w.id as wid FROM applications a JOIN workers w ON w.id = a.workerId WHERE a.jobRequestId = ? AND a.status = 'selected'"
    ).get(job.id);
    const worker = selApp ? normalizeWorker(await db.prepare('SELECT * FROM workers WHERE id = ?').get(selApp.wid)) : null;
    if (worker) {
        const matchedByWid = worker.id === workerId;
        const matchedByUid = worker.userId === workerId;
        if (!matchedByWid && !matchedByUid) {
            return res.status(403).json({ ok: false, error: '선택된 작업자만 출발 처리할 수 있어요.' });
        }
    }

    const departureAt = new Date().toISOString();
    await db.prepare("UPDATE jobs SET status = 'on_the_way', startedAt = ? WHERE id = ?").run(departureAt, job.id);

    try {
        const farmerNotify = await db.prepare('SELECT * FROM users WHERE id = ?').get(job.requesterId);
        if (farmerNotify) {
            await db.prepare(
                "INSERT INTO notify_log (id, userId, type, message, jobId, createdAt) VALUES (?, ?, 'worker_departed', ?, ?, CURRENT_TIMESTAMP)"
            ).run(`ntf-${Date.now()}`, job.requesterId, `작업자가 출발했어요! 잠시 후 도착합니다.`, job.id);
        }
    } catch (_) {}

    await logTransition(job.id, job.status, 'on_the_way', workerId);
    const _otwJob = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id));
    if (typeof global.emitToJob === 'function') global.emitToJob(job.id, { type: 'job_update', job: _otwJob });
    await notifyOnStatus(_otwJob || job, job.status, 'on_the_way');

    setImmediate(async () => {
        try {
            const farmer = await db.prepare('SELECT * FROM users WHERE id = ?').get(job.requesterId);
            if (farmer) sendWorkerDepartedNotification(job, farmer);
        } catch (_) {}
    });
    console.log(`[JOB_ON_THE_WAY] id=${job.id} workerId=${workerId} departureAt=${departureAt}`);
    return res.json({ ok: true, status: 'on_the_way', departureAt });
});

// ─── POST /api/jobs/:id/start ─────────────────────────────────
router.post('/:id/start', async (req, res) => {
    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { requesterId } = req.body;
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 작업만 시작할 수 있어요.' });
    }
    const _startErr = checkTransition(job.status, 'in_progress');
    if (_startErr) return res.status(400).json({ ok: false, error: _startErr });

    const startedAt = new Date().toISOString();
    const _prevForStart = job.status;
    await db.prepare("UPDATE jobs SET status = 'in_progress', startedAt = ? WHERE id = ?").run(startedAt, job.id);
    await logTransition(job.id, _prevForStart, 'in_progress', req.body.requesterId || 'farmer');
    const _startedJob = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id));
    if (typeof global.emitToJob === 'function') global.emitToJob(job.id, { type: 'job_update', job: _startedJob });
    await notifyOnStatus(_startedJob || job, _prevForStart, 'in_progress');

    const selApp = await db.prepare(
        "SELECT workerId FROM applications WHERE jobRequestId = ? AND status = 'selected'"
    ).get(job.id);
    if (selApp) {
        const workerForNotify = normalizeWorker(await db.prepare('SELECT * FROM workers WHERE id = ?').get(selApp.workerId));
        if (workerForNotify) sendJobStartedNotification(job, workerForNotify);
    }

    console.log(`[JOB_STARTED] id=${job.id} startedAt=${startedAt}`);

    const reminderWorker = selApp
        ? normalizeWorker(await db.prepare('SELECT * FROM workers WHERE id = ?').get(selApp.workerId))
        : null;

    if (reminderWorker) {
        const reminderJobId = job.id;
        setTimeout(async () => {
            try {
                await tryFireReminder(reminderJobId, reminderWorker);
            } catch (e) {
                console.error('[DEPARTURE_REMINDER_ERROR]', e.message);
            }
        }, 10 * 60 * 1000);
        console.log(`[DEPARTURE_REMINDER_SCHEDULED] jobId=${job.id} worker=${reminderWorker.name} in 10min`);
    }

    return res.json({ ok: true, status: 'in_progress', startedAt });
});

// ─── POST /api/jobs/:id/mark-paid ────────────────────────────
router.post('/:id/mark-paid', async (req, res) => {
    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { requesterId } = req.body;
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 작업만 입금 처리할 수 있어요.' });
    }
    if (job.status !== 'completed') {
        return res.status(400).json({ ok: false, error: '완료된 작업만 입금 처리 가능해요.' });
    }
    if (job.paymentStatus === 'paid') {
        return res.json({ ok: true, already: true, paymentStatus: 'paid' });
    }

    const paidAt = new Date().toISOString();
    await db.prepare("UPDATE jobs SET paymentStatus = 'paid' WHERE id = ?").run(job.id);

    try {
        const selApp = await db.prepare(
            "SELECT a.workerId, w.userId FROM applications a JOIN workers w ON w.id = a.workerId WHERE a.jobRequestId = ? AND a.status = 'selected'"
        ).get(job.id);
        if (selApp?.userId) {
            await db.prepare(
                "INSERT INTO notify_log (id, userId, type, message, jobId, createdAt) VALUES (?, ?, 'payment_done', ?, ?, CURRENT_TIMESTAMP)"
            ).run(`ntf-${Date.now()}`, selApp.userId, `입금이 완료됐어요! 이제 후기를 남겨보세요 ⭐`, job.id);
        }
    } catch (_) {}

    await logTransition(job.id, 'completed', 'paid(payment)', requesterId);
    const _paidJob = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id));
    if (typeof global.emitToJob === 'function') global.emitToJob(job.id, { type: 'job_update', job: _paidJob });
    await notifyOnStatus(_paidJob || { ...job, paymentStatus: 'paid' }, 'completed', 'paid');

    setImmediate(async () => {
        try {
            const selApp2 = await db.prepare(
                "SELECT a.workerId FROM applications a WHERE a.jobRequestId = ? AND a.status = 'selected'"
            ).get(job.id);
            if (selApp2?.workerId) {
                const w = normalizeWorker(await db.prepare('SELECT * FROM workers WHERE id = ?').get(selApp2.workerId));
                if (w) sendPaymentDoneNotification(job, w);
            }
        } catch (_) {}
    });
    console.log(`[JOB_MARK_PAID] id=${job.id} requesterId=${requesterId} paidAt=${paidAt}`);
    return res.json({ ok: true, paymentStatus: 'paid', paidAt });
});

// ─── POST /api/jobs/:id/complete ─────────────────────────────
router.post('/:id/complete', async (req, res) => {
    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { requesterId } = req.body;
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 작업만 완료할 수 있어요.' });
    }
    const _compErr = checkTransition(job.status, 'completed');
    if (_compErr) return res.status(400).json({ ok: false, error: _compErr });

    if (!job.startedAt) {
        return res.status(400).json({ ok: false, error: '작업 시작 버튼을 먼저 눌러야 완료할 수 있어요.' });
    }

    const MIN_WORK_MS = 10 * 60 * 1000;
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

    const completedAt = new Date().toISOString();
    const payNum = (() => {
        const raw = String(job.pay || '').replace(/[^0-9]/g, '');
        return raw ? parseInt(raw, 10) : null;
    })();

    await db.prepare(`
        UPDATE jobs
        SET status      = 'completed',
            completedAt = ?,
            paid        = 1,
            payAmount   = COALESCE(payAmount, ?)
        WHERE id = ?
    `).run(completedAt, payNum, job.id);
    await logTransition(job.id, 'in_progress', 'completed', req.body.requesterId || 'farmer');
    const _completedJob = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id));
    if (typeof global.emitToJob === 'function') global.emitToJob(job.id, { type: 'job_update', job: _completedJob });
    await notifyOnStatus(_completedJob || job, 'in_progress', 'completed');

    setImmediate(async () => {
        try {
            const farmer = await db.prepare('SELECT * FROM users WHERE id = ?').get(job.requesterId);
            if (farmer) sendJobCompletedToFarmerNotification(job, farmer);
        } catch (_) {}
    });

    if (job.selectedWorkerId) {
        try {
            const wRow = await db.prepare('SELECT id, completedJobs FROM workers WHERE userId = ?').get(job.selectedWorkerId);
            if (wRow) {
                const newCompleted = (wRow.completedJobs || 0) + 1;
                const totalAppsRow = await db.prepare(
                    "SELECT COUNT(*) AS n FROM applications WHERE workerId = ?"
                ).get(wRow.id);
                const totalApps = totalAppsRow?.n || 1;
                const newSuccessRate = Math.round((newCompleted / Math.max(1, totalApps)) * 100) / 100;
                await db.prepare('UPDATE workers SET completedJobs = ?, successRate = ? WHERE id = ?')
                  .run(newCompleted, newSuccessRate, wRow.id);
                console.log(`[WORKER_STATS] workerId=${wRow.id} completedJobs=${newCompleted} successRate=${newSuccessRate}`);
            }
        } catch (e) {
            console.warn('[WORKER_STATS_FAIL]', e.message);
        }
    }

    const selApp = await db.prepare(
        "SELECT workerId FROM applications WHERE jobRequestId = ? AND status = 'selected'"
    ).get(job.id);
    if (selApp) {
        const worker = normalizeWorker(await db.prepare('SELECT * FROM workers WHERE id = ?').get(selApp.workerId));
        if (worker) sendJobCompletedNotification(job, worker);
    }

    console.log(`[JOB_COMPLETED] id=${job.id} payAmount=${payNum} paid=1`);
    if (job.paymentStatus === 'paid') {
        console.log(`[SETTLEMENT_ESCROW] jobId=${job.id} paymentId=${job.paymentId} netAmount=${job.netAmount} fee=${job.fee} → 정산 완료`);
    } else {
        console.log(`[SETTLEMENT_WARNING] jobId=${job.id} paymentStatus=${job.paymentStatus ?? 'pending'} — 결제 없이 완료됨`);
    }
    console.log(`[SETTLEMENT] jobId=${job.id} payAmount=${payNum ?? 'unknown'} completedAt=${completedAt}`);
    await trackEvent('job_completed', { jobId: job.id, userId: requesterId, meta: { category: job.category } });

    if (global.broadcast) {
        global.broadcast({ type: 'job_completed', jobId: job.id, payAmount: payNum, completedAt });
    }

    return res.json({ ok: true, status: 'completed', paid: true, payAmount: payNum, completedAt });
});

// ─── POST /api/jobs/:id/complete-work ────────────────────────
router.post('/:id/complete-work', async (req, res) => {
    const { workerId } = req.body;
    if (!workerId) return res.status(400).json({ ok: false, error: 'workerId가 필요해요.' });

    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const app = await db.prepare(
        'SELECT * FROM applications WHERE jobRequestId = ? AND workerId = ?'
    ).get(job.id, workerId);
    if (!app) return res.status(403).json({ ok: false, error: '지원 이력이 없어요.' });
    if (app.status === 'completed') {
        return res.status(400).json({ ok: false, error: '이미 완료 처리된 작업이에요.' });
    }

    await db.prepare(
        "UPDATE applications SET status = 'completed', completedAt = ? WHERE id = ?"
    ).run(new Date().toISOString(), app.id);

    console.log(`[APP_COMPLETED] jobId=${job.id} workerId=${workerId}`);
    await trackEvent('work_completed', { jobId: job.id, userId: workerId, meta: { category: job.category } });
    return res.json({ ok: true, status: 'completed' });
});

// ─── POST /api/jobs/:id/review ────────────────────────────────
router.post('/:id/review', async (req, res) => {
    const {
        workerId,
        reviewerId:   reviewerIdParam,
        targetId:     targetIdParam,
        rating,
        review:       comment = '',
        tags:         tagsRaw,
        reviewerRole: reviewerRoleRaw,
    } = req.body;

    const reviewerId = reviewerIdParam || workerId;
    if (!reviewerId) return res.status(400).json({ ok: false, error: 'reviewerId가 필요해요.' });

    const r = parseInt(rating);
    if (!r || r < 1 || r > 5) {
        return res.status(400).json({ ok: false, error: '평점은 1~5 사이여야 해요.' });
    }

    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const isFarmer = job.requesterId     === reviewerId;
    const isWorker = job.selectedWorkerId === reviewerId;
    if (!isFarmer && !isWorker) {
        const app = await db.prepare(
            "SELECT id FROM applications WHERE jobRequestId = ? AND workerId = ?"
        ).get(job.id, reviewerId);
        if (!app) return res.status(403).json({ ok: false, error: '이 작업에 참여한 분만 후기를 남길 수 있어요.' });
    }

    const targetId = targetIdParam
        || (isFarmer ? job.selectedWorkerId : job.requesterId);
    if (!targetId) return res.status(400).json({ ok: false, error: '대상을 특정할 수 없어요. targetId를 전달해주세요.' });

    const existing = await db.prepare(
        'SELECT id FROM reviews WHERE jobId = ? AND reviewerId = ?'
    ).get(job.id, reviewerId);
    if (existing) return res.status(409).json({ ok: false, error: '이미 후기를 작성했어요.' });

    const tagsStr = Array.isArray(tagsRaw)
        ? JSON.stringify(tagsRaw)
        : (tagsRaw ? String(tagsRaw) : null);

    const reviewerRole = reviewerRoleRaw || (isFarmer ? 'farmer' : 'worker');

    const id = newId('rev');
    await db.prepare(`
        INSERT INTO reviews (id, jobId, reviewerId, targetId, rating, comment, tags, reviewerRole, isPublic, createdAt)
        VALUES (@id, @jobId, @reviewerId, @targetId, @rating, @comment, @tags, @reviewerRole, 0, @createdAt)
    `).run({ id, jobId: job.id, reviewerId, targetId, rating: r, comment, tags: tagsStr, reviewerRole, createdAt: new Date().toISOString() });

    if (reviewerRole === 'farmer') {
        const w = await db.prepare('SELECT id, ratingAvg, ratingCount FROM workers WHERE id = ?').get(targetId);
        if (w) {
            const oldAvg   = w.ratingAvg   ?? 0;
            const oldCount = w.ratingCount ?? 0;
            const newCount = oldCount + 1;
            const newAvg   = Math.round(((oldAvg * oldCount) + r) / newCount * 10) / 10;
            await db.prepare('UPDATE workers SET ratingAvg = ?, ratingCount = ? WHERE id = ?')
              .run(newAvg, newCount, w.id);
            console.log(`[RATING_UPDATED] workers id=${w.id} newAvg=${newAvg} newCount=${newCount}`);
        }
    } else {
        const u = await db.prepare('SELECT id, rating, reviewCount FROM users WHERE id = ?').get(targetId);
        if (u) {
            const oldAvg   = u.rating      ?? 0;
            const oldCount = u.reviewCount ?? 0;
            const newCount = oldCount + 1;
            const newAvg   = Math.round(((oldAvg * oldCount) + r) / newCount * 10) / 10;
            await db.prepare('UPDATE users SET rating = ?, reviewCount = ? WHERE id = ?')
              .run(newAvg, newCount, u.id);
            console.log(`[RATING_UPDATED] users id=${u.id} newAvg=${newAvg} newCount=${newCount}`);
        }
    }

    const otherReview = await db.prepare(
        'SELECT id FROM reviews WHERE jobId = ? AND reviewerId != ? AND isPublic = 0'
    ).get(job.id, reviewerId);
    let revealed = false;
    if (otherReview) {
        await db.prepare('UPDATE reviews SET isPublic = 1 WHERE jobId = ?').run(job.id);
        revealed = true;
        console.log(`[REVIEW_BLIND_REVEAL] jobId=${job.id} — 양측 작성 완료 → 공개`);
    }

    console.log(`[REVIEW_SUBMITTED] jobId=${job.id} reviewerId=${reviewerId} target=${targetId} rating=${r} role=${reviewerRole} blind=${!revealed}`);
    await trackEvent('review_submitted', { jobId: job.id, userId: reviewerId, meta: { rating: r, reviewerRole } });
    return res.status(201).json({ ok: true, revealed, waitingForOther: !revealed });
});

// ─── GET /api/jobs/:id/reviews ────────────────────────────────
router.get('/:id/reviews', async (req, res) => {
    const { userId } = req.query;
    const reviews = await db.prepare(`
        SELECT r.id, r.reviewerId, r.targetId, r.rating, r.comment, r.tags,
               r.isPublic, r.createdAt,
               u.name AS reviewerName
        FROM   reviews r
        LEFT JOIN users u ON u.id = r.reviewerId
        WHERE  r.jobId = ?
          AND  (r.isPublic = 1 OR r.reviewerId = ?)
        ORDER BY r.createdAt DESC
    `).all(req.params.id, userId || '');

    const parsed = reviews.map(rv => ({
        ...rv,
        tags: (() => { try { return rv.tags ? JSON.parse(rv.tags) : []; } catch { return []; } })(),
        isPublic: !!rv.isPublic,
        waitingForOther: !rv.isPublic,
    }));

    return res.json({ ok: true, reviews: parsed, count: parsed.length });
});

// ─── POST /api/jobs/:id/rematch ───────────────────────────────
router.post('/:id/rematch', async (req, res) => {
    const { requesterId } = req.body;
    if (!requesterId) return res.status(400).json({ ok: false, error: 'requesterId가 필요해요.' });

    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    if (job.requesterId !== requesterId) return res.status(403).json({ ok: false, error: '권한이 없어요.' });
    if (!['completed', 'closed'].includes(job.status)) {
        return res.status(400).json({ ok: false, error: '완료 또는 마감된 작업에만 재매칭을 요청할 수 있어요.' });
    }

    const candidates = await db.prepare(`
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

// ─── POST /api/jobs/:id/urgent ────────────────────────────────
router.post('/:id/urgent', async (req, res) => {
    const { requesterId } = req.body || {};
    if (!requesterId) return res.status(400).json({ ok: false, error: 'requesterId가 필요해요.' });

    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
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

    await db.prepare('UPDATE jobs SET isUrgent = 1 WHERE id = ?').run(job.id);
    console.log(`[JOB_URGENT] jobId=${job.id} requesterId=${requesterId}`);
    await trackEvent('job_urgent', { jobId: job.id, userId: requesterId, meta: { category: job.category } });

    setImmediate(async () => {
        try {
            const apps = await db.prepare(
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

// ─── POST /api/jobs/:id/set-auto-assign ──────────────────────
router.post('/:id/set-auto-assign', async (req, res) => {
    const { requesterId, enable } = req.body || {};
    if (!requesterId) return res.status(400).json({ ok: false, error: 'requesterId가 필요해요.' });

    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 공고만 설정 가능해요.' });
    }

    const flag = enable ? 1 : 0;
    await db.prepare('UPDATE jobs SET autoAssign = ? WHERE id = ?').run(flag, job.id);
    console.log(`[AUTO_ASSIGN_FLAG] jobId=${job.id} autoAssign=${flag}`);
    await trackEvent('auto_assign_toggle', { jobId: job.id, userId: requesterId, meta: { enable: flag } });

    return res.json({ ok: true, autoAssign: flag });
});

// ─── POST /api/jobs/:id/auto-assign ──────────────────────────
router.post('/:id/auto-assign', async (req, res) => {
    const { requesterId } = req.body || {};
    if (!requesterId) return res.status(400).json({ ok: false, error: 'requesterId가 필요해요.' });

    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 공고만 자동 배정 가능해요.' });
    }
    if (job.status !== 'open') {
        return res.status(400).json({ ok: false, error: '모집 중인 공고만 자동 배정 가능해요.' });
    }

    const apps = await db.prepare(
        "SELECT * FROM applications WHERE jobRequestId = ? AND status = 'applied' ORDER BY createdAt ASC"
    ).all(job.id);
    if (apps.length === 0) {
        return res.status(400).json({ ok: false, error: '지원자가 없어요. 잠시 후 다시 시도해주세요.' });
    }

    const scoredRaw = await Promise.all(apps.map(async a => {
        const worker = normalizeWorker(await db.prepare('SELECT * FROM workers WHERE id = ?').get(a.workerId));
        if (!worker) return null;
        const dist = (job.latitude && job.longitude && worker.latitude && worker.longitude)
            ? distanceKm(job.latitude, job.longitude, worker.latitude, worker.longitude)
            : null;
        const distKmVal    = dist !== null ? Math.round(dist * 10) / 10 : null;
        const reviewCountRow = await db.prepare('SELECT COUNT(*) AS cnt FROM reviews WHERE targetId = ?').get(worker.id);
        const reviewCount  = reviewCountRow?.cnt || 0;
        const baseScore    = calcApplicantMatchScore(worker, a, job, distKmVal, reviewCount);
        const v2Bonus      = calcV2Bonus(worker, job);
        const matchScore   = Math.round(baseScore + v2Bonus);
        return { app: a, worker, distKm: distKmVal, matchScore };
    }));
    const scored = scoredRaw.filter(Boolean);

    if (scored.length === 0) {
        return res.status(400).json({ ok: false, error: '유효한 지원자 프로필이 없어요.' });
    }

    scored.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
    const top = scored[0];

    if (top.worker.ratingAvg !== null && top.worker.ratingAvg < 3.0) {
        return res.status(400).json({ ok: false, error: '추천 작업자의 평점이 낮아 자동 배정이 보류됐어요. 직접 선택해주세요.' });
    }
    if ((top.worker.noshowCount || 0) > 3) {
        return res.status(400).json({ ok: false, error: '노쇼 이력이 많아 자동 배정이 불가해요. 직접 선택해주세요.' });
    }

    const workerId   = top.worker.id;
    const farmerUser = await db.prepare('SELECT phone FROM users WHERE id = ?').get(job.requesterId);
    const farmerPhone = farmerUser?.phone || '010-0000-0000';

    let didSelect = false;
    await db.transaction(async () => {
        const r = await db.prepare(`
            UPDATE jobs
            SET status = 'matched', contactRevealed = 1,
                selectedWorkerId = ?, selectedAt = ?, autoSelected = 1
            WHERE id = ? AND status = 'open'
        `).run(workerId, new Date().toISOString(), job.id);

        if (r.changes === 0) return;
        didSelect = true;

        await db.prepare("UPDATE applications SET status = 'selected' WHERE jobRequestId = ? AND workerId = ?")
          .run(job.id, workerId);
        await db.prepare("UPDATE applications SET status = 'rejected' WHERE jobRequestId = ? AND workerId != ?")
          .run(job.id, workerId);

        try {
            await db.prepare(`
                INSERT INTO contacts (id, jobId, farmerId, workerId, createdAt)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING
            `).run(newId('contact'), job.id, job.requesterId, workerId, new Date().toISOString());
        } catch (_) {}
    })();

    if (didSelect) await logTransition(job.id, 'open', 'matched', req.body.requesterId || 'auto');

    if (!didSelect) {
        return res.status(409).json({ ok: false, error: '이미 다른 작업자가 선택됐어요.' });
    }

    console.log(`[AUTO_ASSIGN] jobId=${job.id} workerId=${workerId} score=${top.matchScore} dist=${top.distKm ?? '?'}km`);
    await trackEvent('auto_assign', { jobId: job.id, userId: requesterId, meta: { workerId, score: top.matchScore } });

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

// ─── POST /api/jobs/:id/sponsor ───────────────────────────────
router.post('/:id/sponsor', async (req, res) => {
    const { requesterId, hours = 24, boost = 20, type = 'sponsored' } = req.body || {};
    if (!requesterId) return res.status(400).json({ ok: false, error: 'requesterId가 필요해요.' });

    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '본인 공고만 스폰서 등록 가능해요.' });
    }
    if (job.status !== 'open') {
        return res.status(400).json({ ok: false, error: '모집 중인 공고만 스폰서 등록 가능해요.' });
    }

    try {
        if (type === 'urgentPaid') {
            await db.prepare('UPDATE jobs SET isUrgentPaid = 1 WHERE id = ?').run(job.id);
            console.log(`[SPONSOR_URGENT_PAID] jobId=${job.id} requesterId=${requesterId}`);
            await trackEvent('sponsor_urgent_paid', { jobId: job.id, userId: requesterId });
            return res.json({ ok: true, type: 'urgentPaid', message: '🔥 긴급 공고가 활성화되었어요!' });
        } else {
            const expiresAt = Date.now() + Number(hours) * 3_600_000;
            await db.prepare(
                'INSERT INTO sponsored_jobs (jobId, boost, expiresAt) VALUES (?, ?, ?) ON CONFLICT (jobId) DO UPDATE SET boost = EXCLUDED.boost, expiresAt = EXCLUDED.expiresAt'
            ).run(String(job.id), Number(boost), expiresAt);
            console.log(`[SPONSOR_REGISTERED] jobId=${job.id} boost=${boost} hours=${hours}`);
            await trackEvent('sponsor_registered', { jobId: job.id, userId: requesterId, meta: { hours, boost } });
            return res.json({ ok: true, type: 'sponsored', expiresAt, message: '⭐ 스폰서 공고가 등록되었어요!' });
        }
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── POST /api/jobs/:id/pay ───────────────────────────────────
router.post('/:id/pay', async (req, res) => {
    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    if (job.paymentStatus === 'paid') {
        return res.json({ ok: true, already: true, paymentStatus: 'paid' });
    }
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

        await db.prepare(`
            UPDATE jobs
            SET paymentStatus = 'reserved',
                paymentId     = ?,
                fee           = ?,
                netAmount     = ?
            WHERE id = ?
        `).run(payment.paymentId, payment.fee, payment.net, job.id);

        await trackEvent('payment_reserved', { jobId: job.id, userId: req.body.requesterId || null });

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

// ─── POST /api/jobs/:id/pay/confirm ──────────────────────────
router.post('/:id/pay/confirm', async (req, res) => {
    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    if (!job.paymentId) {
        return res.status(400).json({ ok: false, error: '먼저 결제 요청을 생성해주세요. (/pay)' });
    }
    if (job.paymentStatus === 'paid') {
        return res.json({ ok: true, already: true, paymentStatus: 'paid' });
    }

    try {
        confirmPayment(job.paymentId);

        await db.prepare("UPDATE jobs SET paymentStatus = 'paid' WHERE id = ?").run(job.id);

        console.log(`[PAYMENT_CONFIRMED] jobId=${job.id} paymentId=${job.paymentId} net=${job.netAmount}원`);
        await trackEvent('payment_confirmed', { jobId: job.id, userId: req.body.requesterId || null });

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

// ─── POST /api/jobs/:id/refund ────────────────────────────────
router.post('/:id/refund', async (req, res) => {
    const { requesterId } = req.body || {};
    const job = normalizeJob(await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
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
    if (job.status === 'completed') {
        return res.status(400).json({ ok: false, error: '완료된 작업은 환불할 수 없어요.' });
    }

    try {
        refundPayment(job.paymentId);

        await db.prepare("UPDATE jobs SET paymentStatus = 'refunded' WHERE id = ?").run(job.id);

        console.log(`[PAYMENT_REFUNDED] jobId=${job.id} paymentId=${job.paymentId} requesterId=${requesterId || 'unknown'}`);
        await trackEvent('payment_refunded', { jobId: job.id, userId: requesterId || null });

        return res.json({ ok: true, paymentStatus: 'refunded', paymentId: job.paymentId });
    } catch (e) {
        console.error('[PAYMENT_REFUND_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '환불 처리 오류: ' + e.message });
    }
});

module.exports = router;
