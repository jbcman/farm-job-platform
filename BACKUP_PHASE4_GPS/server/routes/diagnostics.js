'use strict';
/**
 * diagnostics.js — GET /api/diagnostics
 * 모바일 테스트 준비 상태 확인용 경량 진단 엔드포인트
 */
const express = require('express');
const db      = require('../db');

const router = express.Router();

router.get('/', (_req, res) => {
    let dbOk = false;
    let jobCount = 0;
    let workerCount = 0;
    let analyticsCount = 0;

    try {
        jobCount       = db.prepare('SELECT COUNT(*) as n FROM jobs').get().n;
        workerCount    = db.prepare('SELECT COUNT(*) as n FROM workers').get().n;
        analyticsCount = db.prepare('SELECT COUNT(*) as n FROM analytics').get().n;
        dbOk = true;
    } catch (e) {
        console.error('[DIAGNOSTICS]', e.message);
    }

    const seedEnabled = process.env.USE_SEED_DATA !== 'false';
    const mode        = process.env.NODE_ENV || 'development';

    return res.json({
        ok:   true,
        server:   'healthy',
        db:       dbOk ? 'connected' : 'error',
        mode,
        seedEnabled,
        analyticsActive: analyticsCount >= 0,
        counts: { jobs: jobCount, workers: workerCount, analytics: analyticsCount },
        timestamp: new Date().toISOString(),
    });
});

module.exports = router;
