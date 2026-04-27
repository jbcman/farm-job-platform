'use strict';
/**
 * callService.js — 전화 연결 서비스 (PHASE 29)
 *
 * 보안: requesterId 가 해당 job 의 농민이거나, 선택된 작업자의 userId 만 조회 가능
 */

const db = require('../db');

/**
 * getCallInfo(jobId, requestingUserId)
 *
 * @param {string} jobId
 * @param {string} requestingUserId  - 농민 userId 또는 작업자 userId
 * @returns {{ ok: boolean, farmerPhone?: string, workerPhone?: string, workerName?: string, farmerName?: string, error?: string }}
 */
function getCallInfo(jobId, requestingUserId) {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) return { ok: false, error: '작업을 찾을 수 없어요.' };
    if (job.status !== 'matched' && job.status !== 'in_progress') {
        return { ok: false, error: '아직 연결이 완료되지 않은 작업이에요.' };
    }
    if (!job.selectedWorkerId) {
        return { ok: false, error: '선택된 작업자가 없어요.' };
    }

    // 농민 여부 확인
    const isFarmer = job.requesterId === requestingUserId;

    // BUG_FIX: selectedWorkerId = user-xxx 대응 (workers 프로필 없이 선택된 경우)
    const selectedWorkerRow = db.prepare('SELECT * FROM workers WHERE id = ?').get(job.selectedWorkerId)
                           || db.prepare('SELECT * FROM workers WHERE userId = ?').get(job.selectedWorkerId);

    // 작업자 여부: workers.userId 일치 OR selectedWorkerId 자체가 userId인 경우
    const isWorker = selectedWorkerRow
        ? selectedWorkerRow.userId === requestingUserId
        : job.selectedWorkerId === requestingUserId;

    if (!isFarmer && !isWorker) {
        return { ok: false, error: '이 작업의 연락처를 조회할 권한이 없어요.' };
    }

    // 농민 연락처
    const farmerUser = db.prepare('SELECT name, phone FROM users WHERE id = ?').get(job.requesterId);

    // 작업자 연락처: workers.phone 우선, 없으면 users.phone fallback
    let workerPhone = selectedWorkerRow?.phone || null;
    let workerName  = selectedWorkerRow?.name  || null;
    if (!workerPhone || !workerName) {
        const workerUserRow = db.prepare('SELECT name, phone FROM users WHERE id = ?').get(job.selectedWorkerId);
        workerPhone = workerPhone || workerUserRow?.phone || null;
        workerName  = workerName  || workerUserRow?.name  || '작업자';
    }
    const farmerPhone = farmerUser?.phone || null;
    const farmerName  = farmerUser?.name  || job.requesterName || '농민';

    return {
        ok:         true,
        farmerPhone,
        farmerName,
        workerPhone,
        workerName,
    };
}

module.exports = { getCallInfo };
