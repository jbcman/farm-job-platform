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
/**
 * PHASE 30: jobId를 포함한 딥링크 생성
 *
 * 웹 앱:  https://농민일손.kr/jobs/{jobId}?source=kakao
 * 앱 스킴 (추후): farmjob://job/{jobId}
 *
 * SERVICE_DOMAIN 환경변수로 도메인 교체 가능
 */
function buildDeepLink(jobId, source = 'kakao') {
    if (!jobId) return SERVICE_DOMAIN;
    return `${SERVICE_DOMAIN}/jobs/${jobId}?source=${source}`;
}

/** 알림 종류별 소스 태그 — 유입 경로 추적 */
const DEEPLINK_SOURCE = {
    jobMatch:  'kakao_match',
    apply:     'kakao_apply',
    selected:  'kakao_selected',
    arrived:   'kakao_arrived',
};

function buildJobMatchTemplate({ jobType, locationText, pay, date, jobId }) {
    const payLine  = pay ? `💰 일당 ${pay}\n` : '';
    const dateStr  = date || '오늘';
    const link     = jobId ? buildDeepLink(jobId) : SERVICE_DOMAIN;
    return (
`[농민일손]

📍 ${locationText}
🌱 ${jobType}
${payLine}📅 ${dateStr}

👉 지원하기:
${link}`
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
        jobId:        job.id,
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

// ─── PHASE 17: sendApplyAlert — 작업자 지원 시 농민에게 알림 ────────
/**
 * 작업자가 "이 일 할게요"를 눌렀을 때 농민(job.requesterId)에게 즉시 알림
 *
 * @param {{ job: object, worker: object, farmer: object }} opts
 *   job    - jobs 테이블 row (normalizeJob 결과)
 *   worker - users 테이블 row (지원자)
 *   farmer - users 테이블 row (농민/의뢰자)
 */
async function sendApplyAlert({ job, worker, farmer } = {}) {
    if (!job?.id) {
        console.warn('[APPLY_ALERT_SKIP] job 없음');
        return { ok: false, reason: 'missing_job' };
    }

    const farmerPhone = farmer?.phone || null;
    const workerName  = worker?.name  || '지원자';
    const farmerName  = farmer?.name  || '농민';
    const link        = job?.id ? buildDeepLink(job.id, DEEPLINK_SOURCE.apply) : SERVICE_DOMAIN;

    // ── 로그 (PASS 기준 필수) ──────────────────────────────────
    console.log('[APPLY_ALERT_SENT]', {
        jobId:      job.id,
        workerId:   worker?.id,
        workerName,
        farmerId:   farmer?.id,
        farmerPhone: farmerPhone ? maskPhone(farmerPhone) : '(없음)',
        category:   job.category,
        location:   job.locationText,
        mode:       IS_REAL ? 'REAL' : 'MOCK',
    });

    // ── 메시지 포맷 (딥링크 소스 태그 포함) ─────────────────────
    const payLine  = job.pay ? `💰 일당 ${job.pay}\n` : '';
    const message  =
`📢 새로운 지원 도착!

👤 지원자: ${workerName}
📍 위치: ${job.locationText}
🌱 ${job.category}
${payLine}
👉 앱에서 바로 확인:
${link}`;

    if (!IS_REAL) {
        // MOCK 모드 — 콘솔 출력으로 대체
        console.log(`[KAKAO_APPLY_MOCK] 농민(${maskPhone(farmerPhone || '???')})에게 발송 예정`);
        console.log('[KAKAO_APPLY_MSG]\n' + message);
        return { ok: true, mock: true };
    }

    // REAL 모드 — 농민 전화번호가 있을 때만 발송
    if (!farmerPhone) {
        console.warn('[APPLY_ALERT_SKIP] 농민 전화번호 없음 → MOCK fallback');
        console.log('[KAKAO_APPLY_MSG]\n' + message);
        return { ok: false, reason: 'no_farmer_phone' };
    }

    // 기존 sendKakaoReal 재사용 (농민에게 발송)
    try {
        const result = await sendKakaoReal({ phone: farmerPhone, name: farmerName }, {
            ...job,
            // 농민용 메시지 커스터마이즈: category 앞에 지원자 이름 표기
            category: `${job.category} (지원: ${workerName})`,
        });
        return result;
    } catch (err) {
        console.error('[APPLY_ALERT_FAIL]', err.message);
        return { ok: false, error: err.message };
    }
}

// ─── PHASE 29: sendApplicantArrivedAlert — 자동선택 시 작업자에게 알림 ─
/**
 * 자동 선택 후 작업자(선택된 사람)에게 "선택됐어요" 알림
 *
 * @param {{ job: object, worker: object, farmer: object|null }} opts
 */
async function sendApplicantArrivedAlert({ job, worker, farmer } = {}) {
    const workerPhone = worker?.phone || null;
    const workerName  = worker?.name  || '작업자';
    const farmerName  = farmer?.name  || '농민';
    const link        = buildDeepLink(job?.id, DEEPLINK_SOURCE.arrived);

    const message =
`🎉 선택됐어요!

👤 농민: ${farmerName}
📍 위치: ${job?.locationText || ''}
🌱 ${job?.category || ''}

📞 농민이 곧 연락드릴 거예요.
👉 확인하기:
${link}`;

    console.log('[ARRIVED_ALERT]', {
        jobId: job?.id, workerId: worker?.id, workerName,
        phone: workerPhone ? maskPhone(workerPhone) : '(없음)',
        mode: IS_REAL ? 'REAL' : 'MOCK',
    });

    if (!IS_REAL) {
        console.log(`[KAKAO_ARRIVED_MOCK] 작업자(${maskPhone(workerPhone || '???')})에게 발송 예정`);
        console.log('[KAKAO_ARRIVED_MSG]\n' + message);
        return { ok: true, mock: true };
    }

    if (!workerPhone) {
        console.warn('[ARRIVED_ALERT_SKIP] 작업자 전화번호 없음');
        return { ok: false, reason: 'no_worker_phone' };
    }

    try {
        return await sendKakaoReal({ phone: workerPhone, name: workerName }, {
            ...job,
            category: `${job?.category || ''} (선택 완료)`,
        });
    } catch (err) {
        console.error('[ARRIVED_ALERT_FAIL]', err.message);
        return { ok: false, error: err.message };
    }
}

// ─── PHASE 29: sendWorkerSelectedAlert — 작업자 선택 시 농민에게 알림 ─
/**
 * 자동/수동 선택 후 농민에게 "작업자가 결정됐어요" 알림
 *
 * @param {{ job: object, worker: object, farmer: object, isAuto?: boolean }} opts
 */
async function sendWorkerSelectedAlert({ job, worker, farmer, isAuto = false } = {}) {
    const farmerPhone = farmer?.phone || null;
    const farmerName  = farmer?.name  || '농민';
    const workerName  = worker?.name  || '작업자';
    const link        = buildDeepLink(job?.id, DEEPLINK_SOURCE.selected);
    const autoLabel   = isAuto ? ' (자동 매칭)' : '';

    const message =
`✅ 작업자 연결 완료${autoLabel}

👤 작업자: ${workerName}
📍 위치: ${job?.locationText || ''}
🌱 ${job?.category || ''}

📞 작업자에게 직접 연락해보세요.
👉 확인하기:
${link}`;

    console.log('[SELECTED_ALERT]', {
        jobId: job?.id, workerId: worker?.id, workerName, isAuto,
        farmerPhone: farmerPhone ? maskPhone(farmerPhone) : '(없음)',
        mode: IS_REAL ? 'REAL' : 'MOCK',
    });

    if (!IS_REAL) {
        console.log(`[KAKAO_SELECTED_MOCK] 농민(${maskPhone(farmerPhone || '???')})에게 발송 예정`);
        console.log('[KAKAO_SELECTED_MSG]\n' + message);
        return { ok: true, mock: true };
    }

    if (!farmerPhone) {
        console.warn('[SELECTED_ALERT_SKIP] 농민 전화번호 없음');
        return { ok: false, reason: 'no_farmer_phone' };
    }

    try {
        return await sendKakaoReal({ phone: farmerPhone, name: farmerName }, {
            ...job,
            category: `${job?.category || ''} — ${workerName} 선택됨`,
        });
    } catch (err) {
        console.error('[SELECTED_ALERT_FAIL]', err.message);
        return { ok: false, error: err.message };
    }
}

// ─── PHASE 32: sendDepartureReminder — 작업 시작 후 이탈 방지 독촉 ──
/**
 * 작업 시작 10분 후에도 in_progress 상태면 작업자에게 출발 확인 메시지
 *
 * @param {{ job: object, worker: object }} opts
 */
async function sendDepartureReminder({ job, worker } = {}) {
    const workerPhone = worker?.phone || null;
    const workerName  = worker?.name  || '작업자';
    const link        = buildDeepLink(job?.id, 'reminder');

    const message =
`🚜 출발하셨나요?

농민이 기다리고 있어요.

📍 ${job?.locationText || ''}
🌱 ${job?.category || ''}

👉 확인하기:
${link}`;

    console.log('[DEPARTURE_REMINDER]', {
        jobId: job?.id, workerName,
        phone: workerPhone ? maskPhone(workerPhone) : '(없음)',
        mode: IS_REAL ? 'REAL' : 'MOCK',
    });

    if (!IS_REAL) {
        console.log(`[KAKAO_REMINDER_MOCK] 작업자(${maskPhone(workerPhone || '???')})에게 발송`);
        console.log('[KAKAO_REMINDER_MSG]\n' + message);
        return { ok: true, mock: true };
    }

    if (!workerPhone) {
        console.warn('[DEPARTURE_REMINDER_SKIP] 전화번호 없음');
        return { ok: false, reason: 'no_phone' };
    }

    try {
        return await sendKakaoReal({ phone: workerPhone, name: workerName }, {
            ...job, category: `${job?.category || ''} — 출발 확인`,
        });
    } catch (err) {
        console.error('[DEPARTURE_REMINDER_FAIL]', err.message);
        return { ok: false, error: err.message };
    }
}

// ─── 부팅 시 모드 출력 ──────────────────────────────────────────
console.log(`[KAKAO_SERVICE] mode=${IS_REAL ? 'REAL' : 'MOCK'} template_job_match=${TEMPLATE_JOB_MATCH || '(미설정)'}`);

// ─── CONTACT_TO_MATCH_AUTOFLOW_V1: 연락 버튼 자동 알림 ──────────
/**
 * sendContactAlert — 작업자가 "바로 연락하기" 클릭 시 농민에게 알림
 * @param {object} job     — { id, category, locationText, pay, date, requesterId }
 * @param {object} worker  — { id, name? }
 */
async function sendContactAlert(job, worker) {
    try {
        const workerName = worker?.name || '작업자';
        const category   = job?.category || '작업';
        const location   = job?.locationText || '';
        const msg = [
            '[농촌일손]',
            `${category} 의뢰에 ${workerName}님이 연락했습니다.`,
            location ? `📍 ${location}` : '',
            '',
            '앱에서 확인해 주세요.',
        ].filter(l => l !== null).join('\n');

        if (IS_REAL) {
            // 농민 전화번호 조회 (DB 의존성 최소화 — 호출자가 넘겨도 됨)
            const farmerPhone = job.farmerPhone || null;
            if (farmerPhone) {
                await sendKakaoReal({ phone: farmerPhone }, job);
            } else {
                console.log('[CONTACT_ALERT_REAL_SKIP] 농민 전화번호 없음 → MOCK 대체');
                console.log('[CONTACT_ALERT_MOCK]\n' + msg);
            }
        } else {
            console.log('[CONTACT_ALERT_MOCK]');
            console.log(msg);
        }
        return { ok: true };
    } catch (err) {
        console.error('[CONTACT_ALERT_ERROR]', err.message);
        return { ok: false, error: err.message };
    }
}

module.exports = {
    sendJobAlert,
    sendApplyAlert,
    sendApplicantArrivedAlert,
    sendWorkerSelectedAlert,
    sendDepartureReminder,
    sendKakaoReal,
    sendKakaoMock,
    buildJobMatchTemplate,
    sendContactAlert,
    sentCache,
};
