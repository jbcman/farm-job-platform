'use strict';
const express = require('express');
const db      = require('../db');

const router = express.Router();

function newMsgId() {
    return 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

// ─── GET /api/messages?jobId=xx ───────────────────────────────
router.get('/', async (req, res) => {
    const { jobId } = req.query;
    if (!jobId) return res.status(400).json({ ok: false, error: 'jobId가 필요해요.' });

    const msgs = await db.prepare(
        'SELECT * FROM messages WHERE jobId = ? ORDER BY createdAt ASC'
    ).all(jobId);

    return res.json({ ok: true, messages: msgs });
});

// ─── POST /api/messages ───────────────────────────────────────
router.post('/', async (req, res) => {
    const { jobId, text, senderId: bodySenderId } = req.body;
    const senderId = req.headers['x-user-id'] || bodySenderId;

    if (!jobId || !senderId || !text?.trim()) {
        return res.status(400).json({ ok: false, error: 'jobId, senderId, text가 필요해요.' });
    }

    const msg = {
        id:        newMsgId(),
        jobId,
        senderId,
        text:      text.trim(),
        createdAt: new Date().toISOString(),
    };

    await db.prepare(`
        INSERT INTO messages (id, jobId, senderId, text, createdAt)
        VALUES (@id, @jobId, @senderId, @text, @createdAt)
    `).run(msg);

    console.log(`[MESSAGE] jobId=${jobId} from=${senderId} len=${text.length}`);
    return res.status(201).json({ ok: true, message: msg });
});

module.exports = router;
