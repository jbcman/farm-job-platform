'use strict';
/**
 * test.js — GET /api/test/alarm
 * 알림톡 3종 동시 발송 테스트 엔드포인트
 * 운영 환경에서는 NODE_ENV=production 시 비활성화 권장
 */
const express = require('express');
const {
    sendSelectionNotification,
    sendJobStartedNotification,
    sendJobCompletedNotification,
    formatKoreanPhoneNumber,
    maskPhone,
} = require('../services/notificationService');

const router = express.Router();

// ─── GET /api/test/alarm ─────────────────────────────────────────
router.get('/alarm', async (req, res) => {
    const USE_KAKAO  = process.env.USE_KAKAO      === 'true';
    const TEST_MODE  = process.env.KAKAO_TEST_MODE === 'true';
    const TEST_PHONE = process.env.KAKAO_TEST_PHONE || '';

    // 테스트용 더미 데이터
    const job = {
        id:           'test-job-001',
        category:     '밭갈이',
        locationText: '경기 화성시 서신면',
        date:         new Date().toISOString().slice(0, 10),
        requesterName: '테스트농민',
    };
    const worker = {
        id:    'test-worker-001',
        name:  '테스트작업자',
        phone: TEST_MODE && TEST_PHONE ? TEST_PHONE : '010-0000-0000',
    };
    const farmer = { name: '테스트농민' };

    const started = Date.now();
    console.log('[TEST_ALARM] 알림 3종 테스트 시작');

    // 3종 동시 발송
    const [selectResult, startResult, completeResult] = await Promise.allSettled([
        sendSelectionNotification(job, worker, farmer),
        sendJobStartedNotification(job, worker),
        sendJobCompletedNotification(job, worker),
    ]);

    const elapsed = Date.now() - started;
    console.log(`[TEST_ALARM] 완료 (${elapsed}ms)`);

    const toResult = (settled, type) => ({
        type,
        status:    settled.status,
        ok:        settled.status === 'fulfilled' ? settled.value?.ok : false,
        mock:      settled.status === 'fulfilled' ? !!settled.value?.mock : false,
        error:     settled.status === 'rejected'  ? settled.reason?.message : undefined,
        response:  settled.status === 'fulfilled' ? settled.value?.response : undefined,
    });

    return res.json({
        ok: true,
        mode:      USE_KAKAO ? 'REAL' : 'MOCK',
        testMode:  TEST_MODE,
        testPhone: TEST_MODE ? maskPhone(formatKoreanPhoneNumber(TEST_PHONE)) : null,
        elapsedMs: elapsed,
        results: [
            toResult(selectResult,   'SELECT'),
            toResult(startResult,    'START'),
            toResult(completeResult, 'COMPLETE'),
        ],
    });
});

module.exports = router;
