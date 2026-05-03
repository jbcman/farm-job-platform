/**
 * behaviorScore.js — SMART_V4 localStorage 기반 행동 점수 관리
 *
 * 저장 구조:
 *   farm-clickScore : { [jobId]: number }  — 카드 클릭 횟수
 *   farm-callScore  : { [jobId]: number }  — 전화 클릭 횟수
 */

const CLICK_KEY = 'farm-clickScore';
const CALL_KEY  = 'farm-callScore';

function readMap(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch (_) { return {}; }
}
function writeMap(key, map) {
  try { localStorage.setItem(key, JSON.stringify(map)); } catch (_) {}
}

/** 카드 클릭 1회 기록 */
export function trackClick(jobId) {
  if (!jobId) return;
  const map = readMap(CLICK_KEY);
  map[jobId] = (map[jobId] || 0) + 1;
  writeMap(CLICK_KEY, map);
}

/** 전화 버튼 클릭 1회 기록 */
export function trackCall(jobId) {
  if (!jobId) return;
  const map = readMap(CALL_KEY);
  map[jobId] = (map[jobId] || 0) + 1;
  writeMap(CALL_KEY, map);
}

/** 특정 job의 행동 점수 반환 (클릭×10 + 전화×30) */
export function getBehaviorScore(jobId) {
  if (!jobId) return 0;
  const clicks = readMap(CLICK_KEY)[jobId] || 0;
  const calls  = readMap(CALL_KEY)[jobId]  || 0;
  return clicks * 10 + calls * 30;
}

/** 전화 클릭이 있는 jobId들 (인기 추천 문구용) */
export function getHotJobIds() {
  const calls = readMap(CALL_KEY);
  return Object.keys(calls).filter(id => calls[id] > 0);
}

/** 전체 초기화 (테스트용) */
export function clearBehaviorScore() {
  try {
    localStorage.removeItem(CLICK_KEY);
    localStorage.removeItem(CALL_KEY);
  } catch (_) {}
}
