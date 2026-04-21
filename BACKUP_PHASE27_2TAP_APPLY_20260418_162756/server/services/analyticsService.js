'use strict';
/**
 * analyticsService.js — 경량 전환 추적
 * 이벤트: job_created | job_applied | worker_selected | job_completed
 */
const db = require('../db');

function newId() {
    return 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

/**
 * @param {string} event   - 이벤트 이름
 * @param {object} opts    - { jobId, userId, meta }
 */
function trackEvent(event, opts = {}) {
    try {
        const { jobId = null, userId = null, meta = {} } = opts;
        db.prepare(`
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
        // 추적 실패는 메인 로직에 영향 없음
        console.error('[ANALYTICS_ERR]', e.message);
    }
}

module.exports = { trackEvent };
