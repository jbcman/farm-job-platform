/**
 * ws.js — 프론트엔드 WebSocket 클라이언트
 * PHASE_COMPLETE_SETTLEMENT_WS_V1
 *
 * connectWS(onMessage) → WebSocket
 *   - 자동 재연결 (5초 간격, 최대 10회)
 *   - ping 필터 (UI 콜백 호출 안 함)
 *   - 연결 실패 시 silent fail (서비스 무중단)
 */

const WS_MAX_RETRY  = 10;
const WS_RETRY_MS   = 5000;

/**
 * @param {function} onMessage  — (data: object) => void
 * @returns {{ close: function }}  — cleanup handle
 */
export function connectWS(onMessage) {
  let ws      = null;
  let retries = 0;
  let closed  = false;

  function connect() {
    if (closed) return;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}`);

      ws.onopen = () => {
        retries = 0;
        console.log('[WS] 연결됨');
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'ping' || data.type === 'connected') return; // 무시
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

      ws.onerror = () => {
        // onclose가 이어서 호출되므로 별도 처리 불필요
      };
    } catch (err) {
      console.warn('[WS] 연결 불가:', err.message);
    }
  }

  connect();

  return {
    close() {
      closed = true;
      try { ws?.close(); } catch (_) {}
    },
  };
}
