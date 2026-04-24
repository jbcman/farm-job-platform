/**
 * Button — 농촌 일손 공통 버튼 컴포넌트
 * BRAND_SYSTEM_V1
 *
 * variant:
 *   'primary'  — 초록 배경, 흰 텍스트 (기본 CTA)
 *   'outline'  — 흰 배경, 초록 테두리
 *   'danger'   — 빨간 배경 (마감·급구 CTA)
 *   'ghost'    — 반투명 흰색 (헤더 위 보조 버튼)
 *
 * size:
 *   'lg'  — height 52px, text-base (기본 CTA)
 *   'md'  — height 44px, text-sm
 *   'sm'  — height 36px, text-xs
 */

import React from 'react';

const BASE =
  'w-full flex items-center justify-center gap-2 font-bold rounded-2xl ' +
  'active:scale-95 transition-all duration-100 select-none';

const VARIANTS = {
  primary: 'bg-farm-green text-white shadow-lg',
  outline: 'bg-white border-2 border-farm-green text-farm-green',
  danger:  'bg-red-600 text-white shadow-lg',
  ghost:   'bg-white/10 border border-white/25 text-white/80',
  amber:   'bg-farm-yellow text-white shadow-lg',
};

const SIZES = {
  lg: 'py-4 text-lg font-black',
  md: 'py-3 text-base font-bold',
  sm: 'py-2 text-sm font-semibold',
};

export default function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'lg',
  disabled = false,
  className = '',
  style = {},
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={[
        BASE,
        VARIANTS[variant] ?? VARIANTS.primary,
        SIZES[size]       ?? SIZES.lg,
        disabled ? 'opacity-50 cursor-not-allowed' : '',
        className,
      ].join(' ')}
      style={style}
    >
      {children}
    </button>
  );
}
