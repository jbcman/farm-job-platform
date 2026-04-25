/**
 * CallButton — 전화 연결 CTA (UX_V2 핵심 컴포넌트)
 *
 * Props:
 *   phone   : string           — 전화번호 (있으면 직접 tel: 연결)
 *   jobId   : string|number    — 추적용
 *   onFallback : fn?           — phone 없을 때 호출 (기존 지원 플로우)
 *   label   : string?          — 버튼 텍스트 override
 *   variant : 'A'|'B'          — A/B 문구 테스트
 *   disabled: bool
 *   style   : object
 */
import React from 'react';
import { trackClientEvent } from '../../utils/api.js';

export default function CallButton({
  phone,
  jobId,
  onFallback,
  label,
  variant    = 'A',
  disabled   = false,
  style      = {},
}) {
  const defaultLabel = variant === 'B'
    ? '🔥 바로 연결 (전화)'
    : '📞 지금 전화하기';

  const displayLabel = label || defaultLabel;

  function handleClick(e) {
    console.log('[CALL_CLICK]', jobId);
    try { trackClientEvent('call_click', { jobId, variant, hasPhone: !!phone }); } catch (_) {}

    if (!phone) {
      e.preventDefault();
      onFallback?.();
    }
  }

  if (phone) {
    // 직접 tel: 링크 — 브라우저가 전화앱 오픈
    return (
      <a
        href={`tel:${phone.replace(/[^0-9+]/g, '')}`}
        className="btn-call"
        style={{ textDecoration: 'none', ...style }}
        onClick={handleClick}
        aria-label={`전화하기 ${phone}`}
      >
        {displayLabel}
      </a>
    );
  }

  // phone 없음 → fallback 버튼
  return (
    <button
      className="btn-call"
      style={{
        opacity: disabled ? 0.6 : 1,
        cursor:  disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
      disabled={disabled}
      onClick={handleClick}
    >
      {displayLabel}
    </button>
  );
}
