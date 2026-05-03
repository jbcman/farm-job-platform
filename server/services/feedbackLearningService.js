'use strict';
/**
 * feedbackLearningService.js — AI 모델 자동 보정 (PostgreSQL 비동기)
 */
const db = require('../db');

async function updateJobDifficulty(jobId, actualDifficulty) {
    try {
        const row = await db.prepare('SELECT difficulty FROM jobs WHERE id = ?').get(jobId);
        if (!row) return;
        const oldD = row.difficulty ?? 0.5;
        const newD = (oldD * 0.7) + (actualDifficulty * 0.3);
        await db.prepare('UPDATE jobs SET difficulty = ? WHERE id = ?').run(newD, jobId);
        console.log(`[FEEDBACK_LEARN] job=${jobId} difficulty ${oldD.toFixed(3)} → ${newD.toFixed(3)}`);
    } catch (_) {}
}

async function updateUserPreference(workerId, actualDifficulty) {
    try {
        const row     = await db.prepare('SELECT preferredDifficulty FROM users WHERE id = ?').get(workerId);
        const old     = row?.preferredDifficulty ?? 0.5;
        const updated = (old * 0.8) + (actualDifficulty * 0.2);
        await db.prepare('UPDATE users SET preferredDifficulty = ? WHERE id = ?').run(updated, workerId);
        console.log(`[FEEDBACK_LEARN] worker=${workerId} preferredDifficulty ${old.toFixed(3)} → ${updated.toFixed(3)}`);
    } catch (_) {}
}

module.exports = { updateJobDifficulty, updateUserPreference };
