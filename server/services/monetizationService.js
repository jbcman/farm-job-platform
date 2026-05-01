'use strict';
/**
 * monetizationService.js — 스폰서 게시물 + 구독자 보너스
 */
const db = require('../db');

const stmtJobBoost  = db.prepare(
    'SELECT boost FROM sponsored_jobs WHERE jobId = ? AND expiresAt > ?'
);
const stmtUserBoost = db.prepare(
    'SELECT priorityBoost FROM subscriptions WHERE userId = ? AND expiresAt > ?'
);

async function getJobBoost(jobId) {
    if (!jobId) return 0;
    try {
        const row = await stmtJobBoost.get(String(jobId), Date.now());
        return row?.boost || 0;
    } catch (e) { return 0; }
}

async function getUserBoost(userId) {
    if (!userId) return 0;
    try {
        const row = await stmtUserBoost.get(userId, Date.now());
        return row?.priorityBoost || 0;
    } catch (e) { return 0; }
}

module.exports = { getJobBoost, getUserBoost };
