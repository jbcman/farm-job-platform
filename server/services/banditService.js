'use strict';
/**
 * banditService.js — PHASE MULTI_ARM_BANDIT
 *
 * Thompson Sampling 기반 동적 variant 선택.
 * Beta(α, β) 분포에서 샘플을 뽑아 가장 높은 variant 선택.
 *   α = 1 + applies       (성공 횟수)
 *   β = 1 + (impressions - applies)  (실패 횟수)
 *
 * 초기(데이터 없음): α=β=1 → 균등 분포 → 균등 확률 → 공정 탐색
 * 데이터 축적 → 성능 좋은 arm 샘플 높아짐 → 트래픽 자연 증가
 *
 * 외부 라이브러리 없이 Box-Muller 근사 사용.
 */
const db = require('../db');

// ── 쿼리 준비 ─────────────────────────────────────────────────────
const stmtGetArms = db.prepare(
    'SELECT variantKey, impressions, applies FROM bandit_arms WHERE experimentId = ?'
);
const stmtGetArm  = db.prepare(
    'SELECT impressions, applies FROM bandit_arms WHERE experimentId = ? AND variantKey = ?'
);
const stmtInsertArm = db.prepare(
    'INSERT INTO bandit_arms (experimentId, variantKey, impressions, applies, updatedAt) VALUES (?, ?, ?, ?, ?)'
);
const stmtUpdateArm = db.prepare(
    'UPDATE bandit_arms SET impressions = impressions + ?, applies = applies + ?, updatedAt = ? WHERE experimentId = ? AND variantKey = ?'
);

/**
 * Beta(α, β) 분포 샘플 — Box-Muller 정규 근사
 * 작은 α, β에서 오차 있으나 A/B 규모에서 충분히 동작.
 */
function sampleBeta(a, b) {
    const mean     = a / (a + b);
    const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
    const std      = Math.sqrt(variance);

    // Box-Muller 변환
    const u1 = Math.max(1e-10, Math.random()); // log(0) 방어
    const u2 = Math.random();
    const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    return Math.max(0, Math.min(1, mean + std * z));
}

/**
 * Thompson Sampling으로 variant 선택.
 * 각 variant의 Beta 분포에서 샘플 → 최고값 variant 반환.
 *
 * @param {object} experiment  experiments 행 (id, variants JSON)
 * @returns {string|null}      선택된 variantKey
 */
function pickVariantBandit(experiment) {
    if (!experiment) return null;

    try {
        const variants = JSON.parse(experiment.variants);
        if (!Array.isArray(variants) || variants.length === 0) return null;

        const arms = stmtGetArms.all(experiment.id);
        const armMap = {};
        arms.forEach(a => { armMap[a.variantKey] = a; });

        let bestKey    = null;
        let bestSample = -Infinity;

        for (const v of variants) {
            const arm  = armMap[v.key] || { impressions: 0, applies: 0 };
            const α    = 1 + (Number(arm.applies)     || 0);
            const β    = 1 + (Number(arm.impressions)  || 0) - (Number(arm.applies) || 0);
            const sample = sampleBeta(α, Math.max(1, β)); // β 최소 1 보장

            if (sample > bestSample) {
                bestSample = sample;
                bestKey    = v.key;
            }
        }

        return bestKey;

    } catch (e) {
        console.error('[BANDIT] pickVariantBandit 오류:', e.message);
        return null;
    }
}

/**
 * 이벤트 발생 시 arm 통계 업데이트.
 * impression / apply 만 카운트 (view는 CTR 산출용이므로 impression과 별개).
 *
 * @param {string} experimentId
 * @param {string} variantKey
 * @param {string} eventType  'impression' | 'apply' | 기타
 */
function updateBanditStats(experimentId, variantKey, eventType) {
    if (!experimentId || !variantKey) return;
    if (eventType !== 'impression' && eventType !== 'apply') return;

    try {
        const isImpression = eventType === 'impression' ? 1 : 0;
        const isApply      = eventType === 'apply'      ? 1 : 0;

        const row = stmtGetArm.get(experimentId, variantKey);
        if (!row) {
            stmtInsertArm.run(experimentId, variantKey, isImpression, isApply, Date.now());
        } else {
            stmtUpdateArm.run(isImpression, isApply, Date.now(), experimentId, variantKey);
        }
    } catch (e) {
        console.error('[BANDIT] updateBanditStats 오류:', e.message);
    }
}

module.exports = { pickVariantBandit, updateBanditStats, sampleBeta };
