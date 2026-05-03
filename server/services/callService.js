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
 * @returns {Promise<{ ok: boolean, farmerPhone?: string, workerPhone?: string, workerName?: string, farmerName?: string, error?: string }>}
 */
async function getCallInfo(jobId, requestingUserId) {
    const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
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
    const selectedWorkerRow = await db.prepare('SELECT * FROM workers WHERE id = ?').get(job.selectedWorkerId)
                           || await db.prepare('SELECT * FROM workers WHERE userId = ?').get(job.selectedWorkerId);

    // 작업자 여부: 3단계 체크
    // 1) workers.userId === requestingUserId  (일반 케이스 — 사용자 고유 ID)
    // 2) workers.id === requestingUserId      (엣지 케이스 — workers.id가 직접 전달된 경우)
    // 3) selectedWorkerId === requestingUserId (workers 행 없는 경우 — userId 형식 직접 비교)
    const isWorker = selectedWorkerRow
        ? (selectedWorkerRow.userId === requestingUserId || selectedWorkerRow.id === requestingUserId)
        : job.selectedWorkerId === requestingUserId;

    console.log(`[TRACE][CALL_AUTH] jobId=${jobId} requestingUserId=${requestingUserId} isFarmer=${isFarmer} isWorker=${isWorker} selectedWorkerId=${job.selectedWorkerId}`);
    if (!isFarmer && !isWorker) {
        console.warn(`[BROKEN_LINK][CALL_AUTH] 403 — requestingUserId=${requestingUserId} is neither farmer(${job.requesterId}) nor worker(${job.selectedWorkerId})`);
        return { ok: false, error: '이 작업의 연락처를 조회할 권한이 없어요.' };
    }

    // 농민 연락처
    const farmerUser = await db.prepare('SELECT name, phone FROM users WHERE id = ?').get(job.requesterId);

    // 작업자 연락처: workers.phone 우선, 없으면 users.phone fallback
    let workerPhone = selectedWorkerRow?.phone || null;
    let workerName  = selectedWorkerRow?.name  || null;
    if (!workerPhone || !workerName) {
        const workerUserRow = await db.prepare('SELECT name, phone FROM users WHERE id = ?').get(job.selectedWorkerId);
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
