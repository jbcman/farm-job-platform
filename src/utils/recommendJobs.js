/**
 * recommendJobs.js — PHASE 19: 지역 + 작업 기반 개인화 추천 정렬
 *
 * 점수 체계 (높을수록 상단):
 *   +200  스폰서 공고(isSponsored)   — PHASE SCALE 신규 (항상 최상단)
 *   +150  유료 긴급(isUrgentPaid)    — PHASE SCALE 신규
 *   +100  급구(isUrgent)             — PHASE 18 유지
 *   + 50  오늘 작업(isToday)         — PHASE 16 유지
 *   + 50  근거리 (distKm→점수)       — PHASE 16 유지
 *   + 80  지역 매칭                  — PHASE 19 신규
 *   + 60  카테고리 매칭              — PHASE 19 신규
 *
 * userProfile 없을 때 → 지역/카테고리 점수 0 → PHASE 16/18 정렬과 동일
 * (자연스러운 fallback)
 */

/**
 * 단일 일자리 추천 점수 계산
 *
 * @param {object} job         - 일자리 객체 (distKm, isUrgent, isToday, locationText, category)
 * @param {object} userProfile - { region: string|null, category: string|null }
 * @returns {number} score
 */
export function scoreJob(job, userProfile = {}) {
  let score = 0;

  // 0️⃣ PHASE SCALE: 스폰서 / 유료 긴급 — 항상 최상단
  if (job.isSponsored)   score += 200;
  if (job.isUrgentPaid)  score += 150;

  // 1️⃣ 급구 최우선
  if (job.isUrgent) score += 100;

  // 2️⃣ 오늘 작업
  if (job.isToday) score += 50;

  // 3️⃣ 거리 (가까울수록 점수 ↑, 50km 이내만 반영)
  const dist = Number.isFinite(Number(job.distKm)) ? Number(job.distKm) : 9999;
  score += Math.max(0, 50 - dist);

  // 4️⃣ 지역 매칭 (+80)
  // userProfile.region = "화성시" → job.locationText에 포함되면 매칭
  if (userProfile.region && job.locationText?.includes(userProfile.region)) {
    score += 80;
  }

  // 5️⃣ 카테고리 매칭 (+60)
  if (userProfile.category && job.category === userProfile.category) {
    score += 60;
  }

  return score;
}

/**
 * 추천 점수 기반 정렬
 * - 원본 배열 변경 없음 (새 배열 반환)
 * - 각 job에 _score 필드 추가 (배지 표시에 활용)
 * - userProfile 비어있으면 기존 PHASE 16/18 순서와 동일
 *
 * @param {Array}  jobs
 * @param {object} userProfile
 * @returns {Array}
 */
export function sortJobsByRecommend(jobs = [], userProfile = {}) {
  if (!Array.isArray(jobs) || jobs.length === 0) return jobs;

  return jobs
    .map(job => ({ ...job, _score: scoreJob(job, userProfile) }))
    .sort((a, b) => b._score - a._score);
}

/** 추천 배지 표시 임계값 — 지역 or 카테고리 중 하나 이상 매칭된 경우 */
export const RECOMMEND_BADGE_THRESHOLD = 150;
