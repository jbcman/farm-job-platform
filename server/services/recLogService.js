'use strict';
/**
 * recLogService.js — 추천 로그 버퍼 → PostgreSQL 일괄 INSERT
 */
const db = require('../db');

const BUF         = [];
const FLUSH_SIZE  = 50;
const FLUSH_MS    = 2000;
const SAMPLE_RATE = 0.3;
const RETAIN_MS   = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_MS  = 24 * 60 * 60 * 1000;

const stmtInsert = db.prepare(`
    INSERT INTO rec_logs
    (jobId, workerId, variantKey, score, distKm, difficulty, jobType, autoJobType, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const txFlush = db.transaction(async (rows) => {
    for (const r of rows) {
        await stmtInsert.run(
            r.jobId       ?? null,
            r.workerId    ?? null,
            r.variantKey  ?? null,
            r.score       ?? null,
            r.distKm      ?? null,
            r.difficulty  ?? null,
            r.jobType     ?? null,
            r.autoJobType ?? null,
            r.createdAt   ?? Date.now(),
        );
    }
});

async function flush() {
    if (BUF.length === 0) return;
    const batch = BUF.splice(0, BUF.length);
    try {
        await txFlush(batch);
    } catch (_) {
        BUF.unshift(...batch);
    }
}

function pushLog(row) {
    try {
        if (Math.random() > SAMPLE_RATE) return;
        BUF.push({ ...row, createdAt: Date.now() });
        if (BUF.length > 10000) BUF.splice(0, BUF.length - 5000);
        if (BUF.length >= FLUSH_SIZE) flush().catch(() => {});
    } catch (_) {}
}

async function cleanup() {
    try {
        const cutoff  = Date.now() - RETAIN_MS;
        const result  = await db.prepare('DELETE FROM rec_logs WHERE createdAt < ?').run(cutoff);
        if (result.changes > 0) {
            console.log(`[REC_LOG_CLEANUP] ${result.changes}건 삭제 (7일 초과)`);
        }
    } catch (_) {}
}

setInterval(() => flush().catch(() => {}), FLUSH_MS);

setTimeout(() => {
    cleanup().catch(() => {});
    setInterval(() => cleanup().catch(() => {}), CLEANUP_MS);
}, 60 * 1000);

module.exports = { pushLog, flush, cleanup };
