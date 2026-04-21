'use strict';
/**
 * context.js — PHASE CONTEXTUAL_BANDIT
 *
 * 시간대/지역 컨텍스트 추출 유틸.
 */

/**
 * 현재 시각을 4개 시간대 버킷으로 분류.
 *   0: 야간  (00~05시)
 *   1: 오전  (06~11시)
 *   2: 오후  (12~17시)
 *   3: 저녁  (18~23시)
 */
function getTimeBucket(ts = Date.now()) {
    const h = new Date(ts).getHours();
    if (h < 6)  return 0;
    if (h < 12) return 1;
    if (h < 18) return 2;
    return 3;
}

/**
 * 위경도를 ~11km 격자(0.1° 단위)로 버킷화.
 * lat/lng 없으면 'unknown' 반환.
 */
function getRegionBucket(lat, lng) {
    if (lat == null || lng == null ||
        !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
        return 'unknown';
    }
    const rLat = (Math.round(Number(lat) * 10) / 10).toFixed(1);
    const rLng = (Math.round(Number(lng) * 10) / 10).toFixed(1);
    return `${rLat}_${rLng}`;
}

module.exports = { getTimeBucket, getRegionBucket };
