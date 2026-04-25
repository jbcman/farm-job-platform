/**
 * CallButton — 전화 연결 CTA (UX_V2 핵심 컴포넌트)
 *
 * Props:
 *   phone      : string           — 전화번호 (있으면 직접 tel: 연결)
 *   jobId      : string|number    — 추적용
 *   onFallback : fn?              — phone 없을 때 호출 (기존 지원 플로우)
 *   label      : string?          — 버튼 텍스트 override
 *   variant    : 'A'|'B'|null     — null이면 마운트 시 랜덤 배정
 *   disabled   : bool
 *   style      : object
 *
 * A/B 테스트:
 *   variant A → "📞 지금 전화하기"
 *   variant B → "🔥 바로 연결 (전화)"
 *   variant 미지정(null) → Math.random() < 0.5 으로 자동 배정 (마운트 시 고정)
 */
import React, { useRef, useEffect } from 'react';
import { trackClientEvent } from '../../utils/api.js';
import { logCall, logVariant } from '../../utils/conversionTracker.js';

export default function CallButton({
  phone,
  jobId,
  onFallback,
  label,
  variant    = null,   // null → 자동 랜덤 배정
  disabled   = false,
  style      = {},
}) {
  // ── A/B variant: prop 없으면 마운트 시 랜덤 고정 (re-render 불변) ──
  const variantRef    = useRef(variant || (Math.random() < 0.5 ? 'A' : 'B'));
  const activeVariant = variantRef.current;

  // ── 마운트 시 variant 배정 로그 (1회) ──
  useEffect(() => {
    logVariant(jobId, activeVariant);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 버튼 텍스트 ──
  const defaultLabel = activeVariant === 'B'
    ? '🔥 바로 연결 (전화)'
    : '📞 지금 전화하기';

  const displayLabel = label || defaultLabel;

  // ── 클릭 핸들러 ──
  function handleClick(e) {
    logCall(jobId, activeVariant);
    try { trackClientEvent('call_click', { jobId, variant: activeVariant, hasPhone: !!phone }); } catch (_) {}

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
