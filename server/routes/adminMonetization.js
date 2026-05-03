'use strict';
/**
 * adminMonetization.js — PHASE MONETIZATION
 *
 * POST /api/admin/monetization/sponsor    스폰서 게시물 등록
 * POST /api/admin/monetization/subscribe  구독자 등록
 * GET  /api/admin/monetization/status     현재 활성 내역 조회
 */
const router = require('express').Router();
const db     = require('../db');

const stmtInsertSponsor = db.prepare(
    'INSERT INTO sponsored_jobs (jobId, boost, expiresAt) VALUES (?, ?, ?) ON CONFLICT (jobId) DO UPDATE SET boost = EXCLUDED.boost, expiresAt = EXCLUDED.expiresAt'
);
const stmtInsertSub = db.prepare(
    'INSERT INTO subscriptions (userId, tier, priorityBoost, expiresAt) VALUES (?, ?, ?, ?) ON CONFLICT (userId) DO UPDATE SET tier = EXCLUDED.tier, priorityBoost = EXCLUDED.priorityboost, expiresAt = EXCLUDED.expiresat'
);

// 스폰서 게시물 등록
router.post('/sponsor', async (req, res) => {
    const { jobId, boost = 20, hours = 24 } = req.body || {};
    if (!jobId) return res.status(400).json({ error: 'jobId required' });

    try {
        await stmtInsertSponsor.run(String(jobId), Number(boost), Date.now() + Number(hours) * 3_600_000);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 구독 등록
router.post('/subscribe', async (req, res) => {
    const { userId, tier = 'pro', days = 30 } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const priorityBoost = tier === 'pro' ? 15 : 0;
    try {
        await stmtInsertSub.run(userId, tier, priorityBoost, Date.now() + Number(days) * 86_400_000);
        res.json({ ok: true, tier, priorityBoost });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 활성 내역 조회
router.get('/status', async (_req, res) => {
    const now = Date.now();
    const sponsors = await db.prepare('SELECT * FROM sponsored_jobs WHERE expiresAt > ?').all(now);
    const subs     = await db.prepare('SELECT * FROM subscriptions WHERE expiresAt > ?').all(now);
    res.json({ sponsors, subscriptions: subs });
});

module.exports = router;
