'use strict';
/**
 * reminderRecovery.js — 서버 재시작 시 출발 독촉 알림 복구 (PHASE 32)
 */
const db = require('../db');
const { sendDepartureReminder } = require('./kakaoService');

const REMINDER_DELAY_MS = 10 * 60 * 1000;

function normalizeWorker(row) {
    if (!row) return null;
    return {
        ...row,
        categories: typeof row.categories === 'string'
            ? JSON.parse(row.categories)
            : (row.categories || []),
        hasTractor: !!row.hasTractor,
        hasSprayer: !!row.hasSprayer,
        hasRotary:  !!row.hasRotary,
    };
}

async function tryFireReminder(jobId, worker) {
    const result = await db.prepare(`
        UPDATE jobs
        SET departureReminderSent = 1
        WHERE id = ? AND status = 'in_progress' AND departureReminderSent = 0
    `).run(jobId);

    if (result.changes === 0) {
        console.log(`[REMINDER_SKIP_DUPLICATE] jobId=${jobId} — 이미 발송됨 또는 진행 중 아님`);
        return false;
    }

    const jobRow = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    await sendDepartureReminder({ job: jobRow, worker });
    return true;
}

function scheduleOrFireReminder(job, worker) {
    const startedMs  = new Date(job.startedAt).getTime();
    const reminderAt = startedMs + REMINDER_DELAY_MS;
    const now        = Date.now();
    const delayMs    = reminderAt - now;

    if (delayMs <= 0) {
        console.log(`[REMINDER_RECOVERY_FIRE] jobId=${job.id} overdue=${Math.round(-delayMs / 1000)}s — 즉시 발송`);
        setImmediate(async () => {
            try { await tryFireReminder(job.id, worker); }
            catch (e) { console.error('[REMINDER_RECOVERY_FIRE_ERROR]', e.message); }
        });
    } else {
        console.log(`[REMINDER_RECOVERY_SCHEDULE] jobId=${job.id} remainSec=${Math.round(delayMs / 1000)} worker=${worker.name}`);
        setTimeout(async () => {
            try { await tryFireReminder(job.id, worker); }
            catch (e) { console.error('[REMINDER_RECOVERY_TIMEOUT_ERROR]', e.message); }
        }, delayMs);
    }
}

async function recoverDepartureReminders() {
    try {
        const inProgressJobs = await db.prepare(
            "SELECT * FROM jobs WHERE status = 'in_progress' AND startedAt IS NOT NULL"
        ).all();

        if (inProgressJobs.length === 0) {
            console.log('[REMINDER_RECOVERY] 복구할 진행 중 작업 없음');
            return;
        }

        console.log(`[REMINDER_RECOVERY] 진행 중 작업 ${inProgressJobs.length}건 복구 시작`);

        for (const job of inProgressJobs) {
            const selApp = await db.prepare(
                "SELECT workerId FROM applications WHERE jobRequestId = ? AND status = 'selected'"
            ).get(job.id);

            if (!selApp) {
                console.log(`[REMINDER_RECOVERY_SKIP] jobId=${job.id} — 작업자 없음`);
                continue;
            }

            const worker = normalizeWorker(
                await db.prepare('SELECT * FROM workers WHERE id = ?').get(selApp.workerId)
            );

            if (!worker) {
                console.log(`[REMINDER_RECOVERY_SKIP] jobId=${job.id} — worker row 없음`);
                continue;
            }

            scheduleOrFireReminder(job, worker);
        }
    } catch (err) {
        console.error('[REMINDER_RECOVERY_ERROR]', err.message);
    }
}

module.exports = { recoverDepartureReminders, tryFireReminder };
