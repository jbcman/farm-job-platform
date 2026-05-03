'use strict';
/**
 * autoSelect.js — 자동 선택 서비스 (PostgreSQL 비동기)
 */
const db = require('../db');
const { distanceKm, calcApplicantMatchScore } = require('./matchingEngine');
const { sendApplicantArrivedAlert, sendWorkerSelectedAlert } = require('./kakaoService');

const AUTO_SELECT_MIN_COUNT = 3;
const AUTO_SELECT_THRESHOLD = 63;
const AUTO_SELECT_MAX_DIST  = 20;

const runningJobs = new Set();

function normalizeWorker(row) {
    if (!row) return null;
    return {
        ...row,
        categories: typeof row.categories === 'string' ? JSON.parse(row.categories) : (row.categories || []),
        hasTractor: !!row.hasTractor,
        hasSprayer: !!row.hasSprayer,
        hasRotary:  !!row.hasRotary,
    };
}

function newId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function checkAndAutoSelect(jobId) {
    if (runningJobs.has(jobId)) {
        console.log(`[AUTO_SELECT_LOCK] jobId=${jobId} 이미 실행 중 → 스킵`);
        return { skipped: true, reason: 'locked' };
    }
    runningJobs.add(jobId);

    try {
        const jobRow = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!jobRow || jobRow.status !== 'open') return { skipped: true, reason: 'job_not_open' };
        if (!jobRow.autoAssign) return { skipped: true, reason: 'autoAssign_disabled' };
        if (jobRow.autoSelected) return { skipped: true, reason: 'already_auto_selected' };

        const apps = await db.prepare(
            "SELECT * FROM applications WHERE jobRequestId = ? AND status = 'applied' ORDER BY createdAt ASC"
        ).all(jobId);

        if (apps.length < AUTO_SELECT_MIN_COUNT) {
            return { skipped: true, reason: `not_enough_applicants(${apps.length}/${AUTO_SELECT_MIN_COUNT})` };
        }

        const scoredRaw = await Promise.all(apps.map(async (a) => {
            const workerRow = await db.prepare('SELECT * FROM workers WHERE id = ?').get(a.workerId);
            const worker    = normalizeWorker(workerRow);
            if (!worker) return null;
            const dist  = (jobRow.latitude && jobRow.longitude && worker.latitude && worker.longitude)
                ? distanceKm(jobRow.latitude, jobRow.longitude, worker.latitude, worker.longitude)
                : null;
            const distKm     = dist !== null ? Math.round(dist * 10) / 10 : null;
            const matchScore = calcApplicantMatchScore(worker, a, jobRow, distKm);
            if (distKm !== null && distKm > AUTO_SELECT_MAX_DIST) {
                console.log(`[AUTO_SELECT_DIST_SKIP] workerId=${worker.id} distKm=${distKm} > ${AUTO_SELECT_MAX_DIST}km`);
                return null;
            }
            return { app: a, worker, distKm, matchScore };
        }));
        const scored = scoredRaw.filter(Boolean);

        if (scored.length === 0) return { skipped: true, reason: 'no_valid_workers' };

        scored.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
        const top = scored[0];

        if (top.matchScore < AUTO_SELECT_THRESHOLD) {
            console.log(`[AUTO_SELECT_SKIP] jobId=${jobId} topScore=${top.matchScore} threshold=${AUTO_SELECT_THRESHOLD}`);
            return { skipped: true, reason: `score_below_threshold(${top.matchScore}<${AUTO_SELECT_THRESHOLD})` };
        }

        const workerId   = top.worker.id;
        const worker     = top.worker;
        const farmerUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(jobRow.requesterId);

        let didSelect = false;

        await db.transaction(async () => {
            const result = await db.prepare(`
                UPDATE jobs
                SET status = 'matched', contactRevealed = 1,
                    selectedWorkerId = ?, selectedAt = ?, autoSelected = 1
                WHERE id = ? AND status = 'open' AND autoSelected = 0
            `).run(workerId, new Date().toISOString(), jobId);

            if (result.changes === 0) {
                console.log(`[AUTO_SELECT_RACE_SKIP] jobId=${jobId} — 이미 status가 open 아님`);
                return;
            }
            didSelect = true;

            await db.prepare(
                "UPDATE applications SET status = 'selected' WHERE jobRequestId = ? AND workerId = ?"
            ).run(jobId, workerId);

            await db.prepare(
                "UPDATE applications SET status = 'rejected' WHERE jobRequestId = ? AND workerId != ?"
            ).run(jobId, workerId);

            const contactId = newId('contact');
            try {
                await db.prepare(`
                    INSERT INTO contacts (id, jobId, farmerId, workerId, createdAt)
                    VALUES (@id, @jobId, @farmerId, @workerId, @createdAt)
                `).run({
                    id: contactId, jobId, farmerId: jobRow.requesterId,
                    workerId, createdAt: new Date().toISOString(),
                });
            } catch (_) {}
        })();

        if (!didSelect) return { skipped: true, reason: 'race_condition_already_matched' };

        console.log(`[AUTO_SELECTED] jobId=${jobId} workerId=${workerId} name=${worker.name} score=${top.matchScore} dist=${top.distKm ?? '?'}km`);

        setImmediate(async () => {
            try {
                if (farmerUser) await sendWorkerSelectedAlert({ job: jobRow, worker: { id: workerId, name: worker.name, phone: worker.phone }, farmer: farmerUser, isAuto: true });
            } catch (e) { console.error('[AUTO_SELECT_NOTIFY_FARMER_FAIL]', jobId, e.message); }
            try {
                const workerUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(worker.userId);
                if (workerUser) await sendApplicantArrivedAlert({ job: jobRow, worker: workerUser, farmer: farmerUser });
            } catch (e) { console.error('[AUTO_SELECT_NOTIFY_WORKER_FAIL]', jobId, e.message); }
        });

        return { skipped: false, selected: workerId, score: top.matchScore };

    } catch (err) {
        console.error('[AUTO_SELECT_ERROR]', err.message);
        return { skipped: true, reason: `error:${err.message}` };
    } finally {
        runningJobs.delete(jobId);
    }
}

module.exports = { checkAndAutoSelect };
