/**
 * conversionTracker — FARM UX V2 실사용 전환율 측정 유틸
 *
 * 개발 단계 : localStorage 영구 저장 + console.log
 * 운영 준비 : getReport() 결과를 /api/events 로 전송 가능한 구조
 *
 * ──────────────────────────────────────────────────────
 * 브라우저 콘솔 단축키
 *   farm.report()            → 전환율 리포트 출력
 *   farm.clearLog()          → 로그만 초기화
 *   farm.clearAndStartTest() → 초기화 + 테스트 시작 안내
 *   farm.testGuide()         → 테스트 시나리오 안내
 * ──────────────────────────────────────────────────────
 *
 * 로그 엔트리 구조:
 *   {
 *     type      : 'VIEW' | 'CALL' | 'DETAIL',
 *     jobId     : string | number,
 *     variant   : 'A' | 'B' | null,
 *     timestamp : number,        // Date.now()
 *     device    : 'mobile' | 'desktop',
 *   }
 */

const LS_KEY      = 'farm_conversion_log';
const MAX_ENTRIES = 500; // localStorage 과부하 방지 상한

// ── device 감지 ───────────────────────────────────────────────
const _isMobile = typeof navigator !== 'undefined'
  ? /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  : false;
const _device = _isMobile ? 'mobile' : 'desktop';

// ── 내부 helpers ──────────────────────────────────────────────
function _get() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function _save(log) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(log.slice(-MAX_ENTRIES))); } catch (_) {}
}
function _push(entry) {
  const log = _get();
  log.push({
    type:      entry.type,
    jobId:     entry.jobId,
    variant:   entry.variant ?? null,
    timestamp: Date.now(),
    device:    _device,
  });
  _save(log);
}

// ── 공개 로그 API ────────────────────────────────────────────

/** 카드 노출 기록 */
export function logView(jobId) {
  console.log('[JOB_VIEW]', jobId, `(${_device})`);
  _push({ type: 'VIEW', jobId, variant: null });
}

/** 전화 클릭 기록 */
export function logCall(jobId, variant) {
  console.log('[CALL_CLICK]', jobId, 'variant=' + variant, `(${_device})`);
  _push({ type: 'CALL', jobId, variant });
}

/** A/B variant 배정 기록 (마운트 시 1회, 로그 엔트리 미생성) */
export function logVariant(jobId, variant) {
  console.log('[CTA_VARIANT]', variant, jobId);
  // 노출 수 이중 계산 방지를 위해 localStorage 엔트리는 남기지 않음
}

/** 상세 클릭 기록 */
export function logDetail(jobId) {
  console.log('[DETAIL_CLICK]', jobId, `(${_device})`);
  _push({ type: 'DETAIL', jobId, variant: null });
}

// ── 리포트 ───────────────────────────────────────────────────

/** 전환율 리포트 객체 반환 */
export function getReport() {
  const log    = _get();
  const views   = log.filter(e => e.type === 'VIEW');
  const calls   = log.filter(e => e.type === 'CALL');
  const details = log.filter(e => e.type === 'DETAIL');

  const totalView   = views.length;
  const totalCall   = calls.length;
  const totalDetail = details.length;

  const callRate   = totalView > 0 ? (totalCall   / totalView * 100) : 0;
  const detailRate = totalView > 0 ? (totalDetail / totalView * 100) : 0;

  const varA = calls.filter(e => e.variant === 'A').length;
  const varB = calls.filter(e => e.variant === 'B').length;

  const mobileViews = views.filter(e => e.device === 'mobile').length;
  const mobileCalls = calls.filter(e => e.device === 'mobile').length;

  // 자동 판정
  const grade =
    callRate >= 15 ? 'STRONG PASS' :
    callRate >= 5  ? 'PASS' :
                     'FAIL';

  const winner =
    varA > varB  ? 'A ── "📞 지금 전화하기"' :
    varB > varA  ? 'B ── "🔥 바로 연결 (전화)"' :
                   '동일 (데이터 부족)';

  return {
    totalView, totalCall, totalDetail,
    callRate:   callRate.toFixed(1),
    detailRate: detailRate.toFixed(1),
    varA, varB,
    mobileViews, mobileCalls,
    grade, winner,
    dataOK: totalView >= 30,
  };
}

/**
 * 브라우저 콘솔 전환율 리포트 출력
 * 호출: farm.report()
 */
export function printReport() {
  const r = getReport();

  // STEP 5: 데이터 부족 경고
  if (!r.dataOK) {
    console.warn(`⚠ 데이터 부족 (현재 ${r.totalView} VIEW — 최소 30 VIEW 필요)`);
  }

  const gradeLabel =
    r.grade === 'STRONG PASS' ? '✅ STRONG PASS (매우 우수)' :
    r.grade === 'PASS'        ? '✅ PASS (기본 성공)' :
                                '❌ FAIL — UI 개선 필요';

  // STEP 9: 강화된 리포트 출력
  console.group('%c📊 FARM UX V2 — LIVE TEST RESULT', 'font-size:15px;font-weight:900;color:#2d8a4e');
  console.log(`총 VIEW         : ${r.totalView}  (모바일: ${r.mobileViews})`);
  console.log(`총 CALL         : ${r.totalCall}  (모바일: ${r.mobileCalls})`);
  console.log(`총 DETAIL 클릭  : ${r.totalDetail}`);
  console.log(`─────────────────────────────────`);
  console.log(`전환율 (CALL)   : ${r.callRate}%`);
  console.log(`전환율 (DETAIL) : ${r.detailRate}%`);
  console.log(`─────────────────────────────────`);
  console.log(`A/B 결과`);
  console.log(`  Variant A     : ${r.varA} 클릭`);
  console.log(`  Variant B     : ${r.varB} 클릭`);
  console.log(`  우세 문구     : ${r.winner}`);
  console.log(`─────────────────────────────────`);
  console.log(`판정            : ${gradeLabel}`);
  if (!r.dataOK) {
    console.log(`%c⚠ 신뢰도 낮음 — 최소 30 VIEW 이후 판단 권장`, 'color:#b45309;font-weight:700');
  }
  console.groupEnd();

  return r;
}

// ── 브라우저 전역 단축키 등록 ─────────────────────────────────
if (typeof window !== 'undefined') {
  window.farm = window.farm || {};

  /** 전환율 리포트 */
  window.farm.report = printReport;

  /** 원시 로그 배열 */
  window.farm.getLog = _get;

  /** 로그만 초기화 */
  window.farm.clearLog = () => {
    localStorage.removeItem(LS_KEY);
    console.log('%c✔ 전환율 로그 초기화 완료', 'color:#dc2626;font-weight:bold');
  };

  /** STEP 3: 테스트 초기화 + 시작 안내 */
  window.farm.clearAndStartTest = () => {
    localStorage.removeItem(LS_KEY);
    console.log('%c✅ 테스트 초기화 완료 — 새 세션 시작', 'color:#15803d;font-weight:900;font-size:13px');
    window.farm.testGuide();
  };

  /** STEP 6: 테스트 시나리오 안내 */
  window.farm.testGuide = () => {
    console.group('%c📱 FARM UX V2 — 테스트 시나리오', 'font-size:13px;font-weight:900;color:#4f46e5');
    console.log(`
1. JobCard 5개 이상 스크롤
   → [JOB_VIEW] 로그 발생 확인

2. 2~3개 카드 "상세보기" 클릭
   → [DETAIL_CLICK] 로그 확인

3. 최소 1회 전화 버튼 클릭
   → [CALL_CLICK] + variant 로그 확인

4. farm.report() 실행
   → 전환율 리포트 확인

권장: 모바일에서 테스트 (전환율 차이 큼)
현재: ${_isMobile ? '✅ 모바일 환경' : '⚠ 데스크탑 환경 (모바일 권장)'}
    `);
    console.groupEnd();
  };

  // 힌트 메시지 (세션당 1회)
  if (!sessionStorage.getItem('_farm_hint')) {
    console.log(
      '%c[FARM UX V2] 전환율 측정 활성화 — farm.report() | farm.testGuide()',
      'color:#6b7280;font-size:11px'
    );
    sessionStorage.setItem('_farm_hint', '1');
  }
}
