'use strict';
/**
 * statusGuard.js — 작업 상태 전이 검증
 *
 * 허용된 전이 맵 (SSOT):
 *   open → matched
 *   matched → on_the_way | in_progress | closed
 *   on_the_way → in_progress | closed
 *   in_progress → completed | closed
 *   completed → closed
 *   closed → (종료, 전이 없음)
 *
 * paymentStatus 별도 필드 (paid/pending) — jobs.status 와 독립
 */

const VALID_TRANSITIONS = {
    open:        ['matched', 'closed'],
    matched:     ['on_the_way', 'in_progress', 'closed'],
    on_the_way:  ['in_progress', 'closed'],
    in_progress: ['completed', 'closed'],
    completed:   ['closed'],
    closed:      [],
};

/**
 * 전이 가능 여부
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
function canTransition(from, to) {
    return (VALID_TRANSITIONS[from] || []).includes(to);
}

/**
 * 전이 불가 시 에러 메시지 반환, 가능 시 null
 * @param {string} from
 * @param {string} to
 * @returns {string|null}
 */
function getTransitionError(from, to) {
    if (from === 'closed') return '이미 마감된 작업이에요.';
    if (!VALID_TRANSITIONS[from]) return `알 수 없는 상태입니다: ${from}`;
    if (!canTransition(from, to)) {
        return `'${from}' 상태에서 '${to}'(으)로 변경할 수 없어요.`;
    }
    return null;
}

module.exports = { VALID_TRANSITIONS, canTransition, getTransitionError };
