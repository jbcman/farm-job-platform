'use strict';
const express = require('express');
const db      = require('../db');

const router = express.Router();

function newId() {
    return 'rpt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

// ─── POST /api/reports ────────────────────────────────────────
router.post('/', async (req, res) => {
    const { jobId, reason } = req.body;
    const reporterId = req.headers['x-user-id'] || req.body.reporterId;

    if (!jobId || !reporterId || !reason?.trim()) {
        return res.status(400).json({ ok: false, error: 'jobId, reason이 필요해요.' });
    }

    const report = {
        id:         'rpt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        jobId,
        reporterId,
        reason:     reason.trim(),
        createdAt:  new Date().toISOString(),
    };

    await db.prepare(`
        INSERT INTO reports (id, jobId, reporterId, reason, createdAt)
        VALUES (@id, @jobId, @reporterId, @reason, @createdAt)
    `).run(report);

    console.log(`[REPORT] jobId=${jobId} reporterId=${reporterId} reason="${reason.slice(0, 40)}"`);
    return res.status(201).json({ ok: true, report });
});

module.exports = router;
