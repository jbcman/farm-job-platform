'use strict';
/**
 * distanceService.js — Haversine 거리 계산 유틸
 *
 * matchingEngine.js의 distanceKm 재사용 + 편의 함수 추가
 */
const { distanceKm: _haversine } = require('./matchingEngine');

const DEFAULT_RADIUS_KM = 5; // 기본 알림 반경

/**
 * 두 좌표 사이 거리 (km)
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number}
 */
function getDistanceKm(lat1, lng1, lat2, lng2) {
    return _haversine(lat1, lng1, lat2, lng2);
}

/**
 * 두 점이 반경 내에 있는지 확인
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @param {number} [radiusKm]
 */
function isWithinRadius(lat1, lng1, lat2, lng2, radiusKm = DEFAULT_RADIUS_KM) {
    if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return false;
    return getDistanceKm(lat1, lng1, lat2, lng2) <= radiusKm;
}

/**
 * user / job 객체에서 GPS 유효성 확인
 */
function hasGps(obj) {
    return obj && obj.lat != null && obj.lng != null &&
           !isNaN(obj.lat) && !isNaN(obj.lng);
}

module.exports = { getDistanceKm, isWithinRadius, hasGps, DEFAULT_RADIUS_KM };
