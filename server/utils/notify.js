'use strict';
/**
 * notify.js — 상태 전이 기반 알림 통합 모듈
 *
 * notifyOnStatus(job, from, to)
 *   - DB notify_log 기록 (앱 내 알림)
 *   - console.log '[NOTIFY]' (모니터링)
 *   - 카카오/SMS 확장 지점 제공
 */
const db = require('../db');

/** 상태 전이별 수신자 + 메시지 맵 */
const TRANSITION_MESSAGES = {
    matched:     { toWorker: '🎉 선택되었습니다! 농민에게 연락해보세요.',     toFarmer: null },
    on_the_way:  { toWorker: null,                                           toFarmer: '🚗 작업자가 출발했습니다. 잠시 후 도착해요.' },
    in_progress: { toWorker: null,                                           toFarmer: null },
    completed:   { toWorker: '✅ 작업 완료 처리됐어요. 입금을 기다려주세요.', toFarmer: '✅ 작업이 완료됐어요. 입금해주세요!' },
    paid:        { toWorker: '💰 입금이 완료됐어요! 후기를 남겨주세요 ⭐',    toFarmer: null },
    closed:      { toWorker: '작업이 마감됐어요.',                           toFarmer: null },
};

/**
 * 상태 전이 알림 발송
 * @param {object} job — normalizeJob 이후 객체
 * @param {string} from — 이전 상태
 * @param {string} to   — 새 상태
 */
function notifyOnStatus(job, from, to) {
    const msgs = TRANSITION_MESSAGES[to];
    if (!msgs) return;

    const farmerId = job.requesterId;
    const workerId = job.selectedWorkerId;  // userId 기준

    try {
        if (msgs.toFarmer && farmerId) {
            _saveNotify(farmerId, to, msgs.toFarmer, job.id);
        }
        if (msgs.toWorker && workerId) {
            // selectedWorkerId 가 workers.id 일 수도 있으므로 userId 조회
            const workerUserId = _resolveUserId(workerId);
            if (workerUserId) _saveNotify(workerUserId, to, msgs.toWorker, job.id);
        }
    } catch (e) {
        console.warn('[NOTIFY_FAIL]', e.message);
    }
}

function _saveNotify(userId, type, message, jobId) {
    const id = `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
        db.prepare(
            "INSERT INTO notify_log (id, userId, type, message, jobId, createdAt) VALUES (?, ?, ?, ?, ?, datetime('now'))"
        ).run(id, userId, type, message, jobId);
        console.log(`[NOTIFY] userId=${userId} type=${type} msg="${message}"`);
    } catch (_) {}
}

function _resolveUserId(workerId) {
    if (!workerId) return null;
    // workers.userId 조회 시도
    const w = db.prepare('SELECT userId FROM workers WHERE id = ?').get(workerId);
    if (w?.userId) return w.userId;
    // 이미 userId 형식이면 그대로 반환
    return workerId;
}

module.exports = { notifyOnStatus };
