'use strict';
/**
 * matchingService.js — 통합 매칭 엔진 (PHASE MATCH_ENGINE_UNIFY)
 *
 * 단일 패스 전략:
 *   GPS 경로: 거리 ≤ radiusKm(5km) AND (카테고리 일치 OR 거리 ≤ nearFieldKm(3km))
 *   No-GPS 경로: 카테고리 필수 + locationText 텍스트 매칭
 *
 * 규칙:
 *   - notifyEnabled = 1 인 사용자만
 *   - 전체 브로드캐스트 절대 금지
 *   - workers.currentLat/Lng 우선 (실시간), users.lat/lng 폴백
 */
const db = require('../db');
const { getDistanceKm, isWithinRadius, hasGps, DEFAULT_RADIUS_KM } = require('./distanceService');
const { calcMatchScore }   = require('./matchScore');
const { getActiveExperiment, assignVariant, getVariantWeights, getWinnerWeights } = require('./abTestService');
const { getJobBoost }      = require('./monetizationService');
const { pushLog }          = require('./recLogService');
const { getFlag }          = require('./systemFlagService');

const MAX_RADIUS_KM = DEFAULT_RADIUS_KM; // 5km

// ─── 지역 텍스트 정규화 ───────────────────────────────────────────
function normalizeLocation(text) {
    if (!text || typeof text !== 'string') return [];
    return text
        .replace(/도$/, '').replace(/특별시$/, '').replace(/광역시$/, '')
        .split(/\s+/).map(s => s.trim()).filter(Boolean);
}

function isSameOrNearbyLocation(a, b) {
    const tokA = normalizeLocation(a);
    const tokB = normalizeLocation(b);
    if (tokA.length === 0 || tokB.length === 0) return false;
    if (tokA[0] === tokB[0]) return true;
    const setB = new Set(tokB);
    return tokA.slice(1).some(t => t.length >= 2 && setB.has(t));
}

function isSameLocation(a, b) {
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a) || isSameOrNearbyLocation(a, b);
}

// ─── STEP 4: GPS 우선, locationText 폴백 ─────────────────────────
/**
 * user(작업자)와 job이 가까운지 판단
 * - GPS 양쪽 모두 있으면: Haversine ≤ radiusKm
 * - GPS 없으면: locationText 폴백
 */
function isNearby(user, job, radiusKm = MAX_RADIUS_KM) {
    const jobLat = job.lat ?? job.latitude ?? null;
    const jobLng = job.lng ?? job.longitude ?? null;

    if (hasGps(user) && jobLat != null && jobLng != null) {
        const dist = getDistanceKm(user.lat, user.lng, jobLat, jobLng);
        console.log(`[MATCH_GPS] ${user.name || '?'} ↔ job=${job.id||job.category} dist=${dist.toFixed(2)}km`);
        return dist <= radiusKm;
    }

    // GPS 없으면 locationText 폴백
    const userLoc = user.locationText || '';
    const jobLoc  = job.locationText  || '';
    if (userLoc && jobLoc) {
        return isSameOrNearbyLocation(userLoc, jobLoc);
    }
    return false;
}

// ─── 농민이 일 등록 시: 알림 대상 작업자 찾기 ───────────────────────
/**
 * PHASE MATCH_ENGINE_UNIFY: 단일 패스 + 내부 전략 분기
 *
 * GPS 경로:
 *   ① 거리 > radiusKm(5km) → 제외
 *   ② 카테고리 일치 → 포함
 *   ③ 카테고리 불일치 + 거리 ≤ nearFieldKm(3km) → 포함 (근거리 fallback)
 *   ④ 나머지 → 제외
 *
 * No-GPS 경로 (폴백):
 *   카테고리 필수 + locationText 텍스트 매칭
 *
 * @param {{ id, category, locationText, lat?, lng?, latitude?, longitude?, isUrgent? }} job
 * @param {{ radiusKm?: number, nearFieldKm?: number, topN?: number }} options
 * @returns {{ id, name, phone, jobType, locationText, lat, lng, _score: number }[]}
 */
function findMatchingWorkers(job, options = {}) {
    const {
        radiusKm    = MAX_RADIUS_KM, // 알림 반경 (기본 5km)
        nearFieldKm = 3,             // 카테고리 불일치 허용 근거리 임계값 (기본 3km)
        topN        = 20,            // 상위 N명만 알림 발송
    } = options;

    const jobLat    = job.lat ?? job.latitude  ?? null;
    const jobLng    = job.lng ?? job.longitude ?? null;
    const hasJobGps = jobLat != null && jobLng != null;

    // workers.currentLat/currentLng 우선, users.lat/lng 폴백 (LEFT JOIN)
    const candidates = db.prepare(`
        SELECT u.id, u.name, u.phone, u.jobType, u.locationText,
               COALESCE(w.currentLat, u.lat) AS lat,
               COALESCE(w.currentLng, u.lng) AS lng
        FROM users u
        LEFT JOIN workers w ON w.userId = u.id
        WHERE u.role = 'worker'
          AND u.notifyEnabled = 1
          AND u.phone IS NOT NULL
          AND u.phone != ''
    `).all();

    // ── Monetization: 스폰서 보너스 (루프 밖 1회) ───────────────────
    const jobBoost = getJobBoost(job.id);

    // ── SAFE_MODE: 루프 밖 1회 조회 (플래그 체크만, 지연 없음) ────────
    const safeMode = getFlag('SAFE_MODE');

    // ── A/B 테스트: 활성 실험 조회 (루프 밖 1회) ────────────────────
    const experiment   = getActiveExperiment();
    // 승자 확정 시 전체 적용 (루프 내 개인 할당 불필요)
    const winnerWeights = experiment ? getWinnerWeights(experiment.id) : null;

    /** @type {{ user: object, score: number }[]} */
    const scored = [];

    for (const u of candidates) {
        // PHASE IMAGE_JOBTYPE_AI: autoJobType 확정 시 우선 사용
        const jobTypeFinal   = job.autoJobType || job.category;
        const categoryMatch  = u.jobType === jobTypeFinal;
        const workerHasGps   = Number.isFinite(u.lat) && Number.isFinite(u.lng);

        // 🔒 SAFE_MODE: AI 차단 → 기본 A(Control) 강제 / 정상: 실험 할당
        const variantKey = safeMode || winnerWeights
            ? (safeMode ? 'A' : null)
            : (assignVariant(u.id, experiment, { lat: u.lat, lng: u.lng }) || 'A');
        const weights    = safeMode ? {} : (winnerWeights || getVariantWeights(experiment, variantKey) || {});

        if (hasJobGps && workerHasGps) {
            // ── GPS 경로: 단일 패스 거리 + 분기 ──────────────────────
            const distKm = getDistanceKm(jobLat, jobLng, u.lat, u.lng);

            if (distKm > radiusKm) continue;                              // ① 반경 밖 → 제외
            if (!categoryMatch && distKm > nearFieldKm) continue;         // ④ 카테고리 불일치 + 근거리 아님 → 제외

            // ② 카테고리 일치 or ③ 근거리 fallback → 점수 산출 후 포함
            const score = calcMatchScore(job, u, distKm, nearFieldKm, weights);
            scored.push({ user: u, score, variantKey, _jobBoost: jobBoost });
            pushLog({ jobId: job.id, workerId: u.id, variantKey, score, distKm,
                      difficulty: job.difficulty ?? null, jobType: job.category, autoJobType: job.autoJobType ?? null });

        } else {
            // ── No-GPS 경로: 카테고리 필수 + locationText 텍스트 매칭 ─
            if (!categoryMatch) continue;
            const userLoc = u.locationText || '';
            const jobLoc  = job.locationText || '';
            if (userLoc && jobLoc && isSameOrNearbyLocation(userLoc, jobLoc)) {
                const score = calcMatchScore(job, u, null, nearFieldKm, weights);
                scored.push({ user: u, score, variantKey, _jobBoost: jobBoost });
                pushLog({ jobId: job.id, workerId: u.id, variantKey, score, distKm: null,
                          difficulty: job.difficulty ?? null, jobType: job.category, autoJobType: job.autoJobType ?? null });
            }
        }
    }

    // 점수 내림차순 정렬 → 스폰서 동점 우선 → TOP_N 슬라이싱
    scored.sort((a, b) => b.score - a.score);
    // 스폰서 게시물: 동점 시 상단 고정 (stable secondary sort)
    if (jobBoost > 0) {
        scored.sort((a, b) => (b._jobBoost || 0) - (a._jobBoost || 0));
    }
    const topScored = scored.slice(0, topN);
    const matched   = topScored.map(({ user, score, variantKey }) => ({
        ...user,
        _score:   score,
        _variant: variantKey || null,
    }));

    const gpsMode    = hasJobGps ? 'GPS' : 'TEXT';
    const topScore   = topScored.length > 0 ? topScored[0].score.toFixed(1) : 'N/A';
    const expLabel   = experiment ? `exp=${experiment.id}` : 'exp=none';
    console.log(`[MATCH_SCORE] r=${radiusKm}km nf=${nearFieldKm}km mode=${gpsMode} topN=${topN} ${expLabel} => ${matched.length}/${candidates.length}명 topScore=${topScore}`);
    return matched;
}

// ─── 작업자 관심 등록 시: 관련 열린 일 찾기 ─────────────────────────
/**
 * @param {{ jobType, locationText, lat?, lng? }} workerProfile
 * @returns {object[]}
 */
function findMatchingFarmers(workerProfile) {
    if (!workerProfile.jobType) return [];

    const openJobs = db.prepare(
        'SELECT * FROM jobs WHERE status = ? AND category = ?'
    ).all('open', workerProfile.jobType);

    return openJobs.filter(j => isNearby(workerProfile, j));
}

module.exports = {
    normalizeLocation,
    isSameOrNearbyLocation,
    isSameLocation,
    isNearby,
    findMatchingWorkers,
    findMatchingFarmers,
    MAX_RADIUS_KM,
};
