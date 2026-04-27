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

// ── DB 초기화: test_logs 테이블 ───────────────────────────────────
try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS test_logs (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            type       TEXT    NOT NULL,
            payload    TEXT    DEFAULT '{}',
            priority   INTEGER DEFAULT 3,
            sessionId  TEXT    DEFAULT '',
            createdAt  TEXT    DEFAULT (datetime('now'))
        )
    `);
    // 30일 이전 로그 자동 정리 (스타트업 시 1회)
    db.exec(`DELETE FROM test_logs WHERE createdAt < datetime('now', '-30 days')`);
} catch (e) {
    console.error('[TEST_LOG_INIT]', e.message);
}

// ── POST /api/test-log — 이벤트 기록 ─────────────────────────────
router.post('/', (req, res) => {
    try {
        const { type, payload = {}, sessionId = '', ts } = req.body || {};
        if (!type) return res.status(400).json({ ok: false, error: 'type 필요' });

        const priority = classifyBug(type);
        const payloadStr = JSON.stringify(payload);

        db.prepare(`
            INSERT INTO test_logs (type, payload, priority, sessionId, createdAt)
            VALUES (?, ?, ?, ?, datetime('now'))
        `).run(type, payloadStr, priority, String(sessionId || ''));

        // Priority 1 오류는 콘솔에 즉시 경고
        if (priority === 1) {
            console.warn(`[TEST_BUG_P1] type=${type} payload=${payloadStr}`);
        } else if (priority === 2) {
            console.log(`[TEST_BUG_P2] type=${type}`);
        }

        return res.json({ ok: true, priority });
    } catch (e) {
        // fire-and-forget이므로 클라이언트 오류 노출 최소화
        console.error('[TEST_LOG_POST_ERROR]', e.message);
        return res.status(500).json({ ok: false });
    }
});

// ── GET /api/test-log — 빠른 확인용 (최근 50건) ──────────────────
router.get('/', (req, res) => {
    try {
        const rows = db.prepare(`
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
        return res.status(500).json({ ok: false, error: e.message });
    }
});

function safeJson(str) {
    try { return JSON.parse(str); } catch (_) { return {}; }
}

module.exports = router;
