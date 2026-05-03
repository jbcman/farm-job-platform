'use strict';
/**
 * anomalyDetector.js — 이상 감지 → SAFE_MODE (PostgreSQL 비동기)
 */
const db = require('../db');
const { getFlag, setFlag } = require('./systemFlagService');

const WINDOW_MS       = 10 * 60 * 1000;
const CTR_THRESHOLD   = 0.05;
const APPLY_THRESHOLD = 0.01;

const stmtEvents   = db.prepare(`
    SELECT eventType, COUNT(*) AS cnt
    FROM experiment_events
    WHERE createdAt >= ?
    GROUP BY eventType
`);
const stmtSnapshot = db.prepare(
    'INSERT INTO anomaly_snapshots (ctr, applyRate, ts) VALUES (?, ?, ?)'
);

async function detect() {
    try {
        const since = Date.now() - WINDOW_MS;
        const rows  = await stmtEvents.all(since);

        const countOf = (type) => rows.find(r => r.eventType === type)?.cnt ?? 0;
        const impr    = countOf('impression');
        if (impr === 0) return;

        const ctr       = countOf('view')  / impr;
        const applyRate = countOf('apply') / impr;

        await stmtSnapshot.run(ctr, applyRate, Date.now());

        const events = [];
        if (ctr       < CTR_THRESHOLD)   events.push({ type: 'CTR_DROP',   ctr });
        if (applyRate < APPLY_THRESHOLD) events.push({ type: 'APPLY_DROP', applyRate });

        if (events.length > 0) {
            const critical = events.some(e => e.type === 'CTR_DROP' || e.type === 'APPLY_DROP');
            if (critical && !(await getFlag('SAFE_MODE'))) {
                await setFlag('SAFE_MODE', true);
                console.warn('[ANOMALY] SAFE_MODE 활성화 →', events.map(e => e.type).join(', '),
                    `ctr=${ctr.toFixed(3)} applyRate=${applyRate.toFixed(3)}`);
            }
        }
    } catch (_) {}
}

module.exports = { detect };
