'use strict';
/**
 * paymentService.js — 에스크로 결제 서비스 (Mock → PG 전환 가능)
 * PHASE_PAYMENT_ESCROW_V1
 *
 * 수수료: 10% (플랫폼 수익)
 * 상태 흐름: pending → reserved → paid → (refunded)
 *
 * 실결제 전환 방법:
 *   - createPayment()  → 토스/카카오 결제창 URL 반환으로 교체
 *   - confirmPayment() → PG사 webhook 검증 로직으로 교체
 *   - refundPayment()  → PG사 환불 API 호출로 교체
 */

const FEE_RATE = 0.10; // 플랫폼 수수료 10%

// ─── 일당 금액 파싱 (텍스트 → 숫자) ─────────────────────────────
function parsePay(raw) {
    if (!raw) return 0;
    const s = String(raw).trim();
    const manMatch = s.match(/(\d+(?:\.\d+)?)\s*만/);
    if (manMatch) return Math.round(parseFloat(manMatch[1]) * 10000);
    const digits = s.replace(/[^0-9]/g, '');
    return digits ? parseInt(digits, 10) : 0;
}

/**
 * createPayment — 결제 예약 생성 (에스크로)
 * @param {object} job — normalizeJob 결과
 * @returns {{ paymentId, amount, fee, net }}
 */
function createPayment(job) {
    const amount = parsePay(job.pay);
    const fee    = Math.floor(amount * FEE_RATE);
    const net    = amount - fee;

    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    console.log(
        `[PAYMENT_CREATE] paymentId=${paymentId}` +
        ` amount=${amount.toLocaleString()}원` +
        ` fee=${fee.toLocaleString()}원(${Math.round(FEE_RATE * 100)}%)` +
        ` net=${net.toLocaleString()}원`
    );

    return { paymentId, amount, fee, net };
}

/**
 * confirmPayment — 결제 확정 (에스크로 잠금 → 실결제 완료)
 * @param {string} paymentId
 * @returns {boolean}
 */
function confirmPayment(paymentId) {
    // TODO: PG사 결제 검증 API 호출 (토스: GET /v1/payments/{paymentKey})
    console.log(`[PAYMENT_CONFIRM] paymentId=${paymentId} → 확정 완료 (Mock)`);
    return true;
}

/**
 * refundPayment — 결제 환불 (분쟁 / 취소)
 * @param {string} paymentId
 * @returns {boolean}
 */
function refundPayment(paymentId) {
    // TODO: PG사 환불 API 호출 (토스: POST /v1/payments/{paymentKey}/cancel)
    console.log(`[PAYMENT_REFUND] paymentId=${paymentId} → 환불 완료 (Mock)`);
    return true;
}

module.exports = { createPayment, confirmPayment, refundPayment, parsePay };
