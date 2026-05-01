'use strict';
/**
 * ws.js — WebSocket 서버 (REALTIME_ROOM_V2)
 *
 * initWS(httpServer)         — http.Server에 WS 붙이기
 * global.broadcast(obj)      — 모든 연결 클라이언트에게 JSON 브로드캐스트 (하위호환)
 * global.emitToJob(jobId, obj) — 특정 jobId 구독 클라이언트에게만 전송
 *
 * 클라이언트 → 서버 메시지:
 *   { type: 'join', jobId }   — jobId 룸 구독
 *   { type: 'leave', jobId }  — jobId 룸 구독 해제
 *
 * 서버 → 클라이언트 이벤트:
 *   { type: 'connected',   clients }
 *   { type: 'job_update',  job }            — 상태 변경 시 룸에 전송
 *   { type: 'job_completed', jobId, ... }   — 레거시 하위호환
 *   { type: 'job_matched',  jobId, ... }    — 레거시 하위호환
 *   { type: 'ping' }                        — 30s keepalive
 */
const WebSocket = require('ws');
const { setConnections, getSnapshot } = require('./services/metricsService');

// ── 룸 관리 ───────────────────────────────────────────────────────
// Map<jobId, Set<ws>>
const _rooms = new Map();

function _joinRoom(ws, jobId) {
    if (!jobId) return;
    if (!_rooms.has(jobId)) _rooms.set(jobId, new Set());
    _rooms.get(jobId).add(ws);
}

function _leaveRoom(ws, jobId) {
    if (!jobId || !_rooms.has(jobId)) return;
    _rooms.get(jobId).delete(ws);
    if (_rooms.get(jobId).size === 0) _rooms.delete(jobId);
}

function _leaveAllRooms(ws) {
    _rooms.forEach((clients, jobId) => {
        clients.delete(ws);
        if (clients.size === 0) _rooms.delete(jobId);
    });
}

function initWS(httpServer) {
    const wss = new WebSocket.Server({ server: httpServer });

    // ── 전역 broadcast (하위호환) ────────────��─────────────────────
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

    // ── 룸 기반 emit (REALTIME_ROOM_V2) ───────────────────────────
    global.emitToJob = (jobId, data) => {
        const room = _rooms.get(jobId);
        if (!room || room.size === 0) {
            // 룸 구독자 없을 시 전체 broadcast 로 폴백 (상태 동기화 보장)
            global.broadcast(data);
            return;
        }
        const msg = JSON.stringify(data);
        let sent = 0;
        room.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(msg);
                sent++;
            }
        });
        console.log(`[WS_ROOM] type=${data.type} jobId=${jobId} roomClients=${sent}`);
    };

    // ── 연결 이벤트 ───────────────────────���────────────────────────
    wss.on('connection', (ws, req) => {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?';
        console.log(`[WS_CONNECT] ip=${ip} total=${wss.clients.size}`);
        setConnections(wss.clients.size);

        ws.send(JSON.stringify({ type: 'connected', clients: wss.clients.size }));

        // 클라이언트 → 서버 메시지 처리 (join/leave)
        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'join' && msg.jobId) {
                    _joinRoom(ws, msg.jobId);
                    console.log(`[WS_JOIN] jobId=${msg.jobId} total=${_rooms.get(msg.jobId)?.size}`);
                } else if (msg.type === 'leave' && msg.jobId) {
                    _leaveRoom(ws, msg.jobId);
                }
            } catch (_) {}
        });

        ws.on('close', () => {
            _leaveAllRooms(ws);
            console.log(`[WS_DISCONNECT] total=${wss.clients.size}`);
            setConnections(wss.clients.size);
        });

        ws.on('error', (err) => {
            console.error('[WS_ERROR]', err.message);
        });
    });

    // ── 30초 Keepalive Ping ───────────────────────────────────────
    setInterval(() => {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'ping' }));
            }
        });
    }, 30_000);

    // ── 3초 실시간 메트릭스 브로드캐스트 ─────────────────────────
    // Admin 대시보드가 구독하면 실시간으로 받음
    // 접속자가 없으면 스킵 (CPU/대역폭 절약)
    setInterval(() => {
        if (wss.clients.size === 0) return;
        try {
            const snapshot = getSnapshot();
            const msg = JSON.stringify({ type: 'metrics', data: snapshot });
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) client.send(msg);
            });
        } catch (_) {}
    }, 3_000);

    console.log('[WS] WebSocket 서버 초기화 완료 (룸 지원 REALTIME_ROOM_V2)');
    return wss;
}

module.exports = { initWS };
