'use strict';
/**
 * systemFlagService.js — PHASE SAFE_MODE_KILLSWITCH
 *
 * 시스템 상태 플래그 읽기/쓰기.
 * better-sqlite3 동기 API — 추천 경로 지연 없음.
 * 캐시 없음 → DB 직접 조회 (플래그 변경 즉시 반영).
 */
const db = require('../db');

const stmtGet = db.prepare('SELECT value FROM system_flags WHERE key = ?');
const stmtSet = db.prepare(`
    INSERT INTO system_flags (key, value, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
`);

/**
 * @param {string} key
 * @returns {boolean}
 */
function getFlag(key) {
    try {
        return stmtGet.get(key)?.value === '1';
    } catch (_) { return false; }
}

/**
 * @param {string}  key
 * @param {boolean} val
 */
function setFlag(key, val) {
    try {
        stmtSet.run(key, val ? '1' : '0', Date.now());
    } catch (_) {}
}

module.exports = { getFlag, setFlag };
