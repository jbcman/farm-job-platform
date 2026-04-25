/**
 * conversionTracker — FARM UX V2 전환율 측정 유틸
 *
 * 개발 단계: localStorage + console.log
 * 운영 준비: getReport() 결과를 /api/events 로 전송 가능 구조
 *
 * 브라우저 콘솔 단축키:
 *   farm.report()   → 전환율 리포트 출력
 *   farm.clearLog() → 로그 초기화
 */

const LS_KEY   = 'farm_conversion_log';
const MAX_ENTRIES = 500; // localStorage 보호 상한

// ── 내부 helpers ──────────────────────────────────────────────
function _get() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function _save(log) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(log.slice(-MAX_ENTRIES))); } catch (_) {}
}
function _push(entry) {
  const log = _get();
  log.push({ ...entry, ts: Date.now() });
  _save(log);
}

// ── 공개 API ──────────────────────────────────────────────────

/** 카드 노출 기록 */
export function logView(jobId) {
  console.log('[JOB_VIEW]', jobId);
  _push({ type: 'view', jobId });
}

/** 전화 클릭 기록 */
export function logCall(jobId, variant) {
  console.log('[CALL_CLICK]', jobId, 'variant=' + variant);
  _push({ type: 'call', jobId, variant });
}

/** A/B variant 배정 기록 (마운트 시 1회) */
export function logVariant(jobId, variant) {
  console.log('[CTA_VARIANT]', variant, jobId);
  // variant 배정 자체는 log 엔트리에 남기지 않음 (노출 수 중복 방지)
}

/** 상세 클릭 기록 */
export function logDetail(jobId) {
  console.log('[DETAIL_CLICK]', jobId);
  _push({ type: 'detail', jobId });
}

// ── 리포트 ──────────────────────────────────────────────────

/** 전환율 리포트 객체 반환 */
export function getReport() {
  const log    = _get();
  const views  = log.filter(e => e.type === 'view');
  const calls  = log.filter(e => e.type === 'call');
  const details = log.filter(e => e.type === 'detail');

  const rate     = views.length > 0 ? (calls.length / views.length * 100).toFixed(1) : '0.0';
  const detailRate = views.length > 0 ? (details.length / views.length * 100).toFixed(1) : '0.0';
  const varA     = calls.filter(e => e.variant === 'A').length;
  const varB     = calls.filter(e => e.variant === 'B').length;

  return {
    views:      views.length,
    calls:      calls.length,
    details:    details.length,
    rate,
    detailRate,
    varA,
    varB,
  };
}

/**
 * 브라우저 콘솔 전환율 리포트 출력
 * 호출: farm.report()
 */
export function printReport() {
  const r   = getReport();
  const pct = parseFloat(r.rate);

  const grade =
    pct >= 15 ? '✅ STRONG PASS (매우 우수)'
    : pct >= 5 ? '✅ PASS (기본 성공)'
    : '❌ FAIL — UI 개선 필요';

  const winner =
    r.varA > r.varB ? 'A ── "📞 지금 전화하기"'
    : r.varB > r.varA ? 'B ── "🔥 바로 연결 (전화)"'
    : '동일 (데이터 부족)';

  console.group('%c📊 FARM UX V2 — 전환율 리포트', 'font-size:15px;font-weight:900;color:#2d8a4e');
  console.log(`총 노출 수      : ${r.views}`);
  console.log(`총 전화 클릭 수 : ${r.calls}`);
  console.log(`총 상세 클릭 수 : ${r.details}`);
  console.log(`────────────────────────────`);
  console.log(`전환율 (CALL)   : ${r.rate}%`);
  console.log(`전환율 (DETAIL) : ${r.detailRate}%`);
  console.log(`────────────────────────────`);
  console.log(`Variant A 클릭  : ${r.varA}`);
  console.log(`Variant B 클릭  : ${r.varB}`);
  console.log(`우세 문구       : ${winner}`);
  console.log(`────────────────────────────`);
  console.log(`결론            : ${grade} (${r.rate}%)`);
  console.groupEnd();

  return r;
}

// ── 브라우저 전역 단축키 등록 ─────────────────────────────────
if (typeof window !== 'undefined') {
  window.farm          = window.farm || {};
  window.farm.report   = printReport;
  window.farm.getLog   = _get;
  window.farm.clearLog = () => {
    localStorage.removeItem(LS_KEY);
    console.log('%c✔ 전환율 로그 초기화 완료', 'color:#dc2626;font-weight:bold');
  };
  // 힌트 메시지 (최초 로드 시 1회)
  const _hinted = sessionStorage.getItem('_farm_hint');
  if (!_hinted) {
    console.log('%c[FARM UX V2] 전환율 측정 활성화 — farm.report() 로 확인', 'color:#6b7280;font-size:11px');
    sessionStorage.setItem('_farm_hint', '1');
  }
}
