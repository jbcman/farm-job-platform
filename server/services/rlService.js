'use strict';
/**
 * rlService.js — Q-learning Lite (PostgreSQL 비동기)
 */
const db = require('../db');

const ALPHA   = 0.1;
const GAMMA   = 0.9;
const EPSILON = 0.1;

const stmtGetQ = db.prepare('SELECT q FROM rl_qtable WHERE state = ? AND action = ?');
const stmtSetQ = db.prepare(`
    INSERT INTO rl_qtable (state, action, q, updatedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(state, action) DO UPDATE
      SET q = excluded.q, updatedAt = excluded.updatedat
`);

function getState(ctx) {
    return `${ctx.timeBucket}_${ctx.regionBucket}`;
}

async function getQ(state, action) {
    try {
        const row = await stmtGetQ.get(state, action);
        return row?.q ?? 0;
    } catch (e) { return 0; }
}

async function setQ(state, action, q) {
    try {
        await stmtSetQ.run(state, action, q, Date.now());
    } catch (e) {
        console.error('[RL] setQ 오류:', e.message);
    }
}

async function pickActionRL(variants, ctx) {
    if (!Array.isArray(variants) || variants.length === 0) return null;
    const state = getState(ctx);
    if (Math.random() < EPSILON) {
        return variants[Math.floor(Math.random() * variants.length)].key;
    }
    let bestKey = variants[0].key, bestQVal = -Infinity;
    for (const v of variants) {
        const q = await getQ(state, v.key);
        if (q > bestQVal) { bestQVal = q; bestKey = v.key; }
    }
    return bestKey;
}

async function updateQ(state, action, reward) {
    if (!state || !action) return;
    try {
        const currentQ = await getQ(state, action);
        const newQ     = currentQ + ALPHA * (reward + GAMMA * 0 - currentQ);
        await setQ(state, action, newQ);
    } catch (e) {
        console.error('[RL] updateQ 오류:', e.message);
    }
}

module.exports = { pickActionRL, updateQ, getState, getQ };
