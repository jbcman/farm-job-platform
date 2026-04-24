/**
 * BoostButton — 유료 스폰서 부스트 등록 버튼
 *
 * 농민(게시자)이 자신의 공고를 지도 상단 노출 / AI 점수 +50 으로 올릴 수 있는 UI.
 * POST /api/jobs/:id/sponsor → { ok: true }
 *
 * Props:
 *   jobId       : string | number  — 공고 ID (필수)
 *   requesterId : string           — 게시자 userId (필수)
 *   hours?      : number           — 노출 시간 (기본 24h)
 *   onSuccess?  : () => void       — 성공 콜백
 *   style?      : object
 */
import React, { useState } from 'react';
import { trackClientEvent } from '../utils/api.js';

const API_BASE = import.meta.env?.VITE_API_URL || '';

export default function BoostButton({
  jobId,
  requesterId,
  hours      = 24,
  onSuccess  = null,
  style      = {},
}) {
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [msg,    setMsg]    = useState('');

  async function handleBoost() {
    if (!jobId || !requesterId) {
      setMsg('공고 ID 또는 사용자 정보가 없어요.');
      setStatus('error');
      return;
    }
    setStatus('loading');
    setMsg('');

    try {
      trackClientEvent('sponsor_registered_click', { jobId });

      const res  = await fetch(`${API_BASE}/api/jobs/${jobId}/sponsor`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ requesterId, type: 'sponsored', hours, boost: 20 }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setMsg(data.error || '등록에 실패했어요. 다시 시도해 주세요.');
        setStatus('error');
        return;
      }

      setStatus('done');
      setMsg(`✅ ${hours}시간 지도 상단 노출이 시작됐어요!`);
      onSuccess?.();
    } catch (e) {
      console.error('[BoostButton] error', e);
      setMsg('네트워크 오류가 발생했어요.');
      setStatus('error');
    }
  }

  // ── 완료 상태 ──────────────────────────────────────────────────
  if (status === 'done') {
    return (
      <div style={{
        width: '100%',
        padding: '13px 16px',
        background: '#fffbeb',
        border: '1.5px solid #fbbf24',
        borderRadius: 14,
        textAlign: 'center',
        fontWeight: 800,
        fontSize: 14,
        color: '#92400e',
        ...style,
      }}>
        {msg}
      </div>
    );
  }

  return (
    <div style={{ width: '100%', ...style }}>
      <button
        onClick={handleBoost}
        disabled={status === 'loading'}
        style={{
          width:        '100%',
          height:       50,
          background:   status === 'loading'
                          ? '#d97706'
                          : 'linear-gradient(135deg,#f59e0b,#d97706)',
          color:        '#fff',
          border:       'none',
          borderRadius: 14,
          fontWeight:   900,
          fontSize:     15,
          cursor:       status === 'loading' ? 'not-allowed' : 'pointer',
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'center',
          gap:          8,
          boxShadow:    '0 4px 14px rgba(217,119,6,0.45)',
          transition:   'opacity 0.15s',
          opacity:      status === 'loading' ? 0.75 : 1,
        }}
        onPointerDown={e => { if (status !== 'loading') e.currentTarget.style.opacity = '0.82'; }}
        onPointerUp={e   => { e.currentTarget.style.opacity = '1'; }}
      >
        {status === 'loading' ? (
          <>
            <span style={{
              display: 'inline-block',
              width:   16, height: 16,
              border:  '2px solid rgba(255,255,255,0.4)',
              borderTopColor: '#fff',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }} />
            등록 중…
          </>
        ) : (
          <>⭐ 지도 상단 노출 ({hours}시간)</>
        )}
      </button>

      {/* 에러 메시지 */}
      {status === 'error' && msg && (
        <p style={{
          margin: '6px 0 0',
          fontSize: 12,
          color: '#dc2626',
          fontWeight: 700,
          textAlign: 'center',
        }}>
          ⚠️ {msg}
        </p>
      )}

      {/* 설명 텍스트 */}
      {status === 'idle' && (
        <p style={{
          margin: '6px 0 0',
          fontSize: 11,
          color: '#9ca3af',
          textAlign: 'center',
        }}>
          AI 추천 점수 +50 · 지도 마커 ⭐ · {hours}시간 상단 노출
        </p>
      )}

      {/* 스핀 애니메이션 키프레임 (inline style tag) */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
