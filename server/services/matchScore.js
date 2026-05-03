'use strict';
/**
 * matchScore.js — PHASE MATCH_SCORE + FINAL_GUARD + PERSONALIZATION + AB_TEST + IMAGE_DIFFICULTY_AI
 *
 * 기본 가중치 (Control):
 *   거리     : 0~40pt  distKm=0 → 40pt, distKm=5 → 0pt
 *   긴급     : +30pt
 *   카테고리 : +25pt
 *   fallback : -10pt   카테고리 불일치 + nearField 이내
 *   개인화   : 0~90pt  행동 이력 기반 (시간 감쇠 포함)
 *   난이도   : ±10pt   inverted parabola (d=0.5 최고), 과도 어려움(d>0.8) -5pt 패널티
 *
 * A/B 테스트 시 weights 객체로 거리/긴급/카테고리/fallbackPenalty 덮어쓰기 가능.
 * weights 없거나 null → 기본값 그대로 사용 (Control).
 */
const { getPersonalScore }           = require('./personalScore');
const { getJobBoost, getUserBoost }  = require('./monetizationService');

// Control 기본 가중치
const DEFAULT_WEIGHTS = {
    distance:       40,
    urgent:         30,
    category:       25,
    fallbackPenalty: 10,
};

/**
 * @param {object}      job            jobs 행 (category, isUrgent, latitude, longitude)
 * @param {object}      worker         users 행 (id, jobType)
 * @param {number|null} distKm         거리 (km), GPS 없으면 null
 * @param {number}      [nearFieldKm=3] fallback 페널티 기준 거리
 * @param {object}      [weights={}]   A/B 테스트 가중치 오버라이드
 * @returns {number}
 */
function calcMatchScore(job, worker, distKm, nearFieldKm = 3, weights = {}) {
    // Control 기본값에 실험 가중치 병합 (undefined 키는 기본값 유지)
    const W = { ...DEFAULT_WEIGHTS, ...weights };

    let score = 0;
    // PHASE IMAGE_JOBTYPE_AI: autoJobType 확정 시 우선 사용
    const jobTypeFinal  = job.autoJobType || job.category;
    const categoryMatch = worker.jobType === jobTypeFinal;
    const hasDistance   = distKm !== null && Number.isFinite(distKm);

    // ① 거리 점수: distKm=0 → W.distance pt, distKm=5 → 0pt (선형)
    if (hasDistance) {
        score += Math.max(0, W.distance - distKm * (W.distance / 5));
    }

    // ② 긴급 보너스
    if (job.isUrgent) score += W.urgent;

    // ③ 카테고리 일치
    if (categoryMatch) score += W.category;

    // ④ fallback 페널티
    if (!categoryMatch && hasDistance && distKm <= nearFieldKm) {
        score -= W.fallbackPenalty;
    }

    // ⑤ 개인화 점수 (시간 감쇠 포함, fail-safe)
    score += getPersonalScore(worker.id, job);

    // ⑥ monetization boost (스폰서 게시물 + 구독자 보너스, fail-safe)
    try {
        score += getJobBoost(job.id);
        score += getUserBoost(worker.id);
    } catch (_) {}

    // ⑦ 개인화 난이도 점수 (IMAGE_DIFFICULTY_AI + DIFFICULTY_PERSONAL)
    //
    //    preferredDifficulty 미설정(null) → 0.5 기본값
    //    diffGap = |job.difficulty - worker.preferredDifficulty|
    //    personalDifficultyScore = (1 - diffGap * 2) * 8   → 최대 +8pt (완전 일치)
    //
    //    + 극단 패널티: d > 0.8 이고 worker.preferredDifficulty < 0.6 → -5pt
    //      (초보/일반 작업자에게 매우 어려운 작업 하향)
    try {
        const d = job.difficulty;
        if (d != null && Number.isFinite(d)) {
            const prefD   = worker.preferredDifficulty ?? 0.5;
            const diffGap = Math.abs(d - prefD);
            const personalDifficultyScore = (1 - diffGap * 2) * 8;  // 0~8pt
            score += personalDifficultyScore;
            if (d > 0.8 && prefD < 0.6) score -= 5;
        }
    } catch (_) {}

    return score;
}

/**
 * calcRecommendScore — 추천 작업자 전용 점수 (0~1)
 *
 * DB 조회 없는 순수 계산 (엔드포인트에서 대량 호출 시 사용)
 *
 * 가중치 (자동 튜닝 — weightTuner.js가 model_weights.json 갱신):
 *   거리   기본 50%  : 0km=1.0 → 20km=0.0 (선형)
 *   평점   기본 30%  : 1~5 → 0~1 정규화
 *   경험   고정 15%  : 0~100회 → 0~1 포화
 *   즉시가능 고정 5% : activeNow or 10분 내 위치 갱신
 *
 * @param {object} worker  normalizeWorker() 적용된 작업자 행
 * @param {number} distKm  job ↔ worker 거리 (km)
 * @returns {number}       0~1 점수 (높을수록 추천)
 */
function calcRecommendScore(worker, distKm) {
    // 동적 가중치 로드 (weightTuner가 24시간마다 조정)
    let W = { distance: 0.50, rating: 0.30, experience: 0.15, activeNow: 0.05 };
    try {
        const { getWeights } = require('./weightTuner');
        const loaded = getWeights();
        W = {
            distance:   loaded.distance   ?? 0.50,
            rating:     loaded.rating     ?? 0.30,
            experience: loaded.experience ?? 0.15,
            activeNow:  loaded.activeNow  ?? 0.05,
        };
    } catch (_) {} // weightTuner 미존재 시 기본값 유지

    const MAX_DIST = 20;
    const dScore = Math.max(0, 1 - distKm / MAX_DIST);
    const rScore = Math.max(0, ((worker.rating || 4.0) - 1) / 4);   // 1~5 → 0~1
    const eScore = Math.min(1, (worker.completedJobs || 0) / 100);   // 최대 100회 포화

    // 즉시 가능: activeNow OR 최근 10분 내 위치 갱신
    const TEN_MIN = 10 * 60 * 1000;
    const recentlyActive = worker.locationUpdatedAt
        ? Date.now() - new Date(worker.locationUpdatedAt).getTime() < TEN_MIN
        : false;
    const aScore = (worker.activeNow || recentlyActive) ? 1 : 0;

    return dScore * W.distance + rScore * W.rating + eScore * W.experience + aScore * W.activeNow;
}

module.exports = { calcMatchScore, DEFAULT_WEIGHTS, calcRecommendScore };
