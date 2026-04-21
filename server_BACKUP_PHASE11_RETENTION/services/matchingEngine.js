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

module.exports = { rankJobs, rankWorkers, distanceKm, distLabel };
