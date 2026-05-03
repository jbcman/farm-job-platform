'use strict';
/**
 * monitor.js — HTTP 요청 모니터링 미들웨어
 *
 * 기능:
 *  · 모든 API 요청의 메서드/경로/상태코드/응답시간 로깅
 *  · 느린 요청 경고 (>500ms)  → [SLOW_API]
 *  · 5xx 서버 오류 경고        → [API_ERROR]
 *  · metricsService에 응답시간 + 에러 피드
 *  · /api/health 제외 (로그 노이즈 방지)
 */

const SLOW_THRESHOLD_MS = parseInt(process.env.SLOW_API_MS || '500', 10);

// metricsService는 순환 참조 방지를 위해 지연 로드
let _metrics = null;
function _getMetrics() {
    if (!_metrics) {
        try { _metrics = require('../services/metricsService'); } catch (_) {}
    }
    return _metrics;
}

module.exports = function monitor(req, res, next) {
    // 헬스체크는 로그 제외
    if (req.path === '/api/health' || req.path === '/health') return next();

    const startAt = process.hrtime.bigint();

    res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - startAt) / 1_000_000; // ns → ms
        const duration = ms.toFixed(1);

        // ── metricsService 피드 ───────────────────────────────────
        const svc = _getMetrics();
        if (svc) {
            svc.recordRequest(ms);
            if (res.statusCode >= 500) svc.recordError();
        }

        const tag = res.statusCode >= 500 ? '[API_ERROR]'
                  : ms > SLOW_THRESHOLD_MS  ? '[SLOW_API] '
                  : '[REQ]     ';

        const line = `${tag} ${req.method.padEnd(6)} ${String(res.statusCode)} ${String(duration).padStart(7)}ms  ${req.path}`;

        if (res.statusCode >= 500) {
            console.error(line);
        } else if (ms > SLOW_THRESHOLD_MS) {
            console.warn(line);
        } else {
            // 200ms 이하 일반 요청은 로그 생략 (Render 로그 절약)
            if (ms >= 200) console.log(line);
        }
    });

    next();
};
