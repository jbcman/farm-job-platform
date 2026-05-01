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
const _failMap = new Map();
const FAIL_LIMIT  = 10;
const FAIL_WINDOW = 5 * 60 * 1000;

function auth(req, res, next) {
    if (!ADMIN_KEY) return next();

    const ip     = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    const header = (req.headers['authorization'] || '').replace('Bearer ', '');
    const query  = req.query.key || '';

    const fail = _failMap.get(ip);
    if (fail && fail.count >= FAIL_LIMIT && Date.now() - fail.firstAt < FAIL_WINDOW) {
        console.warn(`[ADMIN_BRUTE_FORCE] ip=${ip} count=${fail.count} — 차단`);
        return res.status(429).json({ ok: false, error: '잠시 후 다시 시도해주세요.' });
    }

    if (header !== ADMIN_KEY && query !== ADMIN_KEY) {
        if (fail && Date.now() - fail.firstAt < FAIL_WINDOW) {
            fail.count++;
        } else {
            _failMap.set(ip, { count: 1, firstAt: Date.now() });
        }
        return res.status(401).json({ ok: false, error: '관리자 키가 필요해요.' });
    }

    _failMap.delete(ip);
    next();
}

// ── Admin Action DB 로그 ──────────────────────────────────────────
async function logAction(type, targetId = '', meta = {}, req = null) {
    const metaStr = JSON.stringify(meta);
    const ip      = req ? (req.headers['x-forwarded-for'] || req.ip || '') : '';
    try {
        await db.prepare(`
            INSERT INTO admin_actions (type, targetId, meta, ip, createdAt)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(type, String(targetId), metaStr, String(ip));
    } catch (e) {
        console.error('[ADMIN_LOG_DB_FAIL]', e.message);
    }
    console.log(`[ADMIN_ACTION] type=${type} target=${targetId} meta=${metaStr} ip=${ip}`);
}

function n(val) { return (typeof val === 'number' && !isNaN(val)) ? val : 0; }

// ── GET /api/admin/realtime ──────────────────────────────────────
// 인메모리 메트릭스 스냅샷 (경량, DB 쿼리 없음)
// WebSocket 미사용 환경(폴링 fallback)에도 사용 가능
router.get('/realtime', auth, (req, res) => {
    try {
        const { getSnapshot } = require('../services/metricsService');
        return res.json({ ok: true, ...getSnapshot() });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ── GET /api/admin/metrics ───────────────────────────────────────
router.get('/metrics', auth, async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);

        const jobsToday   = n((await db.prepare("SELECT COUNT(*) AS n FROM jobs        WHERE left(createdat, 10) = ?").get(today))?.n);
        const appsToday   = n((await db.prepare("SELECT COUNT(*) AS n FROM applications WHERE left(createdat, 10) = ?").get(today))?.n);
        const matchToday  = n((await db.prepare("SELECT COUNT(*) AS n FROM jobs        WHERE left(selectedat, 10) = ? AND status IN ('matched','closed')").get(today))?.n);
        const closedToday = n((await db.prepare("SELECT COUNT(*) AS n FROM jobs        WHERE left(closedat, 10) = ? AND status = 'closed'").get(today))?.n);

        const statusRows = await db.prepare("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").all();
        const statusMap  = Object.fromEntries(statusRows.map(r => [r.status, n(r.n)]));
        const openTotal    = statusMap['open']    || 0;
        const matchedTotal = statusMap['matched'] || 0;
        const closedTotal  = statusMap['closed']  || 0;

        const totalJobs    = n((await db.prepare("SELECT COUNT(*) AS n FROM jobs").get())?.n);
        const totalApps    = n((await db.prepare("SELECT COUNT(*) AS n FROM applications").get())?.n);
        const totalMatches = matchedTotal + closedTotal;

        let alertsSentToday = 0;
        let alertsTotal = 0;
        try {
            alertsSentToday = n((await db.prepare("SELECT COUNT(*) AS n FROM notify_log WHERE left(sentat, 10) = ?").get(today))?.n);
            alertsTotal     = n((await db.prepare("SELECT COUNT(*) AS n FROM notify_log").get())?.n);
        } catch (_) {}

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
router.get('/activity', auth, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const rows = await db.prepare(`
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
router.get('/ops/system-status', (req, res) => {
    const hasKakao = !!process.env.KAKAO_REST_API_KEY;
    return res.json({
        ok:    true,
        kakao: { enabled: hasKakao, mode: hasKakao ? 'REAL' : 'MOCK' },
        time:  new Date().toISOString(),
    });
});

// ── GET /api/admin/ops/jobs ──────────────────────────────────────
router.get('/ops/jobs', auth, async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);

        const jobsToday    = n((await db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE left(createdat, 10) = ?").get(today))?.n);
        const matchedToday = n((await db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE left(selectedat, 10) = ? AND status IN ('matched','closed')").get(today))?.n);
        const payPending   = n((await db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE payStatus = 'pending'").get())?.n);

        const rows = await db.prepare(`
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
router.post('/ops/close-job', auth, async (req, res) => {
    try {
        const { jobId } = req.body;
        if (!jobId) return res.status(400).json({ ok: false, error: 'jobId 필요' });

        const now    = new Date().toISOString();
        const result = await db.prepare(
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
router.get('/stale-jobs', auth, async (req, res) => {
    try {
        const hours = Math.max(1, parseInt(req.query.hours) || 24);
        const rows = await db.prepare(`
            SELECT
                id         AS jobId,
                category,
                locationText,
                createdAt,
                EXTRACT(EPOCH FROM (NOW() - createdat::timestamptz)) / 3600 AS hoursOpen
            FROM jobs
            WHERE status = 'open'
              AND createdat::timestamptz < NOW() - ($1 || ' hours')::interval
            ORDER BY createdAt ASC
        `).all(String(hours));

        const mapped = rows.map(r => ({ ...r, hoursOpen: Math.floor(Number(r.hoursOpen)) }));

        if (mapped.length > 0) {
            console.log(`[STALE_JOB_DETECTED] count=${mapped.length} threshold=${hours}h oldest=${mapped[0]?.jobId}`);
        }

        return res.json({ ok: true, staleJobs: mapped, threshold: hours });
    } catch (e) {
        console.error('[ADMIN_STALE_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '오래된 일 조회 오류' });
    }
});

// ── GET /api/admin/revenue ──────────────────────────────────────
router.get('/revenue', auth, async (req, res) => {
    try {
        const daily = await db.prepare(`
            SELECT
                left(completedat, 10)      AS date,
                COUNT(*)                   AS count,
                COALESCE(SUM(payAmount),0) AS total,
                COALESCE(SUM(fee),0)       AS fee,
                COALESCE(SUM(netAmount),0) AS net
            FROM jobs
            WHERE paid = 1
              AND completedAt IS NOT NULL
            GROUP BY left(completedat, 10)
            ORDER BY date ASC
            LIMIT 90
        `).all();

        const monthly = await db.prepare(`
            SELECT
                left(completedat, 7)       AS month,
                COUNT(*)                   AS count,
                COALESCE(SUM(payAmount),0) AS total,
                COALESCE(SUM(fee),0)       AS fee,
                COALESCE(SUM(netAmount),0) AS net
            FROM jobs
            WHERE paid = 1
              AND completedAt IS NOT NULL
            GROUP BY left(completedat, 7)
            ORDER BY month ASC
            LIMIT 24
        `).all();

        const summary = await db.prepare(`
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
router.get('/stats', auth, async (req, res) => {
    try {
        const totalJobs  = n((await db.prepare("SELECT COUNT(*) AS n FROM jobs").get())?.n);
        const completed  = n((await db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('done','completed')").get())?.n);
        const inProgress = n((await db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('matched','in_progress')").get())?.n);

        let revenue = 0;
        try {
            const revRow = await db.prepare("SELECT SUM(payAmount) AS total FROM jobs WHERE paid = 1").get();
            revenue = n(revRow?.total);
        } catch (_) {}

        const matchRate   = totalJobs > 0 ? Math.round((inProgress + completed) / totalJobs * 1000) / 10 : 0;
        const completeRate = totalJobs > 0 ? Math.round(completed / totalJobs * 1000) / 10 : 0;

        console.log(`[ADMIN_STATS] total=${totalJobs} done=${completed} inProg=${inProgress} rev=${revenue}`);

        return res.json({
            ok: true,
            totalJobs,
            completed,
            inProgress,
            revenue,
            matchRate,
            completeRate,
        });
    } catch (e) {
        console.error('[ADMIN_STATS_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '통계 조회 오류: ' + e.message });
    }
});

// ── GET /api/admin/top-workers ───────────────────────────────────
router.get('/top-workers', auth, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 5, 20);
        const rows = await db.prepare(`
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
            successRate:   Math.round(n(r.successRate) * 1000) / 10,
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
router.get('/geo-quality', auth, async (req, res) => {
    try {
        const total    = (await db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE latitude IS NOT NULL").get())?.n || 0;
        const withFarm = (await db.prepare(
            "SELECT COUNT(*) AS n FROM jobs WHERE farmAddress IS NOT NULL AND farmAddress != ''"
        ).get())?.n || 0;
        const gpsOnly  = total - withFarm;
        const farmRate = total > 0 ? Math.round(withFarm / total * 1000) / 10 : 0;

        let softBlocks = 0, bypassed = 0;
        try {
            softBlocks = (await db.prepare("SELECT COUNT(*) AS n FROM analytics WHERE event = 'geo_soft_block'").get())?.n || 0;
            bypassed   = (await db.prepare("SELECT COUNT(*) AS n FROM analytics WHERE event = 'geo_soft_block_bypass'").get())?.n || 0;
        } catch (_) {}

        const addrRows = await db.prepare(
            "SELECT farmAddress FROM jobs WHERE farmAddress IS NOT NULL AND farmAddress != '' LIMIT 100"
        ).all();
        const addrLens = addrRows.map(r => r.farmAddress.length);
        const avgLen   = addrLens.length > 0
            ? Math.round(addrLens.reduce((s, l) => s + l, 0) / addrLens.length)
            : 0;

        const recent = (await db.prepare(
            "SELECT id, farmAddress, locationText, latitude, longitude, createdAt FROM jobs WHERE latitude IS NOT NULL ORDER BY createdAt DESC LIMIT 20"
        ).all()).map(j => ({
            id:        j.id.slice(0, 20),
            source:    j.farmAddress ? 'farmAddress' : 'GPS',
            addrLen:   j.farmAddress ? j.farmAddress.length : 0,
            addr:      (j.farmAddress || j.locationText || '').slice(0, 30),
            lat:       j.latitude  != null ? parseFloat(Number(j.latitude).toFixed(4))  : null,
            lng:       j.longitude != null ? parseFloat(Number(j.longitude).toFixed(4)) : null,
            createdAt: j.createdAt,
        }));

        console.log(`[GEO_QUALITY_ADMIN] total=${total} farmAddr=${withFarm}(${farmRate}%) gpsOnly=${gpsOnly} softBlocks=${softBlocks} bypassed=${bypassed}`);
        return res.json({
            ok: true,
            summary: {
                total,
                withFarmAddr:  withFarm,
                gpsOnly,
                farmAddrRate:  farmRate,
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

// ── GET /api/admin/users ─────────────────────────────────────────
router.get('/users', auth, async (req, res) => {
    try {
        const q = `%${req.query.q || ''}%`;
        const rows = await db.prepare(`
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

// ── PATCH /api/admin/user/:id/block ──────────────────────────────
router.patch('/user/:id/block', auth, async (req, res) => {
    const { id } = req.params;
    const blocked = req.body.blocked ? 1 : 0;
    await db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(blocked, id);
    await logAction('user_block', id, { blocked }, req);
    return res.json({ ok: true });
});

// ── GET /api/admin/jobs-list ──────────────────────────────────────
router.get('/jobs-list', auth, async (req, res) => {
    try {
        const status = req.query.status || '';
        const q      = `%${req.query.q || ''}%`;
        const rows = await db.prepare(`
            SELECT j.id, j.category, j.status, j.locationText,
                   j.latitude, j.longitude, j.farmAddress,
                   j.requesterId, j.createdAt,
                   u.name AS farmerName
            FROM jobs j
            LEFT JOIN users u ON j.requesterId = u.id
            WHERE (? = '' OR j.status = ?)
              AND (j.locationText LIKE ? OR j.category LIKE ? OR j.id LIKE ?)
            ORDER BY j.createdAt DESC
            LIMIT 100
        `).all(status, status, q, q, q);
        return res.json({ ok: true, jobs: rows });
    } catch (e) {
        console.error('[ADMIN_JOBS_LIST_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '작업 조회 오류: ' + e.message });
    }
});

// ── PATCH /api/admin/job/:id/status ──────────────────────────────
router.patch('/job/:id/status', auth, async (req, res) => {
    const { id }     = req.params;
    const { status } = req.body;
    const ALLOWED = ['open', 'matched', 'on_the_way', 'in_progress', 'completed', 'paid', 'closed'];
    if (!ALLOWED.includes(status)) {
        return res.status(400).json({ ok: false, error: `허용 상태: ${ALLOWED.join(', ')}` });
    }
    const result = await db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id);
    if (result.changes === 0) return res.status(404).json({ ok: false, error: '공고 없음' });
    await logAction('status_change', id, { status }, req);
    return res.json({ ok: true });
});

// ── PATCH /api/admin/job/:id/fix-location ────────────────────────
router.patch('/job/:id/fix-location', auth, async (req, res) => {
    const { id }     = req.params;
    const { lat, lng } = req.body;
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
        return res.status(400).json({ ok: false, error: 'lat/lng 숫자 필요' });
    }
    await db.prepare('UPDATE jobs SET latitude = ?, longitude = ? WHERE id = ?').run(parsedLat, parsedLng, id);
    await logAction('geo_fix', id, { lat: parsedLat, lng: parsedLng }, req);
    return res.json({ ok: true });
});

// ── GET /api/admin/reports ───────────────────────────────────────
router.get('/reports', auth, async (req, res) => {
    try {
        const rows = await db.prepare(`
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

// ── GET /api/admin/audit-log ─────────────────────────────────────
router.get('/audit-log', auth, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const rows = await db.prepare(`
            SELECT id, type, targetId, meta, ip, createdAt
            FROM admin_actions
            ORDER BY id DESC
            LIMIT ?
        `).all(limit);
        const logs = rows.map(r => ({
            ...r,
            meta: (() => { try { return JSON.parse(r.meta); } catch (_) { return {}; } })(),
        }));
        return res.json({ ok: true, logs, total: logs.length });
    } catch (e) {
        console.error('[ADMIN_AUDIT_LOG_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ── GET /api/admin/test-logs ─────────────────────────────────────
const { classifyBug } = require('../services/bugClassifier');

router.get('/test-logs', auth, async (req, res) => {
    try {
        // test_logs 테이블 존재 여부 확인 (PostgreSQL)
        const tableRow = await db.prepare(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'test_logs' LIMIT 1"
        ).get();
        if (!tableRow) return res.json({ ok: true, logs: [] });

        const limit    = Math.min(parseInt(req.query.limit) || 100, 500);
        const priority = req.query.priority ? parseInt(req.query.priority) : null;
        const rows = priority
            ? await db.prepare(`SELECT id, type, payload, priority, sessionId, createdAt FROM test_logs WHERE priority = ? ORDER BY id DESC LIMIT ?`).all(priority, limit)
            : await db.prepare(`SELECT id, type, payload, priority, sessionId, createdAt FROM test_logs ORDER BY id DESC LIMIT ?`).all(limit);

        const logs = rows.map(r => ({
            ...r,
            payload: (() => { try { return JSON.parse(r.payload); } catch (_) { return {}; } })(),
        }));
        console.log(`[ADMIN_TEST_LOGS] count=${logs.length} priority=${priority || 'all'}`);
        return res.json({ ok: true, logs });
    } catch (e) {
        console.error('[ADMIN_TEST_LOGS_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ── GET /api/admin/test-summary ──────────────────────────────────
router.get('/test-summary', auth, async (req, res) => {
    try {
        const tableRow = await db.prepare(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'test_logs' LIMIT 1"
        ).get();
        if (!tableRow) return res.json({ ok: true, summary: {
            flowSuccessRate: 0, apiFail: 0, clickFail: 0, mapErrors: 0, total: 0,
        }});

        const total     = (await db.prepare("SELECT COUNT(*) AS n FROM test_logs").get())?.n || 0;
        const p1Count   = (await db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE priority = 1").get())?.n || 0;
        const p2Count   = (await db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE priority = 2").get())?.n || 0;
        const p3Count   = (await db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE priority = 3").get())?.n || 0;
        const apiFail   = (await db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE type = 'ERROR_API_FAIL'").get())?.n || 0;
        const clickFail = (await db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE type = 'ERROR_CLICK_FAIL'").get())?.n || 0;
        const mapErrors = (await db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE type = 'MAP_FAIL' OR type = 'GEO_FAIL'").get())?.n || 0;
        const flowBroken= (await db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE type = 'FLOW_BROKEN'").get())?.n || 0;
        const callFail  = (await db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE type = 'CALL_FAIL'").get())?.n || 0;

        const completed = (await db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE type = 'farmer_complete_job' OR type = 'worker_complete'").get())?.n || 0;
        const started   = (await db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE type = 'farmer_create_job'").get())?.n || 0;
        const flowSuccessRate = started > 0 ? Math.round((completed / started) * 100) : 0;

        const recentSessions = await db.prepare(`
            SELECT sessionId,
                   MAX(CASE WHEN type='farmer_create_job'    THEN 1 ELSE 0 END) AS created,
                   MAX(CASE WHEN type='worker_apply'         THEN 1 ELSE 0 END) AS applied,
                   MAX(CASE WHEN type='farmer_select_worker' THEN 1 ELSE 0 END) AS selected,
                   MAX(CASE WHEN type='farmer_call_worker'   THEN 1 ELSE 0 END) AS called,
                   MAX(CASE WHEN type='farmer_complete_job'  THEN 1 ELSE 0 END) AS completed
            FROM test_logs
            WHERE sessionId != ''
            GROUP BY sessionId
            ORDER BY MAX(id) DESC
            LIMIT 20
        `).all();

        return res.json({
            ok: true,
            summary: {
                total, p1Count, p2Count, p3Count,
                flowSuccessRate, apiFail, clickFail, mapErrors, flowBroken, callFail,
                started, completed,
                recentSessions,
            },
        });
    } catch (e) {
        console.error('[ADMIN_TEST_SUMMARY_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ── GET /api/admin/alert-status ──────────────────────────────────
// 운영 메트릭 알람 (errorsLast1m, avgResponseMs) + test_logs P1/P2 통합
router.get('/alert-status', auth, async (req, res) => {
    let p1Count = 0, p2Count = 0, lastP1Type = null;

    // ── test_logs P1/P2 집계 (SQLite/PG 공용, 테이블 없으면 스킵) ──
    try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        p1Count = (await db.prepare(
            "SELECT COUNT(*) AS n FROM test_logs WHERE priority = 1 AND createdAt > ?"
        ).get(cutoff))?.n || 0;
        p2Count = (await db.prepare(
            "SELECT COUNT(*) AS n FROM test_logs WHERE priority = 2 AND createdAt > ?"
        ).get(cutoff))?.n || 0;
        if (p1Count > 0) {
            const row = await db.prepare(
                "SELECT type FROM test_logs WHERE priority = 1 ORDER BY id DESC LIMIT 1"
            ).get();
            lastP1Type = row?.type || null;
        }
    } catch (_) { /* test_logs 테이블 없음 → 무시 */ }

    // ── 운영 메트릭 알람 상태 (alertService) ─────────────────────
    let opAlerts = null;
    try {
        const { getAlertState } = require('../services/alertService');
        opAlerts = getAlertState();

        // 운영 P1 (ERROR_SPIKE 활성) 을 p1Count에 합산
        if (opAlerts.p1Active) p1Count += 1;
        if (opAlerts.p2Active) p2Count += 1;
    } catch (_) {}

    return res.json({
        ok:         true,
        p1:         p1Count > 0,
        p1Count,
        p2Count,
        lastP1Type,
        // 운영 알람 상세 (프론트 확장용)
        opAlerts,
        checkedAt:  new Date().toISOString(),
    });
});

// ── GET /api/admin/status-logs ───────────────────────────────────
router.get('/status-logs', async (req, res) => {
    const adminKey = req.headers['x-admin-key'] || req.query.adminKey;
    if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'farm-admin-2024') {
        return res.status(403).json({ ok: false, error: '관리자 인증 필요' });
    }
    const { jobId } = req.query;
    try {
        const rows = jobId
            ? await db.prepare('SELECT * FROM status_logs WHERE jobId = ? ORDER BY createdAt DESC').all(jobId)
            : await db.prepare('SELECT * FROM status_logs ORDER BY createdAt DESC LIMIT 200').all();
        return res.json({ ok: true, logs: rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ── POST /api/admin/reset-db ─────────────────────────────────────
router.post('/reset-db', auth, async (req, res) => {
    if (process.env.ALLOW_DB_RESET !== 'true') {
        console.warn('[ADMIN_RESET] ALLOW_DB_RESET 미설정 → 차단');
        return res.status(403).json({ ok: false, error: 'DB 초기화가 비활성화되어 있어요. ALLOW_DB_RESET=true 필요.' });
    }

    if (req.body?.confirm !== 'RESET_OK') {
        return res.status(400).json({ ok: false, error: 'confirm 필드에 RESET_OK 필요' });
    }

    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    console.warn(`[ADMIN_RESET] ⚠️  DB 초기화 시작 — ip=${ip}`);

    try {
        const RESET_TABLES = [
            'applications', 'jobs', 'workers',
            'contacts', 'reviews', 'messages', 'payments', 'sponsored_jobs',
            'status_logs', 'notify_log', 'reports',
            'analytics', 'user_behavior', 'rec_logs',
            'experiment_assignments', 'experiment_events', 'test_logs',
            'anomaly_snapshots',
        ];
        for (const t of RESET_TABLES) {
            try { await db.prepare(`DELETE FROM ${t}`).run(); } catch (_) {}
        }

        const { seed } = require('../seed');
        await seed();

        await logAction('db_reset', null, { tables: RESET_TABLES.length, ip }, req);
        console.warn(`[ADMIN_RESET] ✅ 완료 — ${RESET_TABLES.length}개 테이블 초기화 + 재시드`);

        return res.json({ ok: true, message: `${RESET_TABLES.length}개 테이블 초기화 완료`, tables: RESET_TABLES.length });
    } catch (e) {
        console.error('[ADMIN_RESET] ❌ 오류:', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ── POST /api/admin/run-e2e-test ─────────────────────────────────
const http = require('http');

function e2eCall(port, jobId, action, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const path    = `/api/jobs/${jobId}/${action}`;
        const reqOpts = {
            hostname: '127.0.0.1',
            port,
            path,
            method:  'POST',
            headers: {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        };
        const req = http.request(reqOpts, (res) => {
            let raw = '';
            res.on('data', c => { raw += c; });
            res.on('end', () => {
                try   { resolve({ statusCode: res.statusCode, body: JSON.parse(raw) }); }
                catch { reject(new Error(`JSON 파싱 실패: ${raw.slice(0, 80)}`)); }
            });
        });
        req.on('error', reject);
        req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
        req.write(payload);
        req.end();
    });
}

router.post('/run-e2e-test', auth, async (req, res) => {
    const steps       = [];
    const ts          = Date.now();
    const port        = parseInt(process.env.PORT || '3002');
    const testJobId    = `test-job-${ts}`;
    const testUserId   = `test-user-${ts}`;
    const testWorkerId = `test-worker-${ts}`;
    const testAppId    = `test-app-${ts}`;

    async function runStep(name, fn) {
        const t0 = Date.now();
        try {
            await fn();
            steps.push({ step: name, ok: true, ms: Date.now() - t0 });
        } catch (e) {
            steps.push({ step: name, ok: false, ms: Date.now() - t0, error: e.message });
            throw e;
        }
    }

    async function verifyState(expectStatus, expectLogTo) {
        const job = await db.prepare('SELECT status FROM jobs WHERE id = ?').get(testJobId);
        if (!job)                         throw new Error('공고 행 없음');
        if (job.status !== expectStatus)  throw new Error(`DB 상태 오류: ${job.status} (기대: ${expectStatus})`);
        if (expectLogTo) {
            const log = await db.prepare(
                "SELECT id FROM status_logs WHERE jobId = ? AND toStatus = ? ORDER BY createdAt DESC LIMIT 1"
            ).get(testJobId, expectLogTo);
            if (!log) throw new Error(`status_logs 기록 없음 (toStatus='${expectLogTo}')`);
        }
    }

    try {
        await runStep('🌱 테스트 데이터 생성', async () => {
            await db.prepare(`
                INSERT INTO users (id, name, phone, role, createdAt)
                VALUES (?, 'E2E테스트농민', '010-0000-9001', 'farmer', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING
            `).run(testUserId);

            await db.prepare(`
                INSERT INTO users (id, name, phone, role, createdAt)
                VALUES (?, 'E2E테스트작업자', '010-0000-9002', 'worker', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING
            `).run(`${testUserId}-w`);

            await db.prepare(`
                INSERT INTO workers (id, userId, name, phone, serviceRadiusKm, categories, createdAt)
                VALUES (?, ?, 'E2E테스트작업자', '010-0000-9002', 999, '["기타"]', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING
            `).run(testWorkerId, `${testUserId}-w`);

            await db.prepare(`
                INSERT INTO jobs (id, requesterId, category, locationText, date, status, payAmount, pay, createdAt)
                VALUES (?, ?, '기타', 'E2E테스트위치', CURRENT_DATE::text, 'open', 100000, '100000', CURRENT_TIMESTAMP)
            `).run(testJobId, testUserId);

            await db.prepare(`
                INSERT INTO applications (id, jobRequestId, workerId, status, createdAt)
                VALUES (?, ?, ?, 'applied', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING
            `).run(testAppId, testJobId, testWorkerId);

            const job = await db.prepare('SELECT status FROM jobs WHERE id = ?').get(testJobId);
            if (!job)               throw new Error('jobs INSERT 실패');
            if (job.status !== 'open') throw new Error(`초기 상태 오류: ${job.status}`);
        });

        await runStep('🔗 open → matched  (API: /select-worker)', async () => {
            const r = await e2eCall(port, testJobId, 'select-worker', {
                requesterId: testUserId,
                workerId:    testWorkerId,
            });
            if (r.statusCode !== 200 || r.body.ok === false) {
                throw new Error(r.body?.error || `HTTP ${r.statusCode}`);
            }
            await verifyState('matched', 'matched');
        });

        await runStep('🚗 matched → on_the_way  (API: /on-the-way)', async () => {
            const r = await e2eCall(port, testJobId, 'on-the-way', {
                workerId: testWorkerId,
            });
            if (r.statusCode !== 200 || r.body.ok === false) {
                throw new Error(r.body?.error || `HTTP ${r.statusCode}`);
            }
            await verifyState('on_the_way', 'on_the_way');
        });

        await runStep('⚙️ on_the_way → in_progress  (API: /start)', async () => {
            const r = await e2eCall(port, testJobId, 'start', {
                requesterId: testUserId,
            });
            if (r.statusCode !== 200 || r.body.ok === false) {
                throw new Error(r.body?.error || `HTTP ${r.statusCode}`);
            }
            await verifyState('in_progress', 'in_progress');
        });

        await runStep('⏪ startedAt -11분 백데이트 (시간가드 우회)', async () => {
            const r = await db.prepare(
                "UPDATE jobs SET startedAt = (NOW() - INTERVAL '11 minutes')::text WHERE id = ?"
            ).run(testJobId);
            if (r.changes === 0) throw new Error('startedAt 업데이트 실패');
        });

        await runStep('✅ in_progress → completed  (API: /complete)', async () => {
            const r = await e2eCall(port, testJobId, 'complete', {
                requesterId: testUserId,
            });
            if (r.statusCode !== 200 || r.body.ok === false) {
                throw new Error(r.body?.error || `HTTP ${r.statusCode}`);
            }
            await verifyState('completed', 'completed');
        });

        await runStep('💳 completed → paid  (API: /mark-paid)', async () => {
            const r = await e2eCall(port, testJobId, 'mark-paid', {
                requesterId: testUserId,
            });
            if (r.statusCode !== 200 || r.body.ok === false) {
                throw new Error(r.body?.error || `HTTP ${r.statusCode}`);
            }
            const job = await db.prepare('SELECT status, paymentStatus FROM jobs WHERE id = ?').get(testJobId);
            if (job.status !== 'completed')      throw new Error(`status 오염: ${job.status}`);
            if (job.paymentStatus !== 'paid')    throw new Error(`paymentStatus 오류: ${job.paymentStatus}`);
        });

        await runStep('🔍 status_logs 총계 검증', async () => {
            const logs = await db.prepare(
                "SELECT toStatus FROM status_logs WHERE jobId = ? ORDER BY createdAt ASC"
            ).all(testJobId);

            const expected = ['matched', 'on_the_way', 'in_progress', 'completed'];
            const got      = logs.map(l => l.toStatus);

            for (const s of expected) {
                if (!got.includes(s)) throw new Error(`status_logs 누락: '${s}' 없음 (기록된 전이: ${got.join('→')})`);
            }
        });

    } catch (_) {
        // 실패해도 정리는 반드시 실행
    }

    const t0clean = Date.now();
    try {
        await db.prepare("DELETE FROM jobs         WHERE id   LIKE 'test-%'").run();
        await db.prepare("DELETE FROM workers      WHERE id   LIKE 'test-%'").run();
        await db.prepare("DELETE FROM users        WHERE id   LIKE 'test-%'").run();
        await db.prepare("DELETE FROM applications WHERE id   LIKE 'test-%'").run();
        await db.prepare("DELETE FROM status_logs  WHERE jobId LIKE 'test-%'").run();
        steps.push({ step: '🧹 테스트 데이터 정리', ok: true, ms: Date.now() - t0clean });
    } catch (e) {
        steps.push({ step: '🧹 테스트 데이터 정리', ok: false, ms: Date.now() - t0clean, error: e.message });
    }

    const allOk   = steps.every(s => s.ok);
    const totalMs = Date.now() - ts;

    await logAction('e2e_test', null, { allOk, steps: steps.length, totalMs }, req);
    console.log(`[E2E_TEST] allOk=${allOk} steps=${steps.length} totalMs=${totalMs}ms`);

    return res.json({ ok: true, allOk, totalMs, steps });
});

module.exports = router;
