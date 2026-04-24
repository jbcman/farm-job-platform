/**
 * KakaoButton — 카카오 채널 상담톡 버튼
 *
 * VITE_KAKAO_CHANNEL 환경변수로 채널 URL 주입
 * 미설정 시 안내 메시지 노출
 *
 * Props:
 *   jobId?   : string  — 추적용 (optional)
 *   label?   : string  — 버튼 텍스트 override
 *   compact? : boolean — 소형 모드 (아이콘+텍스트만)
 *   style?   : object  — 추가 스타일
 */
import React from 'react';
import { trackClientEvent } from '../utils/api.js';

const KAKAO_CH = import.meta.env.VITE_KAKAO_CHANNEL || '';

export default function KakaoButton({
  jobId   = null,
  label   = '💬 카카오톡으로 문의',
  compact = false,
  style   = {},
}) {
  function handleClick() {
    // 이벤트 추적
    try {
      trackClientEvent('kakao_chat_click', { jobId });
    } catch (_) {}

    if (!KAKAO_CH) {
      alert('카카오 채널 URL이 설정되지 않았습니다.\n.env 파일의 VITE_KAKAO_CHANNEL을 확인하세요.');
      return;
    }
    window.open(KAKAO_CH, '_blank', 'noopener,noreferrer');
  }

  if (compact) {
    return (
      <button
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          padding: '8px 14px',
          background: '#FEE500',
          border: 'none',
          borderRadius: 10,
          fontWeight: 800,
          fontSize: 13,
          color: '#1a1a1a',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(254,229,0,0.5)',
          ...style,
        }}
      >
        <KakaoIcon size={16} />
        카카오 문의
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      style={{
        width: '100%',
        height: 50,
        background: '#FEE500',
        border: 'none',
        borderRadius: 14,
        fontWeight: 900,
        fontSize: 16,
        color: '#1a1a1a',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        boxShadow: '0 4px 14px rgba(254,229,0,0.45)',
        transition: 'transform 0.1s',
        ...style,
      }}
      onPointerDown={e => e.currentTarget.style.transform = 'scale(0.97)'}
      onPointerUp={e => e.currentTarget.style.transform = 'scale(1)'}
    >
      <KakaoIcon size={22} />
      {label}
    </button>
  );
}

/** 카카오 말풍선 아이콘 (SVG inline) */
function KakaoIcon({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="#1a1a1a"
      aria-hidden="true"
    >
      <path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.7 1.6 5.08 4 6.52L5 21l4.3-2.86C10.16 18.37 11.07 18.5 12 18.5c5.523 0 10-3.477 10-7.7C22 6.477 17.523 3 12 3z" />
    </svg>
  );
}
