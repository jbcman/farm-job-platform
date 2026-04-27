'use strict';
/**
 * bugClassifier.js — 버그 우선순위 자동 분류
 * STEP 6 (REAL_USER_TEST_AND_BUG_PRIORITY_LOOP)
 *
 * Priority 1 — 즉시 수정 필요 (기능 완전 불가)
 *   API 실패, 클릭 안 됨, 데이터 없음
 *
 * Priority 2 — 중간 우선순위 (기능은 동작하나 잘못된 상태)
 *   상태 오류, 위치 오류, 흐름 끊김
 *
 * Priority 3 — 낮은 우선순위 (UX/UI 개선)
 *   UI 렌더 문제, 경고 이벤트, 분석용 이벤트
 */

/**
 * @param {string} type  — logTestEvent의 type 값
 * @returns {1|2|3}      — 버그 우선순위
 */
function classifyBug(type) {
    if (!type) return 3;

    // ── Priority 1: 기능 완전 불가 ────────────────────────────────
    if (
        type.includes('ERROR_API_FAIL')   ||
        type.includes('ERROR_CLICK_FAIL') ||
        type.includes('CALL_FAIL')        ||
        type === 'DATA_MISSING'
    ) return 1;

    // ── Priority 2: 상태 불일치 / 흐름 끊김 ──────────────────────
    if (
        type.includes('FLOW_BROKEN')      ||
        type.includes('STATUS_MISMATCH')  ||
        type.includes('MAP_FAIL')         ||
        type.includes('GEO_FAIL')         ||
        type === 'LOCATION_MISSING'
    ) return 2;

    // ── Priority 3: 정상 이벤트 / UX 개선 ────────────────────────
    return 3;
}

/** 이벤트가 에러인지 여부 */
function isError(type) {
    return classifyBug(type) <= 2;
}

module.exports = { classifyBug, isError };
