'use strict';
/**
 * notify.js — 상태 전이 기반 알림 통합 모듈
 */
const db = require('../db');

const TRANSITION_MESSAGES = {
    matched:     { toWorker: '🎉 선택되었습니다! 농민에게 연락해보세요.',     toFarmer: null },
    on_the_way:  { toWorker: null,                                           toFarmer: '🚗 작업자가 출발했습니다. 잠시 후 도착해요.' },
    in_progress: { toWorker: null,                                           toFarmer: null },
    completed:   { toWorker: '✅ 작업 완료 처리됐어요. 입금을 기다려주세요.', toFarmer: '✅ 작업이 완료됐어요. 입금해주세요!' },
    paid:        { toWorker: '💰 입금이 완료됐어요! 후기를 남겨주세요 ⭐',    toFarmer: null },
    closed:      { toWorker: '작업이 마감됐어요.',                           toFarmer: null },
};

async function notifyOnStatus(job, from, to) {
    const msgs = TRANSITION_MESSAGES[to];
    if (!msgs) return;

    const farmerId = job.requesterId;
    const workerId = job.selectedWorkerId;

    try {
        if (msgs.toFarmer && farmerId) {
            await _saveNotify(farmerId, to, msgs.toFarmer, job.id);
        }
        if (msgs.toWorker && workerId) {
            const workerUserId = await _resolveUserId(workerId);
            if (workerUserId) await _saveNotify(workerUserId, to, msgs.toWorker, job.id);
        }
    } catch (e) {
        console.warn('[NOTIFY_FAIL]', e.message);
    }
}

async function _saveNotify(userId, type, message, jobId) {
    const id = `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
        await db.prepare(
            "INSERT INTO notify_log (id, userId, type, message, jobId, createdAt) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(id, userId, type, message, jobId, new Date().toISOString());
        console.log(`[NOTIFY] userId=${userId} type=${type} msg="${message}"`);
    } catch (_) {}
}

async function _resolveUserId(workerId) {
    if (!workerId) return null;
    const w = await db.prepare('SELECT userId FROM workers WHERE id = ?').get(workerId);
    if (w?.userId) return w.userId;
    return workerId;
}

module.exports = { notifyOnStatus };
