/**
 * mapConfig.js — 농민 일손 플랫폼 지도 설정 (VWorld 기반)
 *
 * 관제 시스템(SACRED_BASELINE)과 동일한 VWorld WMTS 타일 사용
 * 단, 이 파일은 일손 플랫폼 전용이며 독립 운용
 */

// ─── VWorld API KEY ────────────────────────────────────────────
// 환경변수 우선, 미설정 시 기본 공개 키 fallback
const VWORLD_KEY = import.meta.env?.VITE_VWORLD_KEY || '40875C91-3F61-31B1-869E-6AFE1364138B';

// ─── VWorld WMTS 타일 서비스 URL ────────────────────────────────
// 주의: Leaflet에 넘기기 전 {key}를 실제 키로 치환
const VWORLD_TILE_URL_BASE      = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Base/{z}/{y}/{x}.png`;
const VWORLD_TILE_URL_SATELLITE = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Satellite/{z}/{y}/{x}.jpeg`;
const VWORLD_TILE_URL_HYBRID    = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Hybrid/{z}/{y}/{x}.png`;

export const MAP_CONFIG = {
    TILE_URL:    VWORLD_TILE_URL_BASE,
    TILE_URL_SATELLITE: VWORLD_TILE_URL_SATELLITE,
    TILE_URL_HYBRID:    VWORLD_TILE_URL_HYBRID,
    ATTRIBUTION: '&copy; <a href="http://www.vworld.kr/">V-World</a> | Leaflet',

    // 한국 중심 기본값 (좌표 없을 때 fallback)
    DEFAULT_CENTER: [36.5, 127.5],
    DEFAULT_ZOOM:   10,

    // 내 위치 기준
    MY_ZOOM:        13,

    // 줌 제한
    MIN_ZOOM:       6,
    MAX_ZOOM:       18,

    KEY: VWORLD_KEY,
};

/** 유효한 좌표인지 검사 (NaN, Infinity, 범위 모두 체크) */
export function isValidLatLng(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat < -90  || lat > 90)  return false;
    if (lng < -180 || lng > 180) return false;
    return true;
}

console.log('[MAP CONFIG] Farm platform map source: VWorld (unified)');
