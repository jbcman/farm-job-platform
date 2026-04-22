/**
 * formatDriveTime.js — 차량 이동시간 표시 문자열 생성
 *
 * 우선순위:
 *   1. job.driveMin + job.driveSource='kakao'  → "🚜 27분"      (Kakao 실제 경로)
 *   2. job.driveMin + job.driveSource='estimate' → "🚜 약 27분" (추정)
 *   3. job.distKm    — 좌표 기반 추정 (30km/h, driveMin 없을 때 폴백)
 *   4. null          — 거리/좌표 정보 없음 → 표시 안 함
 *
 * driveSource='kakao'  → 정확한 실제 경로 → 접두어 없음
 * driveSource='estimate' or 없음 → 추정값 → "약 " 접두어
 */

/**
 * formatDriveTime
 * @param {object} job — job 객체 (driveMin, driveSource, distKm)
 * @returns {string|null}
 */
export function formatDriveTime(job) {
  // ① 서버에서 내려온 driveMin (Kakao 실제 or 추정)
  const serverMin = job?.driveMin;
  if (serverMin != null && Number.isFinite(serverMin) && serverMin > 0) {
    const isReal = job?.driveSource === 'kakao';
    return _formatMin(serverMin, !isReal); // isReal이 아니면 '약' 접두어
  }

  // ② 클라이언트 추정: distKm ÷ 30km/h (영농 지역 차량 기준)
  const km = job?.distKm ?? null;
  if (km != null && Number.isFinite(km) && km > 0) {
    const estimated = Math.round((km / 30) * 60);
    return _formatMin(Math.max(1, estimated), true); // 항상 추정
  }

  return null;
}

/**
 * _formatMin
 * @param {number} min
 * @param {boolean} estimated — true이면 "약 " 접두어 추가
 */
function _formatMin(min, estimated = false) {
  const prefix = estimated ? '약 ' : '';
  if (min < 2)  return `🚜 ${prefix}1분 이내`;
  if (min < 60) return `🚜 ${prefix}${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  const time = m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  return `🚜 ${prefix}${time}`;
}
