/**
 * geocode.js — PHASE 23: 주소 → 좌표 변환 유틸
 *
 * 현재: 미구현 stub (좌표는 클라이언트 GPS로 직접 수집)
 * 향후: 카카오 Local API / 행정안전부 주소 API 연동 예정
 *
 * 실패 시 항상 [GEOCODE_NO_RESULT] 경고 출력 → 콘솔에서 즉시 확인 가능
 */

/**
 * 주소 문자열 → { lat, lng } 변환
 * @param {string} address - 예: "경기 화성시 서신면"
 * @returns {Promise<{lat: number, lng: number}|null>}
 */
export async function geocodeAddress(address) {
  if (!address || !address.trim()) {
    console.warn('[GEOCODE_NO_RESULT] 주소가 비어있음');
    return null;
  }

  let point = null;

  try {
    // TODO: 카카오 Geocoding API 예시
    // const apiKey = import.meta.env.VITE_KAKAO_REST_KEY;
    // if (apiKey) {
    //   const res = await fetch(
    //     `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`,
    //     { headers: { Authorization: `KakaoAK ${apiKey}` } }
    //   );
    //   const data = await res.json();
    //   const doc  = data.documents?.[0];
    //   if (doc) point = { lat: parseFloat(doc.y), lng: parseFloat(doc.x) };
    // }

    // 현재 미구현 → null 반환
    point = null;

  } catch (e) {
    console.error('[GEOCODE_ERROR]', address, e.message);
    return null;
  }

  if (!point) {
    console.warn('[GEOCODE_NO_RESULT]', address,
      '→ 지도 마커 표시 불가. GPS를 사용하거나 주소 API를 연동하세요.');
  } else {
    console.log('[GEOCODE_OK]', address, point);
  }

  return point;
}

/**
 * 시/도 키워드 → 대략적 좌표 (완전 fallback)
 * geocodeAddress 실패 시 사용 — 지도 범위는 맞추되 정확도 낮음
 */
const REGION_FALLBACK = {
  '서울': { lat: 37.5665, lng: 126.9780 },
  '경기': { lat: 37.4138, lng: 127.5183 },
  '인천': { lat: 37.4563, lng: 126.7052 },
  '충남': { lat: 36.5184, lng: 126.8000 },
  '충북': { lat: 36.6357, lng: 127.4913 },
  '전남': { lat: 34.8679, lng: 126.9910 },
  '전북': { lat: 35.7175, lng: 127.1530 },
  '경남': { lat: 35.4606, lng: 128.2132 },
  '경북': { lat: 36.4919, lng: 128.8889 },
  '강원': { lat: 37.8228, lng: 128.1555 },
  '제주': { lat: 33.4996, lng: 126.5312 },
  '부산': { lat: 35.1796, lng: 129.0756 },
  '대구': { lat: 35.8714, lng: 128.6014 },
  '광주': { lat: 35.1595, lng: 126.8526 },
  '대전': { lat: 36.3504, lng: 127.3845 },
  '울산': { lat: 35.5384, lng: 129.3114 },
  '세종': { lat: 36.4800, lng: 127.2890 },
};

export function getFallbackCoord(locationText) {
  if (!locationText) return null;
  const token = locationText.trim().split(/\s+/)[0] || '';
  const match = Object.keys(REGION_FALLBACK).find(k => token.startsWith(k));
  if (match) {
    console.log('[GEOCODE_FALLBACK]', locationText, '→', match, REGION_FALLBACK[match]);
    return REGION_FALLBACK[match];
  }
  console.warn('[GEOCODE_FALLBACK_FAIL]', locationText, '→ 지역 키워드 없음');
  return null;
}
