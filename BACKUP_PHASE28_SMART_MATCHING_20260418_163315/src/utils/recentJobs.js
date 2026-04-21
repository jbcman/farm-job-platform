/**
 * recentJobs.js — 최근 본 일자리 localStorage 유틸
 * 최대 10개, 중복 제거 (최신 순)
 */

const KEY     = 'farm-recentJobs';
const MAX     = 10;

/** 최근 본 일 목록 반환 */
export function getRecentJobs() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/**
 * 최근 본 일 저장
 * @param {object} job  — 최소: { id, category, locationText, date, pay, isUrgent }
 */
export function saveRecentJob(job) {
  if (!job?.id) return;
  try {
    const prev    = getRecentJobs().filter(j => j.id !== job.id);
    const minimal = {
      id:           job.id,
      category:     job.category,
      locationText: job.locationText,
      date:         job.date,
      pay:          job.pay || null,
      isUrgent:     job.isUrgent || false,
      savedAt:      new Date().toISOString(),
    };
    const next = [minimal, ...prev].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}

/** 특정 job id 제거 */
export function removeRecentJob(id) {
  try {
    const next = getRecentJobs().filter(j => j.id !== id);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}
