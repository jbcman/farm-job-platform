/**
 * formatDistance.js — 거리 표시 문자열 생성
 *
 * 우선순위:
 *   1. job.distLabel (서버 계산값) — 가장 신뢰
 *   2. job.distKm    (서버 계산값 raw)
 *   3. userLocation 기반 클라이언트 계산 (서버값 없을 때 폴백)
 *   4. 좌표 없음     → "📍 거리 확인 필요"
 *   5. 위치 미설정   → "📍 위치 설정 필요"
 */

import { getDistanceKm } from './distance';

/**
 * formatDistance
 * @param {object} job           — job 객체 (distLabel, distKm, latitude, longitude)
 * @param {object} [userLocation] — { lat: number, lng: number } | null
 * @returns {string|null}  거리 문자열 또는 null (표시 불필요 시)
 */
export function formatDistance(job, userLocation) {
  // ① 서버가 이미 계산한 distLabel (NaN/undefined 방어)
  if (job?.distLabel && !job.distLabel.includes('NaN')) {
    return job.distLabel;
  }

  // ② 서버 distKm (숫자 검증)
  const serverKm = job?.distKm ?? null;
  if (serverKm != null && Number.isFinite(serverKm)) {
    return serverKm < 1 ? '1km 이내' : `${serverKm.toFixed(1)}km`;
  }

  // ③ 클라이언트 좌표 기반 계산 (서버값 없을 때)
  const jobLat = job?.latitude;
  const jobLng = job?.longitude;

  if (!Number.isFinite(jobLat) || !Number.isFinite(jobLng)) {
    // 작업 좌표 없음
    return '📍 거리 확인 필요';
  }

  if (!userLocation?.lat || !userLocation?.lng) {
    // 사용자 위치 미설정 (좌표는 있지만 비교 불가)
    return '📍 위치 설정 필요';
  }

  const km = getDistanceKm(userLocation.lat, userLocation.lng, jobLat, jobLng);
  if (km == null) return '📍 거리 확인 필요';
  return km < 1 ? '1km 이내' : `${km.toFixed(1)}km`;
}
