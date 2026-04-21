'use strict';
/**
 * rlService.js — PHASE RL_RECOMMENDER (Q-learning Lite)
 *
 * state  = timeBucket_regionBucket  (예: "1_37.5_127.0")
 * action = variantKey               (예: "A" | "B")
 * reward = 1 (apply) | 0 (그 외)
 *
 * Q 업데이트 공식 (terminal episode 가정, next_Q=0):
 *   Q(s,a) ← Q(s,a) + α × (r + γ×0 − Q(s,a))
 *           = Q(s,a) + α × (r − Q(s,a))
 *
 * ε-greedy 탐색: EPSILON 확률로 랜덤, 나머지는 argmax Q(s,·)
 *
 * 하이퍼파라미터:
 *   ALPHA   = 0.1   (학습률: 새 경험 반영 속도)
 *   GAMMA   = 0.9   (할인율: 미래 보상 가중 — terminal이므로 실질 영향 없음)
 *   EPSILON = 0.1   (탐색률: 10% 랜덤 탐색)
 */
const db = require('../db');

const ALPHA   = 0.1;
const GAMMA   = 0.9;
const EPSILON = 0.1;

// ── 준비된 쿼리 ───────────────────────────────────────────────────
const stmtGetQ = db.prepare('SELECT q FROM rl_qtable WHERE state = ? AND action = ?');
const stmtSetQ = db.prepare(`
    INSERT INTO rl_qtable (state, action, q, updatedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(state, action) DO UPDATE
      SET q = excluded.q, updatedAt = excluded.updatedAt
`);

/** state 키 생성 */
function getState(ctx) {
    return `${ctx.timeBucket}_${ctx.regionBucket}`;
}

function getQ(state, action) {
    try {
        const row = stmtGetQ.get(state, action);
        return row?.q ?? 0;
    } catch (e) {
        return 0;
    }
}

function setQ(state, action, q) {
    try {
        stmtSetQ.run(state, action, q, Date.now());
    } catch (e) {
        console.error('[RL] setQ 오류:', e.message);
    }
}

/**
 * ε-greedy 정책으로 variant 선택.
 * @param {{ key: string }[]} variants
 * @param {{ timeBucket: number, regionBucket: string }} ctx
 * @returns {string} variantKey
 */
function pickActionRL(variants, ctx) {
    if (!Array.isArray(variants) || variants.length === 0) return null;

    const state = getState(ctx);

    // ε 탐색: 랜덤 선택
    if (Math.random() < EPSILON) {
        return variants[Math.floor(Math.random() * variants.length)].key;
    }

    // greedy: argmax Q(state, ·)
    let bestKey = variants[0].key;
    let bestQ   = -Infinity;

    for (const v of variants) {
        const q = getQ(state, v.key);
        if (q > bestQ) { bestQ = q; bestKey = v.key; }
    }

    return bestKey;
}

/**
 * apply 이벤트 발생 시 Q 업데이트.
 * @param {string} state   getState(ctx) 결과
 * @param {string} action  variantKey
 * @param {number} reward  1 (apply) | 0
 */
function updateQ(state, action, reward) {
    if (!state || !action) return;
    try {
        const currentQ = getQ(state, action);
        const newQ     = currentQ + ALPHA * (reward + GAMMA * 0 - currentQ);
        setQ(state, action, newQ);
    } catch (e) {
        console.error('[RL] updateQ 오류:', e.message);
    }
}

module.exports = { pickActionRL, updateQ, getState, getQ };
