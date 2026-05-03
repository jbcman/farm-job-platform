'use strict';
/**
 * adminStream.js — PHASE ADMIN_REALTIME_LOG (SSE)
 *
 * GET /api/admin/stream/sse
 *   → text/event-stream, 2초마다 새 rec_logs 행 push
 *   → 클라이언트 연결 끊기면 인터벌 정리 (메모리 누수 방지)
 */
const router = require('express').Router();
const db     = require('../db');

const POLL_MS   = 2000;
const BATCH_MAX = 50;

router.get('/sse', async (req, res) => {
    // 토큰 가드 (헤더 또는 쿼리 파라미터 — EventSource는 헤더 미지원)
    const token = req.headers['x-admin-token'] || req.query.token;
    if (process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) {
        return res.status(403).end();
    }

    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    // 연결 시점의 마지막 id 조회 (이후 데이터만 스트림)
    let lastId = 0;
    try {
        const row = await db.prepare('SELECT MAX(id) AS maxId FROM rec_logs').get();
        lastId = row?.maxId ?? 0;
    } catch (_) {}

    const timer = setInterval(async () => {
        try {
            const rows = await db.prepare(`
                SELECT * FROM rec_logs
                WHERE id > ?
                ORDER BY id ASC
                LIMIT ${BATCH_MAX}
            `).all(lastId);

            for (const r of rows) {
                lastId = r.id;
                res.write(`data: ${JSON.stringify(r)}\n\n`);
            }
        } catch (_) {}
    }, POLL_MS);

    req.on('close', () => clearInterval(timer));
});

module.exports = router;
