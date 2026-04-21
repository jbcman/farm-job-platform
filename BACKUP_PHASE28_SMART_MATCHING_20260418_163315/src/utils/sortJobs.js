/**
 * sortJobs.js — PHASE 16/18: 거리 기반 자동 추천 정렬 + 급구 필터
 *
 * 우선순위 (높음 → 낮음):
 *   1. 급구(isUrgent) — 즉각 노출 필요
 *   2. 오늘(isToday)  — 당일 마감 임박
 *   3. 거리(distKm)   — 가까운 순, null은 최하위
 *
 * 지도(JobMapView)와 리스트(JobListPage) 동일 규칙 적용 → 일관된 UX
 */

/**
 * 일자리 배열을 우선순위 기준으로 정렬한다.
 * 원본 배열을 변경하지 않고 새 배열을 반환한다.
 *
 * @param {Array} jobs - 일자리 객체 배열
 * @param {boolean} [applySort=true] - false 전달 시 원본 순서 유지 (fallback)
 * @returns {Array}
 */
/**
 * 급구 필터 — isUrgent=true 인 항목만 반환
 * showUrgentOnly=false 이면 원본 그대로 반환 (fallback)
 *
 * @param {Array}   jobs
 * @param {boolean} showUrgentOnly
 * @returns {Array}
 */
export function filterUrgentOnly(jobs = [], showUrgentOnly = false) {
  if (!showUrgentOnly || !Array.isArray(jobs)) return jobs;
  return jobs.filter(j => j.isUrgent);
}

export function sortJobsByPriority(jobs = [], applySort = true) {
  if (!applySort || !Array.isArray(jobs) || jobs.length === 0) return jobs;

  return [...jobs].sort((a, b) => {
    // 1️⃣ 급구 최우선
    const urgA = a.isUrgent ? 1 : 0;
    const urgB = b.isUrgent ? 1 : 0;
    if (urgA !== urgB) return urgB - urgA;   // 급구가 위로

    // 2️⃣ 오늘 작업 우선
    const todA = a.isToday ? 1 : 0;
    const todB = b.isToday ? 1 : 0;
    if (todA !== todB) return todB - todA;   // 오늘이 위로

    // 3️⃣ 거리 가까운 순 (distKm 없으면 9999 처리 → 최하위)
    const distA = Number.isFinite(Number(a.distKm)) ? Number(a.distKm) : 9999;
    const distB = Number.isFinite(Number(b.distKm)) ? Number(b.distKm) : 9999;
    return distA - distB;
  });
}
