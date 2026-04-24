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

// ── GET /api/admin/ops/system-status ────────────────────────────
// 인증 없음 — 운영자 페이지가 키 없이도 시스템 상태 조회 가능
router.get('/ops/system-status', (req, res) => {
    const hasKakao = !!process.env.KAKAO_REST_API_KEY;
    return res.json({
        ok:    true,
        kakao: { enabled: hasKakao, mode: hasKakao ? 'REAL' : 'MOCK' },
        time:  new Date().toISOString(),
    });
});

// ── GET /api/admin/ops/jobs ──────────────────────────────────────
// 운영자 전용: 공고 목록 + 결제 상태 (최근 50건, pending 우선)
router.get('/ops/jobs', auth, (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);

        // 오늘 요약
        const jobsToday    = n(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE DATE(createdAt) = ?").get(today)?.n);
        const matchedToday = n(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE DATE(selectedAt) = ? AND status IN ('matched','closed')").get(today)?.n);
        const payPending   = n(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE payStatus = 'pending'").get()?.n);

        // 공고 목록 (farmer 정보 JOIN)
        const rows = db.prepare(`
            SELECT
                j.id,
                j.category,
                j.status,
                j.payStatus,
                j.payMethod,
                j.isUrgentPaid,
                j.locationText,
                j.workDate,
                j.createdAt,
                u.name  AS farmerName,
                u.phone AS farmerPhone
            FROM jobs j
            LEFT JOIN users u ON j.requesterId = u.id
            ORDER BY
                CASE WHEN j.payStatus = 'pending' THEN 0 ELSE 1 END ASC,
                j.createdAt DESC
            LIMIT 50
        `).all();

        return res.json({
            ok:      true,
            summary: { jobsToday, matchedToday, payPending },
            jobs:    rows,
        });
    } catch (e) {
        console.error('[ADMIN_OPS_JOBS_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '조회 오류: ' + e.message });
    }
});

// ── POST /api/admin/ops/close-job ───────────────────────────────
// 운영자 전용: 공고 강제 종료 (쓰레기 데이터, 오입력 등)
router.post('/ops/close-job', auth, (req, res) => {
    try {
        const { jobId } = req.body;
        if (!jobId) return res.status(400).json({ ok: false, error: 'jobId 필요' });

        const now    = new Date().toISOString();
        const result = db.prepare(
            "UPDATE jobs SET status = 'closed', closedAt = ? WHERE id = ?"
        ).run(now, jobId);

        if (result.changes === 0) {
            return res.status(404).json({ ok: false, error: '공고를 찾을 수 없어요.' });
        }

        console.log(`[OPS_CLOSE_JOB] jobId=${jobId} closedAt=${now}`);
        return res.json({ ok: true });
    } catch (e) {
        console.error('[OPS_CLOSE_JOB_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '처리 오류: ' + e.message });
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

// ── GET /api/admin/revenue ──────────────────────────────────────
// PHASE_REVENUE_DASHBOARD_V1: 일별 / 월별 매출 집계
router.get('/revenue', auth, (req, res) => {
    try {
        const daily = db.prepare(`
            SELECT
                DATE(completedAt)          AS date,
                COUNT(*)                   AS count,
                COALESCE(SUM(payAmount),0) AS total,
                COALESCE(SUM(fee),0)       AS fee,
                COALESCE(SUM(netAmount),0) AS net
            FROM jobs
            WHERE paid = 1
              AND completedAt IS NOT NULL
            GROUP BY DATE(completedAt)
            ORDER BY date ASC
            LIMIT 90
        `).all();

        const monthly = db.prepare(`
            SELECT
                substr(completedAt, 1, 7)  AS month,
                COUNT(*)                   AS count,
                COALESCE(SUM(payAmount),0) AS total,
                COALESCE(SUM(fee),0)       AS fee,
                COALESCE(SUM(netAmount),0) AS net
            FROM jobs
            WHERE paid = 1
              AND completedAt IS NOT NULL
            GROUP BY substr(completedAt, 1, 7)
            ORDER BY month ASC
            LIMIT 24
        `).all();

        // 전체 누적 합산
        const summary = db.prepare(`
            SELECT
                COUNT(*)                   AS totalCount,
                COALESCE(SUM(payAmount),0) AS totalRevenue,
                COALESCE(SUM(fee),0)       AS totalFee,
                COALESCE(SUM(netAmount),0) AS totalNet
            FROM jobs
            WHERE paid = 1
        `).get();

        console.log(`[ADMIN_REVENUE] daily=${daily.length}건 monthly=${monthly.length}건 summary=${JSON.stringify(summary)}`);

        return res.json({
            ok: true,
            daily,
            monthly,
            summary: {
                totalCount:   n(summary?.totalCount),
                totalRevenue: n(summary?.totalRevenue),
                totalFee:     n(summary?.totalFee),
                totalNet:     n(summary?.totalNet),
            },
        });
    } catch (e) {
        console.error('[ADMIN_REVENUE_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '매출 집계 오류: ' + e.message });
    }
});

// ── GET /api/admin/stats ─────────────────────────────────────────
// PHASE_ADMIN_DASHBOARD_AI_V2: 통합 운영 지표 (매출/매칭율/완료율)
router.get('/stats', auth, (req, res) => {
    try {
        const totalJobs  = n(db.prepare("SELECT COUNT(*) AS n FROM jobs").get()?.n);
        const completed  = n(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'done'").get()?.n);
        const inProgress = n(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('matched','in_progress')").get()?.n);

        const revRow = safeGet(() =>
            db.prepare("SELECT SUM(payAmount) AS total FROM jobs WHERE paid = 1").get()
        );
        const revenue = n(revRow?.total);

        const matchRate   = totalJobs > 0 ? Math.round((inProgress + completed) / totalJobs * 1000) / 10 : 0;
        const completeRate = totalJobs > 0 ? Math.round(completed / totalJobs * 1000) / 10 : 0;

        console.log(`[ADMIN_STATS] total=${totalJobs} done=${completed} inProg=${inProgress} rev=${revenue}`);

        return res.json({
            ok: true,
            totalJobs,
            completed,
            inProgress,
            revenue,
            matchRate,    // %
            completeRate, // %
        });
    } catch (e) {
        console.error('[ADMIN_STATS_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '통계 조회 오류: ' + e.message });
    }
});

// ── GET /api/admin/top-workers ───────────────────────────────────
// PHASE_ADMIN_DASHBOARD_AI_V2: 완료 작업 기준 상위 작업자 TOP 5
router.get('/top-workers', auth, (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 5, 20);
        const rows = db.prepare(`
            SELECT
                w.id,
                COALESCE(u.name, w.name) AS name,
                w.completedJobs,
                w.rating,
                COALESCE(w.successRate, 0) AS successRate,
                w.categories
            FROM workers w
            LEFT JOIN users u ON w.userId = u.id
            ORDER BY w.completedJobs DESC, w.rating DESC
            LIMIT ?
        `).all(limit);

        const workers = rows.map(r => ({
            id:            r.id,
            name:          r.name || '이름 없음',
            completedJobs: n(r.completedJobs),
            rating:        r.rating != null ? Math.round(r.rating * 10) / 10 : 4.5,
            successRate:   Math.round(n(r.successRate) * 1000) / 10, // % 변환
            categories:    (() => { try { return JSON.parse(r.categories || '[]'); } catch(_) { return []; } })(),
        }));

        console.log(`[ADMIN_TOP_WORKERS] count=${workers.length}`);
        return res.json({ ok: true, workers });
    } catch (e) {
        console.error('[ADMIN_TOP_WORKERS_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '작업자 조회 오류: ' + e.message });
    }
});

module.exports = router;
