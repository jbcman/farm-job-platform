'use strict';
/**
 * abTestService.js — A/B 테스트 자동화 (PostgreSQL 비동기)
 */
const db = require('../db');
const { pickVariantBandit }          = require('./banditService');
const { pickVariantContextual }      = require('./contextualBanditService');
const { getTimeBucket, getRegionBucket } = require('../utils/context');
const { pickActionRL }               = require('./rlService');
const { getFlag }                    = require('./systemFlagService');

const stmtActiveExp    = db.prepare('SELECT * FROM experiments WHERE isActive = 1 LIMIT 1');
const stmtFindAssign   = db.prepare(
    'SELECT variantKey FROM experiment_assignments WHERE userId = ? AND experimentId = ?'
);
const stmtInsertAssign = db.prepare(
    'INSERT INTO experiment_assignments (userId, experimentId, variantKey, assignedAt) VALUES (?, ?, ?, ?)'
);
const stmtWinnerResult = db.prepare(
    'SELECT winnerVariant FROM experiment_results WHERE experimentId = ?'
);
const stmtExpById      = db.prepare('SELECT variants FROM experiments WHERE id = ?');

async function getActiveExperiment() {
    try {
        return await stmtActiveExp.get() || null;
    } catch (e) {
        console.error('[AB_TEST] getActiveExperiment 오류:', e.message);
        return null;
    }
}

async function assignVariant(userId, experiment, ctxInput = {}) {
    if (!userId || !experiment) return null;
    try {
        const found = await stmtFindAssign.get(userId, experiment.id);
        if (found) return found.variantKey;

        const ctx = {
            timeBucket:   getTimeBucket(),
            regionBucket: getRegionBucket(ctxInput.lat, ctxInput.lng),
        };

        const safeMode = await getFlag('SAFE_MODE');
        const variants = JSON.parse(experiment.variants);

        let pick;
        const useRL = !safeMode && Math.random() < 0.3;
        if (useRL) {
            pick = await pickActionRL(variants, ctx);
        }
        pick = pick
            || await pickVariantContextual(experiment, ctx)
            || await pickVariantBandit(experiment);
        if (!pick) return null;

        await stmtInsertAssign.run(userId, experiment.id, pick, Date.now());
        return pick;
    } catch (e) {
        console.error('[AB_TEST] assignVariant 오류:', e.message);
        return null;
    }
}

function getVariantWeights(experiment, variantKey) {
    if (!experiment || !variantKey) return null;
    try {
        const variants = JSON.parse(experiment.variants);
        const v = variants.find(item => item.key === variantKey);
        return v?.weights || null;
    } catch (e) {
        console.error('[AB_TEST] getVariantWeights 파싱 오류:', e.message);
        return null;
    }
}

async function getWinnerWeights(experimentId) {
    if (!experimentId) return null;
    try {
        const result = await stmtWinnerResult.get(experimentId);
        if (!result) return null;
        const exp = await stmtExpById.get(experimentId);
        if (!exp) return null;
        const variants = JSON.parse(exp.variants);
        const v = variants.find(item => item.key === result.winnerVariant);
        return v?.weights || null;
    } catch (e) {
        console.error('[AB_TEST] getWinnerWeights 오류:', e.message);
        return null;
    }
}

module.exports = { getActiveExperiment, assignVariant, getVariantWeights, getWinnerWeights };
