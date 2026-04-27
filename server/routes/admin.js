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

// ── GET /api/admin/geo-quality ───────────────────────────────────
// GEO_QUALITY 대시보드 — farmAddress vs GPS 비율 + 최근 등록 품질
router.get('/geo-quality', auth, (req, res) => {
    try {
        const total       = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE latitude IS NOT NULL").get()?.n || 0;
        const withFarm    = db.prepare(
            "SELECT COUNT(*) AS n FROM jobs WHERE farmAddress IS NOT NULL AND farmAddress != ''"
        ).get()?.n || 0;
        const gpsOnly     = total - withFarm;
        const farmRate    = total > 0 ? Math.round(withFarm / total * 1000) / 10 : 0;

        // 소프트 차단 발생 횟수 (analytics 로그)
        const softBlocks  = safeGet(() =>
            db.prepare("SELECT COUNT(*) AS n FROM analytics WHERE event = 'geo_soft_block'").get()
        )?.n || 0;
        const bypassed    = safeGet(() =>
            db.prepare("SELECT COUNT(*) AS n FROM analytics WHERE event = 'geo_soft_block_bypass'").get()
        )?.n || 0;

        // addrLen 분포 (farmAddress가 있는 것만)
        const addrRows = db.prepare(
            "SELECT farmAddress FROM jobs WHERE farmAddress IS NOT NULL AND farmAddress != '' LIMIT 100"
        ).all();
        const addrLens  = addrRows.map(r => r.farmAddress.length);
        const avgLen    = addrLens.length > 0
            ? Math.round(addrLens.reduce((s, l) => s + l, 0) / addrLens.length)
            : 0;

        // 최근 20건 품질 로그
        const recent = db.prepare(
            "SELECT id, farmAddress, locationText, latitude, longitude, createdAt FROM jobs WHERE latitude IS NOT NULL ORDER BY createdAt DESC LIMIT 20"
        ).all().map(j => ({
            id:         j.id.slice(0, 20),
            source:     j.farmAddress ? 'farmAddress' : 'GPS',
            addrLen:    j.farmAddress ? j.farmAddress.length : 0,
            addr:       (j.farmAddress || j.locationText || '').slice(0, 30),
            lat:        j.latitude  != null ? parseFloat(j.latitude.toFixed(4))  : null,
            lng:        j.longitude != null ? parseFloat(j.longitude.toFixed(4)) : null,
            createdAt:  j.createdAt,
        }));

        console.log(`[GEO_QUALITY_ADMIN] total=${total} farmAddr=${withFarm}(${farmRate}%) gpsOnly=${gpsOnly} softBlocks=${softBlocks} bypassed=${bypassed}`);
        return res.json({
            ok: true,
            summary: {
                total,
                withFarmAddr:  withFarm,
                gpsOnly,
                farmAddrRate:  farmRate,   // % — 목표: ≥60%
                avgAddrLen:    avgLen,
                softBlocks,
                bypassed,
                bypassRate:    softBlocks > 0 ? Math.round(bypassed / softBlocks * 1000) / 10 : 0,
            },
            recent,
        });
    } catch (e) {
        console.error('[GEO_QUALITY_ADMIN_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: 'GEO_QUALITY 조회 오류: ' + e.message });
    }
});

// ── DB 마이그레이션: users.blocked 컬럼 추가 (안전) ─────────────
try { db.exec("ALTER TABLE users ADD COLUMN blocked INTEGER DEFAULT 0"); } catch (_) {}

// ── GET /api/admin/users — 사용자 목록 (검색 포함) ────────────────
router.get('/users', auth, (req, res) => {
    try {
        const q = `%${req.query.q || ''}%`;
        const rows = db.prepare(`
            SELECT id, name, phone, role,
                   COALESCE(rating, 0)      AS rating,
                   COALESCE(reviewCount, 0) AS reviewCount,
                   COALESCE(blocked, 0)     AS blocked,
                   createdAt
            FROM users
            WHERE name LIKE ? OR phone LIKE ? OR id LIKE ?
            ORDER BY createdAt DESC
            LIMIT 100
        `).all(q, q, q);
        console.log(`[ADMIN_USERS] q="${req.query.q||''}" count=${rows.length}`);
        return res.json({ ok: true, users: rows });
    } catch (e) {
        console.error('[ADMIN_USERS_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '사용자 조회 오류: ' + e.message });
    }
});

// ── PATCH /api/admin/user/:id/block — 사용자 차단/해제 ────────────
router.patch('/user/:id/block', auth, (req, res) => {
    const { id } = req.params;
    const blocked = req.body.blocked ? 1 : 0;
    db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(blocked, id);
    console.log(`[ADMIN_ACTION] type=user_block userId=${id} blocked=${blocked}`);
    return res.json({ ok: true });
});

// ── GET /api/admin/jobs-list — 작업 목록 관리용 ───────────────────
router.get('/jobs-list', auth, (req, res) => {
    try {
        const status = req.query.status || '';
        const q      = `%${req.query.q || ''}%`;
        const rows = db.prepare(`
            SELECT j.id, j.category, j.status, j.locationText,
                   j.latitude, j.longitude, j.farmAddress,
                   j.requesterId, j.createdAt,
                   u.name AS farmerName
            FROM jobs j
            LEFT JOIN users u ON j.requesterId = u.id
            WHERE (status LIKE ? OR ? = '%' || '' || '%')
              AND (j.locationText LIKE ? OR j.category LIKE ? OR j.id LIKE ?)
            ORDER BY j.createdAt DESC
            LIMIT 100
        `).all(
            status ? status : '%',
            status ? status : '',
            q, q, q
        );
        return res.json({ ok: true, jobs: rows });
    } catch (e) {
        console.error('[ADMIN_JOBS_LIST_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '작업 조회 오류: ' + e.message });
    }
});

// ── PATCH /api/admin/job/:id/status — 상태 강제 변경 ─────────────
router.patch('/job/:id/status', auth, (req, res) => {
    const { id }     = req.params;
    const { status } = req.body;
    const ALLOWED = ['open', 'matched', 'in_progress', 'done', 'closed'];
    if (!ALLOWED.includes(status)) {
        return res.status(400).json({ ok: false, error: `허용 상태: ${ALLOWED.join(', ')}` });
    }
    const result = db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id);
    if (result.changes === 0) return res.status(404).json({ ok: false, error: '공고 없음' });
    console.log(`[ADMIN_ACTION] type=status_change jobId=${id} status=${status}`);
    return res.json({ ok: true });
});

// ── PATCH /api/admin/job/:id/fix-location — 좌표 보정 ────────────
router.patch('/job/:id/fix-location', auth, (req, res) => {
    const { id }     = req.params;
    const { lat, lng } = req.body;
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
        return res.status(400).json({ ok: false, error: 'lat/lng 숫자 필요' });
    }
    db.prepare('UPDATE jobs SET latitude = ?, longitude = ? WHERE id = ?').run(parsedLat, parsedLng, id);
    console.log(`[ADMIN_ACTION] type=geo_fix jobId=${id} lat=${parsedLat} lng=${parsedLng}`);
    return res.json({ ok: true });
});

// ── GET /api/admin/reports — 신고 목록 ───────────────────────────
router.get('/reports', auth, (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT r.id, r.jobId, r.reporterId, r.reason, r.createdAt,
                   j.category   AS jobCategory,
                   j.locationText AS jobLocation,
                   u.name       AS reporterName
            FROM reports r
            LEFT JOIN jobs  j ON r.jobId     = j.id
            LEFT JOIN users u ON r.reporterId = u.id
            ORDER BY r.createdAt DESC
            LIMIT 100
        `).all();
        console.log(`[ADMIN_REPORTS] count=${rows.length}`);
        return res.json({ ok: true, reports: rows });
    } catch (e) {
        console.error('[ADMIN_REPORTS_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '신고 조회 오류: ' + e.message });
    }
});

module.exports = router;
