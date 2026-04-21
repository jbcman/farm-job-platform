'use strict';
/**
 * kakaoService.js — 통합 카카오 알림 서비스 (MOCK / REAL)
 *
 * ─ 모드 결정 우선순위 ────────────────────────────────────────────
 *   1) KAKAO_MODE=REAL   → REAL 발송
 *   2) USE_KAKAO=true    → REAL 발송 (하위 호환)
 *   3) 그 외             → MOCK (콘솔 로그)
 *
 * ─ REAL 발송 ────────────────────────────────────────────────────
 *   SolAPI HMAC-SHA256 → notificationService.sendKakaoAlimtalk()
 *   자체 재시도 1회 + 5s timeout 내장 (notificationService에 구현)
 *
 * ─ 중복 방지 ────────────────────────────────────────────────────
 *   in-memory sentCache (key: phone|jobId)
 *   DB notify_log 60s cooldown (kakaoAlertService 위임)
 *
 * ─ fail-safe ────────────────────────────────────────────────────
 *   모든 예외 catch → 로그 출력 → 서버 흐름 유지
 *   API 실패 시 절대 throw 하지 않음
 */

// ─── 모드 결정 ───────────────────────────────────────────────────
const IS_REAL =
    process.env.KAKAO_MODE === 'REAL' ||
    process.env.USE_KAKAO  === 'true';

const SERVICE_DOMAIN    = process.env.SERVICE_DOMAIN || 'https://농민일손.kr';
const TEMPLATE_JOB_MATCH = process.env.KAKAO_TEMPLATE_CODE_JOB_MATCH || '';

// ─── 의존 서비스 (지연 로드) ─────────────────────────────────────
let _notifSvc = null;
function notifSvc() {
    if (!_notifSvc) {
        try { _notifSvc = require('./notificationService'); }
        catch (_) {}
    }
    return _notifSvc;
}

let _alertSvc = null;
function alertSvc() {
    if (!_alertSvc) {
        try { _alertSvc = require('./kakaoAlertService'); }
        catch (_) {}
    }
    return _alertSvc;
}

// ─── 전화번호 마스킹 ────────────────────────────────────────────
function maskPhone(phone) {
    if (!phone || phone.length < 4) return '***';
    return phone.slice(0, Math.max(0, phone.length - 4)).replace(/./g, '*') + phone.slice(-4);
}

// ─── STEP 4: 표준 알림 템플릿 ────────────────────────────────────
/**
 * [농민일손]
 *
 * 📍 {{location}}
 * 🌱 {{jobType}}
 * 💰 {{pay}}
 * 📅 {{date}}
 *
 * 👉 지원하기:
 * https://DOMAIN
 */
function buildJobMatchTemplate({ jobType, locationText, pay, date }) {
    const payLine  = pay  ? `💰 일당 ${pay}\n` : '';
    const dateStr  = date || '오늘';
    return (
`[농민일손]

📍 ${locationText}
🌱 ${jobType}
${payLine}📅 ${dateStr}

👉 지원하기:
${SERVICE_DOMAIN}`
    );
}

// ─── STEP 2: REAL 발송 ───────────────────────────────────────────
/**
 * SolAPI를 통해 실 알림톡 발송
 * notificationService.sendKakaoAlimtalk에 5s timeout + 1회 재시도 내장
 */
async function sendKakaoReal(user, job) {
    const svc = notifSvc();
    if (!svc) {
        console.error('[KAKAO_REAL_FAIL] notificationService 로드 실패 → MOCK 대체');
        sendKakaoMock(user, job);
        return { ok: false, error: 'notificationService_unavailable' };
    }

    const text = buildJobMatchTemplate({
        jobType:      job.category || job.jobType,
        locationText: job.locationText,
        pay:          job.pay,
        date:         job.date,
    });

    try {
        const result = await svc.sendKakaoAlimtalk({
            phone:        user.phone,
            templateCode: TEMPLATE_JOB_MATCH,
            text,
            variables: {
                jobType:      job.category || job.jobType,
                location:     job.locationText,
                pay:          job.pay || '협의',
                date:         job.date || '오늘',
            },
        });

        if (result.ok) {
            console.log(`[KAKAO_REAL_SENT] to=${maskPhone(user.phone)} jobType=${job.category||job.jobType} loc=${job.locationText}`);
        } else {
            console.error(`[KAKAO_REAL_FAIL] to=${maskPhone(user.phone)} reason=${result.error||result.reason||result.status}`);
        }
        return result;
    } catch (err) {
        // STEP 5: fail-safe — API 오류 시 서버 흐름 유지
        console.error(`[KAKAO_REAL_FAIL] to=${maskPhone(user.phone)} err=${err.message}`);
        return { ok: false, error: err.message };
    }
}

// ─── MOCK 발송 ───────────────────────────────────────────────────
function sendKakaoMock(user, job) {
    const payStr = job.pay ? ` 일당=${job.pay}` : '';
    console.log(
        `[KAKAO_MOCK] to=${maskPhone(user.phone)}` +
        ` name=${user.name||'?'}` +
        ` jobType=${job.category||job.jobType}` +
        ` loc=${job.locationText}${payStr}`
    );
    // 템플릿 내용도 함께 출력 (개발 확인용)
    console.log('[KAKAO_MOCK_TEMPLATE]\n' + buildJobMatchTemplate({
        jobType:      job.category || job.jobType,
        locationText: job.locationText,
        pay:          job.pay,
        date:         job.date,
    }));
    return { ok: true, mock: true };
}

// ─── STEP 3: 모드 스위치 ────────────────────────────────────────
/**
 * 중복 방지(in-memory sentCache + DB cooldown)를 포함한 단일 발송 진입점
 */
const sentCache = new Set();

async function sendJobAlert(user, job) {
    if (!user?.phone || !job?.id) return { ok: false, reason: 'missing_args' };

    // in-memory 중복 방지 (STEP 5)
    const cacheKey = user.phone + '|' + job.id;
    if (sentCache.has(cacheKey)) {
        console.log(`[KAKAO_SKIP] cache-hit ${maskPhone(user.phone)} job=${job.id}`);
        return { ok: false, reason: 'duplicate_cache' };
    }

    // DB 기반 중복 방지 + 실제 발송은 kakaoAlertService 위임
    const svc = alertSvc();
    if (svc) {
        const result = await svc.sendJobMatchAlert({
            jobId:        job.id,
            phone:        user.phone,
            name:         user.name || '작업자',
            jobType:      job.category || job.jobType,
            locationText: job.locationText,
            pay:          job.pay   || null,
            date:         job.date  || '',
        });
        if (result.reason !== 'duplicate') sentCache.add(cacheKey);
        return result;
    }

    // fallback: kakaoAlertService 없을 때 직접 처리
    try {
        let result;
        if (IS_REAL) {
            result = await sendKakaoReal(user, job);
        } else {
            result = sendKakaoMock(user, job);
        }
        sentCache.add(cacheKey);
        return result;
    } catch (err) {
        console.error('[KAKAO_ERROR] sendJobAlert:', err.message);
        return { ok: false, error: err.message };
    }
}

// ─── 부팅 시 모드 출력 ──────────────────────────────────────────
console.log(`[KAKAO_SERVICE] mode=${IS_REAL ? 'REAL' : 'MOCK'} template_job_match=${TEMPLATE_JOB_MATCH || '(미설정)'}`);

module.exports = { sendJobAlert, sendKakaoReal, sendKakaoMock, buildJobMatchTemplate, sentCache };
