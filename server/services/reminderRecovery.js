'use strict';
/**
 * reminderRecovery.js — 서버 재시작 시 출발 독촉 알림 복구 (PHASE 32)
 *
 * 동작:
 *   서버 시작 → in_progress 작업 전체 조회
 *   각 작업의 startedAt + 10분 기준:
 *     ① 이미 10분 지남  → 즉시 sendDepartureReminder()
 *     ② 아직 10분 미만  → 남은 시간만큼 setTimeout 재등록
 *     ③ startedAt 없음  → 스킵
 *
 * 서버 재시작 후에도 알림을 한 번도 놓치지 않습니다.
 */

const db = require('../db');
const { distanceKm } = require('./matchingEngine'); // unused but keep consistent
const { sendDepartureReminder } = require('./kakaoService');

const REMINDER_DELAY_MS = 10 * 60 * 1000; // 10분

/**
 * tryFireReminder(jobId, worker)
 *
 * 중복 발송 방지를 포함한 공용 발송 함수.
 * DB 원자적 UPDATE WHERE departureReminderSent = 0 으로 정확히 1회만 실행.
 *
 * @param {string} jobId
 * @param {object} worker - normalizeWorker 결과
 * @returns {boolean} 실제 발송 여부
 */
async function tryFireReminder(jobId, worker) {
    // ── 원자적 플래그 획득 ─────────────────────────────────────
    // changes = 1 이면 이 호출이 최초 발송자 → 진행
    // changes = 0 이면 이미 다른 타이머가 먼저 발송 → 중단
    const result = db.prepare(`
        UPDATE jobs
        SET departureReminderSent = 1
        WHERE id = ? AND status = 'in_progress' AND departureReminderSent = 0
    `).run(jobId);

    if (result.changes === 0) {
        console.log(`[REMINDER_SKIP_DUPLICATE] jobId=${jobId} — 이미 발송됨 또는 진행 중 아님`);
        return false;
    }

    // 발송
    const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    await sendDepartureReminder({ job: jobRow, worker });
    return true;
}

/** DB row → worker 정규화 */
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

/**
 * 단일 작업에 대한 독촉 알림 실행 또는 스케줄링
 * @param {object} job - DB row (normalizeJob 처리 전)
 * @param {object} worker - normalizeWorker 결과
 */
function scheduleOrFireReminder(job, worker) {
    const startedMs   = new Date(job.startedAt).getTime();
    const reminderAt  = startedMs + REMINDER_DELAY_MS;
    const now         = Date.now();
    const delayMs     = reminderAt - now;

    if (delayMs <= 0) {
        // ① 이미 10분 경과 — 즉시 발송 (서버가 오래 꺼져 있었던 경우)
        console.log(`[REMINDER_RECOVERY_FIRE] jobId=${job.id} overdue=${Math.round(-delayMs / 1000)}s — 즉시 발송`);
        setImmediate(async () => {
            try {
                await tryFireReminder(job.id, worker);
            } catch (e) {
                console.error('[REMINDER_RECOVERY_FIRE_ERROR]', e.message);
            }
        });
    } else {
        // ② 아직 10분 미만 — 남은 시간만큼 재등록
        console.log(`[REMINDER_RECOVERY_SCHEDULE] jobId=${job.id} remainSec=${Math.round(delayMs / 1000)} worker=${worker.name}`);
        setTimeout(async () => {
            try {
                await tryFireReminder(job.id, worker);
            } catch (e) {
                console.error('[REMINDER_RECOVERY_TIMEOUT_ERROR]', e.message);
            }
        }, delayMs);
    }
}

/**
 * recoverDepartureReminders()
 *
 * index.js 서버 시작 직후 한 번 호출.
 * in_progress 전체를 순회해 타이머를 복구합니다.
 */
function recoverDepartureReminders() {
    try {
        const inProgressJobs = db.prepare(
            "SELECT * FROM jobs WHERE status = 'in_progress' AND startedAt IS NOT NULL"
        ).all();

        if (inProgressJobs.length === 0) {
            console.log('[REMINDER_RECOVERY] 복구할 진행 중 작업 없음');
            return;
        }

        console.log(`[REMINDER_RECOVERY] 진행 중 작업 ${inProgressJobs.length}건 복구 시작`);

        for (const job of inProgressJobs) {
            // 선택된 작업자 조회
            const selApp = db.prepare(
                "SELECT workerId FROM applications WHERE jobRequestId = ? AND status = 'selected'"
            ).get(job.id);

            if (!selApp) {
                console.log(`[REMINDER_RECOVERY_SKIP] jobId=${job.id} — 작업자 없음`);
                continue;
            }

            const worker = normalizeWorker(
                db.prepare('SELECT * FROM workers WHERE id = ?').get(selApp.workerId)
            );

            if (!worker) {
                console.log(`[REMINDER_RECOVERY_SKIP] jobId=${job.id} — worker row 없음`);
                continue;
            }

            scheduleOrFireReminder(job, worker);
        }
    } catch (err) {
        // fail-safe: 복구 실패해도 서버 시작을 막지 않음
        console.error('[REMINDER_RECOVERY_ERROR]', err.message);
    }
}

module.exports = { recoverDepartureReminders, tryFireReminder };
