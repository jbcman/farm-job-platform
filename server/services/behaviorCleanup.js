'use strict';
/**
 * behaviorCleanup.js — user_behavior 테이블 자동 정리
 *
 * 전략 (2단계):
 *   STEP A — 30일 이전 전체 삭제 (방법 1): 빠른 bulk 정리
 *   STEP B — 사용자당 최신 100개 초과분 삭제 (방법 2): 특정 사용자 폭발 방지
 *
 * 실행 시점:
 *   - 서버 시작 시 1회 (30초 지연, 부팅 부하 방지)
 *   - 이후 24시간마다 반복
 *
 * 안전 규칙:
 *   - 오류 발생 시 로그만 출력, 서버 중단 없음
 *   - 삭제 0건이면 로그 생략 (무의미한 노이즈 방지)
 */
const db = require('../db');

const RETENTION_MS   = 30 * 24 * 60 * 60 * 1000; // 30일
const PER_USER_CAP   = 100;                        // 사용자당 최대 행
const INTERVAL_MS    = 24 * 60 * 60 * 1000;       // 실행 주기: 24시간
const STARTUP_DELAY  = 30_000;                     // 서버 시작 후 30초 뒤 첫 실행

// ── STEP A: 30일 이전 삭제 ───────────────────────────────────────
const stmtExpired = db.prepare(
    'DELETE FROM user_behavior WHERE createdAt < ?'
);

// ── STEP B: 사용자당 100개 초과분 삭제 (window ROW_NUMBER) ────────
// SQLite 3.25+ window function 지원 (현재 3.53 ✓)
const stmtUserCap = db.prepare(`
    DELETE FROM user_behavior
    WHERE id IN (
        SELECT id FROM (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY userId
                       ORDER BY createdAt DESC
                   ) AS rn
            FROM user_behavior
        )
        WHERE rn > ?
    )
`);

function runCleanup() {
    try {
        const cutoff = Date.now() - RETENTION_MS;

        // STEP A
        const expiredResult = stmtExpired.run(cutoff);

        // STEP B
        const capResult = stmtUserCap.run(PER_USER_CAP);

        const total = expiredResult.changes + capResult.changes;
        if (total > 0) {
            console.log(
                `[BEHAVIOR_CLEANUP] 삭제 완료 — ` +
                `30일 초과: ${expiredResult.changes}건, ` +
                `사용자 캡 초과: ${capResult.changes}건`
            );
        }
    } catch (e) {
        console.error('[BEHAVIOR_CLEANUP] 오류 (무시):', e.message);
    }
}

function scheduleBehaviorCleanup() {
    // 서버 시작 직후 부하 방지 — 30초 뒤 첫 실행
    setTimeout(() => {
        runCleanup();
        setInterval(runCleanup, INTERVAL_MS);
    }, STARTUP_DELAY);

    console.log('[BEHAVIOR_CLEANUP] 스케줄 등록 완료 (30초 후 첫 실행, 이후 24h 주기)');
}

module.exports = { scheduleBehaviorCleanup, runCleanup };
