'use strict';
/**
 * adminLogs.js — PHASE ADMIN_REALTIME_LOG
 *
 * GET /api/admin/logs/recent   최근 200건
 * GET /api/admin/logs/stats    variant/jobType 집계
 *
 * ADMIN_TOKEN 미설정 시 내부망 전용 (토큰 없이 접근 허용).
 * ADMIN_TOKEN 설정 시 x-admin-token 헤더 필수.
 */
const router = require('express').Router();
const db     = require('../db');

// ─── 토큰 가드 ────────────────────────────────────────────────────
router.use((req, res, next) => {
    const token = req.headers['x-admin-token'];
    if (!process.env.ADMIN_TOKEN || token === process.env.ADMIN_TOKEN) return next();
    return res.status(403).json({ error: 'forbidden' });
});

// ─── 최근 N건 ─────────────────────────────────────────────────────
router.get('/recent', async (_req, res) => {
    try {
        const rows = await db.prepare(`
            SELECT * FROM rec_logs ORDER BY id DESC LIMIT 200
        `).all();
        res.json(rows);
    } catch (_) { res.json([]); }
});

// ─── 집계 ────────────────────────────────────────────────────────
router.get('/stats', async (_req, res) => {
    try {
        const byVariant = await db.prepare(`
            SELECT variantKey, COUNT(*) cnt, ROUND(AVG(score)::numeric,2) avgScore
            FROM rec_logs GROUP BY variantKey ORDER BY cnt DESC
        `).all();

        const byType = await db.prepare(`
            SELECT COALESCE(autojobtype, jobtype) AS type,
                   COUNT(*) cnt, ROUND(AVG(score)::numeric,2) avgScore
            FROM rec_logs GROUP BY type ORDER BY cnt DESC
        `).all();

        const totalRow = await db.prepare('SELECT COUNT(*) AS n FROM rec_logs').get();
        const total = totalRow?.n || 0;

        res.json({ total, byVariant, byType });
    } catch (_) { res.json({ total: 0, byVariant: [], byType: [] }); }
});

module.exports = router;
