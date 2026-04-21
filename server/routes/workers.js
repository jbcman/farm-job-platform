'use strict';
const express = require('express');
const db      = require('../db');
const { rankWorkers, distLabel } = require('../services/matchingEngine');

const router = express.Router();

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
router.get('/nearby', (req, res) => {
    const { lat, lon, category } = req.query;
    const userLat = lat ? parseFloat(lat) : null;
    const userLon = lon ? parseFloat(lon) : null;

    const allWorkers = db.prepare('SELECT * FROM workers').all().map(normalizeWorker);
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
router.post('/location', (req, res) => {
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

    // workers 테이블에서 userId로 찾아 현재 위치 갱신
    const result = db.prepare(`
        UPDATE workers
        SET currentLat = ?, currentLng = ?, locationUpdatedAt = ?
        WHERE userId = ?
    `).run(latNum, lngNum, new Date().toISOString(), userId);

    if (result.changes === 0) {
        // workers 프로필 없는 사용자 — 무시 (farmer 등)
        return res.json({ ok: true, updated: false });
    }

    console.log(`[WORKER_LOC_UPDATE] userId=${userId} (${latNum}, ${lngNum})`);
    return res.json({ ok: true, updated: true });
});

module.exports = router;
