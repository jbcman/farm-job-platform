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

module.exports = router;
