'use strict';
/**
 * feedback.js — PHASE FEEDBACK_LOOP_AI
 *
 * POST /api/feedback
 *   body: { jobId, workerId, rating, actualDifficulty, durationMin }
 *
 * 1. job_feedback INSERT (기록)
 * 2. setImmediate → AI 자동 보정 (fire-and-forget, fail-safe)
 */
const router = require('express').Router();
const db     = require('../db');
const { updateJobDifficulty, updateUserPreference } = require('../services/feedbackLearningService');

const stmtInsert = db.prepare(`
    INSERT INTO job_feedback
    (jobId, workerId, rating, actualDifficulty, durationMin, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
`);

router.post('/', (req, res) => {
    try {
        const { jobId, workerId, rating, actualDifficulty, durationMin } = req.body || {};

        // 필수값 검증 (jobId / workerId)
        if (!jobId || !workerId) {
            return res.status(400).json({ ok: false, error: 'jobId, workerId 필수' });
        }

        // rating 범위 클램프 (1~5)
        const safeRating = rating != null ? Math.min(5, Math.max(1, Number(rating))) : null;

        // actualDifficulty 범위 클램프 (0~1)
        const safeDiff = actualDifficulty != null
            ? Math.min(1, Math.max(0, Number(actualDifficulty)))
            : null;

        stmtInsert.run(
            String(jobId),
            String(workerId),
            safeRating,
            safeDiff,
            durationMin != null ? Number(durationMin) : null,
            Date.now(),
        );

        // AI 자동 보정 — 비동기 (완전 fail-safe)
        setImmediate(() => {
            try {
                if (typeof safeDiff === 'number') {
                    updateJobDifficulty(jobId, safeDiff);
                    updateUserPreference(workerId, safeDiff);
                }
            } catch (_) {}
        });

        res.json({ ok: true });
    } catch (_) {
        res.json({ ok: true }); // fail-safe: 클라이언트에 절대 에러 노출 안 함
    }
});

module.exports = router;
