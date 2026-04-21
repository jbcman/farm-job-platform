'use strict';
/**
 * recommendationService.js — 오늘 일 우선 추천 + 가까운 순 정렬
 *
 * 정렬 우선순위 (고정):
 *   1. 오늘 일 (date === today)  → isToday score +1000
 *   2. 거리 가까운 순 (distanceKm ASC)
 *   3. 일당 높은 순 (payValue DESC)
 *   4. 최신 등록 순 (createdAt DESC)
 *
 * GPS 없으면 거리 0으로 처리 → 기존 createdAt 기반 흐름 유지
 */
const { distanceKm: haversine } = require('./matchingEngine');

// ─── 오늘 날짜 (KST) ──────────────────────────────────────────────
function todayStr() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
}

function isTodayJob(job) {
    return job.date === todayStr();
}

// ─── pay 파싱 (안전) ──────────────────────────────────────────────
/**
 * "150,000" / "150000" / "15만원" / "15만" / null → number
 * 파싱 불가 시 0 반환
 */
function parsePay(raw) {
    if (!raw) return 0;
    const s = String(raw).trim();
    // "15만원" / "15만" → 150000
    const manMatch = s.match(/(\d+(?:\.\d+)?)\s*만/);
    if (manMatch) return Math.round(parseFloat(manMatch[1]) * 10000);
    // 숫자 + 쉼표만 남기기
    const digits = s.replace(/[^0-9]/g, '');
    return digits ? parseInt(digits, 10) : 0;
}

// ─── 거리 계산 (fail-safe) ────────────────────────────────────────
function getDistanceSafe(uLat, uLng, jLat, jLng) {
    if (uLat == null || uLng == null || jLat == null || jLng == null) return null;
    const a = parseFloat(uLat), b = parseFloat(uLng),
          c = parseFloat(jLat), d = parseFloat(jLng);
    if (isNaN(a) || isNaN(b) || isNaN(c) || isNaN(d)) return null;
    return haversine(a, b, c, d);
}

// ─── 추천 점수 계산 ──────────────────────────────────────────────
/**
 * 낮을수록 우선 (ASC 정렬용 key)
 *
 * isToday  → 0 / 1
 * dist     → 0 ~ 500 (GPS 없으면 0, 반영 안 함)
 * pay      → -(payValue / 10000) → 음수, 높은 pay = 더 작은 값
 * age      → 음수 timestamp (최신 = 더 작은 값)
 */
function scoreJob(job, distKm) {
    const todayPenalty = isTodayJob(job) ? 0 : 1;          // 오늘이 아니면 +1
    const distScore    = distKm !== null ? distKm : 0;       // GPS 없으면 0
    const payScore     = -(parsePay(job.pay) / 10000);       // 높은 pay = 더 낮은 score
    const ageScore     = -new Date(job.createdAt).getTime() / 1e12;
    return todayPenalty * 1000 + distScore + payScore + ageScore;
}

// ─── 메인: 추천 정렬 ─────────────────────────────────────────────
/**
 * @param {object[]} jobs         open 상태 jobs
 * @param {{ lat?, lng? }} ctx    사용자 GPS (없으면 null)
 * @returns {object[]}            추천 필드 붙인 정렬된 배열
 */
function sortRecommendedJobs(jobs, ctx = {}) {
    const uLat = ctx.lat != null ? parseFloat(ctx.lat) : null;
    const uLng = ctx.lng != null ? parseFloat(ctx.lng) : null;
    const today = todayStr();
    const hasGps = uLat !== null && uLng !== null;

    const enriched = jobs.map(job => {
        const jLat  = job.latitude  ?? job.lat  ?? null;
        const jLng  = job.longitude ?? job.lng  ?? null;
        const dist  = hasGps ? getDistanceSafe(uLat, uLng, jLat, jLng) : null;
        const isToday   = job.date === today;
        const payValue  = parsePay(job.pay);
        const distanceKm = dist !== null ? Math.round(dist * 10) / 10 : null;
        const _score    = scoreJob(job, dist);

        console.log(
            `[RECOMMEND_SORT] jobId=${job.id} isToday=${isToday}` +
            ` distanceKm=${distanceKm ?? 'n/a'}` +
            ` payValue=${payValue} score=${_score.toFixed(4)}`
        );

        return { ...job, isToday, distanceKm, payValue, _score };
    });

    return enriched.sort((a, b) => a._score - b._score);
}

module.exports = { isTodayJob, parsePay, getDistanceSafe, sortRecommendedJobs, todayStr };
