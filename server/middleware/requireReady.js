'use strict';
/**
 * requireReady.js — DB Readiness 미들웨어
 *
 * PG 연결 + schema/migration 완료 전 DB 의존 API 호출을 503으로 차단합니다.
 *
 * 적용 범위:
 *   app.use('/api', requireReady)  ← DB 라우트 마운트 바로 전에 삽입
 *
 * 제외 대상 (미들웨어보다 먼저 정의되어 있음):
 *   GET /api/health      → 항상 허용 (이미 처리됨)
 *   GET /api/geocode     → 외부 API, DB 불필요 (이미 처리됨)
 *   GET /api/reverse-geocode → 동상 (이미 처리됨)
 *
 * 동작:
 *   _dbReady = false (PG 초기화 중) → 503 { error: 'Service warming up' }
 *   _dbReady = true  (준비 완료)    → next()
 *
 * warm-up 소요 시간: 일반적으로 5~15초 (PG 연결 + migration)
 * SQLite 전용 모드: _dbReady = true 즉시 → 이 미들웨어는 사실상 noop
 */

const db = require('../db');

module.exports = function requireReady(req, res, next) {
    if (db.isReady?.() !== false) return next(); // ready 또는 isReady 미지원 시 통과

    // DB 준비 중 — 잠깐 후 재시도 안내
    return res.status(503).json({
        error:   'Service warming up',
        message: 'DB 연결 초기화 중입니다. 잠시 후 다시 시도해주세요.',
        db:      db.mode,
        retryMs: 3000,
    });
};
