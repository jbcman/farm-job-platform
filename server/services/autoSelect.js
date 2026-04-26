'use strict';
/**
 * autoSelect.js — 자동 선택 서비스 (PHASE 28-29)
 *
 * 조건:
 *   ① 지원자 ≥ 3명
 *   ② 상위 matchScore ≥ 63점 (90점 만점의 70%)
 *   ③ 거리 ≤ 20km (거리 정보 있는 경우만 필터)
 *
 * 경쟁 상태 방어:
 *   - in-memory runningJobs Set → 동일 jobId 동시 실행 차단
 *   - DB 원자적 UPDATE WHERE status = 'open' → changes = 0 이면 이미 처리됨
 *
 * 알림:
 *   - 농민 ↔ 작업자 각각 개별 try/catch → 한쪽 실패해도 다른 쪽 전송
 */

const db = require('../db');
const { distanceKm, calcApplicantMatchScore } = require('./matchingEngine');
const { sendApplicantArrivedAlert, sendWorkerSelectedAlert } = require('./kakaoService');

const AUTO_SELECT_MIN_COUNT  = 3;   // 최소 지원자 수
const AUTO_SELECT_THRESHOLD  = 63;  // 70% of 90pts
const AUTO_SELECT_MAX_DIST   = 20;  // km — 초과 시 자동 선택 제외

// ── 경쟁 상태 방어: in-memory 잠금 ───────────────────────────────
const runningJobs = new Set();

/** DB row → JS 정규화 */
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

function newId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * checkAndAutoSelect(jobId)
 *
 * 지원 완료 직후 setImmediate로 호출.
 * @returns {{ skipped: boolean, reason?: string, selected?: string, score?: number }}
 */
async function checkAndAutoSelect(jobId) {
    // ── [방어 1] in-memory 잠금 ──────────────────────────────────
    if (runningJobs.has(jobId)) {
        console.log(`[AUTO_SELECT_LOCK] jobId=${jobId} 이미 실행 중 → 스킵`);
        return { skipped: true, reason: 'locked' };
    }
    runningJobs.add(jobId);

    try {
        // 1. 작업 조회
        const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!jobRow || jobRow.status !== 'open') {
            return { skipped: true, reason: 'job_not_open' };
        }
        // ── [SAFETY] 농민 동의(autoAssign=1) 없으면 자동 배정 차단 ──────
        // 기본값 0 (OFF). 농민이 명시적으로 켜야만 자동 매칭 실행됨.
        if (!jobRow.autoAssign) {
            return { skipped: true, reason: 'autoAssign_disabled' };
        }
        // ── [방어 0] 서버 재시작 후에도 재실행 차단: 이미 자동 선택된 경우 ──
        if (jobRow.autoSelected) {
            return { skipped: true, reason: 'already_auto_selected' };
        }

        // 2. 현재 지원자 목록 (applied 상태만)
        const apps = db.prepare(
            "SELECT * FROM applications WHERE jobRequestId = ? AND status = 'applied' ORDER BY createdAt ASC"
        ).all(jobId);

        if (apps.length < AUTO_SELECT_MIN_COUNT) {
            return { skipped: true, reason: `not_enough_applicants(${apps.length}/${AUTO_SELECT_MIN_COUNT})` };
        }

        // 3. 각 지원자 점수 계산 + 거리 필터
        const scored = apps.map(a => {
            const workerRow = db.prepare('SELECT * FROM workers WHERE id = ?').get(a.workerId);
            const worker    = normalizeWorker(workerRow);
            if (!worker) return null;

            const dist = (jobRow.latitude && jobRow.longitude && worker.latitude && worker.longitude)
                ? distanceKm(jobRow.latitude, jobRow.longitude, worker.latitude, worker.longitude)
                : null;
            const distKm     = dist !== null ? Math.round(dist * 10) / 10 : null;
            const matchScore = calcApplicantMatchScore(worker, a, jobRow, distKm);

            // ── [방어 3] 거리 제한 — 거리 정보 있는데 20km 초과면 제외 ──
            if (distKm !== null && distKm > AUTO_SELECT_MAX_DIST) {
                console.log(`[AUTO_SELECT_DIST_SKIP] workerId=${worker.id} distKm=${distKm} > ${AUTO_SELECT_MAX_DIST}km`);
                return null;
            }

            return { app: a, worker, distKm, matchScore };
        }).filter(Boolean);

        if (scored.length === 0) return { skipped: true, reason: 'no_valid_workers' };

        // 4. 최고 점수 지원자
        scored.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
        const top = scored[0];

        if (top.matchScore < AUTO_SELECT_THRESHOLD) {
            console.log(`[AUTO_SELECT_SKIP] jobId=${jobId} topScore=${top.matchScore} threshold=${AUTO_SELECT_THRESHOLD}`);
            return { skipped: true, reason: `score_below_threshold(${top.matchScore}<${AUTO_SELECT_THRESHOLD})` };
        }

        const workerId  = top.worker.id;
        const worker    = top.worker;
        const farmerUser = db.prepare('SELECT * FROM users WHERE id = ?').get(jobRow.requesterId);

        // 5. DB 원자적 트랜잭션 ─────────────────────────────────────
        // ── [방어 2] WHERE status = 'open' → 이미 매칭된 경우 changes = 0 ──
        let didSelect = false;

        db.transaction(() => {
            const result = db.prepare(`
                UPDATE jobs
                SET status = 'matched', contactRevealed = 1,
                    selectedWorkerId = ?, selectedAt = ?, autoSelected = 1
                WHERE id = ? AND status = 'open' AND autoSelected = 0
            `).run(workerId, new Date().toISOString(), jobId);

            if (result.changes === 0) {
                // 이미 다른 프로세스가 선택 완료 → 롤백 없이 그냥 중단
                console.log(`[AUTO_SELECT_RACE_SKIP] jobId=${jobId} — 이미 status가 open 아님`);
                return; // transaction 내 return → 이후 UPDATE 건너뜀
            }

            didSelect = true;

            db.prepare(
                "UPDATE applications SET status = 'selected' WHERE jobRequestId = ? AND workerId = ?"
            ).run(jobId, workerId);

            db.prepare(
                "UPDATE applications SET status = 'rejected' WHERE jobRequestId = ? AND workerId != ?"
            ).run(jobId, workerId);

            const contactId = newId('contact');
            try {
                db.prepare(`
                    INSERT OR IGNORE INTO contacts (id, jobId, farmerId, workerId, createdAt)
                    VALUES (@id, @jobId, @farmerId, @workerId, @createdAt)
                `).run({
                    id:        contactId,
                    jobId:     jobId,
                    farmerId:  jobRow.requesterId,
                    workerId:  workerId,
                    createdAt: new Date().toISOString(),
                });
            } catch (_) { /* UNIQUE 충돌 무시 */ }
        })();

        if (!didSelect) {
            return { skipped: true, reason: 'race_condition_already_matched' };
        }

        console.log(
            `[AUTO_SELECTED] jobId=${jobId} workerId=${workerId}` +
            ` name=${worker.name} score=${top.matchScore} dist=${top.distKm ?? '?'}km`
        );

        // 6. 카카오 알림 — 개별 try/catch로 한쪽 실패해도 다른 쪽 전송 ─
        setImmediate(async () => {
            // 농민에게: "작업자가 AI로 자동 선택됐어요"
            try {
                if (farmerUser) {
                    await sendWorkerSelectedAlert({
                        job:    jobRow,
                        worker: { id: workerId, name: worker.name, phone: worker.phone },
                        farmer: farmerUser,
                        isAuto: true,
                    });
                }
            } catch (e) {
                console.error('[AUTO_SELECT_NOTIFY_FARMER_FAIL]', jobId, e.message);
            }

            // 작업자에게: "선택됐어요"
            try {
                const workerUser = db.prepare('SELECT * FROM users WHERE id = ?').get(worker.userId);
                if (workerUser) {
                    await sendApplicantArrivedAlert({
                        job:    jobRow,
                        worker: workerUser,
                        farmer: farmerUser,
                    });
                }
            } catch (e) {
                console.error('[AUTO_SELECT_NOTIFY_WORKER_FAIL]', jobId, e.message);
            }
        });

        return { skipped: false, selected: workerId, score: top.matchScore };

    } catch (err) {
        console.error('[AUTO_SELECT_ERROR]', err.message);
        return { skipped: true, reason: `error:${err.message}` };
    } finally {
        // ── [방어 1] 잠금 해제 — 성공/실패/예외 모두 해제 ────────
        runningJobs.delete(jobId);
    }
}

module.exports = { checkAndAutoSelect };
