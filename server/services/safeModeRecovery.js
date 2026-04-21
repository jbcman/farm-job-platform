'use strict';
/**
 * safeModeRecovery.js — PHASE SAFE_MODE_KILLSWITCH
 *
 * SAFE_MODE 해제 조건 (최근 5분 안정):
 *   - ctr       > 5%
 *   - applyRate > 1%
 *
 * 조건 충족 시 → 10분 쿨다운 후 SAFE_MODE = false (자동 복구).
 * 쿨다운 타이머는 1개만 유지 (중복 방지).
 */
const db = require('../db');
const { getFlag, setFlag } = require('./systemFlagService');

const COOLDOWN_MS    = 10 * 60 * 1000; // 10분 쿨다운
const STABLE_WINDOW  = 5  * 60 * 1000; // 최근 5분 체크
const CTR_MIN        = 0.05;
const APPLY_MIN      = 0.01;

let recoveryTimer = null; // 중복 타이머 방지

function tryRecover() {
    try {
        if (!getFlag('SAFE_MODE')) return;
        if (recoveryTimer)        return; // 이미 쿨다운 중

        const since = Date.now() - STABLE_WINDOW;
        const row   = db.prepare(`
            SELECT AVG(ctr) AS ctr, AVG(applyRate) AS applyRate
            FROM anomaly_snapshots WHERE ts >= ?
        `).get(since);

        if (!row || row.ctr == null) return; // 데이터 없음 → 대기

        const stable = (row.ctr || 0) > CTR_MIN && (row.applyRate || 0) > APPLY_MIN;
        if (!stable) return;

        // 안정 확인 → 10분 후 SAFE_MODE 해제
        recoveryTimer = setTimeout(() => {
            setFlag('SAFE_MODE', false);
            recoveryTimer = null;
            console.log('[SAFE_MODE] 자동 복구 완료 — AI 추천 재개');
        }, COOLDOWN_MS);

        console.log('[SAFE_MODE] 안정 감지 → 10분 후 복구 예정');
    } catch (_) {}
}

module.exports = { tryRecover };
