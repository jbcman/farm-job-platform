'use strict';
/**
 * behaviorCleanup.js — user_behavior 테이블 자동 정리
 */
const db = require('../db');

const RETENTION_MS   = 30 * 24 * 60 * 60 * 1000;
const PER_USER_CAP   = 100;
const INTERVAL_MS    = 24 * 60 * 60 * 1000;
const STARTUP_DELAY  = 30_000;

async function runCleanup() {
    try {
        const cutoff = Date.now() - RETENTION_MS;

        // STEP A: 30일 이전 삭제
        const expiredResult = await db.prepare(
            'DELETE FROM user_behavior WHERE createdAt < ?'
        ).run(cutoff);

        // STEP B: 사용자당 100개 초과분 삭제
        const capResult = await db.prepare(`
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
                WHERE rn > $1
            )
        `).run(PER_USER_CAP);

        const total = (expiredResult.changes || 0) + (capResult.changes || 0);
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
    setTimeout(() => {
        runCleanup().catch(() => {});
        setInterval(() => runCleanup().catch(() => {}), INTERVAL_MS);
    }, STARTUP_DELAY);

    console.log('[BEHAVIOR_CLEANUP] 스케줄 등록 완료 (30초 후 첫 실행, 이후 24h 주기)');
}

module.exports = { scheduleBehaviorCleanup, runCleanup };
