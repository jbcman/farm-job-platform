'use strict';
/**
 * aiMatchV2.js — AI 추천 V2 보정 점수 (작물/스킬/시간대/즉시가능)
 *
 * 기존 calcApplicantMatchScore(0~90점) 결과에 추가 보정값을 더함.
 * 높을수록 더 추천 (기존 matchingEngine과 동일 방향성).
 *
 * 보정 항목:
 *   cropType × skillTags 매칭   +5점
 *   timeSlot × preferredTime    +3점
 *   activeNow (즉시 가능)       +4점
 *
 * fail-safe: 예외 시 0 반환 (기존 점수 유지)
 */

function safeParse(v) {
    try { return JSON.parse(v || '[]'); } catch { return []; }
}

/**
 * calcV2Bonus — V2 보정 점수 계산
 * @param {object} worker  workers DB row (normalizeWorker 후)
 * @param {object} job     jobs   DB row (normalizeJob 후)
 * @returns {number}       보정값 (양수 = 추가 우대)
 */
function calcV2Bonus(worker, job) {
    try {
        let bonus = 0;

        // 1. 작물/스킬 매칭 (+5점)
        //    job.cropType 이 worker.skillTags 배열의 항목과 겹치면 우대
        if (job.cropType && worker.skillTags) {
            const skills = safeParse(worker.skillTags);
            const crop   = job.cropType.trim();
            if (skills.some(s => String(s).includes(crop) || crop.includes(String(s)))) {
                bonus += 5;
            }
        }

        // 2. 시간대 매칭 (+3점)
        //    job.timeSlot === worker.preferredTime 이면 우대
        //    e.g. '오전', '오후', '저녁', 'AM', 'PM'
        if (job.timeSlot && worker.preferredTime) {
            if (worker.preferredTime === job.timeSlot) {
                bonus += 3;
            }
        }

        // 3. 즉시 가능 보너스 (+4점) — 최근 10분 내 위치 갱신 기준 (정적 activeNow 대체)
        const TEN_MIN_MS = 10 * 60 * 1000;
        const isRecentlyActive = worker.locationUpdatedAt
            ? (Date.now() - new Date(worker.locationUpdatedAt).getTime()) < TEN_MIN_MS
            : false;
        if (worker.activeNow || isRecentlyActive) {
            bonus += 4;
        }

        return bonus;
    } catch (e) {
        // fail-safe — 기존 점수에 영향 없도록 0 반환
        console.warn('[AI_MATCH_V2_WARN]', e.message);
        return 0;
    }
}

module.exports = { calcV2Bonus };
