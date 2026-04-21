'use strict';
/**
 * matchingService.js — 관심 분야 + GPS 기반 알림 대상 매칭
 *
 * 매칭 우선순위:
 *   1) GPS 모두 존재 → Haversine 거리 ≤ MAX_RADIUS_KM
 *   2) GPS 일부 없음 → locationText 텍스트 매칭 (폴백)
 *
 * 규칙:
 *   - jobType(category) 일치 필수
 *   - notifyEnabled = 1 인 사용자만
 *   - 전체 브로드캐스트 절대 금지
 */
const db = require('../db');
const { getDistanceKm, isWithinRadius, hasGps, DEFAULT_RADIUS_KM } = require('./distanceService');

const MAX_RADIUS_KM = DEFAULT_RADIUS_KM; // 5km

// ─── 지역 텍스트 정규화 ───────────────────────────────────────────
function normalizeLocation(text) {
    if (!text || typeof text !== 'string') return [];
    return text
        .replace(/도$/, '').replace(/특별시$/, '').replace(/광역시$/, '')
        .split(/\s+/).map(s => s.trim()).filter(Boolean);
}

function isSameOrNearbyLocation(a, b) {
    const tokA = normalizeLocation(a);
    const tokB = normalizeLocation(b);
    if (tokA.length === 0 || tokB.length === 0) return false;
    if (tokA[0] === tokB[0]) return true;
    const setB = new Set(tokB);
    return tokA.slice(1).some(t => t.length >= 2 && setB.has(t));
}

function isSameLocation(a, b) {
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a) || isSameOrNearbyLocation(a, b);
}

// ─── STEP 4: GPS 우선, locationText 폴백 ─────────────────────────
/**
 * user(작업자)와 job이 가까운지 판단
 * - GPS 양쪽 모두 있으면: Haversine ≤ 5km
 * - GPS 없으면: locationText 폴백
 */
function isNearby(user, job) {
    // job GPS: lat/lng 또는 latitude/longitude 모두 지원
    const jobLat = job.lat ?? job.latitude ?? null;
    const jobLng = job.lng ?? job.longitude ?? null;

    if (hasGps(user) && jobLat != null && jobLng != null) {
        const dist = getDistanceKm(user.lat, user.lng, jobLat, jobLng);
        console.log(`[MATCH_GPS] ${user.name || '?'} ↔ job=${job.id||job.category} dist=${dist.toFixed(2)}km`);
        return dist <= MAX_RADIUS_KM;
    }

    // STEP 7 CASE 3: GPS 없으면 locationText 폴백
    const userLoc = user.locationText || '';
    const jobLoc  = job.locationText  || '';
    if (userLoc && jobLoc) {
        return isSameOrNearbyLocation(userLoc, jobLoc);
    }
    return false;
}

// ─── 농민이 일 등록 시: 알림 대상 작업자 찾기 ───────────────────────
/**
 * @param {{ id, category, locationText, lat?, lng?, latitude?, longitude? }} job
 * @returns {{ id, name, phone, jobType, locationText, lat, lng }[]}
 */
function findMatchingWorkers(job) {
    if (!job.category) return [];

    const candidates = db.prepare(`
        SELECT id, name, phone, jobType, locationText, lat, lng
        FROM users
        WHERE role = 'worker'
          AND notifyEnabled = 1
          AND phone IS NOT NULL
          AND phone != ''
    `).all();

    const matched = candidates.filter(u => {
        if (!u.jobType)           return false; // 관심 분야 미설정 → 제외
        if (u.jobType !== job.category) return false;
        return isNearby(u, job);
    });

    const jobLat = job.lat ?? job.latitude;
    const jobLng = job.lng ?? job.longitude;
    const gpsMode = (jobLat != null) ? 'GPS' : 'TEXT';
    console.log(`[MATCH] category=${job.category} mode=${gpsMode} loc=${job.locationText||''} => ${matched.length}/${candidates.length}명 매칭`);
    return matched;
}

// ─── 작업자 관심 등록 시: 관련 열린 일 찾기 ─────────────────────────
/**
 * @param {{ jobType, locationText, lat?, lng? }} workerProfile
 * @returns {object[]}
 */
function findMatchingFarmers(workerProfile) {
    if (!workerProfile.jobType) return [];

    const openJobs = db.prepare(
        'SELECT * FROM jobs WHERE status = ? AND category = ?'
    ).all('open', workerProfile.jobType);

    return openJobs.filter(j => isNearby(workerProfile, j));
}

module.exports = {
    normalizeLocation,
    isSameOrNearbyLocation,
    isSameLocation,
    isNearby,
    findMatchingWorkers,
    findMatchingFarmers,
    MAX_RADIUS_KM,
};
