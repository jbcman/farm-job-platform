'use strict';
/**
 * metricsService.js — 경량 인메모리 실시간 메트릭스
 *
 * 수집 항목:
 *   · activeConnections   WebSocket 접속자 수 (ws.js가 갱신)
 *   · jobsOpen/matched/inProgress/completed  30초 DB 갱신
 *   · errorsLast1m        최근 1분 에러 카운트 (롤링 윈도우)
 *   · reqPerMin           최근 1분 요청 수 (롤링 윈도우)
 *   · avgResponseMs       EWMA 평균 응답시간 (α=0.1)
 *   · uptimeSec           process.uptime()
 *   · dbMode              'SQLITE' | 'POSTGRES'
 *
 * 인터페이스:
 *   recordRequest(ms)   — monitor.js가 호출
 *   recordError()       — index.js unhandledRejection/5xx가 호출
 *   setConnections(n)   — ws.js가 호출
 *   setJobCounts({...}) — index.js 30s interval이 호출
 *   getSnapshot()       — ws.js / admin route가 호출
 */

const EWMA_ALPHA = 0.1;

// ── 롤링 타임스탬프 배열 (1분) ──────────────────────────────────
const _errorTs = [];
const _reqTs   = [];
function _pruneOlderThan(arr, ageMs) {
    const cutoff = Date.now() - ageMs;
    while (arr.length && arr[0] < cutoff) arr.shift();
}

// ── 상태 변수 ───────────────────────────────────────────────────
let _connections = 0;
let _ewmaMs      = 0;
let _jobCounts   = { open: 0, matched: 0, in_progress: 0, completed: 0 };

// ── 외부 호출 API ───────────────────────────────────────────────

/** HTTP 요청 완료 시 monitor.js가 호출 */
function recordRequest(durationMs) {
    const now = Date.now();
    _reqTs.push(now);
    _pruneOlderThan(_reqTs, 60_000);
    if (_ewmaMs === 0) _ewmaMs = durationMs;
    else _ewmaMs = EWMA_ALPHA * durationMs + (1 - EWMA_ALPHA) * _ewmaMs;
}

/** 에러 발생 시 호출 (unhandledRejection / 5xx) */
function recordError() {
    _errorTs.push(Date.now());
    _pruneOlderThan(_errorTs, 60_000);
}

/** ws.js: 접속자 수 갱신 */
function setConnections(n) {
    _connections = Math.max(0, n);
}

/** index.js 30s interval: DB 집계 결과 갱신 */
function setJobCounts(counts) {
    _jobCounts = { ..._jobCounts, ...counts };
}

/** 현재 스냅샷 반환 (ws broadcast / admin route 용) */
function getSnapshot() {
    _pruneOlderThan(_errorTs, 60_000);
    _pruneOlderThan(_reqTs,   60_000);

    let dbMode = 'SQLITE';
    try { dbMode = require('../db').mode; } catch (_) {}

    return {
        activeConnections: _connections,
        jobsOpen:          _jobCounts.open,
        jobsMatched:       _jobCounts.matched,
        jobsInProgress:    _jobCounts.in_progress,
        jobsCompleted:     _jobCounts.completed,
        errorsLast1m:      _errorTs.length,
        reqPerMin:         _reqTs.length,
        avgResponseMs:     Math.round(_ewmaMs),
        uptimeSec:         Math.floor(process.uptime()),
        dbMode,
        ts:                Date.now(),
    };
}

module.exports = { recordRequest, recordError, setConnections, setJobCounts, getSnapshot };
