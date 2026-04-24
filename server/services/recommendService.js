'use strict';
/**
 * recommendService.js — AI 가중치 추천 정렬
 *
 * 점수 가중치:
 *   거리 가까움  60%  (distScore:  0=멀다 → 1=매우 가까움)
 *   일당 높음    20%  (payScore:   0=낮다 → 1=매우 높음)
 *   최신 등록    20%  (recency:    0=오래됨 → 1=방금 등록)
 *
 * finalScore = 0.6 × dist + 0.2 × pay + 0.2 × recency  (높을수록 우선)
 *
 * GPS 없을 시 distScore = 0 → pay + recency 기반 정렬 유지
 */
const { haversineKm } = require('../utils/distance');

// ─── 일당 파싱 ────────────────────────────────────────────────
function parsePay(raw) {
    if (!raw) return 0;
    const s = String(raw).trim();
    const manMatch = s.match(/(\d+(?:\.\d+)?)\s*만/);
    if (manMatch) return Math.round(parseFloat(manMatch[1]) * 10000);
    const digits = s.replace(/[^0-9]/g, '');
    return digits ? parseInt(digits, 10) : 0;
}

// ─── 거리 점수 (0~1, 높을수록 가까움) ─────────────────────────
// 기준: 0km → 1.0 / 10km → 0.5 / 20km 이상 → 0
function distScore(km) {
    if (km == null || !isFinite(km)) return 0;
    return Math.max(0, 1 - km / 20);
}

// ─── 일당 점수 (0~1, 집합 내 상대 정규화) ─────────────────────
function payScores(jobs) {
    const vals = jobs.map(j => parsePay(j.pay));
    const max  = Math.max(...vals, 1);
    return vals.map(v => v / max);
}

// ─── 최신 점수 (0~1, 최근 24시간=1, 7일 이상=0) ──────────────
const DAY_MS = 24 * 60 * 60 * 1000;
function recencyScore(createdAt) {
    if (!createdAt) return 0;
    const ageDays = (Date.now() - new Date(createdAt).getTime()) / DAY_MS;
    return Math.max(0, 1 - ageDays / 7);
}

// ─── 메인: 추천 정렬 ─────────────────────────────────────────
/**
 * scoreJob — 단일 작업 점수 계산
 * @param {object} job     — normalizeJob() 결과
 * @param {object} user    — { lat, lng } | null
 * @param {number} payNorm — 일당 정규화 값 (0~1, 외부에서 계산)
 * @returns {number}       — 0~1 (높을수록 추천)
 */
function scoreJob(job, user, payNorm) {
    const jLat = job.latitude  ?? null;
    const jLng = job.longitude ?? null;

    const dKm   = (user && jLat != null && jLng != null)
        ? haversineKm({ lat: user.lat, lng: user.lng }, { lat: jLat, lng: jLng })
        : null;
    const dScore = distScore(dKm);
    const rScore = recencyScore(job.createdAt);

    const score = 0.6 * dScore + 0.2 * (payNorm ?? 0) + 0.2 * rScore;

    console.log(
        `[RECOMMEND_SCORE] jobId=${job.id}` +
        ` dist=${dKm != null ? dKm.toFixed(1) + 'km' : 'n/a'}` +
        ` dScore=${dScore.toFixed(2)} payNorm=${(payNorm ?? 0).toFixed(2)}` +
        ` recency=${rScore.toFixed(2)} → score=${score.toFixed(3)}`
    );

    return score;
}

/**
 * sortJobs — AI 추천 정렬
 * @param {object[]} jobs   — open jobs (normalizeJob 처리된 것)
 * @param {object|null} user — { lat, lng } | null
 * @returns {object[]}      — _aiScore + distKm 필드 추가된 내림차순 정렬 배열
 */
function sortJobs(jobs, user = null) {
    const uLat = user?.lat != null ? Number(user.lat) : null;
    const uLng = user?.lng != null ? Number(user.lng) : null;
    const ctx  = (uLat != null && isFinite(uLat) && uLng != null && isFinite(uLng))
        ? { lat: uLat, lng: uLng }
        : null;

    // 일당 정규화 (집합 전체 기준)
    const payVals = jobs.map(j => parsePay(j.pay));
    const payMax  = Math.max(...payVals, 1);
    const payNorms = payVals.map(v => v / payMax);

    const scored = jobs.map((job, i) => {
        const aiScore = scoreJob(job, ctx, payNorms[i]);
        const jLat = job.latitude  ?? null;
        const jLng = job.longitude ?? null;
        const distKm = (ctx && jLat != null && jLng != null)
            ? haversineKm({ lat: ctx.lat, lng: ctx.lng }, { lat: jLat, lng: jLng })
            : null;
        return {
            ...job,
            _aiScore: aiScore,
            distKm:   distKm != null ? Math.round(distKm * 10) / 10 : null,
            payValue: payVals[i],
        };
    });

    // 내림차순 (점수 높은 순)
    return scored.sort((a, b) => b._aiScore - a._aiScore);
}

// ─── 작업자 신뢰도 점수 ──────────────────────────────────────────
/**
 * scoreWorker — 작업자 AI 신뢰도 점수
 *   rating(0~5) × 40  + completedJobs(경험치, 최대50) × 2  + successRate(0~1) × 30
 *   최대: 200 + 100 + 30 = 330  (높을수록 신뢰 가능)
 */
function scoreWorker(worker) {
    const rating      = Number(worker.rating        || 4.5);
    const exp         = Math.min(Number(worker.completedJobs || 0), 50);
    const successRate = Number(worker.successRate   || 0.5);
    const score = rating * 40 + exp * 2 + successRate * 30;

    console.log(
        `[WORKER_SCORE] workerId=${worker.id}` +
        ` rating=${rating} exp=${exp} successRate=${successRate} → ${score.toFixed(1)}`
    );
    return score;
}

module.exports = { scoreJob, sortJobs, parsePay, scoreWorker };
