'use strict';
/**
 * testLog.js — 실사용 테스트 이벤트 수집 API
 * STEP 2 (REAL_USER_TEST_AND_BUG_PRIORITY_LOOP)
 *
 * POST /api/test-log   — 이벤트 기록
 * GET  /api/test-log   — 최근 50건 (빠른 확인용)
 */
const express       = require('express');
const db            = require('../db');
const { classifyBug } = require('../services/bugClassifier');

const router = express.Router();

// ── POST /api/test-log — 이벤트 기록 ─────────────────────────────
// fire-and-forget: DB 장애와 무관하게 클라이언트는 항상 ok: true
router.post('/', async (req, res) => {
    const { type, payload = {}, sessionId = '' } = req.body || {};
    if (!type) return res.status(400).json({ ok: false, error: 'type 필요' });

    const priority = classifyBug(type);

    try {
        const payloadStr = JSON.stringify(payload);
        await db.prepare(`
            INSERT INTO test_logs (type, payload, priority, sessionId, createdAt)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(type, payloadStr, priority, String(sessionId || ''));

        // Priority 1 오류는 콘솔에 즉시 경고
        if (priority === 1) {
            console.warn(`[TEST_BUG_P1] type=${type} payload=${payloadStr}`);
        } else if (priority === 2) {
            console.log(`[TEST_BUG_P2] type=${type}`);
        }
    } catch (e) {
        // INSERT 실패는 로그만 — 서비스 영향 0
        console.error('[TEST_LOG]', e.message);
    }

    // INSERT 성공/실패 무관하게 항상 성공 응답
    return res.json({ ok: true, priority });
});

// ── GET /api/test-log — 빠른 확인용 (최근 50건) ──────────────────
router.get('/', async (req, res) => {
    try {
        const rows = await db.prepare(`
            SELECT id, type, payload, priority, sessionId, createdAt
            FROM test_logs
            ORDER BY id DESC
            LIMIT 50
        `).all();
        return res.json({ ok: true, logs: rows.map(r => ({
            ...r,
            payload: safeJson(r.payload),
        }))});
    } catch (e) {
        return res.json({ ok: false, logs: [], error: e.message });
    }
});

function safeJson(str) {
    try { return JSON.parse(str); } catch (_) { return {}; }
}

module.exports = router;
