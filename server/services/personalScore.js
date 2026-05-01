'use strict';
/**
 * personalScore.js — 개인화 점수 (PostgreSQL 비동기)
 */
const db = require('../db');

async function getPersonalScore(userId, job) {
    if (!userId) return 0;
    try {
        const rows = await db.prepare(`
            SELECT action, jobType, lat, lng, createdAt
            FROM user_behavior
            WHERE userId = ?
            ORDER BY createdAt DESC
            LIMIT 20
        `).all(userId);

        if (!rows.length) return 0;

        const now         = Date.now();
        const jobCategory = job.category || job.jobType || null;
        let   score       = 0;

        const weightOf = (createdAt) => {
            const ageHours = (now - createdAt) / (1000 * 60 * 60);
            return Math.max(0.2, 1 - ageHours / 24);
        };

        rows.forEach(r => {
            const w = weightOf(r.createdAt);
            if (jobCategory && r.jobType === jobCategory) score += 2   * w;
            if (r.action === 'apply')                     score += 1.5 * w;
        });

        const jobLat = job.latitude  ?? job.lat ?? null;
        const jobLng = job.longitude ?? job.lng ?? null;

        if (jobLat != null && jobLng != null) {
            const valid = rows.filter(r => r.lat != null && r.lng != null);
            if (valid.length > 0) {
                const weighted = valid.map(r => {
                    const w = weightOf(r.createdAt);
                    return { wLat: r.lat * w, wLng: r.lng * w, w };
                });
                const totalW = weighted.reduce((s, r) => s + r.w,    0);
                const avgLat = weighted.reduce((s, r) => s + r.wLat, 0) / totalW;
                const avgLng = weighted.reduce((s, r) => s + r.wLng, 0) / totalW;
                const dDeg   = Math.sqrt(Math.pow(avgLat - jobLat, 2) + Math.pow(avgLng - jobLng, 2));
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
