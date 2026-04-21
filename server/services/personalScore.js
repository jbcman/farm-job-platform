'use strict';
/**
 * personalScore.js — PHASE PERSONALIZATION_SCORE + FINAL_UPGRADE (Time Decay)
 *
 * 점수 구성 (모두 시간 감쇠 적용):
 *   카테고리 선호  : jobType 일치 시 2 × weight     (최대 40pt @ weight=1 × 20개)
 *   지원 행동 가중 : apply 시   1.5 × weight        (최대 30pt @ weight=1 × 20개)
 *   지역 근접도   : 가중 centroid ↔ job 위치 보너스  (최대 20pt)
 *
 * 감쇠 함수:
 *   weight = max(0.2, 1 - ageHours / 24)
 *   → 24시간 이내 최신 행동: 1.0  (풀 가중)
 *   → 24시간 초과 오래된 행동: 0.2 (최소 20% — 완전 무시 방지)
 *
 * 실패 시 항상 0 반환 (fail-safe) — 기존 매칭 점수에 영향 없음.
 */
const db = require('../db');

/**
 * @param {string|null} userId   작업자 userId (users.id)
 * @param {object}      job      jobs 행 (category, latitude, longitude)
 * @returns {number}             개인화 점수 (0 이상)
 */
function getPersonalScore(userId, job) {
    if (!userId) return 0;

    try {
        // createdAt 포함 (감쇠 계산용)
        const rows = db.prepare(`
            SELECT action, jobType, lat, lng, createdAt
            FROM user_behavior
            WHERE userId = ?
            ORDER BY createdAt DESC
            LIMIT 20
        `).all(userId);

        if (!rows.length) return 0;

        const now        = Date.now();
        const jobCategory = job.category || job.jobType || null;
        let   score      = 0;

        // ── 시간 가중치 계산 헬퍼 ──────────────────────────────────
        const weightOf = (createdAt) => {
            const ageHours = (now - createdAt) / (1000 * 60 * 60);
            return Math.max(0.2, 1 - ageHours / 24);
        };

        // ① 카테고리 선호 + ② apply 행동 가중 — 단일 패스
        rows.forEach(r => {
            const w = weightOf(r.createdAt);

            if (jobCategory && r.jobType === jobCategory) score += 2   * w;
            if (r.action === 'apply')                     score += 1.5 * w;
        });

        // ③ 지역 선호 — 가중 centroid ↔ job 위치
        const jobLat = job.latitude  ?? job.lat ?? null;
        const jobLng = job.longitude ?? job.lng ?? null;

        if (jobLat != null && jobLng != null) {
            const valid = rows.filter(r => r.lat != null && r.lng != null);
            if (valid.length > 0) {
                const weighted = valid.map(r => {
                    const w = weightOf(r.createdAt);
                    return { wLat: r.lat * w, wLng: r.lng * w, w };
                });

                const totalW  = weighted.reduce((s, r) => s + r.w,    0);
                const avgLat  = weighted.reduce((s, r) => s + r.wLat, 0) / totalW;
                const avgLng  = weighted.reduce((s, r) => s + r.wLng, 0) / totalW;

                // 위경도 차 기반 근사 (°당 약 111km)
                const dDeg = Math.sqrt(
                    Math.pow(avgLat - jobLat, 2) +
                    Math.pow(avgLng - jobLng, 2)
                );
                // dDeg 0 → 20pt, dDeg ≥ 0.2(약 22km) → 0pt
                score += Math.max(0, 20 - dDeg * 100);
            }
        }

        return score;

    } catch (e) {
        console.error('[PERSONAL_SCORE] 오류 (무시):', e.message);
        return 0;
    }
}

module.exports = { getPersonalScore };
