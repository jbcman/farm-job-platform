'use strict';
/**
 * contextualBanditService.js — 컨텍스트 기반 Thompson Sampling (PostgreSQL 비동기)
 */
const db          = require('../db');
const { sampleBeta } = require('./banditService');

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

async function pickVariantContextual(experiment, ctx) {
    if (!experiment || !ctx) return null;
    try {
        const variants = JSON.parse(experiment.variants);
        if (!Array.isArray(variants) || variants.length === 0) return null;

        const { timeBucket, regionBucket } = ctx;
        const arms = await stmtGetCtxArms.all(experiment.id, timeBucket, regionBucket);
        if (arms.length === 0) return null;

        const armMap = {};
        arms.forEach(a => { armMap[a.variantKey] = a; });

        let bestKey = null, bestSample = -Infinity;
        for (const v of variants) {
            const arm = armMap[v.key] || { impressions: 0, applies: 0 };
            const α   = 1 + (Number(arm.applies)    || 0);
            const β   = 1 + Math.max(0, (Number(arm.impressions) || 0) - (Number(arm.applies) || 0));
            const s   = sampleBeta(α, β);
            if (s > bestSample) { bestSample = s; bestKey = v.key; }
        }
        return bestKey;
    } catch (e) {
        console.error('[CTX_BANDIT] pickVariantContextual 오류:', e.message);
        return null;
    }
}

async function updateContextStats(experimentId, variantKey, ctx, eventType) {
    if (!experimentId || !variantKey || !ctx) return;
    if (eventType !== 'impression' && eventType !== 'apply') return;
    try {
        const { timeBucket, regionBucket } = ctx;
        const isImp   = eventType === 'impression' ? 1 : 0;
        const isApply = eventType === 'apply'      ? 1 : 0;
        const row = await stmtGetCtxArm.get(experimentId, variantKey, timeBucket, regionBucket);
        if (!row) {
            await stmtInsertCtx.run(experimentId, variantKey, timeBucket, regionBucket, isImp, isApply, Date.now());
        } else {
            await stmtUpdateCtx.run(isImp, isApply, Date.now(), experimentId, variantKey, timeBucket, regionBucket);
        }
    } catch (e) {
        console.error('[CTX_BANDIT] updateContextStats 오류:', e.message);
    }
}

module.exports = { pickVariantContextual, updateContextStats };
