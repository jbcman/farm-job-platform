/**
 * historyManager.js — OS 뒤로가기 지원을 위한 History 유틸
 *
 * 사용법:
 *   pushView('job-detail', { jobId: 'abc', source: 'list' })  → history stack 추가
 *   replaceView('home')                                        → 현재 항목 교체 (홈)
 *   getSavedState()                                            → 세션 백업에서 복원
 *
 * 설계 원칙:
 *   - pushState/replaceState 는 URL 변경 없이 state만 교체 ('')
 *   - selectedJob(전체 객체) 포함 가능 (sessionStorage 용량 내)
 *   - 실패 시 조용히 무시 (fail-safe)
 */

const SESSION_KEY = 'farm-lastViewState';

export function pushView(view, params = {}) {
  const state = { view, params };
  try {
    window.history.pushState(state, '');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[HISTORY] pushView fail', e.message);
  }
}

export function replaceView(view, params = {}) {
  const state = { view, params };
  try {
    window.history.replaceState(state, '');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[HISTORY] replaceView fail', e.message);
  }
}

export function getSavedState() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
