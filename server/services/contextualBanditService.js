'use strict';
/**
 * contextualBanditService.js — PHASE CONTEXTUAL_BANDIT
 *
 * 시간대(timeBucket) × 지역(regionBucket) 컨텍스트별 Thompson Sampling.
 * sampleBeta는 banditService에서 공유.
 *
 * fallback 체계:
 *   contextual 데이터 있으면 → 컨텍스트 기반 선택
 *   없으면(신규 컨텍스트) → null 반환 → 호출측에서 일반 Bandit fallback
 */
const db          = require('../db');
const { sampleBeta } = require('./banditService');

// ── 쿼리 준비 ─────────────────────────────────────────────────────
const stmtGetCtxArms = db.prepare(`
    SELECT variantKey, impressions, applies
    FROM bandit_context_arms
    WHERE experimentId = ? AND timeBucket = ? AND regionBucket = ?
`);
const stmtGetCtxArm = db.prepare(`
    SELECT impressions, applies
    FROM bandit_context_arms
    WHERE experimentId = ? AND variantKey = ? AND timeBucket = ? AND regionBucket = ?
`);
const stmtInsertCtx = db.prepare(`
    INSERT INTO bandit_context_arms
    (experimentId, variantKey, timeBucket, regionBucket, impressions, applies, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const stmtUpdateCtx = db.prepare(`
    UPDATE bandit_context_arms
    SET impressions = impressions + ?,
        applies     = applies     + ?,
        updatedAt   = ?
    WHERE experimentId = ? AND variantKey = ? AND timeBucket = ? AND regionBucket = ?
`);

/**
 * 컨텍스트 기반 Thompson Sampling.
 * 해당 컨텍스트에 데이터가 전혀 없으면 null 반환 → 호출측 Bandit fallback.
 *
 * @param {object} experiment  experiments 행
 * @param {{ timeBucket: number, regionBucket: string }} ctx
 * @returns {string|null}
 */
function pickVariantContextual(experiment, ctx) {
    if (!experiment || !ctx) return null;

    try {
        const variants = JSON.parse(experiment.variants);
        if (!Array.isArray(variants) || variants.length === 0) return null;

        const { timeBucket, regionBucket } = ctx;
        const arms = stmtGetCtxArms.all(experiment.id, timeBucket, regionBucket);

        // 이 컨텍스트에 데이터 없음 → fallback 신호
        if (arms.length === 0) return null;

        const armMap = {};
        arms.forEach(a => { armMap[a.variantKey] = a; });

        let bestKey    = null;
        let bestSample = -Infinity;

        for (const v of variants) {
            const arm  = armMap[v.key] || { impressions: 0, applies: 0 };
            const α    = 1 + (Number(arm.applies)    || 0);
            const β    = 1 + Math.max(0, (Number(arm.impressions) || 0) - (Number(arm.applies) || 0));
            const s    = sampleBeta(α, β);

            if (s > bestSample) { bestSample = s; bestKey = v.key; }
        }

        return bestKey;

    } catch (e) {
        console.error('[CTX_BANDIT] pickVariantContextual 오류:', e.message);
        return null;
    }
}

/**
 * impression / apply 이벤트를 컨텍스트별 통계에 반영.
 */
function updateContextStats(experimentId, variantKey, ctx, eventType) {
    if (!experimentId || !variantKey || !ctx) return;
    if (eventType !== 'impression' && eventType !== 'apply') return;

    try {
        const { timeBucket, regionBucket } = ctx;
        const isImp   = eventType === 'impression' ? 1 : 0;
        const isApply = eventType === 'apply'      ? 1 : 0;

        const row = stmtGetCtxArm.get(experimentId, variantKey, timeBucket, regionBucket);
        if (!row) {
            stmtInsertCtx.run(experimentId, variantKey, timeBucket, regionBucket, isImp, isApply, Date.now());
        } else {
            stmtUpdateCtx.run(isImp, isApply, Date.now(), experimentId, variantKey, timeBucket, regionBucket);
        }
    } catch (e) {
        console.error('[CTX_BANDIT] updateContextStats 오류:', e.message);
    }
}

module.exports = { pickVariantContextual, updateContextStats };
