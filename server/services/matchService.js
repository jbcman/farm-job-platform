'use strict';
/**
 * matchService.js — 작업 ↔ 작업자 근거리 매칭
 *
 * findNearestWorkers(job, workers, topN)
 *   → job 위치 기준 가장 가까운 작업자 TOP N 반환
 *   → 복합 정렬: 거리(70%) + AI 신뢰도 점수(30%)
 *
 * NOTE: users 테이블 컬럼은 lat / lng (latitude/longitude 아님)
 *
 * PHASE_ADMIN_DASHBOARD_AI_V2: scoreWorker 통합
 */
const { haversineKm } = require('../utils/distance');
const { scoreWorker } = require('./recommendService');

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

    // 복합 정렬: 거리 정규화(70%) + AI 신뢰도 점수 정규화(30%)
    const maxDist = Math.max(...withDist.map(r => r.distKm), 1);
    const scores  = withDist.map(r => scoreWorker(r.worker));
    const maxScore = Math.max(...scores, 1);

    withDist.forEach((r, i) => {
        const distNorm  = 1 - (r.distKm / maxDist);           // 가까울수록 1
        const wrkNorm   = scores[i] / maxScore;               // 높을수록 1
        r._matchScore   = 0.7 * distNorm + 0.3 * wrkNorm;
        r._workerScore  = Math.round(scores[i] * 10) / 10;
    });

    withDist.sort((a, b) => b._matchScore - a._matchScore);
    const result = withDist.slice(0, topN);

    console.log(
        `[MATCH_NEAREST] jobId=${job.id} jLat=${jLat} jLng=${jLng}` +
        ` candidates=${workers.length} → top${topN}: [${result.map(r => `${r.worker.id}:${r.distKm}km(ms=${r._matchScore.toFixed(2)})`).join(', ')}]`
    );
    return result;
}

module.exports = { findNearestWorkers };
