'use strict';
/**
 * admin.js — 관리자 대시보드 API
 * GET /api/admin/metrics     — KPI + 퍼널
 * GET /api/admin/activity    — 최근 이벤트 피드
 * GET /api/admin/stale-jobs  — 24시간 이상 미매칭 일 경고
 */
const express = require('express');
const db      = require('../db');

const router   = express.Router();
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// ── 인증 미들웨어 ────────────────────────────────────────────────
function auth(req, res, next) {
    if (!ADMIN_KEY) return next(); // ENV 미설정 → 개발 모드 통과
    const header = (req.headers['authorization'] || '').replace('Bearer ', '');
    const query  = req.query.key || '';
    if (header !== ADMIN_KEY && query !== ADMIN_KEY) {
        return res.status(401).json({ ok: false, error: '관리자 키가 필요해요.' });
    }
    next();
}

// 안전 숫자 (null/undefined → 0)
function n(val) { return (typeof val === 'number' && !isNaN(val)) ? val : 0; }
function safeGet(fn) { try { return fn(); } catch (_) { return null; } }

// ── GET /api/admin/metrics ───────────────────────────────────────
router.get('/metrics', auth, (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        // ── 오늘 집계 ─────────────────────────────────────────────
        const jobsToday   = n(db.prepare("SELECT COUNT(*) AS n FROM jobs        WHERE DATE(createdAt)  = ?").get(today)?.n);
        const appsToday   = n(db.prepare("SELECT COUNT(*) AS n FROM applications WHERE DATE(createdAt) = ?").get(today)?.n);
        const matchToday  = n(db.prepare("SELECT COUNT(*) AS n FROM jobs        WHERE DATE(selectedAt) = ? AND status IN ('matched','closed')").get(today)?.n);
        const closedToday = n(db.prepare("SELECT COUNT(*) AS n FROM jobs        WHERE DATE(closedAt)   = ? AND status = 'closed'").get(today)?.n);

        // ── 전체 상태 현황 ────────────────────────────────────────
        const statusRows = db.prepare("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").all();
        const statusMap  = Object.fromEntries(statusRows.map(r => [r.status, n(r.n)]));
        const openTotal    = statusMap['open']    || 0;
        const matchedTotal = statusMap['matched'] || 0;
        const closedTotal  = statusMap['closed']  || 0;

        // ── 전체 지원/매칭 수 (퍼널용) ───────────────────────────
        const totalJobs    = n(db.prepare("SELECT COUNT(*) AS n FROM jobs").get()?.n);
        const totalApps    = n(db.prepare("SELECT COUNT(*) AS n FROM applications").get()?.n);
        const totalMatches = matchedTotal + closedTotal;

        // ── 알림 집계 ─────────────────────────────────────────────
        const alertsSentToday = n(safeGet(() =>
            db.prepare("SELECT COUNT(*) AS n FROM notify_log WHERE DATE(sentAt) = ?").get(today)?.n
        ));
        const alertsTotal = n(safeGet(() =>
            db.prepare("SELECT COUNT(*) AS n FROM notify_log").get()?.n
        ));

        // ── 퍼널 비율 (0 나누기 방지) ────────────────────────────
        const applyRate = totalJobs    > 0 ? Math.round((totalApps    / totalJobs)    * 100) / 100 : 0;
        const matchRate = totalApps    > 0 ? Math.round((totalMatches / totalApps)    * 100) / 100 : 0;
        const closeRate = totalMatches > 0 ? Math.round((closedTotal  / totalMatches) * 100) / 100 : 0;

        console.log(`[ADMIN_METRICS_FETCH] today=${today} jobsToday=${jobsToday} appsToday=${appsToday} matchToday=${matchToday} closedToday=${closedToday}`);

        return res.json({
            ok: true,
            today:  { jobs: jobsToday, applications: appsToday, matches: matchToday, closed: closedToday },
            totals: { open: openTotal, matched: matchedTotal, closed: closedTotal },
            alerts: { sentToday: alertsSentToday, total: alertsTotal },
            funnel: { applyRate, matchRate, closeRate },
            _meta: { generatedAt: new Date().toISOString() },
        });
    } catch (e) {
        console.error('[ADMIN_METRICS_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '집계 중 오류가 발생했어요.' });
    }
});

// ── GET /api/admin/activity ──────────────────────────────────────
router.get('/activity', auth, (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const rows = db.prepare(`
            SELECT event, jobId, userId, createdAt
            FROM analytics
            WHERE event IN ('job_created','job_applied','worker_selected','job_closed','job_completed')
            ORDER BY createdAt DESC
            LIMIT ?
        `).all(limit);

        const LABEL = {
            job_created:     'JOB_CREATED',
            job_applied:     'APPLY',
            worker_selected: 'MATCHED',
            job_closed:      'CLOSED',
            job_completed:   'COMPLETED',
        };

        const feed = rows.map(r => ({
            type:  LABEL[r.event] || r.event.toUpperCase(),
            event: r.event,
            jobId: r.jobId  || null,
            time:  r.createdAt,
        }));

        console.log(`[ADMIN_ACTIVITY_FETCH] count=${feed.length}`);
        return res.json({ ok: true, activity: feed });
    } catch (e) {
        console.error('[ADMIN_ACTIVITY_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '활동 로그 조회 오류' });
    }
});

// ── GET /api/admin/stale-jobs ────────────────────────────────────
router.get('/stale-jobs', auth, (req, res) => {
    try {
        const hours = Math.max(1, parseInt(req.query.hours) || 24);
        const rows = db.prepare(`
            SELECT
                id         AS jobId,
                category,
                locationText,
                createdAt,
                CAST((julianday('now') - julianday(createdAt)) * 24 AS INTEGER) AS hoursOpen
            FROM jobs
            WHERE status = 'open'
              AND datetime(createdAt) < datetime('now', '-' || ? || ' hours')
            ORDER BY createdAt ASC
        `).all(hours);

        if (rows.length > 0) {
            console.log(`[STALE_JOB_DETECTED] count=${rows.length} threshold=${hours}h oldest=${rows[0]?.jobId}`);
        }

        return res.json({ ok: true, staleJobs: rows, threshold: hours });
    } catch (e) {
        console.error('[ADMIN_STALE_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '오래된 일 조회 오류' });
    }
});

module.exports = router;
