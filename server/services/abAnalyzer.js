'use strict';
/**
 * abAnalyzer.js — 실험 이벤트 분석 → 승자 결정 (PostgreSQL 비동기)
 */
const db = require('../db');

const MIN_IMPRESSIONS = 200;
const MIN_LIFT        = 0.05;

const stmtStats = db.prepare(`
    SELECT variantKey,
           SUM(CASE WHEN eventType = 'impression' THEN 1 ELSE 0 END) AS impressions,
           SUM(CASE WHEN eventType = 'apply'      THEN 1 ELSE 0 END) AS applies
    FROM experiment_events
    WHERE experimentId = ?
    GROUP BY variantKey
`);

async function analyzeExperiment(experimentId) {
    const rows = await stmtStats.all(experimentId);
    if (rows.length < 2) return null;

    const stats = rows.map(r => ({
        key:         r.variantKey,
        impressions: Number(r.impressions) || 0,
        applyRate:   r.impressions ? (Number(r.applies) || 0) / Number(r.impressions) : 0,
    }));

    const valid = stats.filter(s => s.impressions >= MIN_IMPRESSIONS);
    if (valid.length < 2) return null;

    valid.sort((a, b) => b.applyRate - a.applyRate);
    const best   = valid[0];
    const second = valid[1];

    const lift = second.applyRate > 0
        ? (best.applyRate - second.applyRate) / second.applyRate
        : (best.applyRate > 0 ? 1 : 0);

    if (lift < MIN_LIFT) return null;

    return { winner: best.key, lift, applyRate: best.applyRate };
}

module.exports = { analyzeExperiment, MIN_IMPRESSIONS, MIN_LIFT };
