'use strict';
/**
 * ws.js — WebSocket 서버 (PHASE_COMPLETE_SETTLEMENT_WS_V1)
 *
 * initWS(httpServer)   — http.Server에 WS 붙이기
 * global.broadcast(obj) — 모든 연결 클라이언트에게 JSON 브로드캐스트
 *
 * 이벤트 타입:
 *   { type: 'job_completed',   jobId, payAmount, completedAt }
 *   { type: 'job_rescheduled', jobId, scheduledAt }
 *   { type: 'job_matched',     jobId, workerId }
 *   { type: 'ping' }           — 30s keepalive
 */
const WebSocket = require('ws');

function initWS(httpServer) {
    const wss = new WebSocket.Server({ server: httpServer });

    // ── 전역 broadcast ─────────────────────────────────────────────
    global.broadcast = (data) => {
        const msg = JSON.stringify(data);
        let sent = 0;
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(msg);
                sent++;
            }
        });
        if (data.type !== 'ping') {
            console.log(`[WS_BROADCAST] type=${data.type} clients=${sent}`);
        }
    };

    // ── 연결 이벤트 ────────────────────────────────────────────────
    wss.on('connection', (ws, req) => {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?';
        console.log(`[WS_CONNECT] ip=${ip} total=${wss.clients.size}`);

        // 첫 연결 시 현재 연결 수 전송
        ws.send(JSON.stringify({ type: 'connected', clients: wss.clients.size }));

        ws.on('close', () => {
            console.log(`[WS_DISCONNECT] total=${wss.clients.size}`);
        });

        ws.on('error', (err) => {
            console.error('[WS_ERROR]', err.message);
        });
    });

    // ── 30초 Keepalive Ping ─────────────────────────────────────────
    setInterval(() => {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'ping' }));
            }
        });
    }, 30_000);

    console.log('[WS] WebSocket 서버 초기화 완료 (HTTP 서버에 연결됨)');
    return wss;
}

module.exports = { initWS };
