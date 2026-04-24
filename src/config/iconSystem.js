/**
 * 농촌 일손 Icon System — SSOT
 * BRAND_SYSTEM_V1
 *
 * 이모지 아이콘은 의미론적으로만 사용합니다.
 * 장식용 사용 금지 — 항상 의미를 전달해야 합니다.
 *
 * Lucide 아이콘은 stroke-weight 일관성을 위해 size=22 기본.
 */

// ── 농업 카테고리 아이콘 (카드·배지에 사용) ─────────────────────
export const CATEGORY_ICONS = {
  '밭갈이':   '🚜',
  '로터리':   '🔄',
  '두둑':     '⛰️',
  '방제':     '💊',
  '수확 일손':'🌾',
  '예초':     '✂️',
  default:    '🌱',
};

// ── 액션 아이콘 (CTA·버튼에 사용) ───────────────────────────────
export const ACTION_ICONS = {
  urgent:  '🔥',   // 급구·마감 임박
  call:    '📞',   // 전화 연결
  sms:     '💬',   // 문자 전송
  ai:      '🤖',   // AI 추천·매칭
  map:     '🗺️',   // 지도 보기
  connect: '👉',   // 연결·이동
  add:     '➕',   // 등록·추가
  search:  '🔍',   // 검색·찾기
};

// ── 정보 아이콘 (메타데이터·라벨에 사용) ────────────────────────
export const INFO_ICONS = {
  location: '📍',
  distance: '🚜',   // 가까운 거리 체감
  time:     '⏱️',
  rating:   '⭐',
  check:    '✔',
  worker:   '👨‍🌾',
  farmer:   '🧑‍🌾',
};

// ── 상태 아이콘 ──────────────────────────────────────────────────
export const STATUS_ICONS = {
  success:  '✅',
  pending:  '⏳',
  matched:  '🔗',
  closed:   '🔒',
  new:      '🆕',
};
