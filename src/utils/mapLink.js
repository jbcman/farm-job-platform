/**
 * mapLink.js — 지도/길찾기 링크 유틸
 *
 * getMapPageUrl    — 내부 MapPage URL (/map?...)
 * getKakaoNaviLink — 카카오맵 길찾기 URL (외부 앱)
 */

/**
 * getMapPageUrl
 * @param {object} job  — { id, latitude, longitude, category, locationText, distKm, driveMin }
 * @returns {string|null}
 */
export function getMapPageUrl(job) {
  if (!job) return null;

  // Number() 캐스팅 — string으로 들어와도 방어
  const lat = Number(job.latitude);
  const lng = Number(job.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const p = new URLSearchParams({
    lat:   lat.toString(),
    lng:   lng.toString(),
    title: job.title || job.category || job.locationText || '작업 위치',
    jobId: job.id || '',
  });

  // 이동시간: driveMin(Kakao 실제) 우선, distKm 추정 폴백
  if (Number.isFinite(job.driveMin) && job.driveMin > 0) {
    p.set('driveMin', String(job.driveMin));
  } else if (Number.isFinite(job.distKm) && job.distKm > 0) {
    p.set('driveMin', String(Math.max(1, Math.round((job.distKm / 30) * 60))));
  }

  return `/map?${p.toString()}`;
}

/**
 * getKakaoNaviLink
 * @param {object} job  — { latitude, longitude, category, locationText }
 * @returns {string|null}
 */
export function getKakaoNaviLink(job) {
  if (!job) return null;
  const lat = Number(job.latitude);
  const lng = Number(job.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const label = encodeURIComponent(job.category || job.locationText || '작업지');
  return `https://map.kakao.com/link/to/${label},${lat},${lng}`;
}
