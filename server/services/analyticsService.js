'use strict';
/**
 * analyticsService.js — 경량 전환 추적
 */
const db = require('../db');

function newId() {
    return 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

async function trackEvent(event, opts = {}) {
    try {
        const { jobId = null, userId = null, meta = {} } = opts;
        await db.prepare(`
            INSERT INTO analytics (id, event, jobId, userId, meta, createdAt)
            VALUES (@id, @event, @jobId, @userId, @meta, @createdAt)
        `).run({
            id:        newId(),
            event,
            jobId,
            userId,
            meta:      JSON.stringify(meta),
            createdAt: new Date().toISOString(),
        });
        console.log(`[ANALYTICS] ${event} jobId=${jobId || '-'} userId=${userId || '-'}`);
    } catch (e) {
        console.error('[ANALYTICS_ERR]', e.message);
    }
}

module.exports = { trackEvent };
