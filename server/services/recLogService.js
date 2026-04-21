'use strict';
/**
 * recLogService.js — PHASE ADMIN_REALTIME_LOG
 *
 * 추천 결과를 메모리 버퍼에 쌓고 2초마다 일괄 INSERT.
 * 추천 경로에 쓰기 지연 없음 (fire-and-forget).
 * 버퍼 50개 초과 시 즉시 플러시 (메모리 보호).
 *
 * 샘플링: 30%만 저장 (고트래픽 DB 부담 감소, 분석 충분 유지)
 * 자동 정리: 7일 초과 로그 24시간마다 삭제
 */
const db = require('../db');

const BUF         = [];
const FLUSH_SIZE  = 50;
const FLUSH_MS    = 2000;
const SAMPLE_RATE = 0.3;                        // 30% 샘플링
const RETAIN_MS   = 7 * 24 * 60 * 60 * 1000;   // 7일 보관
const CLEANUP_MS  = 24 * 60 * 60 * 1000;        // 24시간마다 정리

const stmtInsert = db.prepare(`
    INSERT INTO rec_logs
    (jobId, workerId, variantKey, score, distKm, difficulty, jobType, autoJobType, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const txFlush = db.transaction((rows) => {
    for (const r of rows) {
        stmtInsert.run(
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

function flush() {
    if (BUF.length === 0) return;
    const batch = BUF.splice(0, BUF.length);
    try {
        txFlush(batch);
    } catch (_) {
        BUF.unshift(...batch);  // DB 실패 → 버퍼 복원 (재시도 대기)
    }
}

/**
 * 추천 로그 1건 버퍼에 추가 (fail-safe, 30% 샘플링)
 * @param {{ jobId, workerId, variantKey, score, distKm, difficulty, jobType, autoJobType }} row
 */
function pushLog(row) {
    try {
        if (Math.random() > SAMPLE_RATE) return;   // 70% 드롭 → 30%만 저장
        BUF.push({ ...row, createdAt: Date.now() });
        if (BUF.length > 10000) BUF.splice(0, BUF.length - 5000);  // 메모리 상한: 5000개로 트림
        if (BUF.length >= FLUSH_SIZE) flush();
    } catch (_) {}
}

// 7일 초과 로그 자동 삭제 (fail-safe)
function cleanup() {
    try {
        const cutoff  = Date.now() - RETAIN_MS;
        const result  = db.prepare('DELETE FROM rec_logs WHERE createdAt < ?').run(cutoff);
        if (result.changes > 0) {
            console.log(`[REC_LOG_CLEANUP] ${result.changes}건 삭제 (7일 초과)`);
        }
    } catch (_) {}
}

// 2초마다 자동 플러시
setInterval(flush, FLUSH_MS);

// 24시간마다 자동 정리 (서버 시작 1분 후 첫 실행)
setTimeout(() => {
    cleanup();
    setInterval(cleanup, CLEANUP_MS);
}, 60 * 1000);

module.exports = { pushLog, flush, cleanup };
