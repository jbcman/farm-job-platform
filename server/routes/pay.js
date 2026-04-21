'use strict';
/**
 * pay.js — PHASE SCALE+ 결제 라우트
 *
 * GET  /api/pay/urgent-price   A/B 그룹별 가격 조회
 * POST /api/pay/create         결제 주문 생성 (orderId 발급)
 * POST /api/pay/confirm        결제 승인 (Toss confirm or 체험 자동 처리)
 *
 * A/B 그룹 정책:
 *   A = 완전 무료 체험  → amount=0, 자동 confirm
 *   B = 3,000원        → Toss 결제 연동 (첫 1회 무료 then 3000원)
 *   C = 효과 후 결제    → amount=0, 자동 confirm + 관리자 수금 플래그
 */
const express = require('express');
const https   = require('https');
const db      = require('../db');
const { trackEvent } = require('../services/analyticsService');

const router = express.Router();

// ─── A/B 가격 매핑 ────────────────────────────────────────────
const AB_CONFIG = {
    A: { price: 0,    label: '무료 체험',    autoConfirm: true  },  // 효과 먼저 체험
    B: { price: 3000, label: '3,000원',      autoConfirm: false },  // 실제 결제
    C: { price: 0,    label: '효과 후 결제', autoConfirm: true  },  // 사후 수금
};

function getConfig(abGroup) {
    return AB_CONFIG[abGroup] || AB_CONFIG['A']; // 그룹 없으면 무료 체험 기본
}

function newOrderId() {
    return 'ord-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ─── GET /api/pay/urgent-price ────────────────────────────────
router.get('/urgent-price', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ ok: false, error: '로그인이 필요해요.' });

    const user = db.prepare('SELECT abGroup, urgentTrialUsed FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ ok: false, error: '사용자를 찾을 수 없어요.' });

    const group  = user.abGroup || 'A';
    const cfg    = getConfig(group);
    // Group B: 첫 1회 무료 체험 → 이후 3000원
    const firstTrialFree = (group === 'B' && user.urgentTrialUsed === 0);
    const effectivePrice = firstTrialFree ? 0 : cfg.price;
    const isFree         = effectivePrice === 0;

    try { trackEvent('urgent_price_view', { userId, meta: { group, price: effectivePrice, isFree } }); } catch (_) {}

    return res.json({
        ok: true,
        group,
        price:          effectivePrice,
        basePrice:      cfg.price,
        label:          cfg.label,
        isFree,
        firstTrialFree,
        autoConfirm:    cfg.autoConfirm || firstTrialFree,
    });
});

// ─── POST /api/pay/create ─────────────────────────────────────
router.post('/create', (req, res) => {
    const userId = req.headers['x-user-id'];
    const { jobId } = req.body || {};

    if (!userId) return res.status(401).json({ ok: false, error: '로그인이 필요해요.' });
    if (!jobId)  return res.status(400).json({ ok: false, error: 'jobId가 필요해요.' });

    // job 소유권 검증
    const job = db.prepare('SELECT id, requesterId, category FROM jobs WHERE id = ?').get(jobId);
    if (!job)                      return res.status(404).json({ ok: false, error: '공고를 찾을 수 없어요.' });
    if (job.requesterId !== userId) return res.status(403).json({ ok: false, error: '본인 공고만 결제할 수 있어요.' });

    const user = db.prepare('SELECT abGroup, urgentTrialUsed FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ ok: false, error: '사용자를 찾을 수 없어요.' });

    const group          = user.abGroup || 'A';
    const cfg            = getConfig(group);
    const firstTrialFree = (group === 'B' && user.urgentTrialUsed === 0);
    const amount         = (cfg.autoConfirm || firstTrialFree) ? 0 : cfg.price;
    const autoConfirm    = cfg.autoConfirm || firstTrialFree;
    const orderId        = newOrderId();

    // 결제 레코드 생성
    db.prepare(`
        INSERT INTO payments (userId, jobId, amount, status, provider, orderId, createdAt)
        VALUES (?, ?, ?, 'ready', 'toss', ?, ?)
    `).run(userId, jobId, amount, orderId, new Date().toISOString());

    try { trackEvent('payment_start', { userId, jobId, meta: { amount, orderId, group, autoConfirm } }); } catch (_) {}

    console.log(`[PAY_CREATE] orderId=${orderId} userId=${userId} jobId=${jobId} amount=${amount} group=${group} autoConfirm=${autoConfirm}`);

    return res.json({
        ok: true,
        orderId,
        amount,
        autoConfirm,
        group,
        label: cfg.label,
    });
});

// ─── POST /api/pay/confirm ────────────────────────────────────
router.post('/confirm', async (req, res) => {
    const { paymentKey, orderId, amount } = req.body || {};
    if (!orderId) return res.status(400).json({ ok: false, error: 'orderId가 필요해요.' });

    const payment = db.prepare('SELECT * FROM payments WHERE orderId = ?').get(orderId);
    if (!payment) return res.status(404).json({ ok: false, error: '결제 내역을 찾을 수 없어요.' });

    // 멱등성: 이미 처리된 결제
    if (payment.status === 'paid') {
        return res.json({ ok: true, jobId: payment.jobId, message: '이미 처리된 결제예요.' });
    }

    const isFreeOrder = payment.amount === 0;

    try {
        if (!isFreeOrder) {
            // 토스페이먼츠 서버 측 confirm (실결제)
            const secretKey = process.env.TOSS_SECRET_KEY || '';
            if (!secretKey) {
                throw new Error('결제 설정이 아직 준비되지 않았어요. 무료 체험을 이용해주세요.');
            }
            await confirmTossPayment({ paymentKey, orderId, amount: payment.amount, secretKey });
        }

        // 성공 처리
        db.prepare('UPDATE payments SET status = ?, paymentKey = ? WHERE orderId = ?')
            .run('paid', paymentKey || 'free', orderId);
        db.prepare('UPDATE jobs SET isUrgentPaid = 1 WHERE id = ?').run(payment.jobId);
        db.prepare('UPDATE users SET urgentTrialUsed = 1 WHERE id = ?').run(payment.userId);

        // Group C: 후불 수금 대기 마킹 (jobs.note에 태그 또는 별도 처리)
        const user = db.prepare('SELECT abGroup FROM users WHERE id = ?').get(payment.userId);
        if (user?.abGroup === 'C' && payment.amount === 0) {
            console.log(`[PAY_DEFER] group=C jobId=${payment.jobId} → 효과 후 수금 대기`);
            // 관리자 추후 확인을 위한 로그만 남김 (실제 수금은 외부 프로세스)
        }

        try {
            trackEvent('payment_success', {
                userId:  payment.userId,
                jobId:   payment.jobId,
                meta:    { amount: payment.amount, isFree: isFreeOrder, orderId },
            });
        } catch (_) {}

        console.log(`[PAY_SUCCESS] orderId=${orderId} jobId=${payment.jobId} amount=${payment.amount} free=${isFreeOrder}`);
        return res.json({ ok: true, jobId: payment.jobId, isFree: isFreeOrder });

    } catch (e) {
        db.prepare('UPDATE payments SET status = ? WHERE orderId = ?').run('failed', orderId);
        try {
            trackEvent('payment_fail', {
                userId: payment.userId,
                jobId:  payment.jobId,
                meta:   { error: e.message, orderId },
            });
        } catch (_) {}
        console.error('[PAY_FAIL]', e.message);
        return res.status(400).json({ ok: false, error: e.message });
    }
});

// ─── 토스페이먼츠 서버 측 confirm ────────────────────────────
function confirmTossPayment({ paymentKey, orderId, amount, secretKey }) {
    return new Promise((resolve, reject) => {
        const body    = JSON.stringify({ paymentKey, orderId, amount });
        const encoded = Buffer.from(secretKey + ':').toString('base64');

        const opts = {
            hostname: 'api.tosspayments.com',
            path:     '/v1/payments/confirm',
            method:   'POST',
            headers: {
                'Authorization':  `Basic ${encoded}`,
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };

        const r = https.request(opts, (res) => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(raw);
                    if (res.statusCode === 200) resolve(parsed);
                    else reject(new Error(parsed.message || `토스 결제 오류 (${res.statusCode})`));
                } catch (_) {
                    reject(new Error('토스 응답 파싱 오류'));
                }
            });
        });
        r.on('error', reject);
        r.write(body);
        r.end();
    });
}

// ─── POST /api/pay/request (농민 자발적 결제 의사 표시) ──────────
// 효과 체험 후 "결제할게요" 클릭 시 → payStatus='pending' 마킹
router.post('/request', (req, res) => {
    const userId = req.headers['x-user-id'];
    const { jobId, method = 'phone' } = req.body || {};

    if (!userId) return res.status(401).json({ ok: false, error: '로그인이 필요해요.' });
    if (!jobId)  return res.status(400).json({ ok: false, error: 'jobId가 필요해요.' });

    const job = db.prepare('SELECT id, requesterId FROM jobs WHERE id = ?').get(jobId);
    if (!job) return res.status(404).json({ ok: false, error: '공고를 찾을 수 없어요.' });
    if (job.requesterId !== userId) return res.status(403).json({ ok: false, error: '본인 공고만 처리할 수 있어요.' });

    try {
        db.prepare("UPDATE jobs SET payStatus = 'pending', payMethod = ? WHERE id = ?").run(method, jobId);

        // payments 테이블에 pending 레코드 (결제 의사 표시)
        const orderId = 'pay-req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
        const existing = db.prepare("SELECT id FROM payments WHERE jobId = ? AND status IN ('ready','pending')").get(jobId);
        if (!existing) {
            db.prepare(`
                INSERT INTO payments (userId, jobId, amount, status, provider, orderId, createdAt)
                VALUES (?, ?, 3000, 'pending', ?, ?, ?)
            `).run(userId, jobId, method, orderId, new Date().toISOString());
        }

        trackEvent('pay_request', { userId, jobId, meta: { method } });
        console.log(`[PAY_REQUEST] jobId=${jobId} method=${method} userId=${userId}`);
        return res.json({ ok: true });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── POST /api/pay/mark-paid (관리자/운영자 결제 완료 처리) ─────────
router.post('/mark-paid', (req, res) => {
    const { jobId, adminKey } = req.body || {};
    if (!jobId) return res.status(400).json({ ok: false, error: 'jobId가 필요해요.' });

    // 관리자 키 확인 (또는 x-user-id가 admin인 경우)
    const expectedKey = process.env.ADMIN_KEY || 'your-secret-admin-key';
    if (adminKey !== expectedKey) {
        return res.status(403).json({ ok: false, error: '관리자 권한이 필요해요.' });
    }

    try {
        db.prepare("UPDATE jobs SET payStatus = 'paid', isUrgentPaid = 1 WHERE id = ?").run(jobId);
        db.prepare("UPDATE payments SET status = 'paid' WHERE jobId = ? AND status = 'pending'").run(jobId);
        trackEvent('pay_mark_paid', { jobId });
        console.log(`[PAY_MARK_PAID] jobId=${jobId}`);
        return res.json({ ok: true });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;
