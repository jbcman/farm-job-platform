'use strict';
/**
 * matchingService.js — 관심 분야 기반 알림 대상 매칭
 *
 * 규칙:
 *   - jobType(category) 일치 필수
 *   - locationText 동일 또는 근접 (광역시도 또는 시군구 단위)
 *   - notifyEnabled = true 인 사용자만
 *   - 전체 브로드캐스트 절대 금지
 */
const db = require('../db');

// ─── 지역 정규화 ──────────────────────────────────────────────────
/**
 * 지역 텍스트에서 핵심 단어 추출
 * "경기 화성시 서신면" → ["경기", "화성시", "서신면"]
 * "경기도 화성" → ["경기", "화성"]
 */
function normalizeLocation(text) {
    if (!text || typeof text !== 'string') return [];
    return text
        .replace(/도$/,  '')    // 경기도 → 경기
        .replace(/특별시$/, '')  // 서울특별시 → 서울
        .replace(/광역시$/, '')  // 부산광역시 → 부산
        .split(/\s+/)
        .map(s => s.trim())
        .filter(Boolean);
}

/**
 * 두 지역 텍스트가 동일하거나 근접한지 판단
 * 광역 단위(첫 토큰) 또는 시군구 단위(두 번째 토큰) 중 하나라도 일치하면 true
 */
function isSameOrNearbyLocation(a, b) {
    const tokA = normalizeLocation(a);
    const tokB = normalizeLocation(b);
    if (tokA.length === 0 || tokB.length === 0) return false;

    // 광역시도 일치
    if (tokA[0] === tokB[0]) return true;

    // 시군구 토큰 교차 확인
    const setB = new Set(tokB);
    return tokA.slice(1).some(t => t.length >= 2 && setB.has(t));
}

// ─── 농민이 일 등록 시: 알림 대상 작업자 찾기 ───────────────────────
/**
 * @param {{ category: string, locationText: string }} job
 * @returns {{ id, name, phone, jobType, locationText }[]}
 */
function findMatchingWorkers(job) {
    if (!job.category || !job.locationText) return [];

    // role=worker, notifyEnabled=1 인 users 전체 조회
    const candidates = db.prepare(`
        SELECT id, name, phone, jobType, locationText
        FROM users
        WHERE role = 'worker'
          AND notifyEnabled = 1
          AND phone IS NOT NULL
          AND phone != ''
    `).all();

    const matched = candidates.filter(u => {
        // jobType 미설정 = 전체 수신 거부 (명시적 선택 없으면 알림 안 보냄)
        if (!u.jobType) return false;
        // category 일치
        if (u.jobType !== job.category) return false;
        // location 매칭 (미설정 = 알림 불가)
        if (!u.locationText) return false;
        return isSameOrNearbyLocation(u.locationText, job.locationText);
    });

    console.log(`[MATCH] job.category=${job.category} loc=${job.locationText} => ${matched.length}/${candidates.length} 매칭`);
    return matched;
}

// ─── 작업자가 관심 등록 시: 관련 열린 일 찾기 ──────────────────────
/**
 * @param {{ jobType: string, locationText: string }} workerProfile
 * @returns {object[]} open 상태 jobs
 */
function findMatchingFarmers(workerProfile) {
    if (!workerProfile.jobType || !workerProfile.locationText) return [];

    const openJobs = db.prepare(`
        SELECT * FROM jobs WHERE status = 'open' AND category = ?
    `).all(workerProfile.jobType);

    return openJobs.filter(j => isSameOrNearbyLocation(j.locationText, workerProfile.locationText));
}

/**
 * spec-compatible alias: includes 기반 단순 매칭
 * (isSameOrNearbyLocation의 보완 버전으로 함께 사용)
 */
function isSameLocation(a, b) {
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a) || isSameOrNearbyLocation(a, b);
}

module.exports = {
    normalizeLocation,
    isSameOrNearbyLocation,
    isSameLocation,
    findMatchingWorkers,
    findMatchingFarmers,
};
