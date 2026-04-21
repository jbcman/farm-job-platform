'use strict';
const express  = require('express');
const db       = require('../db');
const { rankJobs, distLabel, distanceKm }             = require('../services/matchingEngine');
const { suggestCategory, generateTitle, suggestUrgent, getPriceGuide } = require('../services/smartAssist');
const {
    sendSelectionNotification,
    sendJobStartedNotification,
    sendJobCompletedNotification,
} = require('../services/notificationService');
const { trackEvent }              = require('../services/analyticsService');
const { findMatchingWorkers }     = require('../services/matchingService');
const { sendJobMatchAlert }       = require('../services/kakaoAlertService');

const router = express.Router();

// ─── 유틸 ────────────────────────────────────────────────────
function newId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** DB row → JS object (정수 Boolean 정규화) */
function normalizeJob(row) {
    if (!row) return null;
    return { ...row, isUrgent: !!row.isUrgent };
}

function normalizeWorker(row) {
    if (!row) return null;
    return {
        ...row,
        categories: typeof row.categories === 'string'
            ? JSON.parse(row.categories)
            : (row.categories || []),
        hasTractor: !!row.hasTractor,
        hasSprayer: !!row.hasSprayer,
        hasRotary:  !!row.hasRotary,
    };
}

/** 작업별 지원자 수 (DB 조회) */
function appCountForJob(jobId) {
    return db.prepare(
        "SELECT COUNT(*) as n FROM applications WHERE jobRequestId = ? AND status != 'cancelled'"
    ).get(jobId).n;
}

/** 작업 응답 포맷 (거리 정보 포함) */
function jobView(job, opts = {}) {
    const { userLat, userLon } = opts;
    const dist = (userLat && userLon)
        ? distanceKm(userLat, userLon, job.latitude, job.longitude)
        : null;
    return {
        ...job,
        applicationCount: appCountForJob(job.id),
        distKm:    dist !== null ? Math.round(dist * 10) / 10 : null,
        distLabel: dist !== null ? distLabel(dist) : null,
    };
}

// ─── 특정 경로 먼저 (/:id 보다 앞에 정의) ─────────────────────

// ─── GET /api/jobs/my/jobs ────────────────────────────────────
router.get('/my/jobs', (req, res) => {
    const { userId } = req.query;
    const rows = db.prepare(
        'SELECT * FROM jobs WHERE requesterId = ? ORDER BY createdAt DESC'
    ).all(userId);
    const myJobs = rows.map(r => jobView(normalizeJob(r)));
    return res.json({ ok: true, jobs: myJobs });
});

// ─── GET /api/jobs/my/applications ───────────────────────────
router.get('/my/applications', (req, res) => {
    const { userId } = req.query;
    const worker = db.prepare('SELECT * FROM workers WHERE userId = ?').get(userId);
    if (!worker) return res.json({ ok: true, applications: [] });

    const apps = db.prepare(
        'SELECT * FROM applications WHERE workerId = ? ORDER BY createdAt DESC'
    ).all(worker.id);

    const result = apps.map(a => {
        const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(a.jobRequestId);
        return { ...a, job: jobRow ? jobView(normalizeJob(jobRow)) : null };
    });

    return res.json({ ok: true, applications: result });
});

// ─── POST /api/jobs/smart-assist ─────────────────────────────
router.post('/smart-assist', (req, res) => {
    const { text, category, locationText, date, areaSize, areaUnit } = req.body;

    const suggestion  = suggestCategory(text || '');
    const resolvedCat = category || suggestion.category;
    const title       = resolvedCat
        ? generateTitle({ category: resolvedCat, locationText, date, areaSize, areaUnit })
        : null;
    const isUrgent   = suggestUrgent({ note: text || '', date });
    const priceGuide = resolvedCat
        ? getPriceGuide(resolvedCat, parseInt(areaSize), areaUnit)
        : null;

    return res.json({
        ok: true,
        suggestedCategory: suggestion.category,
        confidence:        suggestion.confidence,
        title,
        isUrgent,
        priceGuide,
    });
});

// ─── POST /api/jobs ───────────────────────────────────────────
router.post('/', (req, res) => {
    const {
        requesterId, requesterName, category, locationText,
        latitude, longitude, date, timeSlot,
        areaSize, areaUnit, pay, note, imageUrl,
    } = req.body;

    if (!requesterId || !category || !locationText || !date) {
        return res.status(400).json({ ok: false, error: '필수 항목이 빠졌어요.' });
    }

    const isUrgent = suggestUrgent({ note: note || '', date });
    const id       = newId('job');
    const row = {
        id, requesterId,
        requesterName: requesterName || '농민',
        category, locationText,
        latitude:  parseFloat(latitude)  || 37.5,
        longitude: parseFloat(longitude) || 127.0,
        date, timeSlot: timeSlot || '협의',
        areaSize:  parseInt(areaSize) || null,
        areaUnit:  areaUnit || '평',
        pay:       pay || null,
        note:      note    || '',
        imageUrl:  imageUrl || null,
        isUrgent:  isUrgent ? 1 : 0,
        status:    'open',
        createdAt: new Date().toISOString(),
    };

    db.prepare(`
        INSERT INTO jobs
        (id, requesterId, requesterName, category, locationText,
         latitude, longitude, date, timeSlot, areaSize, areaUnit,
         pay, note, imageUrl, isUrgent, status, createdAt)
        VALUES
        (@id, @requesterId, @requesterName, @category, @locationText,
         @latitude, @longitude, @date, @timeSlot, @areaSize, @areaUnit,
         @pay, @note, @imageUrl, @isUrgent, @status, @createdAt)
    `).run(row);

    console.log(`[JOB_CREATED] id=${id} category=${category} location=${locationText} urgent=${isUrgent}`);
    trackEvent('job_created', { jobId: id, userId: requesterId, meta: { category } });

    // ── Phase 2: 관심 분야 매칭 알림 (DB 저장 성공 후에만 발송) ──────
    setImmediate(async () => {
        try {
            const targets = findMatchingWorkers({ category, locationText });
            if (targets.length === 0) {
                console.log(`[MATCH_ALERT] no matching workers for job=${id}`);
                return;
            }
            console.log(`[MATCH_ALERT] job=${id} sending to ${targets.length} worker(s)`);
            for (const t of targets) {
                await sendJobMatchAlert({
                    jobId:        id,
                    phone:        t.phone,
                    name:         t.name,
                    jobType:      category,
                    locationText,
                    pay:          pay || null,
                    date,
                });
            }
        } catch (e) {
            console.error('[MATCH_ALERT_ERROR]', e.message);
        }
    });

    return res.status(201).json({ ok: true, job: jobView(normalizeJob(row)) });
});

// ─── GET /api/jobs ────────────────────────────────────────────
router.get('/', (req, res) => {
    const { category, date, lat, lon, radius = 200 } = req.query;
    const userLat = lat ? parseFloat(lat) : null;
    const userLon = lon ? parseFloat(lon) : null;

    const allJobs = db.prepare('SELECT * FROM jobs').all().map(normalizeJob);
    const ranked  = rankJobs(allJobs, {
        category, date,
        userLat, userLon,
        radiusKm: parseFloat(radius),
    }).map(j => jobView(j, { userLat, userLon }));

    console.log(`[JOB_LIST_VIEWED] count=${ranked.length} category=${category || 'all'} gps=${lat ? 'on' : 'off'}`);
    return res.json({ ok: true, jobs: ranked });
});

// ─── GET /api/jobs/:id ────────────────────────────────────────
router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    return res.json({ ok: true, job: jobView(normalizeJob(row)) });
});

// ─── POST /api/jobs/:id/apply ─────────────────────────────────
router.post('/:id/apply', (req, res) => {
    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job)              return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    if (job.status !== 'open') return res.status(400).json({ ok: false, error: '마감된 작업이에요.' });

    const { workerId, message = '' } = req.body;
    if (!workerId) return res.status(400).json({ ok: false, error: 'workerId가 필요해요.' });

    // 중복 지원 방지
    const already = db.prepare(
        'SELECT id FROM applications WHERE jobRequestId = ? AND workerId = ?'
    ).get(job.id, workerId);
    if (already) return res.status(409).json({ ok: false, error: '이미 지원했어요.' });

    const id  = newId('app');
    const app = {
        id, jobRequestId: job.id, workerId, message,
        status: 'applied', createdAt: new Date().toISOString(),
    };
    db.prepare(`
        INSERT INTO applications (id, jobRequestId, workerId, message, status, createdAt)
        VALUES (@id, @jobRequestId, @workerId, @message, @status, @createdAt)
    `).run(app);

    console.log(`[JOB_APPLIED] jobId=${job.id} workerId=${workerId}`);
    trackEvent('job_applied', { jobId: job.id, userId: workerId, meta: { category: job.category } });
    return res.status(201).json({ ok: true, application: app });
});

// ─── GET /api/jobs/:id/applicants ─────────────────────────────
router.get('/:id/applicants', (req, res) => {
    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { requesterId } = req.query;
    if (requesterId && job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 요청만 볼 수 있어요.' });
    }

    const apps = db.prepare(
        "SELECT * FROM applications WHERE jobRequestId = ? AND status != 'cancelled'"
    ).all(job.id);

    const result = apps.map(a => {
        const worker = normalizeWorker(
            db.prepare('SELECT * FROM workers WHERE id = ?').get(a.workerId)
        );
        const dist = (job.latitude && worker)
            ? distanceKm(job.latitude, job.longitude, worker.latitude, worker.longitude)
            : null;
        return {
            applicationId: a.id,
            status:        a.status,
            message:       a.message,
            createdAt:     a.createdAt,
            worker: worker ? {
                id:               worker.id,
                name:             worker.name,
                baseLocationText: worker.baseLocationText,
                categories:       worker.categories,
                hasTractor:       worker.hasTractor,
                hasSprayer:       worker.hasSprayer,
                hasRotary:        worker.hasRotary,
                completedJobs:    worker.completedJobs,
                rating:           worker.rating,
                availableTimeText: worker.availableTimeText,
                distLabel:        dist !== null ? distLabel(dist) : null,
            } : null,
        };
    });

    console.log(`[APPLICANT_VIEWED] jobId=${job.id} count=${result.length}`);
    return res.json({ ok: true, applicants: result });
});

// ─── POST /api/jobs/:id/select-worker ─────────────────────────
router.post('/:id/select-worker', (req, res) => {
    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { requesterId, workerId } = req.body;
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 요청만 선택할 수 있어요.' });
    }

    const worker = normalizeWorker(
        db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId)
    );
    if (!worker) return res.status(404).json({ ok: false, error: '작업자를 찾을 수 없어요.' });

    // 트랜잭션: 상태 일괄 업데이트
    db.transaction(() => {
        db.prepare("UPDATE jobs SET status = 'matched' WHERE id = ?").run(job.id);
        db.prepare("UPDATE applications SET status = 'selected' WHERE jobRequestId = ? AND workerId = ?").run(job.id, workerId);
        db.prepare("UPDATE applications SET status = 'rejected' WHERE jobRequestId = ? AND workerId != ?").run(job.id, workerId);

        // 연락처 영속화 (contacts 테이블)
        const contactId = 'contact-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        try {
            db.prepare(`
                INSERT OR IGNORE INTO contacts (id, jobId, farmerId, workerId, createdAt)
                VALUES (@id, @jobId, @farmerId, @workerId, @createdAt)
            `).run({
                id:        contactId,
                jobId:     job.id,
                farmerId:  job.requesterId,
                workerId:  workerId,
                createdAt: new Date().toISOString(),
            });
        } catch (_) { /* UNIQUE 충돌 시 무시 */ }
    })();

    console.log(`[CONTACT_STORED] jobId=${job.id} farmerId=${job.requesterId} workerId=${workerId}`);

    // 알림 훅 (콘솔 로그 → 카카오 알림톡으로 확장 가능)
    sendSelectionNotification(job, worker);

    const farmerPhone = '010-0000-' + requesterId.slice(-4).padStart(4, '0');
    console.log(`[WORKER_SELECTED] jobId=${job.id} workerId=${workerId}`);
    console.log(`[CONTACT_REVEALED] jobId=${job.id} farmer<->worker`);
    trackEvent('worker_selected', { jobId: job.id, userId: requesterId, meta: { workerId } });

    return res.json({
        ok: true,
        contact: {
            workerName:  worker.name,
            workerPhone: worker.phone,
            farmerName:  job.requesterName,
            farmerPhone,
            message: `${worker.name}님이 선택되었어요! 연락처를 확인하고 직접 연락해보세요.`,
        },
    });
});

// ─── POST /api/jobs/:id/start ─────────────────────────────────
router.post('/:id/start', (req, res) => {
    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { requesterId } = req.body;
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 작업만 시작할 수 있어요.' });
    }
    if (job.status !== 'matched') {
        return res.status(400).json({ ok: false, error: `현재 상태(${job.status})에서는 시작할 수 없어요.` });
    }

    db.prepare("UPDATE jobs SET status = 'in_progress' WHERE id = ?").run(job.id);

    // 선택된 작업자 조회 → 알림
    const selApp = db.prepare(
        "SELECT workerId FROM applications WHERE jobRequestId = ? AND status = 'selected'"
    ).get(job.id);
    if (selApp) {
        const worker = normalizeWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(selApp.workerId));
        if (worker) sendJobStartedNotification(job, worker);
    }

    console.log(`[JOB_STARTED] id=${job.id}`);
    return res.json({ ok: true, status: 'in_progress' });
});

// ─── POST /api/jobs/:id/complete ──────────────────────────────
router.post('/:id/complete', (req, res) => {
    const job = normalizeJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });

    const { requesterId } = req.body;
    if (job.requesterId !== requesterId) {
        return res.status(403).json({ ok: false, error: '내 작업만 완료할 수 있어요.' });
    }
    if (job.status !== 'in_progress') {
        return res.status(400).json({ ok: false, error: `현재 상태(${job.status})에서는 완료할 수 없어요.` });
    }

    db.prepare("UPDATE jobs SET status = 'done' WHERE id = ?").run(job.id);

    // 선택된 작업자 조회 → 알림
    const selApp = db.prepare(
        "SELECT workerId FROM applications WHERE jobRequestId = ? AND status = 'selected'"
    ).get(job.id);
    if (selApp) {
        const worker = normalizeWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(selApp.workerId));
        if (worker) sendJobCompletedNotification(job, worker);
    }

    console.log(`[JOB_COMPLETED] id=${job.id}`);
    trackEvent('job_completed', { jobId: job.id, userId: requesterId, meta: { category: job.category } });
    return res.json({ ok: true, status: 'done' });
});

module.exports = router;
