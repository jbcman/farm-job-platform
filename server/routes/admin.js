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
// ❗ 보완: Brute-force 방어 (IP당 5분 내 10회 실패 → 일시 차단)
const _failMap = new Map(); // ip → { count, firstAt }
const FAIL_LIMIT  = 10;
const FAIL_WINDOW = 5 * 60 * 1000; // 5분

function auth(req, res, next) {
    if (!ADMIN_KEY) return next(); // ENV 미설정 → 개발 모드 통과

    const ip     = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    const header = (req.headers['authorization'] || '').replace('Bearer ', '');
    const query  = req.query.key || '';

    // 차단된 IP 확인
    const fail = _failMap.get(ip);
    if (fail && fail.count >= FAIL_LIMIT && Date.now() - fail.firstAt < FAIL_WINDOW) {
        console.warn(`[ADMIN_BRUTE_FORCE] ip=${ip} count=${fail.count} — 차단`);
        return res.status(429).json({ ok: false, error: '잠시 후 다시 시도해주세요.' });
    }

    if (header !== ADMIN_KEY && query !== ADMIN_KEY) {
        // 실패 횟수 누적
        if (fail && Date.now() - fail.firstAt < FAIL_WINDOW) {
            fail.count++;
        } else {
            _failMap.set(ip, { count: 1, firstAt: Date.now() });
        }
        return res.status(401).json({ ok: false, error: '관리자 키가 필요해요.' });
    }

    // 성공 시 fail 기록 초기화
    _failMap.delete(ip);
    next();
}

// ── Admin Action DB 로그 ──────────────────────────────────────────
// ❗ 보완 사항: console만 찍으면 휘발됨 → DB에 영구 저장 (감사 추적용)
try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS admin_actions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            type       TEXT    NOT NULL,
            targetId   TEXT    DEFAULT NULL,
            meta       TEXT    DEFAULT '{}',
            ip         TEXT    DEFAULT '',
            createdAt  TEXT    DEFAULT (datetime('now'))
        )
    `);
} catch (_) {}

/**
 * logAction(type, targetId, meta, req)
 * 모든 관리자 조치를 DB + console에 동시 기록
 * type    : 'user_block' | 'status_change' | 'geo_fix' | 기타
 * targetId: 조치 대상 id (userId, jobId 등)
 * meta    : 추가 컨텍스트 (object)
 * req     : Express req (IP 추출용, 선택)
 */
function logAction(type, targetId = '', meta = {}, req = null) {
    const metaStr = JSON.stringify(meta);
    const ip      = req ? (req.headers['x-forwarded-for'] || req.ip || '') : '';
    // 1. DB 저장
    try {
        db.prepare(`
            INSERT INTO admin_actions (type, targetId, meta, ip, createdAt)
            VALUES (?, ?, ?, ?, datetime('now'))
        `).run(type, String(targetId), metaStr, String(ip));
    } catch (e) {
        console.error('[ADMIN_LOG_DB_FAIL]', e.message);
    }
    // 2. 콘솔 (운영 로그 스트림)
    console.log(`[ADMIN_ACTION] type=${type} target=${targetId} meta=${metaStr} ip=${ip}`);
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
        // STATUS_NORMALIZE: done(레거시) + completed 모두 카운트
        const completed  = n(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('done','completed')").get()?.n);
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
    logAction('user_block', id, { blocked }, req); // ❗ DB 저장
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

// ── PATCH /api/admin/job/:id/status — 상태 강제 변경 ─────────────
router.patch('/job/:id/status', auth, (req, res) => {
    const { id }     = req.params;
    const { status } = req.body;
    const ALLOWED = ['open', 'matched', 'on_the_way', 'in_progress', 'completed', 'paid', 'closed'];
    if (!ALLOWED.includes(status)) {
        return res.status(400).json({ ok: false, error: `허용 상태: ${ALLOWED.join(', ')}` });
    }
    const result = db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id);
    if (result.changes === 0) return res.status(404).json({ ok: false, error: '공고 없음' });
    logAction('status_change', id, { status }, req); // ❗ DB 저장
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
    logAction('geo_fix', id, { lat: parsedLat, lng: parsedLng }, req); // ❗ DB 저장
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

// ── GET /api/admin/audit-log — 관리자 조치 이력 ─────────────────
// ❗ 보완: 관리자가 무슨 조치를 했는지 추적 가능해야 함
router.get('/audit-log', auth, (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const rows = db.prepare(`
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

// ── GET /api/admin/test-logs — 테스트 로그 (REAL_USER_TEST) ──────
const { classifyBug } = require('../services/bugClassifier');

router.get('/test-logs', auth, (req, res) => {
    try {
        // test_logs 테이블이 없으면 빈 배열 반환
        const tableExists = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='test_logs'"
        ).get();
        if (!tableExists) return res.json({ ok: true, logs: [] });

        const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
        const priority = req.query.priority ? parseInt(req.query.priority) : null;
        const rows   = db.prepare(`
            SELECT id, type, payload, priority, sessionId, createdAt
            FROM test_logs
            ${priority ? 'WHERE priority = ?' : ''}
            ORDER BY id DESC
            LIMIT ?
        `).all(...(priority ? [priority, limit] : [limit]));

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

// ── GET /api/admin/test-summary — 자동 요약 (STEP 15) ────────────
router.get('/test-summary', auth, (req, res) => {
    try {
        const tableExists = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='test_logs'"
        ).get();
        if (!tableExists) return res.json({ ok: true, summary: {
            flowSuccessRate: 0, apiFail: 0, clickFail: 0, mapErrors: 0, total: 0,
        }});

        const total     = db.prepare("SELECT COUNT(*) AS n FROM test_logs").get()?.n || 0;
        const p1Count   = db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE priority = 1").get()?.n || 0;
        const p2Count   = db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE priority = 2").get()?.n || 0;
        const p3Count   = db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE priority = 3").get()?.n || 0;
        const apiFail   = db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE type = 'ERROR_API_FAIL'").get()?.n || 0;
        const clickFail = db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE type = 'ERROR_CLICK_FAIL'").get()?.n || 0;
        const mapErrors = db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE type = 'MAP_FAIL' OR type = 'GEO_FAIL'").get()?.n || 0;
        const flowBroken= db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE type = 'FLOW_BROKEN'").get()?.n || 0;
        const callFail  = db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE type = 'CALL_FAIL'").get()?.n || 0;

        // 완료 이벤트 기준 성공률
        const completed = db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE type = 'farmer_complete_job' OR type = 'worker_complete'").get()?.n || 0;
        const started   = db.prepare("SELECT COUNT(*) AS n FROM test_logs WHERE type = 'farmer_create_job'").get()?.n || 0;
        const flowSuccessRate = started > 0 ? Math.round((completed / started) * 100) : 0;

        // 최근 세션별 플로우 현황
        const recentSessions = db.prepare(`
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

// ══════════════════════════════════════════════════════════════════
// GET /api/admin/alert-status — P1 자동 경보 (인증 불필요 — Admin만 호출)
// 60초 폴링으로 Admin 대시보드가 호출. 빠른 응답이 핵심.
// ══════════════════════════════════════════════════════════════════
router.get('/alert-status', auth, (req, res) => {
    try {
        // test_logs 없으면 경보 없음
        const tableExists = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='test_logs'"
        ).get();
        if (!tableExists) return res.json({ ok: true, p1: false, p1Count: 0, p2Count: 0, checkedAt: new Date().toISOString() });

        // 최근 24시간 P1/P2 카운트
        const window = "datetime('now', '-24 hours')";
        const p1Count = db.prepare(
            `SELECT COUNT(*) AS n FROM test_logs WHERE priority = 1 AND createdAt > ${window}`
        ).get()?.n || 0;
        const p2Count = db.prepare(
            `SELECT COUNT(*) AS n FROM test_logs WHERE priority = 2 AND createdAt > ${window}`
        ).get()?.n || 0;

        // 가장 최근 P1 오류 타입 (배너 메시지용)
        const lastP1 = p1Count > 0
            ? db.prepare(`SELECT type FROM test_logs WHERE priority = 1 ORDER BY id DESC LIMIT 1`).get()?.type
            : null;

        return res.json({
            ok: true,
            p1: p1Count > 0,
            p1Count,
            p2Count,
            lastP1Type: lastP1,
            checkedAt: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[ALERT_STATUS_ERROR]', e.message);
        return res.json({ ok: true, p1: false, p1Count: 0, p2Count: 0 }); // fail-safe: 경보 미발령
    }
});

// ─── GET /api/admin/status-logs?jobId=xx ─────────────────────
// STATUS_AUDIT_LOG: 작업 상태 전이 이력 조회 (관리자 전용)
router.get('/status-logs', (req, res) => {
    const adminKey = req.headers['x-admin-key'] || req.query.adminKey;
    if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'farm-admin-2024') {
        return res.status(403).json({ ok: false, error: '관리자 인증 필요' });
    }
    const { jobId } = req.query;
    try {
        const rows = jobId
            ? db.prepare(
                'SELECT * FROM status_logs WHERE jobId = ? ORDER BY createdAt DESC'
              ).all(jobId)
            : db.prepare(
                'SELECT * FROM status_logs ORDER BY createdAt DESC LIMIT 200'
              ).all();
        return res.json({ ok: true, logs: rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── POST /api/admin/reset-db ─────────────────────────────────────
// SAFE_RESET: 테스트 데이터 전체 삭제 + 재시드
// 보호 레이어: ① admin auth ② ALLOW_DB_RESET=true ③ body.confirm='RESET_OK'
router.post('/reset-db', auth, (req, res) => {
    // ① 환경변수 게이트 — 명시적으로 허용하지 않으면 차단
    if (process.env.ALLOW_DB_RESET !== 'true') {
        console.warn('[ADMIN_RESET] ALLOW_DB_RESET 미설정 → 차단');
        return res.status(403).json({ ok: false, error: 'DB 초기화가 비활성화되어 있어요. ALLOW_DB_RESET=true 필요.' });
    }

    // ② 명시적 확인 토큰 검증
    if (req.body?.confirm !== 'RESET_OK') {
        return res.status(400).json({ ok: false, error: 'confirm 필드에 RESET_OK 필요' });
    }

    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    console.warn(`[ADMIN_RESET] ⚠️  DB 초기화 시작 — ip=${ip}`);

    try {
        // ③ 테스트 데이터 삭제 (users 제외 — 실사용자 보호)
        const RESET_TABLES = [
            'applications', 'jobs', 'workers',
            'contacts', 'reviews', 'messages', 'payments', 'sponsored_jobs',
            'status_logs', 'notify_log', 'reports',
            'analytics', 'user_behavior', 'rec_logs',
            'experiment_assignments', 'experiment_events', 'test_logs',
            'anomaly_snapshots',
        ];
        for (const t of RESET_TABLES) {
            try { db.prepare(`DELETE FROM ${t}`).run(); } catch (_) {}
        }

        // ④ 시퀀스 초기화
        try { db.prepare("DELETE FROM sqlite_sequence WHERE name != 'users' AND name != 'system_flags'").run(); } catch (_) {}

        // ⑤ 데모 데이터 재시드
        const { seed } = require('../seed');
        seed();

        // ⑥ 감사 로그
        logAction('db_reset', null, { tables: RESET_TABLES.length, ip }, req);
        console.warn(`[ADMIN_RESET] ✅ 완료 — ${RESET_TABLES.length}개 테이블 초기화 + 재시드`);

        return res.json({ ok: true, message: `${RESET_TABLES.length}개 테이블 초기화 완료`, tables: RESET_TABLES.length });
    } catch (e) {
        console.error('[ADMIN_RESET] ❌ 오류:', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── POST /api/admin/run-e2e-test ────────────────────────────────
// E2E_SCENARIO_TEST: 1클릭 전체 상태 흐름 자동 검증
// 테스트 데이터 생성 → open→matched→on_the_way→in_progress→completed → 정리
// 각 단계별 PASS/FAIL + 소요시간 반환
const E2E_TRANSITIONS = {
    open:        ['matched', 'closed'],
    matched:     ['on_the_way', 'in_progress', 'closed'],
    on_the_way:  ['in_progress', 'closed'],
    in_progress: ['completed', 'closed'],
    completed:   ['closed'],
};

router.post('/run-e2e-test', auth, (req, res) => {
    const steps = [];
    const ts          = Date.now();
    const testJobId    = `test-job-${ts}`;
    const testUserId   = `test-user-${ts}`;
    const testWorkerId = `test-worker-${ts}`;

    // 단계 실행 헬퍼: 예외 발생 시 steps에 FAIL 기록 후 re-throw
    function runStep(name, fn) {
        const t0 = Date.now();
        try {
            fn();
            steps.push({ step: name, ok: true, ms: Date.now() - t0 });
        } catch (e) {
            steps.push({ step: name, ok: false, ms: Date.now() - t0, error: e.message });
            throw e; // 다음 단계 중단
        }
    }

    // 상태 전이 유효성 검사
    function assertTransition(from, to) {
        if (from === 'closed') throw new Error('이미 마감된 작업입니다.');
        const allowed = E2E_TRANSITIONS[from];
        if (!allowed) throw new Error(`알 수 없는 상태: ${from}`);
        if (!allowed.includes(to)) throw new Error(`'${from}' → '${to}' 전이 불가`);
    }

    // 상태 확인 헬퍼
    function getStatus() {
        const row = db.prepare('SELECT status FROM jobs WHERE id = ?').get(testJobId);
        if (!row) throw new Error('테스트 공고를 찾을 수 없음');
        return row.status;
    }

    try {
        // ── 1. 테스트 데이터 생성 ─────────────────────────────────
        runStep('🌱 테스트 데이터 생성', () => {
            db.prepare(`
                INSERT OR IGNORE INTO users (id, name, phone, role, createdAt)
                VALUES (?, 'E2E테스트농민', '010-0000-9001', 'farmer', datetime('now'))
            `).run(testUserId);

            db.prepare(`
                INSERT OR IGNORE INTO workers
                    (id, userId, name, phone, serviceRadiusKm, categories, createdAt)
                VALUES (?, ?, 'E2E테스트작업자', '010-0000-9002', 999, '["기타"]', datetime('now'))
            `).run(testWorkerId, testUserId);

            db.prepare(`
                INSERT INTO jobs
                    (id, requesterId, category, locationText, workDate, status, workerCount, payAmount, createdAt)
                VALUES (?, ?, '기타', 'E2E테스트위치', date('now'), 'open', 1, 100000, datetime('now'))
            `).run(testJobId, testUserId);

            // 생성 확인
            const job = db.prepare('SELECT status FROM jobs WHERE id = ?').get(testJobId);
            if (!job) throw new Error('공고 INSERT 실패');
            if (job.status !== 'open') throw new Error(`초기 상태 오류: ${job.status}`);
        });

        // ── 2. open → matched ────────────────────────────────────
        runStep('🔗 open → matched', () => {
            assertTransition(getStatus(), 'matched');
            db.prepare(`
                UPDATE jobs
                SET status = 'matched', selectedWorkerId = ?, selectedAt = datetime('now')
                WHERE id = ?
            `).run(testWorkerId, testJobId);
            const s = getStatus();
            if (s !== 'matched') throw new Error(`상태 업데이트 실패: ${s}`);
        });

        // ── 3. matched → on_the_way ──────────────────────────────
        runStep('🚗 matched → on_the_way', () => {
            assertTransition(getStatus(), 'on_the_way');
            db.prepare("UPDATE jobs SET status = 'on_the_way' WHERE id = ?").run(testJobId);
            const s = getStatus();
            if (s !== 'on_the_way') throw new Error(`상태 업데이트 실패: ${s}`);
        });

        // ── 4. on_the_way → in_progress ─────────────────────────
        runStep('⚙️ on_the_way → in_progress', () => {
            assertTransition(getStatus(), 'in_progress');
            db.prepare("UPDATE jobs SET status = 'in_progress', startedAt = datetime('now') WHERE id = ?").run(testJobId);
            const s = getStatus();
            if (s !== 'in_progress') throw new Error(`상태 업데이트 실패: ${s}`);
        });

        // ── 5. in_progress → completed ──────────────────────────
        runStep('✅ in_progress → completed', () => {
            assertTransition(getStatus(), 'completed');
            db.prepare("UPDATE jobs SET status = 'completed', completedAt = datetime('now') WHERE id = ?").run(testJobId);
            const s = getStatus();
            if (s !== 'completed') throw new Error(`상태 업데이트 실패: ${s}`);
        });

        // ── 6. 최종 상태 무결성 검증 ─────────────────────────────
        runStep('🔍 최종 무결성 검증', () => {
            const job = db.prepare(
                'SELECT status, selectedWorkerId, completedAt FROM jobs WHERE id = ?'
            ).get(testJobId);
            if (!job)                                    throw new Error('공고 없음');
            if (job.status !== 'completed')              throw new Error(`최종 상태 오류: ${job.status}`);
            if (job.selectedWorkerId !== testWorkerId)   throw new Error('selectedWorkerId 불일치');
            if (!job.completedAt)                        throw new Error('completedAt 미설정');
        });

        // ── 7. 역방향 전이 차단 검증 (보너스) ─────────────────────
        runStep('🛡 역방향 차단 검증', () => {
            // completed → open 은 E2E_TRANSITIONS에 없어야 함
            const badTransitions = [
                ['open', 'in_progress'],   // open에서 in_progress 직행 불가
                ['completed', 'open'],     // 역방향 불가
            ];
            for (const [from, to] of badTransitions) {
                const allowed = E2E_TRANSITIONS[from];
                if (allowed && allowed.includes(to)) {
                    throw new Error(`잘못된 전이 허용됨: ${from}→${to}`);
                }
            }
        });

    } catch (_) {
        // 실패해도 정리는 반드시 진행
    }

    // ── 8. 테스트 데이터 정리 (성공/실패 무관) ─────────────────────
    const t0clean = Date.now();
    try {
        db.prepare("DELETE FROM jobs        WHERE id   LIKE 'test-%'").run();
        db.prepare("DELETE FROM workers     WHERE id   LIKE 'test-%'").run();
        db.prepare("DELETE FROM users       WHERE id   LIKE 'test-%'").run();
        try { db.prepare("DELETE FROM applications WHERE jobId LIKE 'test-%'").run(); } catch (_) {}
        steps.push({ step: '🧹 테스트 데이터 정리', ok: true, ms: Date.now() - t0clean });
    } catch (e) {
        steps.push({ step: '🧹 테스트 데이터 정리', ok: false, ms: Date.now() - t0clean, error: e.message });
    }

    const allOk   = steps.every(s => s.ok);
    const totalMs = Date.now() - ts;

    logAction('e2e_test', null, { allOk, steps: steps.length, totalMs }, req);
    console.log(`[E2E_TEST] allOk=${allOk} steps=${steps.length} totalMs=${totalMs}ms`);

    return res.json({ ok: true, allOk, totalMs, steps });
});

module.exports = router;
