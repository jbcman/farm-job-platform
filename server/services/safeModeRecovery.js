'use strict';
/**
 * safeModeRecovery.js — SAFE_MODE 자동 복구 (PostgreSQL 비동기)
 */
const db = require('../db');
const { getFlag, setFlag } = require('./systemFlagService');

const COOLDOWN_MS   = 10 * 60 * 1000;
const STABLE_WINDOW = 5  * 60 * 1000;
const CTR_MIN       = 0.05;
const APPLY_MIN     = 0.01;

let recoveryTimer = null;

async function tryRecover() {
    try {
        if (!(await getFlag('SAFE_MODE'))) return;
        if (recoveryTimer) return;

        const since = Date.now() - STABLE_WINDOW;
        const row   = await db.prepare(`
            SELECT AVG(ctr) AS ctr, AVG(applyRate) AS applyRate
            FROM anomaly_snapshots WHERE ts >= ?
        `).get(since);

        if (!row || row.ctr == null) return;

        const stable = (row.ctr || 0) > CTR_MIN && (row.applyRate || 0) > APPLY_MIN;
        if (!stable) return;

        recoveryTimer = setTimeout(async () => {
            await setFlag('SAFE_MODE', false);
            recoveryTimer = null;
            console.log('[SAFE_MODE] 자동 복구 완료 — AI 추천 재개');
        }, COOLDOWN_MS);

        console.log('[SAFE_MODE] 안정 감지 → 10분 후 복구 예정');
    } catch (_) {}
}

module.exports = { tryRecover };
