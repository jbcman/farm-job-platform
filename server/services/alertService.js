'use strict';
/**
 * alertService.js — 운영자 장애 자동 알람
 *
 * 트리거 (환경변수로 재정의 가능):
 *   ERROR_SPIKE  errorsLast1m  > ALERT_ERROR_THRESHOLD  (기본 5)
 *   SLOW_SERVER  avgResponseMs > ALERT_SLOW_MS           (기본 1000)
 *
 * 쿨다운 전략:
 *   ① 기본 5분  (ALERT_COOLDOWN_MS)
 *   ② 동일 타입 3회 연속 발화 → 30분으로 자동 억제 (알람 피로 방지)
 *   ③ 복구 감지 시 연속 카운트 리셋
 *
 * 발송:
 *   USE_KAKAO=false : console.warn 로그 (MOCK)
 *   USE_KAKAO=true  : notificationService.sendKakaoAlimtalk → ADMIN_PHONE
 *
 * 환경변수:
 *   ADMIN_PHONE               운영자 수신 번호 (예: 010-1234-5678)
 *   ALERT_COOLDOWN_MS         기본 쿨다운 ms   (기본 300000 = 5분)
 *   ALERT_ERROR_THRESHOLD     에러/분 임계값   (기본 5)
 *   ALERT_SLOW_MS             응답속도 임계 ms  (기본 1000)
 *   KAKAO_TEMPLATE_CODE_ALERT 운영자 알람 카카오 템플릿 코드
 */

// ── 설정 상수 ─────────────────────────────────────────────────────
const ADMIN_PHONE       = process.env.ADMIN_PHONE                || '';
const COOLDOWN_MS       = parseInt(process.env.ALERT_COOLDOWN_MS || '300000', 10);   // 5분
const ESCALATE_COOLDOWN = COOLDOWN_MS * 6;                                           // 30분
const ESCALATE_AFTER    = 3;   // 연속 N회 이상이면 쿨다운 에스컬레이션
const ERR_THRESHOLD     = parseInt(process.env.ALERT_ERROR_THRESHOLD || '5',    10);
const SLOW_THRESHOLD    = parseInt(process.env.ALERT_SLOW_MS          || '1000', 10);
const TEMPLATE_ALERT    = process.env.KAKAO_TEMPLATE_CODE_ALERT || '';

// ── 알람 타입 정의 ────────────────────────────────────────────────
const ALERT_TYPES = {
    ERROR_SPIKE:  { label: '🚨 에러 급증',   priority: 1 },
    SLOW_SERVER:  { label: '⚠️ 서버 지연',   priority: 2 },
    RECOVERY:     { label: '✅ 서비스 복구',  priority: 3 },
};

// ── 인메모리 상태 (타입별 독립 쿨다운) ───────────────────────────
// Map<type, { lastAt, consecutive, cooldownMs, active }>
const _state = new Map(
    Object.keys(ALERT_TYPES).map(t => [t, {
        lastAt:       0,
        consecutive:  0,
        cooldownMs:   COOLDOWN_MS,
        active:       false,  // 현재 이 조건이 발화 중인지
    }])
);

// ── 이전 스냅샷 (복구 감지용) ────────────────────────────────────
let _prevSnapshot = null;

// ── 카카오 발송 ──────────────────────────────────────────────────
async function _sendKakao(type, bodyText) {
    const label = ALERT_TYPES[type]?.label || type;
    const fullText = `[농민일손 운영알람]\n${label}\n\n${bodyText}\n\n발생시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`;

    if (!ADMIN_PHONE) {
        console.warn(`[ALERT] ${label} — ADMIN_PHONE 미설정, 로그만 출력`);
        console.warn(`[ALERT] ${fullText.replace(/\n/g, ' | ')}`);
        return { ok: false, reason: 'no_admin_phone' };
    }

    try {
        const { sendKakaoAlimtalk } = require('./notificationService');
        const result = await sendKakaoAlimtalk({
            phone:        ADMIN_PHONE,
            templateCode: TEMPLATE_ALERT,
            text:         fullText,
            variables:    { type, body: bodyText },
        });
        return result;
    } catch (e) {
        console.error('[ALERT_SEND_FAIL]', e.message);
        return { ok: false, error: e.message };
    }
}

// ── 쿨다운 체크 + 발송 ───────────────────────────────────────────
async function _tryFire(type, bodyText) {
    const st  = _state.get(type);
    const now = Date.now();

    if (now - st.lastAt < st.cooldownMs) return false; // 쿨다운 중

    // 발송
    const label = ALERT_TYPES[type]?.label || type;
    console.warn(`[ALERT_FIRE] type=${type} label=${label} body="${bodyText}"`);

    await _sendKakao(type, bodyText);

    // 상태 업데이트
    st.consecutive++;
    st.lastAt = now;
    // 에스컬레이션: 연속 N회 이상이면 쿨다운 연장
    st.cooldownMs = st.consecutive >= ESCALATE_AFTER ? ESCALATE_COOLDOWN : COOLDOWN_MS;
    if (st.consecutive >= ESCALATE_AFTER) {
        console.warn(`[ALERT_ESCALATE] type=${type} consecutive=${st.consecutive} → cooldown=${st.cooldownMs / 60000}분`);
    }

    return true;
}

// ── 복구 감지 + 알림 ─────────────────────────────────────────────
async function _checkRecovery(type, nowActive) {
    const st = _state.get(type);
    if (st.active && !nowActive) {
        // 조건이 해소됨 → 복구 알람 (쿨다운 없음, 1회)
        st.active      = false;
        st.consecutive = 0;
        st.cooldownMs  = COOLDOWN_MS;
        console.log(`[ALERT_RECOVERY] type=${type} — 조건 해소`);
        // 복구 알람은 직전에 실제로 발화된 경우만 발송 (lastAt > 0)
        if (st.lastAt > 0) {
            const label = ALERT_TYPES[type]?.label || type;
            await _sendKakao('RECOVERY', `${label} 조건 해소됨`);
        }
    }
    if (!st.active && nowActive) {
        st.active = true;
    }
}

// ── 핵심: 메트릭스 스냅샷 기반 알람 체크 ────────────────────────
/**
 * @param {object} snapshot  — metricsService.getSnapshot() 반환값
 */
async function checkAlerts(snapshot) {
    if (!snapshot) return;

    const { errorsLast1m, avgResponseMs } = snapshot;

    // ── ERROR_SPIKE ──────────────────────────────────────────────
    const errActive = (errorsLast1m || 0) > ERR_THRESHOLD;
    await _checkRecovery('ERROR_SPIKE', errActive);
    if (errActive) {
        await _tryFire('ERROR_SPIKE',
            `에러 ${errorsLast1m}건/분 (임계: ${ERR_THRESHOLD}건)\n응답속도: ${avgResponseMs}ms`
        );
    }

    // ── SLOW_SERVER ──────────────────────────────────────────────
    const slowActive = (avgResponseMs || 0) > SLOW_THRESHOLD;
    await _checkRecovery('SLOW_SERVER', slowActive);
    if (slowActive) {
        await _tryFire('SLOW_SERVER',
            `평균 응답속도 ${avgResponseMs}ms (임계: ${SLOW_THRESHOLD}ms)\n에러: ${errorsLast1m}건/분`
        );
    }

    _prevSnapshot = snapshot;
}

// ── 현재 알람 상태 (admin API용) ─────────────────────────────────
/**
 * @returns {{ alerts: Array, anyActive: boolean, summary: string }}
 */
function getAlertState() {
    const alerts = [];
    for (const [type, st] of _state.entries()) {
        if (type === 'RECOVERY') continue;
        const def    = ALERT_TYPES[type] || {};
        const inCooldown = st.lastAt > 0 && (Date.now() - st.lastAt) < st.cooldownMs;
        alerts.push({
            type,
            label:        def.label       || type,
            priority:     def.priority    || 9,
            active:       st.active,
            consecutive:  st.consecutive,
            lastAlertAt:  st.lastAt       || null,
            cooldownUntil: st.lastAt      ? st.lastAt + st.cooldownMs : null,
            inCooldown,
        });
    }

    const activeAlerts = alerts.filter(a => a.active);
    const p1Active     = activeAlerts.some(a => a.priority === 1);
    const p2Active     = activeAlerts.some(a => a.priority === 2);

    return {
        alerts,
        anyActive: activeAlerts.length > 0,
        p1Active,
        p2Active,
        thresholds: {
            errorsLast1m: ERR_THRESHOLD,
            avgResponseMs: SLOW_THRESHOLD,
        },
        lastSnapshot: _prevSnapshot
            ? { errorsLast1m: _prevSnapshot.errorsLast1m, avgResponseMs: _prevSnapshot.avgResponseMs }
            : null,
    };
}

// ── 설정 로그 ────────────────────────────────────────────────────
console.log(
    `[ALERT_SERVICE] 초기화 — ` +
    `errorThreshold=${ERR_THRESHOLD}/min ` +
    `slowThreshold=${SLOW_THRESHOLD}ms ` +
    `cooldown=${COOLDOWN_MS / 60000}분 ` +
    `adminPhone=${ADMIN_PHONE ? '***' + ADMIN_PHONE.slice(-4) : '(미설정)'}`
);

module.exports = { checkAlerts, getAlertState };
