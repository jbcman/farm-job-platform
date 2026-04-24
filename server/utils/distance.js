'use strict';
/**
 * distance.js — Haversine 거리 계산 유틸 (서버 공용)
 *
 * haversineKm(a, b) — 객체 형식 { lat, lng } 인터페이스
 * 모든 입력은 null/undefined/NaN 방어 처리
 */

/**
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 * @returns {number|null} km 또는 null
 */
function haversineKm(a, b) {
    if (!a || !b) return null;
    const lat1 = Number(a.lat),  lng1 = Number(a.lng);
    const lat2 = Number(b.lat),  lng2 = Number(b.lng);
    if (!isFinite(lat1) || !isFinite(lng1)) return null;
    if (!isFinite(lat2) || !isFinite(lng2)) return null;

    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a2 =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    const km = R * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2));
    return isFinite(km) ? km : null;
}

module.exports = { haversineKm };
