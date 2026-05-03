'use strict';
/**
 * banditService.js — Thompson Sampling 기반 Multi-Arm Bandit
 */
const db = require('../db');

const stmtGetArms   = db.prepare(
    'SELECT variantKey, impressions, applies FROM bandit_arms WHERE experimentId = ?'
);
const stmtGetArm    = db.prepare(
    'SELECT impressions, applies FROM bandit_arms WHERE experimentId = ? AND variantKey = ?'
);
const stmtInsertArm = db.prepare(
    'INSERT INTO bandit_arms (experimentId, variantKey, impressions, applies, updatedAt) VALUES (?, ?, ?, ?, ?)'
);
const stmtUpdateArm = db.prepare(
    'UPDATE bandit_arms SET impressions = impressions + ?, applies = applies + ?, updatedAt = ? WHERE experimentId = ? AND variantKey = ?'
);

function sampleBeta(a, b) {
    const mean     = a / (a + b);
    const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
    const std      = Math.sqrt(variance);
    const u1 = Math.max(1e-10, Math.random());
    const u2 = Math.random();
    const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.min(1, mean + std * z));
}

async function pickVariantBandit(experiment) {
    if (!experiment) return null;
    try {
        const variants = JSON.parse(experiment.variants);
        if (!Array.isArray(variants) || variants.length === 0) return null;

        const arms   = await stmtGetArms.all(experiment.id);
        const armMap = {};
        arms.forEach(a => { armMap[a.variantKey] = a; });

        let bestKey = null, bestSample = -Infinity;
        for (const v of variants) {
            const arm    = armMap[v.key] || { impressions: 0, applies: 0 };
            const α      = 1 + (Number(arm.applies)    || 0);
            const β      = 1 + (Number(arm.impressions) || 0) - (Number(arm.applies) || 0);
            const sample = sampleBeta(α, Math.max(1, β));
            if (sample > bestSample) { bestSample = sample; bestKey = v.key; }
        }
        return bestKey;
    } catch (e) {
        console.error('[BANDIT] pickVariantBandit 오류:', e.message);
        return null;
    }
}

async function updateBanditStats(experimentId, variantKey, eventType) {
    if (!experimentId || !variantKey) return;
    if (eventType !== 'impression' && eventType !== 'apply') return;
    try {
        const isImpression = eventType === 'impression' ? 1 : 0;
        const isApply      = eventType === 'apply'      ? 1 : 0;
        const row = await stmtGetArm.get(experimentId, variantKey);
        if (!row) {
            await stmtInsertArm.run(experimentId, variantKey, isImpression, isApply, Date.now());
        } else {
            await stmtUpdateArm.run(isImpression, isApply, Date.now(), experimentId, variantKey);
        }
    } catch (e) {
        console.error('[BANDIT] updateBanditStats 오류:', e.message);
    }
}

module.exports = { pickVariantBandit, updateBanditStats, sampleBeta };
