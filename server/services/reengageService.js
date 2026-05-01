'use strict';
/**
 * reengageService.js — 미선택 지원자 재매칭 알림 (PostgreSQL 비동기)
 */
const db           = require('../db');
const { trackEvent } = require('./analyticsService');

async function reengageUnselectedApplicants(newJob) {
    try {
        if (!newJob?.id || !newJob?.category) return;

        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const pastJobs = await db.prepare(`
            SELECT id FROM jobs
            WHERE category = ?
              AND status IN ('closed', 'matched')
              AND createdAt > ?
              AND requesterId != ?
        `).all(newJob.category, cutoff, newJob.requesterId);

        if (pastJobs.length === 0) return;

        const pastJobIds    = pastJobs.map(j => j.id);
        const placeholders  = pastJobIds.map((_, i) => `$${i + 1}`).join(',');
        const unselected    = await db.q(
            `SELECT DISTINCT workerId FROM applications WHERE jobRequestId IN (${placeholders}) AND status IN ('pending', 'rejected')`,
            pastJobIds
        ).then(r => r.rows || []);

        if (unselected.length === 0) return;

        console.log(`[REENGAGE_ALERT_SENT] newJobId=${newJob.id} category=${newJob.category} targets=${unselected.length}`);

        try {
            await trackEvent('reengage_match_found', {
                jobId: newJob.id, userId: newJob.requesterId,
                meta: { matchedCount: unselected.length, category: newJob.category },
            });
        } catch (e) { console.error('[REENGAGE_MATCH_FOUND_ERROR]', e.message); }

        for (const { workerid } of unselected) {
            try {
                await trackEvent('reengage_alert', {
                    jobId: newJob.id, userId: workerid,
                    meta: { category: newJob.category, locationText: newJob.locationText, date: newJob.date },
                });
            } catch (_) {}
        }
    } catch (e) {
        console.error('[REENGAGE_ERROR]', e.message);
    }
}

module.exports = { reengageUnselectedApplicants };
