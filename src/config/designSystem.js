/**
 * 농촌 일손 Design System — SSOT
 * BRAND_SYSTEM_V1
 *
 * 이 파일이 전체 색상·그림자의 단일 출처입니다.
 * Tailwind 클래스(farm-green 등)와 1:1 매핑됩니다.
 */

export const COLORS = {
  primary:      '#2D8A4E',   // farm-green — CTA, 헤더, 아이콘
  primaryDark:  '#1F6B3A',   // 호버/액티브 상태
  primaryLight: '#E8F5E9',   // farm-light — 배지 배경, 카테고리

  accent:  '#F59E0B',        // farm-yellow — 별점, 보조 CTA
  danger:  '#DC2626',        // 급구 배너, 마감 임박
  info:    '#2563EB',        // AI 매칭 배지, 먼 거리

  textMain: '#1F2937',
  textSub:  '#6B7280',

  bgMain: '#F7FDF9',         // farm-bg — 앱 배경
  card:   '#FFFFFF',
};

export const SHADOW = {
  card:   '0 2px 10px rgba(0,0,0,0.08)',
  button: '0 4px 14px rgba(45,138,78,0.35)',
  urgent: '0 3px 10px rgba(185,28,28,0.35)',
};

export const RADIUS = {
  card:   18,   // px — rounded-2xl(16) + 여백
  button: 14,   // px — rounded-xl(12)+
  badge:  9999, // px — rounded-full
  input:  12,   // px — rounded-xl
};

export const FONT = {
  display: "'Jalnan2', 'Noto Sans KR', sans-serif",
  body:    "'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif",
};

/** 거리(km) → 체감 배지 색상 */
export function distBadgeColor(km) {
  if (km == null) return COLORS.info;
  if (km <= 3)    return COLORS.danger;
  if (km <= 5)    return COLORS.accent;
  return COLORS.info;
}
