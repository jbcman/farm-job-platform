'use strict';
/**
 * systemFlagService.js — 시스템 상태 플래그 읽기/쓰기 (PostgreSQL 비동기)
 */
const db = require('../db');

const stmtGet = db.prepare('SELECT value FROM system_flags WHERE key = ?');
const stmtSet = db.prepare(`
    INSERT INTO system_flags (key, value, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedat
`);

async function getFlag(key) {
    try {
        const row = await stmtGet.get(key);
        return row?.value === '1';
    } catch (_) { return false; }
}

async function setFlag(key, val) {
    try {
        await stmtSet.run(key, val ? '1' : '0', Date.now());
    } catch (_) {}
}

module.exports = { getFlag, setFlag };
