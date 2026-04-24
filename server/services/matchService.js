'use strict';
/**
 * matchService.js — 작업 ↔ 작업자 근거리 매칭
 *
 * findNearestWorkers(job, workers, topN)
 *   → job 위치 기준 가장 가까운 작업자 TOP N 반환 (거리 오름차순)
 *
 * NOTE: users 테이블 컬럼은 lat / lng (latitude/longitude 아님)
 */
const { haversineKm } = require('../utils/distance');

/**
 * @param {object}   job      — { id, latitude, longitude, ... }
 * @param {object[]} workers  — users 배열 ({ id, name, lat, lng, ... })
 * @param {number}   [topN=5] — 반환 수 상한
 * @returns {{ worker: object, distKm: number }[]}
 */
function findNearestWorkers(job, workers, topN = 5) {
    const jLat = Number(job.latitude);
    const jLng = Number(job.longitude);

    if (!isFinite(jLat) || !isFinite(jLng)) {
        console.log(`[MATCH_NEAREST] jobId=${job.id} — 작업 위치 없음, 스킵`);
        return [];
    }

    const withDist = workers
        .filter(w => w.lat != null && w.lng != null)
        .map(w => {
            const km = haversineKm(
                { lat: jLat,        lng: jLng        },
                { lat: Number(w.lat), lng: Number(w.lng) }
            );
            return { worker: w, distKm: km != null ? Math.round(km * 10) / 10 : null };
        })
        .filter(r => r.distKm !== null);

    withDist.sort((a, b) => a.distKm - b.distKm);
    const result = withDist.slice(0, topN);

    console.log(
        `[MATCH_NEAREST] jobId=${job.id} jLat=${jLat} jLng=${jLng}` +
        ` candidates=${workers.length} → top${topN}: [${result.map(r => `${r.worker.id}:${r.distKm}km`).join(', ')}]`
    );
    return result;
}

module.exports = { findNearestWorkers };
