'use strict';
/**
 * anomalyDetector.js — PHASE SAFE_MODE_KILLSWITCH
 *
 * experiment_events 기반 이상 감지 (최근 10분 윈도우).
 *
 * 이상 기준:
 *   CTR_DROP   : impression 대비 view 클릭률 < 5%
 *   APPLY_DROP : impression 대비 apply 비율 < 1%
 *
 * 감지 시 → SAFE_MODE = true + anomaly_snapshots 기록
 * 정상 시 → anomaly_snapshots만 기록 (복구 판단 소스)
 *
 * 10분마다 실행 (index.js setInterval).
 */
const db = require('../db');
const { getFlag, setFlag } = require('./systemFlagService');

const WINDOW_MS      = 10 * 60 * 1000; // 최근 10분
const CTR_THRESHOLD  = 0.05;           // 5% 미만 → CTR_DROP
const APPLY_THRESHOLD = 0.01;          // 1% 미만 → APPLY_DROP

const stmtEvents = db.prepare(`
    SELECT eventType, COUNT(*) AS cnt
    FROM experiment_events
    WHERE createdAt >= ?
    GROUP BY eventType
`);

const stmtSnapshot = db.prepare(`
    INSERT INTO anomaly_snapshots (ctr, applyRate, ts) VALUES (?, ?, ?)
`);

function detect() {
    try {
        const since  = Date.now() - WINDOW_MS;
        const rows   = stmtEvents.all(since);

        const countOf = (type) => rows.find(r => r.eventType === type)?.cnt ?? 0;
        const impr    = countOf('impression');

        if (impr === 0) return; // 데이터 없음 → 판단 보류

        const ctr       = countOf('view')  / impr;
        const applyRate = countOf('apply') / impr;

        // 스냅샷 저장 (복구 판단용)
        stmtSnapshot.run(ctr, applyRate, Date.now());

        const events = [];
        if (ctr       < CTR_THRESHOLD)   events.push({ type: 'CTR_DROP',   ctr });
        if (applyRate < APPLY_THRESHOLD) events.push({ type: 'APPLY_DROP', applyRate });

        if (events.length > 0) {
            const critical = events.some(e =>
                e.type === 'CTR_DROP' || e.type === 'APPLY_DROP'
            );
            if (critical && !getFlag('SAFE_MODE')) {
                setFlag('SAFE_MODE', true);
                console.warn('[ANOMALY] SAFE_MODE 활성화 →', events.map(e => e.type).join(', '),
                    `ctr=${ctr.toFixed(3)} applyRate=${applyRate.toFixed(3)}`);
            }
        }
    } catch (_) {}
}

module.exports = { detect };
