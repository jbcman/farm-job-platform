'use strict';
const express = require('express');
const db      = require('../db');
const { rankWorkers, distLabel } = require('../services/matchingEngine');

const router = express.Router();

// LIVE_LOCATION_THROTTLE: jobId당 최소 3초 간격 (WS flood 방지)
const _locEmitTs = new Map(); // Map<jobId, lastEmitMs>

function canEmit(jobId) {
    const now  = Date.now();
    const last = _locEmitTs.get(jobId) || 0;
    if (now - last >= 3000) {
        _locEmitTs.set(jobId, now);
        return true;
    }
    return false;
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

// ─── GET /api/workers/nearby ──────────────────────────────────
router.get('/nearby', async (req, res) => {
    const { lat, lon, category } = req.query;
    const userLat = lat ? parseFloat(lat) : null;
    const userLon = lon ? parseFloat(lon) : null;

    const allWorkers = (await db.prepare('SELECT * FROM workers').all()).map(normalizeWorker);
    const ranked = rankWorkers(allWorkers, { lat: userLat, lon: userLon, category })
        .map(w => ({
            id:               w.id,
            name:             w.name,
            baseLocationText: w.baseLocationText,
            categories:       w.categories,
            hasTractor:       w.hasTractor,
            hasSprayer:       w.hasSprayer,
            hasRotary:        w.hasRotary,
            completedJobs:    w.completedJobs,
            rating:           w.rating,
            availableTimeText: w.availableTimeText,
            // GPS 있을 때만 거리 표시
            distLabel: (userLat && userLon && w._dist > 0) ? distLabel(w._dist) : null,
            _score:    w._score,
        }));

    console.log(`[WORKERS_VIEWED] count=${ranked.length} gps=${lat ? 'on' : 'off'}`);
    return res.json({ ok: true, workers: ranked });
});

// ─── POST /api/workers/location — PHASE AUTO_MATCH_ALERT ──────
// 작업자 앱이 GPS 취득 시 서버에 현재 위치 저장 (실시간 매칭용)
router.post('/location', async (req, res) => {
    const userId = req.headers['x-user-id'] || req.body?.userId;
    const { lat, lng } = req.body || {};

    if (!userId || lat == null || lng == null) {
        return res.status(400).json({ ok: false, error: 'userId, lat, lng 필요' });
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
        return res.status(400).json({ ok: false, error: '유효하지 않은 좌표' });
    }

    // workers 테이블에서 userId로 찾아 현재 위치 갱신 + activeNow=1 (최근 활동 표시)
    const result = await db.prepare(`
        UPDATE workers
        SET currentLat = ?, currentLng = ?, locationUpdatedAt = ?, activeNow = 1
        WHERE userId = ?
    `).run(latNum, lngNum, new Date().toISOString(), userId);

    if (result.changes === 0) {
        // workers 프로필 없는 사용자 — 무시 (farmer 등)
        return res.json({ ok: true, updated: false });
    }

    // LIVE_LOCATION: 선택된 작업자만 WS emit (보안 검증 + throttle)
    try {
        const workerRow = await db.prepare('SELECT id FROM workers WHERE userId = ?').get(userId);
        if (workerRow) {
            // ① 해당 작업자가 selectedWorkerId 로 지정된 active job만 허용
            const activeJob = await db.prepare(
                "SELECT id, selectedWorkerId FROM jobs WHERE selectedWorkerId = ? AND status IN ('on_the_way','in_progress')"
            ).get(workerRow.id);

            if (!activeJob) {
                // 배정된 active job 없음 — DB 저장은 유지(매칭 점수용), WS emit만 스킵
                return res.json({ ok: true, updated: true, emit: false });
            }

            // ② 명시적 작업자 검증 (이중 보호)
            if (activeJob.selectedWorkerId !== workerRow.id) {
                return res.status(403).json({ ok: false, error: '배정된 작업자만 위치를 전송할 수 있어요.' });
            }

            // ③ Throttle: jobId당 3초 간격 이내 요청 무시
            if (canEmit(activeJob.id) && typeof global.emitToJob === 'function') {
                global.emitToJob(activeJob.id, {
                    type:     'location_update',
                    jobId:    activeJob.id,
                    workerId: userId,
                    lat:      latNum,
                    lng:      lngNum,
                    ts:       new Date().toISOString(),
                });
            }
        }
    } catch (_) {}

    console.log(`[WORKER_LOC_UPDATE] userId=${userId} (${latNum}, ${lngNum})`);
    return res.json({ ok: true, updated: true });
});

// ─── POST /api/workers/heartbeat — ACTIVE_NOW_RELIABILITY ────
// 작업자 앱이 주기적으로 호출 → locationUpdatedAt 갱신 → V2 보너스 유지
// 좌표 없이도 "지금 활동 중" 신호만 전송 가능
router.post('/heartbeat', async (req, res) => {
    const userId = req.headers['x-user-id'] || req.body?.userId;
    if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId 필요' });
    }

    const now = new Date().toISOString();
    const result = await db.prepare(`
        UPDATE workers
        SET activeNow = 1, locationUpdatedAt = ?
        WHERE userId = ?
    `).run(now, userId);

    if (result.changes === 0) {
        // workers 프로필 없는 사용자 (농민 등) — 무시
        return res.json({ ok: true, updated: false });
    }

    return res.json({ ok: true, updated: true, activeUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
});

module.exports = router;
