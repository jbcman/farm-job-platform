'use strict';
/**
 * notificationService.js — 카카오 알림톡 (SolAPI)
 *
 * 환경변수:
 *   USE_KAKAO=true/false              실발송 여부 (기본 false → MOCK)
 *   KAKAO_TEST_MODE=true/false        테스트 모드 (true → KAKAO_TEST_PHONE으로만 발송)
 *   KAKAO_TEST_PHONE=821012345678     테스트 수신 번호
 *   KAKAO_API_KEY                     SolAPI API Key
 *   KAKAO_API_SECRET                  SolAPI API Secret
 *   KAKAO_PFID                        카카오 발신 프로필 ID
 *   KAKAO_FROM                        발신 번호 (숫자만: 01012345678)
 *   KAKAO_TEMPLATE_CODE_SELECT        작업자 선택 템플릿
 *   KAKAO_TEMPLATE_CODE_START         작업 시작 템플릿
 *   KAKAO_TEMPLATE_CODE_COMPLETE      작업 완료 템플릿
 */

const https  = require('https');
const crypto = require('crypto');

// ─── 설정 ────────────────────────────────────────────────────────
const USE_KAKAO    = process.env.USE_KAKAO      === 'true';
const TEST_MODE    = process.env.KAKAO_TEST_MODE === 'true';
const TEST_PHONE   = process.env.KAKAO_TEST_PHONE || '';
const API_KEY      = process.env.KAKAO_API_KEY    || '';
const API_SECRET   = process.env.KAKAO_API_SECRET || '';
const PFID         = process.env.KAKAO_PFID       || '';
const FROM         = process.env.KAKAO_FROM       || '';

const TEMPLATE = {
    select:   process.env.KAKAO_TEMPLATE_CODE_SELECT   || '',
    start:    process.env.KAKAO_TEMPLATE_CODE_START    || '',
    complete: process.env.KAKAO_TEMPLATE_CODE_COMPLETE || '',
};

const SOLAPI_HOST    = 'api.solapi.com';
const SOLAPI_PATH    = '/messages/v4/send';
const TIMEOUT_MS     = 5000;
const RETRY_DELAY_MS = 1000;

// ─── 부팅 시 상태 출력 ───────────────────────────────────────────
function printAlimtalkStatus() {
    const mode     = USE_KAKAO  ? 'REAL' : 'MOCK';
    const testInfo = TEST_MODE  ? `ON  (→ ${maskPhone(TEST_PHONE)})` : 'OFF';
    const configOk = !!(API_KEY && API_SECRET && PFID && FROM);
    console.log('');
    console.log('──────────────────────────────────────────');
    console.log('📨 Kakao AlimTalk Status');
    console.log(`   Mode      : ${mode}`);
    console.log(`   Test Mode : ${testInfo}`);
    console.log(`   Config OK : ${configOk ? '✅' : '⚠️  환경변수 미설정'}`);
    if (USE_KAKAO && !configOk) {
        console.log('   ❗ KAKAO_API_KEY / API_SECRET / PFID / FROM 확인 필요');
    }
    console.log('──────────────────────────────────────────');
    console.log('');
}
printAlimtalkStatus();

// ─── 전화번호 유틸 ───────────────────────────────────────────────
/**
 * 한국 번호 → 국제 형식 (821012345678)
 */
function formatKoreanPhoneNumber(raw) {
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('82')) return digits;
    if (digits.startsWith('0'))  return '82' + digits.slice(1);
    return '82' + digits;
}

/**
 * 전화번호 마스킹 (로그용)
 * 821012345678 → 8210****5678
 */
function maskPhone(phone) {
    if (!phone || phone.length < 8) return '****';
    return phone.slice(0, 4) + '****' + phone.slice(-4);
}

/**
 * 전화번호 유효성 검사
 * 국제형식(82로 시작, 11~12자리 숫자)
 */
function isValidPhone(phone) {
    return /^82\d{9,10}$/.test(phone);
}

// ─── SolAPI 인증 헤더 ────────────────────────────────────────────
function buildAuthHeader() {
    const date      = new Date().toISOString();
    const salt      = crypto.randomBytes(16).toString('hex');
    const signature = crypto
        .createHmac('sha256', API_SECRET)
        .update(date + salt)
        .digest('hex');
    return `HMAC-SHA256 apiKey=${API_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}

// ─── HTTP POST (내장 https, timeout 포함) ────────────────────────
function httpsPost(host, path, payload, headers) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const req  = https.request(
            {
                hostname: host,
                port: 443,
                path,
                method: 'POST',
                headers: {
                    'Content-Type':   'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    ...headers,
                },
            },
            (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                    catch (_) { resolve({ status: res.statusCode, body: data }); }
                });
            }
        );
        req.on('error', reject);
        req.setTimeout(TIMEOUT_MS, () => {
            req.destroy(new Error(`timeout after ${TIMEOUT_MS}ms`));
        });
        req.write(body);
        req.end();
    });
}

// ─── 단건 발송 (재시도 1회 포함) ─────────────────────────────────
async function trySend(payload, attempt = 1) {
    try {
        return await httpsPost(SOLAPI_HOST, SOLAPI_PATH, payload, {
            Authorization: buildAuthHeader(),
        });
    } catch (err) {
        if (attempt < 2) {
            console.warn(`[ALIMTALK_RETRY] attempt=${attempt} error=${err.message}`);
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            return trySend(payload, attempt + 1);
        }
        throw err;
    }
}

// ─── 핵심 발송 함수 ──────────────────────────────────────────────
/**
 * @param {string} phone         - 수신자 번호 (010-xxxx-xxxx 등)
 * @param {string} templateCode  - SolAPI 템플릿 코드
 * @param {string} text          - 메시지 본문
 * @param {object} [variables]   - 템플릿 변수
 * @returns {Promise<{ok:boolean, mock?:boolean, response?:any, error?:string}>}
 */
async function sendKakaoAlimtalk({ phone, templateCode, text, variables = {} }) {
    // 수신 번호 결정 (테스트 모드)
    const rawTarget = TEST_MODE && TEST_PHONE ? TEST_PHONE : phone;
    const to        = formatKoreanPhoneNumber(rawTarget);

    // ── MOCK 모드 ───────────────────────────────────────────────
    if (!USE_KAKAO) {
        console.log(`[ALIMTALK_MOCK] to=${maskPhone(to)} template=${templateCode || 'n/a'} testMode=${TEST_MODE}`);
        console.log(`[ALIMTALK_MOCK] "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);
        return { ok: true, mock: true };
    }

    // ── 전화번호 유효성 검사 ─────────────────────────────────────
    if (!isValidPhone(to)) {
        console.error(`[ALIMTALK_FAIL] 유효하지 않은 번호: ${maskPhone(to)}`);
        return { ok: false, error: 'invalid_phone' };
    }

    // ── 필수 설정 확인 ──────────────────────────────────────────
    if (!API_KEY || !API_SECRET || !PFID || !FROM) {
        console.warn('[ALIMTALK_SKIP] 환경변수 미설정 → MOCK 처리');
        console.log(`[ALIMTALK_MOCK] to=${maskPhone(to)} "${text.slice(0, 60)}..."`);
        return { ok: false, reason: 'config_missing' };
    }
    if (!templateCode) {
        console.warn('[ALIMTALK_SKIP] 템플릿 코드 없음 → MOCK 처리');
        return { ok: false, reason: 'no_template' };
    }

    const solPayload = {
        messages: [{
            to,
            from: FROM,
            type: 'ATA',
            kakaoOptions: {
                pfId:         PFID,
                templateCode,
                variables,
                disableSms:   false,
            },
            text,
        }],
    };

    console.log(`[ALIMTALK_REQ] to=${maskPhone(to)} template=${templateCode} testMode=${TEST_MODE}`);

    try {
        const result = await trySend(solPayload);

        if (result.status === 200 || result.status === 201) {
            console.log(`[ALIMTALK_SUCCESS] to=${maskPhone(to)} template=${templateCode} status=${result.status}`);
            return { ok: true, response: result.body };
        } else {
            console.error(`[ALIMTALK_FAIL] to=${maskPhone(to)} template=${templateCode} status=${result.status}`, JSON.stringify(result.body));
            return { ok: false, status: result.status, body: result.body };
        }
    } catch (err) {
        console.error(`[ALIMTALK_FAIL] to=${maskPhone(to)} template=${templateCode} error=${err.message}`);
        return { ok: false, error: err.message };
    }
}

// ─── 레거시 호환 ─────────────────────────────────────────────────
function sendKakaoMessage(phone, text) {
    sendKakaoAlimtalk({ phone, templateCode: '', text }).catch(() => {});
}

// ─── 템플릿별 알림 함수 ──────────────────────────────────────────

function sendSelectionNotification(job, worker, farmer) {
    const farmerName = farmer?.name || job.requesterName || '농민';
    const text =
`[농민일손] 작업 배정 알림

${farmerName}님이 ${worker.name}님을 작업자로 선택했습니다.

📋 작업: ${job.category}
📍 위치: ${job.locationText}
📅 날짜: ${job.date}

지금 바로 연락해보세요!`;

    console.log(`[ALERT] 매칭 알림 → worker=${worker.name} (${maskPhone(formatKoreanPhoneNumber(worker.phone))})`);

    return sendKakaoAlimtalk({
        phone:        worker.phone,
        templateCode: TEMPLATE.select,
        text,
        variables: {
            farmerName,
            workerName:   worker.name,
            category:     job.category,
            locationText: job.locationText,
            date:         job.date,
        },
    }).catch(() => ({ ok: false, error: 'unhandled' }));
}

function sendJobStartedNotification(job, worker) {
    const text =
`[농민일손] 작업 시작 알림

${job.category} 작업이 시작되었습니다.

📍 위치: ${job.locationText}
📅 날짜: ${job.date}

안전하게 작업 마무리하세요!`;

    console.log(`[ALERT] 작업 시작 알림 → worker=${worker.name} (${maskPhone(formatKoreanPhoneNumber(worker.phone))})`);

    return sendKakaoAlimtalk({
        phone:        worker.phone,
        templateCode: TEMPLATE.start,
        text,
        variables: {
            workerName:   worker.name,
            category:     job.category,
            locationText: job.locationText,
            date:         job.date,
        },
    }).catch(() => ({ ok: false, error: 'unhandled' }));
}

function sendJobCompletedNotification(job, worker) {
    const text =
`[농민일손] 작업 완료 알림

${job.category} 작업이 완료되었습니다. 수고하셨습니다!

📍 위치: ${job.locationText}
📅 날짜: ${job.date}

농민님이 후기를 남기면 알려드릴게요.`;

    console.log(`[ALERT] 작업 완료 알림 → worker=${worker.name} (${maskPhone(formatKoreanPhoneNumber(worker.phone))})`);

    return sendKakaoAlimtalk({
        phone:        worker.phone,
        templateCode: TEMPLATE.complete,
        text,
        variables: {
            workerName:   worker.name,
            category:     job.category,
            locationText: job.locationText,
            date:         job.date,
        },
    }).catch(() => ({ ok: false, error: 'unhandled' }));
}

module.exports = {
    sendKakaoMessage,
    sendKakaoAlimtalk,
    sendSelectionNotification,
    sendJobStartedNotification,
    sendJobCompletedNotification,
    formatKoreanPhoneNumber,
    maskPhone,
    isValidPhone,
};
