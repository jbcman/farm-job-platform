'use strict';
/**
 * behavior.js — PHASE PERSONALIZATION_SCORE + AB_TEST_AUTOMATION
 *
 * POST /api/behavior
 *   body: { jobId, action: 'view'|'apply'|'impression', jobType?, lat?, lng? }
 *   header: x-user-id
 *
 * 행동 기록 2중 역할:
 *   1. user_behavior → 개인화 점수 계산 소스 (view / apply)
 *   2. experiment_events → A/B 테스트 지표 (impression / view → click / apply)
 */
const express = require('express');
const db      = require('../db');
const { getActiveExperiment, assignVariant } = require('../services/abTestService');
const { updateBanditStats }                 = require('../services/banditService');
const { updateContextStats }                = require('../services/contextualBanditService');
const { getTimeBucket, getRegionBucket }    = require('../utils/context');
const { updateQ, getState }                 = require('../services/rlService');

const router = express.Router();

// 허용 액션: view/apply → 개인화 기록 대상 / impression → A/B만
const VALID_ACTIONS        = new Set(['view', 'apply', 'impression']);
const PERSONALIZE_ACTIONS  = new Set(['view', 'apply']); // user_behavior 기록 대상

// experiment_events insert 준비
const stmtExpEvent = db.prepare(`
    INSERT INTO experiment_events
    (userId, experimentId, variantKey, eventType, jobId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
`);

router.post('/', async (req, res) => {
    const userId = req.headers['x-user-id'];
    const { jobId, action, jobType, lat, lng } = req.body || {};

    if (!userId || !jobId || !action || !VALID_ACTIONS.has(action)) {
        return res.status(400).json({
            error: 'invalid: userId, jobId, action(view|apply|impression) required',
        });
    }

    // ① 개인화 행동 기록 (view / apply 만)
    if (PERSONALIZE_ACTIONS.has(action)) {
        try {
            await db.prepare(`
                INSERT INTO user_behavior
                (userId, jobId, action, jobType, lat, lng, createdAt)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId,
                String(jobId),
                action,
                jobType || null,
                lat != null ? Number(lat) : null,
                lng != null ? Number(lng) : null,
                Date.now(),
            );
        } catch (e) {
            console.error('[BEHAVIOR] user_behavior insert 실패:', e.message);
        }
    }

    // ① DIFFICULTY_PERSONAL: apply 시 preferredDifficulty 자동 학습 (EMA, decay 0.9/0.1)
    if (action === 'apply') {
        try {
            const job = await db.prepare('SELECT difficulty FROM jobs WHERE id = ?').get(String(jobId));
            const d   = job?.difficulty;
            if (d != null && Number.isFinite(d)) {
                await db.prepare(`
                    UPDATE users
                    SET preferredDifficulty = (preferredDifficulty * 0.9) + (? * 0.1)
                    WHERE id = ?
                `).run(d, userId);
            }
        } catch (e) {
            console.error('[BEHAVIOR] preferredDifficulty 갱신 실패:', e.message);
        }
    }

    // ② A/B 테스트 이벤트 기록 + Bandit/Contextual 통계 업데이트
    try {
        const exp     = getActiveExperiment();
        const variant = assignVariant(userId, exp, { lat, lng }) || 'A';
        if (exp && variant) {
            await stmtExpEvent.run(userId, exp.id, variant, action, String(jobId), Date.now());
            updateBanditStats(exp.id, variant, action);

            // 컨텍스트 통계 + RL Q 업데이트
            const ctx = {
                timeBucket:   getTimeBucket(),
                regionBucket: getRegionBucket(lat, lng),
            };
            updateContextStats(exp.id, variant, ctx, action);

            // RL reward: apply=1, 그 외=0
            const state  = getState(ctx);
            const reward = action === 'apply' ? 1 : 0;
            updateQ(state, variant, reward);
        }
    } catch (e) {
        console.error('[BEHAVIOR] experiment_events/bandit/context 실패:', e.message);
    }

    res.json({ ok: true });
});

module.exports = router;
