'use strict';
/**
 * matchingEngine.js — 작업-작업자 매칭 엔진 (스코어 기반)
 *
 * 스코어 산식:
 *   작업  : score = (catMatch × 50) + (거리점수 0~25) + (isUrgent × 100)
 *   작업자: score = (catMatch × 50) + (거리점수 0~25) + (rating × 10)
 *
 * 거리점수: Math.max(0, 5 - Math.min(distKm, 5)) × 5
 *   → 1km 이내 = 20점, 3km = 10점, 5km 이상 = 0점
 *
 * 급구 Boost: isUrgent → +100점 (무조건 상단 고정)
 */

/** Haversine 거리 계산 (km) */
function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
            * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 거리 → 점수 변환 (0~25점) */
function distScore(km) {
    return Math.max(0, 5 - Math.min(km, 5)) * 5;
}

/**
 * 작업 목록 정렬/필터
 * @param {object[]} jobList
 * @param {object}   opts  { category, userLat, userLon, date, radiusKm }
 */
function rankJobs(jobList, opts = {}) {
    const { category, userLat, userLon, date, radiusKm = 100 } = opts;

    return jobList
        .filter(j => j.status === 'open')
        .filter(j => !date || j.date === date)
        .map(j => {
            const dist     = (userLat && userLon)
                ? distanceKm(userLat, userLon, j.latitude, j.longitude)
                : 0;                                 // 위치 없으면 0 → 전국 노출
            const catMatch = category ? (j.category === category ? 1 : 0) : 1;

            let score = (catMatch * 50) + distScore(dist);
            if (j.isUrgent) score += 100;            // 🔥 급구 Boost

            return { ...j, _dist: dist, _catMatch: catMatch, _score: score };
        })
        // 위치 있을 때만 반경 필터
        .filter(j => !(userLat && userLon) || j._dist <= radiusKm)
        // 스코어 내림차순 → 동점 시 최신순
        .sort((a, b) => b._score - a._score || new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * 근처 작업자 정렬
 * @param {object[]} workerList
 * @param {object}   opts  { lat, lon, category }
 */
function rankWorkers(workerList, opts = {}) {
    const { lat, lon, category } = opts;

    return workerList
        .map(w => {
            const dist     = (lat && lon)
                ? distanceKm(lat, lon, w.latitude, w.longitude)
                : 0;
            const catMatch = category ? (w.categories.includes(category) ? 1 : 0) : 1;
            const inRadius = !(lat && lon) || dist <= w.serviceRadiusKm;
            const score    = (catMatch * 50) + distScore(dist) + ((w.rating || 0) * 10);

            return { ...w, _dist: dist, _catMatch: catMatch, _inRadius: inRadius, _score: score };
        })
        .filter(w => w._inRadius)
        .sort((a, b) => b._score - a._score);
}

/** 거리 표시 문자열 */
function distLabel(km) {
    if (km < 1) return '1km 이내';
    return `${Math.round(km)}km`;
}

/**
 * PHASE 28-30: 지원자 매칭 점수 계산 (0~90점)
 *
 * 산식 (최대 90점):
 *   거리점수  (0~30): 0km=30, 15km=0, 이상=0
 *   평점점수  (0~25): rating × 5 × ratingWeight (리뷰 수 보정)
 *   경험점수  (0~15): completedJobs 최대 10회 기준
 *   속도점수  (0~20): job 등록 후 지원까지 시간 (0분=20, 60분=0)
 *
 * 평점 초기 보정 (PHASE 30):
 *   리뷰 0개 → weight 0.5  (기본 5.0점이어도 신뢰도 50%만 반영)
 *   리뷰 1개 → weight 0.6
 *   리뷰 2개 → weight 0.8
 *   리뷰 3개+ → weight 1.0 (완전 신뢰)
 *
 * @param {object}      worker      - worker DB row (정규화된)
 * @param {object}      app         - application row
 * @param {object}      job         - job row
 * @param {number|null} distKm      - job ↔ worker 거리 (km)
 * @param {number}      reviewCount - 해당 작업자의 누적 리뷰 수 (기본 0)
 */
function calcApplicantMatchScore(worker, app, job, distKm, reviewCount = 0) {
    let score = 0;

    // ── 거리 점수 (0~30) ──────────────────────────────────────────
    if (distKm !== null && distKm !== undefined) {
        score += Math.max(0, 30 - distKm * 2);  // 0km→30, 15km→0
    } else {
        score += 15;  // 거리 정보 없으면 중간값
    }

    // ── 평점 점수 (0~25) — 리뷰 수 기반 신뢰 가중치 적용 ─────────
    const ratingWeights = [0.5, 0.6, 0.8, 1.0]; // 0, 1, 2, 3+ 리뷰
    const ratingWeight  = ratingWeights[Math.min(reviewCount, 3)];
    score += (worker.rating || 4.0) * 5 * ratingWeight;

    // ── 경험 점수 (0~15) ─────────────────────────────────────────
    score += Math.min(worker.completedJobs || 0, 10) * 1.5;

    // ── 속도 점수 (0~20) — 빨리 지원할수록 고점 ──────────────────
    const jobCreatedMs = new Date(job.createdAt).getTime();
    const appCreatedMs = new Date(app.createdAt).getTime();
    const diffMins     = Math.max(0, (appCreatedMs - jobCreatedMs) / 60000);
    score += Math.max(0, 20 - diffMins / 3);     // 0분→20, 60분→0

    return Math.round(score);
}

/** 지원자 목록을 matchScore 기준 내림차순 정렬 후 rank 부여 */
function rankApplicants(applicantList) {
    return applicantList
        .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
        .map((a, i) => ({ ...a, rank: i + 1 }));
}

module.exports = { rankJobs, rankWorkers, distanceKm, distLabel, calcApplicantMatchScore, rankApplicants };
