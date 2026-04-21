'use strict';
/**
 * monetizationService.js — PHASE MONETIZATION
 *
 * 스폰서 게시물(jobBoost) + 구독자(userBoost) 보너스 조회.
 * 만료됐거나 없으면 0 반환 — 기존 점수에 영향 없음.
 * 오류 발생 시 항상 0 반환 (fail-safe).
 */
const db = require('../db');

const stmtJobBoost  = db.prepare(
    'SELECT boost FROM sponsored_jobs WHERE jobId = ? AND expiresAt > ?'
);
const stmtUserBoost = db.prepare(
    'SELECT priorityBoost FROM subscriptions WHERE userId = ? AND expiresAt > ?'
);

/**
 * 스폰서 게시물 보너스.
 * @param {string|number} jobId
 * @returns {number}  boost pt (기본 0)
 */
function getJobBoost(jobId) {
    if (!jobId) return 0;
    try {
        const row = stmtJobBoost.get(String(jobId), Date.now());
        return row?.boost || 0;
    } catch (e) {
        return 0;
    }
}

/**
 * 구독자 우선 알림 보너스.
 * @param {string} userId
 * @returns {number}  boost pt (기본 0)
 */
function getUserBoost(userId) {
    if (!userId) return 0;
    try {
        const row = stmtUserBoost.get(userId, Date.now());
        return row?.priorityBoost || 0;
    } catch (e) {
        return 0;
    }
}

module.exports = { getJobBoost, getUserBoost };
