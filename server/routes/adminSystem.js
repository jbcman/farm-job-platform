'use strict';
/**
 * adminSystem.js — PHASE SAFE_MODE_KILLSWITCH
 *
 * POST /api/admin/system/safe-mode  { enable: true|false }
 * GET  /api/admin/system/status
 */
const router = require('express').Router();
const { getFlag, setFlag } = require('../services/systemFlagService');
const db = require('../db');

// 토큰 가드
router.use((req, res, next) => {
    const token = req.headers['x-admin-token'];
    if (!process.env.ADMIN_TOKEN || token === process.env.ADMIN_TOKEN) return next();
    return res.status(403).json({ error: 'forbidden' });
});

// 수동 제어
router.post('/safe-mode', async (req, res) => {
    try {
        const { enable } = req.body || {};
        await setFlag('SAFE_MODE', !!enable);
        console.log(`[SAFE_MODE] 수동 ${enable ? '활성화' : '해제'}`);
        res.json({ ok: true, safeMode: !!enable });
    } catch (_) {
        res.status(500).json({ ok: false });
    }
});

// 현재 상태 조회
router.get('/status', async (_req, res) => {
    try {
        const safeMode  = await getFlag('SAFE_MODE');
        const flags     = await db.prepare('SELECT * FROM system_flags').all();
        const lastSnap  = await db.prepare(
            'SELECT * FROM anomaly_snapshots ORDER BY ts DESC LIMIT 1'
        ).get();
        res.json({ safeMode, flags, lastAnomaly: lastSnap ?? null });
    } catch (_) {
        res.status(500).json({ ok: false });
    }
});

module.exports = router;
