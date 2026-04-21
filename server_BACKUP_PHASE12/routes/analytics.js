'use strict';
const express = require('express');
const db      = require('../db');
const { trackEvent } = require('../services/analyticsService');

const router = express.Router();

// 프론트엔드에서 전송 가능한 이벤트 목록
const ALLOWED_EVENTS = new Set([
    // 기존
    'job_viewed',
    'page_view',
    'cta_clicked',
    'onboarding_done',
    // Mission I: 모바일 실사용 추적
    'mobile_visit',
    'login_success',
    'quick_job_created',
    'call_clicked',
    'location_permission_granted',
    'location_permission_denied',
    // Phase 5: 딥링크 + 지원 추적
    'job_detail_view',
    'job_apply',
    // Phase 8: 마감 추적
    'job_closed',
    // Phase 10: 지도 이벤트
    'map_view_open',
    'map_marker_click',
    'map_gps_denied',
    'map_card_select',
    // Phase 11: 리텐션
    'retention_cta_click',
    'job_copy_created',
]);

// ─── POST /api/analytics/event ────────────────────────────────
router.post('/event', (req, res) => {
    const { event, jobId, meta } = req.body;
    const userId = req.headers['x-user-id'] || req.body.userId;

    if (!event || !ALLOWED_EVENTS.has(event)) {
        return res.status(400).json({ ok: false, error: '허용되지 않는 이벤트예요.' });
    }

    trackEvent(event, { jobId, userId, meta });
    return res.json({ ok: true });
});

// ─── GET /api/analytics/summary ───────────────────────────────
router.get('/summary', (_req, res) => {
    const rows = db.prepare(`
        SELECT event, COUNT(*) as count,
               MAX(createdAt) as lastAt
        FROM analytics
        GROUP BY event
        ORDER BY count DESC
    `).all();

    const total = db.prepare('SELECT COUNT(*) as n FROM analytics').get().n;

    return res.json({ ok: true, total, events: rows });
});

module.exports = router;
