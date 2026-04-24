/**
 * BoostButton — 유료 스폰서 부스트 등록 버튼 (BOOST_CONVERSION_MODE)
 * POST /api/jobs/:id/sponsor → { ok: true }
 *
 * 전환 최적화:
 *  - "AI 점수" 언급 없음 → "추천 1순위 / 인기 공고" 문구
 *  - 긴급성 강조: FOMO + 사회적 증거
 *  - 버튼 h:58 / 강한 그라디언트 / 펄스 링
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
      setMsg('공고 정보가 없어요. 새로고침 후 다시 시도해 주세요.');
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
        setMsg(data.error || '등록에 실패했어요. 잠시 후 다시 시도해 주세요.');
        setStatus('error');
        return;
      }

      setStatus('done');
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
        padding: '16px',
        background: 'linear-gradient(135deg,#fffbeb,#fef3c7)',
        border: '2px solid #f59e0b',
        borderRadius: 16,
        textAlign: 'center',
        ...style,
      }}>
        <p style={{ margin: '0 0 4px', fontSize: 22 }}>🔥</p>
        <p style={{ margin: '0 0 3px', fontWeight: 900, fontSize: 15, color: '#92400e' }}>
          추천 1순위 등록 완료!
        </p>
        <p style={{ margin: 0, fontSize: 12, color: '#b45309', fontWeight: 600 }}>
          지금부터 {hours}시간 동안 지원자가 몰려옵니다
        </p>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', ...style }}>

      {/* 긴급성 콜아웃 */}
      {status === 'idle' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#fff7ed',
          border: '1px solid #fed7aa',
          borderRadius: 12,
          padding: '9px 13px',
          marginBottom: 10,
        }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>⚡</span>
          <div>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#c2410c' }}>
              지금 신청한 농민은 평균 2시간 안에 일손을 구합니다
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9a3412', fontWeight: 600 }}>
              현재 주변 농민들도 신청 중 — 1순위 자리는 하나뿐이에요
            </p>
          </div>
        </div>
      )}

      {/* 메인 버튼 */}
      <button
        onClick={handleBoost}
        disabled={status === 'loading'}
        style={{
          position:     'relative',
          width:        '100%',
          height:       58,
          background:   status === 'loading'
                          ? '#d97706'
                          : 'linear-gradient(135deg,#f97316 0%,#dc2626 100%)',
          color:        '#fff',
          border:       'none',
          borderRadius: 16,
          fontWeight:   900,
          fontSize:     16,
          cursor:       status === 'loading' ? 'not-allowed' : 'pointer',
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'center',
          gap:          8,
          boxShadow:    status === 'loading'
                          ? '0 4px 14px rgba(217,119,6,0.4)'
                          : '0 6px 24px rgba(220,38,38,0.45)',
          transition:   'all 0.15s',
          opacity:      status === 'loading' ? 0.8 : 1,
          letterSpacing: '-0.01em',
        }}
        onPointerDown={e => {
          if (status !== 'loading') {
            e.currentTarget.style.transform = 'scale(0.97)';
            e.currentTarget.style.boxShadow = '0 2px 10px rgba(220,38,38,0.3)';
          }
        }}
        onPointerUp={e => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 6px 24px rgba(220,38,38,0.45)';
        }}
      >
        {/* 펄스 링 */}
        {status === 'idle' && (
          <span style={{
            position: 'absolute',
            inset: -3,
            borderRadius: 19,
            border: '2.5px solid rgba(249,115,22,0.55)',
            animation: 'boostPulse 1.8s ease-in-out infinite',
            pointerEvents: 'none',
          }} />
        )}

        {status === 'loading' ? (
          <>
            <span style={{
              display: 'inline-block',
              width: 18, height: 18,
              border: '2.5px solid rgba(255,255,255,0.35)',
              borderTopColor: '#fff',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
              flexShrink: 0,
            }} />
            등록 중…
          </>
        ) : (
          <>🔥 지금 1순위로 올리기</>
        )}
      </button>

      {/* 이점 텍스트 */}
      {status === 'idle' && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 14,
          marginTop: 8,
          fontSize: 11,
          color: '#6b7280',
          fontWeight: 600,
        }}>
          <span>⭐ 추천 1순위 노출</span>
          <span>👥 지원자 3배↑</span>
          <span>⏱ {hours}시간</span>
        </div>
      )}

      {/* 에러 메시지 */}
      {status === 'error' && msg && (
        <p style={{
          margin: '8px 0 0',
          fontSize: 12,
          color: '#dc2626',
          fontWeight: 700,
          textAlign: 'center',
          background: '#fef2f2',
          padding: '8px 12px',
          borderRadius: 10,
        }}>
          ⚠️ {msg}
        </p>
      )}

      {/* 애니메이션 */}
      <style>{`
        @keyframes spin       { to { transform: rotate(360deg); } }
        @keyframes boostPulse { 0%,100% { opacity:.6; transform:scale(1); }
                                50%      { opacity:.15; transform:scale(1.06); } }
      `}</style>
    </div>
  );
}
