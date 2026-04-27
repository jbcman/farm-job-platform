/**
 * distance.js — Haversine 거리 계산
 * 모든 좌표는 null/undefined/NaN 방어 처리됨
 */

/**
 * getDistanceKm — 두 좌표 사이의 직선 거리 (km)
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number|null} km 또는 null (좌표 유효하지 않을 때)
 */
export function getDistanceKm(lat1, lng1, lat2, lng2) {
  if (
    !Number.isFinite(lat1) || !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) || !Number.isFinite(lng2)
  ) {
    return null;
  }

  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;

  const km = R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  return Number.isFinite(km) ? km : null;
}

// MAP_CORE: getDistance alias (getDistanceKm과 동일, 짧은 이름)
export const getDistance = getDistanceKm;
