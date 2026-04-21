'use strict';
/**
 * kakaoService.js — MOCK / REAL Kakao job alert
 *
 * STEP 3 spec interface:
 *   sendJobAlert(user, job)
 *
 * Duplicate guard (STEP 5):
 *   In-memory sentCache + DB notify_log (persistent)
 *   Key: user.phone + job.id
 */
const { sendJobMatchAlert } = require('./kakaoAlertService');

// ─── STEP 5: 인메모리 중복 방지 캐시 ─────────────────────────────
const sentCache = new Set();

/**
 * @param {{ phone, name, jobType, locationText }} user
 * @param {{ id, category, locationText, pay, date }}  job
 */
async function sendJobAlert(user, job) {
    if (!user?.phone || !job?.id) return;

    const key = user.phone + '|' + job.id;

    // STEP 5: 인메모리 중복 차단 (프로세스 재시작 전까지 유효)
    if (sentCache.has(key)) {
        console.log(`[KAKAO_SKIP] cache-hit key=${key}`);
        return;
    }

    // DB 기반 중복 방지 + MOCK/REAL 분기는 kakaoAlertService에 위임
    const result = await sendJobMatchAlert({
        jobId:        job.id,
        phone:        user.phone,
        name:         user.name || '작업자',
        jobType:      job.category || job.jobType,
        locationText: job.locationText,
        pay:          job.pay  || null,
        date:         job.date || '',
    });

    if (result.reason !== 'duplicate') {
        sentCache.add(key);
    }
}

module.exports = { sendJobAlert, sentCache };
