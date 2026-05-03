/**
 * testLogger.js — 실사용 테스트 이벤트 로깅
 * STEP 1 (REAL_USER_TEST_AND_BUG_PRIORITY_LOOP)
 *
 * 사용법:
 *   import { logTestEvent } from '../utils/testLogger.js';
 *   logTestEvent('farmer_create_job', { jobId, category });
 *
 * - 항상 console.log → 개발자 DevTools에서 확인 가능
 * - 서버로 fire-and-forget POST → 절대 throw하지 않음
 * - TEST_MODE가 아니어도 항상 활성 (실사용 데이터가 핵심)
 */

const TEST_LOG_ENDPOINT = '/api/test-log';

// ── FLOW 추적용 상태 (세션 내) ────────────────────────────────────
const _flowState = {
  steps: [],        // 완료된 스텝 목록
  sessionId: null,  // 세션 구분용 랜덤 ID
};

function getSessionId() {
  if (!_flowState.sessionId) {
    try {
      _flowState.sessionId = sessionStorage.getItem('test-session-id')
        || (Math.random().toString(36).slice(2) + Date.now().toString(36));
      sessionStorage.setItem('test-session-id', _flowState.sessionId);
    } catch (_) {
      _flowState.sessionId = Math.random().toString(36).slice(2);
    }
  }
  return _flowState.sessionId;
}

function getUserId() {
  try { return localStorage.getItem('farm-userId') || 'anonymous'; } catch (_) { return 'anonymous'; }
}

// ── 핵심 함수 ────────────────────────────────────────────────────
export function logTestEvent(type, payload = {}) {
  const ts        = Date.now();
  const sessionId = getSessionId();
  const userId    = getUserId();

  // 1. 항상 콘솔 출력 (DevTools)
  console.log(`[TEST] ${type}`, { ...payload, sessionId, userId, ts });

  // 2. FLOW 스텝 기록 (create→apply→select→call→complete)
  _flowState.steps.push({ type, ts });
  checkFlowBreak(type, _flowState.steps);

  // 3. 서버 fire-and-forget — 절대 throw 안 함
  try {
    fetch(TEST_LOG_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type, payload: { ...payload, userId }, sessionId, ts }),
    }).catch(() => {}); // 서버 오류 무시
  } catch (_) {}
}

// ── STEP 9: 흐름 끊김 감지 ───────────────────────────────────────
const FLOW_SEQUENCE = [
  'farmer_create_job',
  'worker_apply',
  'farmer_select_worker',
  'farmer_call_worker',
  'farmer_complete_job',
];
const FLOW_TIMEOUT_MS = 30 * 60 * 1000; // 30분 내에 다음 스텝이 없으면 끊김

function checkFlowBreak(type, steps) {
  const idx = FLOW_SEQUENCE.indexOf(type);
  if (idx < 1) return; // 첫 스텝은 비교 대상 없음

  const prevExpected = FLOW_SEQUENCE[idx - 1];
  const recentSteps  = steps.slice(-20); // 최근 20개만
  const prevStep     = recentSteps.findLast?.(s => s.type === prevExpected);

  if (!prevStep) {
    // 이전 스텝이 없음 → 흐름 끊김
    logTestEvent('FLOW_BROKEN', { step: type, missing: prevExpected });
  }
}

// ── STEP 8: 체크포인트 헬퍼 ─────────────────────────────────────
export function logCheckpoint(step, extra = {}) {
  logTestEvent('CHECKPOINT', { step, ...extra });
}

// ── STEP 11: 진동 검증 헬퍼 ──────────────────────────────────────
export function logVibrate() {
  if (navigator.vibrate) {
    logTestEvent('VIBRATE_TRIGGERED');
  }
}

// ── STEP 13: 전화 연결 헬퍼 ──────────────────────────────────────
export function logCallTriggered(jobId, workerId = null) {
  logTestEvent('CALL_TRIGGERED', { jobId, workerId });
}

export function logCallFail(jobId, reason = '') {
  logTestEvent('CALL_FAIL', { jobId, reason });
}

// ── STEP 12: 지도 렌더 헬퍼 ──────────────────────────────────────
export function logMapRender(lat, lng, precision) {
  logTestEvent('MAP_RENDER', { lat, lng, precision });
}

// ── STEP 14: 리뷰 헬퍼 ───────────────────────────────────────────
export function logReviewRequired(jobId)  { logTestEvent('REVIEW_REQUIRED',  { jobId }); }
export function logReviewSubmitted(jobId) { logTestEvent('REVIEW_SUBMITTED', { jobId }); }

// ── API 실패 헬퍼 (STEP 5) ────────────────────────────────────────
export function logApiFail(endpoint, status, action = '') {
  logTestEvent('ERROR_API_FAIL', { endpoint, status, action });
}

export function logClickFail(action, error = '') {
  logTestEvent('ERROR_CLICK_FAIL', { action, error: String(error) });
}
