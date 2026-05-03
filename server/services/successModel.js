'use strict';
/**
 * successModel.js — 매칭 성공 확률 예측 모델 (0~1)
 *
 * predictSuccess(worker, job, weather, ctx) → number [0, 1]
 *
 * 가중치 구성 (총합 1.0):
 *   ① 기본 추천 점수  35%   calcRecommendScore (거리·평점·경험·즉시가능)
 *   ② 카테고리 일치   20%   worker.jobType === job.category
 *   ③ 날씨 페널티     15%   비·강풍 시 하향
 *   ④ 시간대 보너스   10%   아침/오전 시간대 야외 작업에 유리
 *   ⑤ 주말 보너스     10%   주말 = 농번기 동원 가능성 ↑
 *   ⑥ 지역 일치       10%   worker 지역 ≈ job 지역 (위도 기반)
 *
 * 최종값은 clamp [0.05, 0.97] 후 반환 (극단값 배제)
 */
const { calcRecommendScore } = require('./matchScore');
const { getContextFeatures } = require('./contextFeature');

/**
 * @param {object}  worker   normalizeWorker() 결과 (jobType, rating, completedJobs, activeNow, locationUpdatedAt, latitude)
 * @param {object}  job      normalizeJob()   결과 (category, latitude, longitude, workDate)
 * @param {object}  weather  { rain, temp, wind, source }
 * @param {object}  ctx      getContextFeatures(job) 결과
 * @param {number}  distKm   worker ↔ job 거리 (km)
 * @returns {number}  0~1
 */
function predictSuccess(worker, job, weather, ctx, distKm) {
    // ① 기본 추천 점수 (이미 0~1 정규화)
    const baseScore = calcRecommendScore(worker, distKm);  // 0~1

    // ② 카테고리 일치
    const catMatch = worker.jobType === (job.autoJobType || job.category) ? 1.0 : 0.0;

    // ③ 날씨 페널티 (1.0 = 완벽, 0.0 = 최악)
    //   비 > 5mm/h → -0.4, 1~5mm → -0.2, 바람 > 10m/s → -0.2
    let weatherScore = 1.0;
    const rain = weather.rain || 0;
    const wind = weather.wind || 0;
    if      (rain > 5)  weatherScore -= 0.4;
    else if (rain > 1)  weatherScore -= 0.2;
    if (wind > 10)      weatherScore -= 0.2;
    weatherScore = Math.max(0, weatherScore);

    // ④ 시간대 보너스 (야외 농작업 특성상 아침·오전이 유리)
    let timeScore = 0.5; // 기본값 (저녁·심야)
    if (ctx.isMorning)   timeScore = 1.0;
    if (ctx.isAfternoon) timeScore = 0.8;
    if (ctx.isEvening)   timeScore = 0.4;

    // ⑤ 주말 보너스 (농번기 일손 수요 ↑)
    const weekendScore = ctx.isWeekend ? 1.0 : 0.7;

    // ⑥ 지역 일치 (worker 위도 기반 지역 vs job 지역)
    //    같은 광역권 = 1.0, 인접 = 0.7, 다름 = 0.4
    const workerRegion = _latToRegion(worker.latitude);
    const jobRegion    = ctx.regionCode;
    let regionScore = 0.4;
    if (workerRegion !== 'unknown' && workerRegion === jobRegion) regionScore = 1.0;
    else if (workerRegion !== 'unknown' && jobRegion !== 'unknown' &&
             _areAdjacent(workerRegion, jobRegion))               regionScore = 0.7;

    // ─── 가중 합산 ───────────────────────────────────────────────
    const raw =
        baseScore    * 0.35 +
        catMatch     * 0.20 +
        weatherScore * 0.15 +
        timeScore    * 0.10 +
        weekendScore * 0.10 +
        regionScore  * 0.10;

    // clamp [0.05, 0.97]
    return Math.min(0.97, Math.max(0.05, raw));
}

// ─── 내부 헬퍼 ───────────────────────────────────────────────────

function _latToRegion(lat) {
    if (lat == null || !Number.isFinite(Number(lat))) return 'unknown';
    const n = Number(lat);
    if (n >= 38.0)  return '강원';
    if (n >= 37.0)  return '경기';
    if (n >= 36.0)  return '충청';
    if (n >= 35.5)  return '경북전북';
    if (n >= 34.5)  return '경남전남';
    if (n >= 33.0)  return '제주';
    return 'unknown';
}

// 인접 광역권 쌍 (순서 무관)
const ADJACENT = new Set([
    '강원-경기', '경기-충청', '충청-경북전북', '경북전북-경남전남',
]);
function _pairKey(a, b) { return [a, b].sort().join('-'); }
function _areAdjacent(a, b) { return ADJACENT.has(_pairKey(a, b)); }

/**
 * buildExplain — 추천 이유 텍스트 배열 생성 (최대 4개)
 *
 * 각 factor의 기여도를 계산해 긍정 요인 상위 항목만 반환.
 * 부정 요인(비, 야간 등)은 별도 warn 배열에 담아 반환.
 *
 * @returns {{ reasons: string[], warn: string[] }}
 *   reasons: 긍정 이유 (예: ["거리 2km", "평점 4.8", "활동 중"])
 *   warn:    주의 사항 (예: ["우천 예보"])
 */
function buildExplain(worker, job, weather, ctx, distKm) {
    const reasons = [];
    const warn    = [];

    // ① 거리
    if (distKm <= 2)       reasons.push(`거리 ${distKm}km`);
    else if (distKm <= 5)  reasons.push(`가까운 거리 (${distKm}km)`);
    else if (distKm <= 10) reasons.push(`${distKm}km 이내`);

    // ② 평점
    const rating = worker.rating || 0;
    if (rating >= 4.7)      reasons.push(`평점 ${rating} ⭐`);
    else if (rating >= 4.3) reasons.push(`높은 평점 (${rating})`);
    else if (rating >= 4.0) reasons.push(`평점 양호`);

    // ③ 즉시 가능 (activeNow or 10분 내)
    const TEN_MIN = 10 * 60 * 1000;
    const recentlyActive = worker.locationUpdatedAt
        ? Date.now() - new Date(worker.locationUpdatedAt).getTime() < TEN_MIN : false;
    if (worker.activeNow || recentlyActive) reasons.push('지금 활동 중 🟢');

    // ④ 경험
    const jobs = worker.completedJobs || 0;
    if (jobs >= 50)      reasons.push(`경험 풍부 (${jobs}회)`);
    else if (jobs >= 20) reasons.push(`완료 ${jobs}회`);
    else if (jobs >= 10) reasons.push(`경험 있음`);

    // ⑤ 카테고리 일치
    if (worker.jobType === (job.autoJobType || job.category)) {
        reasons.push('전문 분야 일치');
    }

    // ⑥ 시간대 / 주말
    if (ctx.isMorning)   reasons.push('아침 작업 유리 ☀️');
    if (ctx.isWeekend)   reasons.push('주말 가용');

    // ⑦ 날씨 (warn)
    const rain = weather.rain || 0;
    const wind = weather.wind || 0;
    if (rain > 5)        warn.push('강한 비 예보 🌧');
    else if (rain > 1)   warn.push('우천 예보 🌦');
    if (wind > 10)       warn.push('강풍 주의 💨');
    if (weather.source === 'api' && rain === 0 && wind <= 5) {
        reasons.push('맑은 날씨 ☀️');
    }

    // 긍정 이유 최대 4개 (중요도 순서 유지)
    return { reasons: reasons.slice(0, 4), warn };
}

module.exports = { predictSuccess, buildExplain };
