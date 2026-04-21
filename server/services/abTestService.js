'use strict';
/**
 * abTestService.js — PHASE AB_TEST_AUTOMATION
 *
 * 활성 실험 조회 → 사용자 그룹 고정 할당 → 가중치 반환
 *
 * 실험 없거나 오류 시: null 반환 → 호출측 기본 가중치(Control) 사용
 *
 * experiments.variants JSON 포맷:
 * [
 *   { "key": "A", "weights": { "distance": 40, "urgent": 30, "category": 25, "fallbackPenalty": 10 } },
 *   { "key": "B", "weights": { "distance": 30, "urgent": 30, "category": 35, "fallbackPenalty": 10 } }
 * ]
 */
const db = require('../db');
const { pickVariantBandit }                     = require('./banditService');
const { pickVariantContextual }                 = require('./contextualBanditService');
const { getTimeBucket, getRegionBucket }        = require('../utils/context');
const { pickActionRL }                          = require('./rlService');
const { getFlag }                               = require('./systemFlagService');

// ── 쿼리 준비 (모듈 로드 시 1회) ─────────────────────────────────
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

/**
 * 현재 활성 실험 반환. 없으면 null.
 */
function getActiveExperiment() {
    try {
        return stmtActiveExp.get() || null;
    } catch (e) {
        console.error('[AB_TEST] getActiveExperiment 오류:', e.message);
        return null;
    }
}

/**
 * 사용자를 실험 그룹에 할당 (최초 1회, 이후 고정).
 *
 * 선택 우선순위:
 *   1. Contextual Bandit (시간대 + 지역 데이터 있을 때)
 *   2. 일반 Bandit (컨텍스트 데이터 없을 때 fallback)
 *   3. null → 호출측에서 'A' fallback
 *
 * @param {string}  userId
 * @param {object}  experiment
 * @param {object}  [ctxInput]  { lat?, lng? } — 현재 위치
 * @returns {string|null}
 */
function assignVariant(userId, experiment, ctxInput = {}) {
    if (!userId || !experiment) return null;

    try {
        // 기존 할당 확인 → 고정 반환
        const found = stmtFindAssign.get(userId, experiment.id);
        if (found) return found.variantKey;

        // 컨텍스트 구성
        const ctx = {
            timeBucket:   getTimeBucket(),
            regionBucket: getRegionBucket(ctxInput.lat, ctxInput.lng),
        };

        // 선택 전략 (soft switch):
        //   🔒 SAFE_MODE: RL 차단 → Contextual/Bandit만 사용
        //   정상: 30% → RL (Q-learning) / 70% → Contextual Bandit → Bandit
        let pick;
        const safeMode = getFlag('SAFE_MODE');
        const useRL    = !safeMode && Math.random() < 0.3;
        const variants = JSON.parse(experiment.variants);
        if (useRL) {
            pick = pickActionRL(variants, ctx);
        }
        pick = pick
            || pickVariantContextual(experiment, ctx)
            || pickVariantBandit(experiment);
        if (!pick) return null;

        stmtInsertAssign.run(userId, experiment.id, pick, Date.now());
        return pick;

    } catch (e) {
        console.error('[AB_TEST] assignVariant 오류:', e.message);
        return null;
    }
}

/**
 * 해당 실험+그룹의 가중치 객체 반환.
 * 파싱 실패 시 null → 호출측 기본값 사용.
 * @returns {{ distance, urgent, category, fallbackPenalty }|null}
 */
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

/**
 * 실험 결과(승자) 가중치 반환.
 * 실험이 끝나고 승자가 결정된 경우에만 반환, 없으면 null.
 * @param {string} experimentId
 * @returns {{ distance, urgent, category, fallbackPenalty }|null}
 */
function getWinnerWeights(experimentId) {
    if (!experimentId) return null;
    try {
        const result = stmtWinnerResult.get(experimentId);
        if (!result) return null;

        const exp = stmtExpById.get(experimentId);
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
