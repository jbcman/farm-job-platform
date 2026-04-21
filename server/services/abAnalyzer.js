'use strict';
/**
 * abAnalyzer.js — PHASE AUTO_WINNER
 *
 * 실험 이벤트 데이터 분석 → 통계적으로 유효한 승자 반환
 *
 * 승자 결정 조건 (AND):
 *   1. 모든 variant 표본 ≥ MIN_IMPRESSIONS (200)
 *   2. 최고 applyRate vs 2위 lift ≥ MIN_LIFT (5%)
 * 조건 미충족 시 null 반환 → 승격 금지
 */
const db = require('../db');

const MIN_IMPRESSIONS = 200;  // 최소 노출 수 (통계 안정성)
const MIN_LIFT        = 0.05; // 최소 5% 개선 (실질적 차이)

const stmtStats = db.prepare(`
    SELECT variantKey,
           SUM(CASE WHEN eventType = 'impression' THEN 1 ELSE 0 END) AS impressions,
           SUM(CASE WHEN eventType = 'apply'      THEN 1 ELSE 0 END) AS applies
    FROM experiment_events
    WHERE experimentId = ?
    GROUP BY variantKey
`);

/**
 * @param {string} experimentId
 * @returns {{ winner: string, lift: number, applyRate: number }|null}
 */
function analyzeExperiment(experimentId) {
    const rows = stmtStats.all(experimentId);
    if (rows.length < 2) return null;

    const stats = rows.map(r => ({
        key:        r.variantKey,
        impressions: Number(r.impressions) || 0,
        applyRate:   r.impressions ? (Number(r.applies) || 0) / Number(r.impressions) : 0,
    }));

    // ① 모든 variant 최소 표본 충족 여부
    const valid = stats.filter(s => s.impressions >= MIN_IMPRESSIONS);
    if (valid.length < 2) return null;

    // ② 최고 성능 정렬
    valid.sort((a, b) => b.applyRate - a.applyRate);
    const best   = valid[0];
    const second = valid[1];

    // ③ lift 조건 (zero-division 방어)
    const lift = second.applyRate > 0
        ? (best.applyRate - second.applyRate) / second.applyRate
        : (best.applyRate > 0 ? 1 : 0);

    if (lift < MIN_LIFT) return null;

    return { winner: best.key, lift, applyRate: best.applyRate };
}

module.exports = { analyzeExperiment, MIN_IMPRESSIONS, MIN_LIFT };
