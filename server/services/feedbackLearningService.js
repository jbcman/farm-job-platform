'use strict';
/**
 * feedbackLearningService.js — PHASE FEEDBACK_LOOP_AI
 *
 * 실제 작업 데이터(평점/난이도/소요시간)로 AI 모델 자동 보정.
 * 모든 함수 fail-safe — 오류 시 아무 영향 없음.
 *
 * job.difficulty    : EMA (0.7 old + 0.3 actual) — 실제 반영 비중 30%
 * preferredDifficulty: EMA (0.8 old + 0.2 actual) — 완료 경험 반영 비중 20%
 *   (apply 시 0.1 이미 반영 → 완료 시 추가 0.2 = 실수확 데이터 우선)
 */
const db = require('../db');

/**
 * job.difficulty → EMA 보정
 * @param {string} jobId
 * @param {number} actualDifficulty  0~1
 */
function updateJobDifficulty(jobId, actualDifficulty) {
    try {
        const row = db.prepare('SELECT difficulty FROM jobs WHERE id = ?').get(jobId);
        if (!row) return;
        const oldD = row.difficulty ?? 0.5;
        const newD = (oldD * 0.7) + (actualDifficulty * 0.3);
        db.prepare('UPDATE jobs SET difficulty = ? WHERE id = ?').run(newD, jobId);
        console.log(`[FEEDBACK_LEARN] job=${jobId} difficulty ${oldD.toFixed(3)} → ${newD.toFixed(3)}`);
    } catch (_) {}
}

/**
 * users.preferredDifficulty → EMA 보정 (완료 경험 반영)
 * @param {string} workerId
 * @param {number} actualDifficulty  0~1
 */
function updateUserPreference(workerId, actualDifficulty) {
    try {
        const row = db.prepare('SELECT preferredDifficulty FROM users WHERE id = ?').get(workerId);
        const old     = row?.preferredDifficulty ?? 0.5;
        const updated = (old * 0.8) + (actualDifficulty * 0.2);
        db.prepare('UPDATE users SET preferredDifficulty = ? WHERE id = ?').run(updated, workerId);
        console.log(`[FEEDBACK_LEARN] worker=${workerId} preferredDifficulty ${old.toFixed(3)} → ${updated.toFixed(3)}`);
    } catch (_) {}
}

module.exports = { updateJobDifficulty, updateUserPreference };
