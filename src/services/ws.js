/**
 * ws.js — 프론트엔드 WebSocket 클라이언트 (REALTIME_ROOM_V2)
 *
 * connectWS(onMessage) → handle
 *   - 자동 재연결 (5초 간격, 최대 10회)
 *   - ping / connected 필터
 *   - 연결 실패 시 silent fail (서비스 무중단)
 *
 * handle.joinJob(jobId)  — 특정 jobId 룸 구독
 * handle.leaveJob(jobId) — 구독 해제
 * handle.close()         — 완전 종료
 */

const WS_MAX_RETRY = 10;
const WS_RETRY_MS  = 5000;

/**
 * @param {function} onMessage — (data: object) => void
 * @returns {{ joinJob, leaveJob, close }}
 */
export function connectWS(onMessage) {
  let ws        = null;
  let retries   = 0;
  let closed    = false;
  const _joined = new Set(); // 현재 구독 중인 jobIds

  function _send(obj) {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
      }
    } catch (_) {}
  }

  function connect() {
    if (closed) return;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}`);

      ws.onopen = () => {
        retries = 0;
        console.log('[WS] 연결됨');
        // 재연결 시 이전 구독 복원
        _joined.forEach(jobId => _send({ type: 'join', jobId }));
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'ping' || data.type === 'connected') return;
          onMessage && onMessage(data);
        } catch (_) {}
      };

      ws.onclose = () => {
        if (closed) return;
        retries++;
        if (retries <= WS_MAX_RETRY) {
          console.log(`[WS] 재연결 시도 ${retries}/${WS_MAX_RETRY} (${WS_RETRY_MS / 1000}s 후)`);
          setTimeout(connect, WS_RETRY_MS);
        } else {
          console.warn('[WS] 재연결 한도 초과 — 실시간 비활성');
        }
      };

      ws.onerror = () => {};
    } catch (err) {
      console.warn('[WS] 연결 불가:', err.message);
    }
  }

  connect();

  return {
    /** jobId 룸 구독 */
    joinJob(jobId) {
      if (!jobId || _joined.has(jobId)) return;
      _joined.add(jobId);
      _send({ type: 'join', jobId });
    },
    /** jobId 룸 구독 해제 */
    leaveJob(jobId) {
      if (!jobId) return;
      _joined.delete(jobId);
      _send({ type: 'leave', jobId });
    },
    /** 완전 종료 */
    close() {
      closed = true;
      try { ws?.close(); } catch (_) {}
    },
  };
}
