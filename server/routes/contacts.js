'use strict';
const express = require('express');
const db      = require('../db');

const router = express.Router();

// ─── GET /api/contacts/my ─────────────────────────────────────
router.get('/my', (req, res) => {
    const userId = req.headers['x-user-id'] || req.query.userId;
    if (!userId) return res.status(401).json({ ok: false, error: '로그인이 필요해요.' });

    // 농민 역할: farmerId = userId
    const asFarmer = db.prepare(`
        SELECT
            c.id, c.jobId, c.farmerId, c.workerId, c.createdAt,
            j.category, j.locationText, j.date, j.status AS jobStatus,
            w.name  AS partnerName,
            w.phone AS partnerPhone,
            w.baseLocationText AS partnerLocation,
            'farmer' AS myRole
        FROM contacts c
        JOIN jobs    j ON j.id = c.jobId
        JOIN workers w ON w.id = c.workerId
        WHERE c.farmerId = ?
        ORDER BY c.createdAt DESC
    `).all(userId);

    // 작업자 역할: worker.userId = userId
    const worker = db.prepare('SELECT id FROM workers WHERE userId = ?').get(userId);
    const asWorker = worker
        ? db.prepare(`
            SELECT
                c.id, c.jobId, c.farmerId, c.workerId, c.createdAt,
                j.category, j.locationText, j.date, j.status AS jobStatus,
                j.requesterName AS partnerName,
                j.requesterId   AS requesterId,
                NULL            AS partnerPhone,
                j.locationText  AS partnerLocation,
                'worker'        AS myRole
            FROM contacts c
            JOIN jobs j ON j.id = c.jobId
            WHERE c.workerId = ?
            ORDER BY c.createdAt DESC
        `).all(worker.id)
        : [];

    // 중복 제거 후 최신순 병합
    const seen = new Set();
    const contacts = [...asFarmer, ...asWorker]
        .filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    console.log(`[CONTACTS_VIEWED] userId=${userId} count=${contacts.length}`);
    return res.json({ ok: true, contacts });
});

module.exports = router;
