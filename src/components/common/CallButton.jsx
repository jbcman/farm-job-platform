/**
 * CallButton — 전화 연결 CTA (UX_V2 + PRIVACY_CALL)
 *
 * Props:
 *   phone      : string?          — fallback 전화번호 (토큰 실패 시 사용)
 *   jobId      : string|number    — 토큰 요청용 (있으면 서버 토큰 플로우 우선)
 *   onFallback : fn?              — phone/token 모두 없을 때
 *   label      : string?          — 버튼 텍스트 override
 *   variant    : 'A'|'B'|null
 *   disabled   : bool
 *   style      : object
 *
 * 연결 플로우 (jobId 있을 때):
 *   클릭 → POST /api/phone/request → token → GET /api/phone/resolve/:token → tel:
 *   실패 시 → phone prop fallback → onFallback()
 *
 * 스팸 방지:
 *   클라이언트: 3초 쿨다운
 *   서버:       IP 기준 분당 10회
 */
import React, { useRef, useEffect, useState } from 'react';
import { trackClientEvent } from '../../utils/api.js';
import { logCall, logVariant } from '../../utils/conversionTracker.js';
import { trackCall } from '../../utils/behaviorScore.js';

// 모듈 레벨 쿨다운 (컴포넌트 재마운트 시에도 유지)
let lastCallTime = 0;

export default function CallButton({
  phone,
  jobId,
  onFallback,
  label,
  variant    = null,
  disabled   = false,
  style      = {},
}) {
  const variantRef    = useRef(variant || (Math.random() < 0.5 ? 'A' : 'B'));
  const activeVariant = variantRef.current;
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    logVariant(jobId, activeVariant);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const defaultLabel = activeVariant === 'B' ? '🔥 바로 연결 (전화)' : '📞 지금 전화하기';
  const displayLabel = label || defaultLabel;

  async function handleClick(e) {
    e.preventDefault();

    // 3초 쿨다운
    if (Date.now() - lastCallTime < 3000) {
      alert('잠시 후 다시 시도해주세요');
      return;
    }
    lastCallTime = Date.now();

    logCall(jobId, activeVariant);
    trackCall(jobId);   // SMART_V4: 전화 행동 기록 (가중치 ×30)
    try { trackClientEvent('call_click', { jobId, variant: activeVariant, hasPhone: !!phone }); } catch (_) {}

    // jobId 있으면 토큰 플로우 우선
    if (jobId) {
      setLoading(true);
      try {
        const r1 = await fetch('/api/phone/request', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ jobId }),
        });
        if (r1.ok) {
          const { token } = await r1.json();
          const r2 = await fetch(`/api/phone/resolve/${token}`);
          if (r2.ok) {
            const { phone: resolved } = await r2.json();
            window.location.href = `tel:${resolved.replace(/[^0-9+]/g, '')}`;
            return;
          }
        }
        // 429 rate limit
        if (r1.status === 429) {
          const { error } = await r1.json().catch(() => ({ error: '잠시 후 다시 시도해주세요' }));
          alert(error);
          return;
        }
      } catch (_) {
        // 네트워크 오류 → fallback
      } finally {
        setLoading(false);
      }
    }

    // Fallback: phone prop 직접 사용
    if (phone && phone !== 'has_link') {
      window.location.href = `tel:${phone.replace(/[^0-9+]/g, '')}`;
      return;
    }

    // 최종 fallback
    onFallback?.();
  }

  const btnStyle = {
    opacity:  disabled || loading ? 0.7 : 1,
    cursor:   disabled ? 'not-allowed' : 'pointer',
    ...style,
  };

  return (
    <div style={{ width: '100%' }}>
      <button
        className="btn-call"
        style={btnStyle}
        disabled={disabled || loading}
        onClick={handleClick}
        aria-label="전화 연결"
      >
        {loading
          ? <><span style={{
              display: 'inline-block', width: 18, height: 18,
              border: '2.5px solid rgba(255,255,255,0.4)',
              borderTopColor: '#fff', borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
              marginRight: 8,
            }} />연결 중...</>
          : displayLabel
        }
      </button>
      {/* STEP 4: 신뢰 배지 */}
      <p style={{
        textAlign: 'center', fontSize: 11, color: '#9ca3af',
        marginTop: 5, marginBottom: 0,
      }}>
        🔒 번호 비공개 · 안전 연결
      </p>
      {/* spin 키프레임 */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
