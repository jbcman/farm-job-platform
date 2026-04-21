'use strict';
/**
 * kakaoAlertService.js — 관심 분야 매칭 카카오 알림
 *
 * ENV:
 *   USE_KAKAO=false  → MOCK (콘솔 로그)
 *   USE_KAKAO=true   → REAL (notificationService 위임)
 *
 * 중복 방지:
 *   DB notify_log 테이블 (jobId + phone + type UNIQUE)
 *   짧은 시간(60s) 이내 동일 발송 차단
 */
const db = require('../db');

const USE_KAKAO   = process.env.USE_KAKAO        === 'true';
const TEST_MODE   = process.env.KAKAO_TEST_MODE   === 'true';
const TEST_PHONE  = process.env.KAKAO_TEST_PHONE  || '';
const COOLDOWN_MS = 60_000; // 60초 이내 동일 jobId+phone+type 중복 차단

// 실서비스 위임 (USE_KAKAO=true 일 때만 import)
let notifSvc = null;
function getNotifSvc() {
    if (!notifSvc) {
        try { notifSvc = require('./notificationService'); }
        catch (_) { notifSvc = null; }
    }
    return notifSvc;
}

// ─── 중복 방지 체크 ────────────────────────────────────────────
function isDuplicate(jobId, phone, type) {
    const row = db.prepare(`
        SELECT sentAt FROM notify_log WHERE jobId = ? AND phone = ? AND type = ?
    `).get(jobId, phone, type);
    if (!row) return false;
    const elapsed = Date.now() - new Date(row.sentAt).getTime();
    return elapsed < COOLDOWN_MS;
}

function recordLog(jobId, phone, type) {
    const id = `nlog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
        db.prepare(`
            INSERT OR REPLACE INTO notify_log (id, jobId, phone, type, sentAt)
            VALUES (?, ?, ?, ?, ?)
        `).run(id, jobId, phone, type, new Date().toISOString());
    } catch (_) {}
}

// ─── 발송 대상 전화번호 결정 ───────────────────────────────────
function resolvePhone(phone) {
    if (TEST_MODE && TEST_PHONE) return TEST_PHONE;
    return phone;
}

// ─── 농민 일 등록 → 작업자에게 알림 ──────────────────────────────
/**
 * @param {{ jobId, phone, name, jobType, locationText, pay, date, link }} opts
 */
async function sendJobMatchAlert(opts) {
    const { jobId, phone, name, jobType, locationText, pay, date, link = '' } = opts;
    if (!phone || !jobId) return { ok: false, reason: 'missing_phone_or_jobId' };

    const type = 'JOB_MATCH';
    if (isDuplicate(jobId, phone, type)) {
        console.log(`[KAKAO_SKIP] dup jobId=${jobId} phone=***${phone.slice(-4)} type=${type}`);
        return { ok: false, reason: 'duplicate' };
    }

    const target = resolvePhone(phone);
    const payStr = pay ? ` · 일당 ${pay}` : '';

    if (!USE_KAKAO) {
        // MOCK 모드
        console.log(
            `[KAKAO_MOCK_SENT] to=${maskPhone(target)} type=${type}` +
            ` name=${name} jobType=${jobType} loc=${locationText} date=${date}${payStr}`
        );
        recordLog(jobId, phone, type);
        return { ok: true, mock: true };
    }

    // REAL 모드 — notificationService 위임
    try {
        const svc = getNotifSvc();
        if (!svc) throw new Error('notificationService 없음');
        const fakeJob    = { id: jobId, category: jobType, locationText, date, requesterName: '농민' };
        const fakeWorker = { name, phone: target };
        const result = await svc.sendSelectionNotification(fakeJob, fakeWorker);
        recordLog(jobId, phone, type);
        return result;
    } catch (e) {
        console.error(`[KAKAO_ERROR] sendJobMatchAlert: ${e.message}`);
        return { ok: false, error: e.message };
    }
}

// ─── 작업자 관심 등록 → 농민에게 알림 (미래 확장용) ────────────────
/**
 * @param {{ jobId, phone, name, jobType, locationText, link }} opts
 */
async function sendWorkerMatchAlert(opts) {
    const { jobId, phone, name, jobType, locationText, link = '' } = opts;
    if (!phone || !jobId) return { ok: false, reason: 'missing_phone_or_jobId' };

    const type = 'WORKER_MATCH';
    if (isDuplicate(jobId, phone, type)) {
        console.log(`[KAKAO_SKIP] dup jobId=${jobId} phone=***${phone.slice(-4)} type=${type}`);
        return { ok: false, reason: 'duplicate' };
    }

    const target = resolvePhone(phone);
    if (!USE_KAKAO) {
        console.log(
            `[KAKAO_MOCK_SENT] to=${maskPhone(target)} type=${type}` +
            ` name=${name} jobType=${jobType} loc=${locationText}`
        );
        recordLog(jobId, phone, type);
        return { ok: true, mock: true };
    }

    // REAL 모드 추후 구현
    recordLog(jobId, phone, type);
    return { ok: true };
}

// ─── 전화번호 마스킹 ───────────────────────────────────────────
function maskPhone(phone) {
    if (!phone || phone.length < 4) return '***';
    return phone.slice(0, Math.max(0, phone.length - 4)).replace(/./g, '*') + phone.slice(-4);
}

module.exports = { sendJobMatchAlert, sendWorkerMatchAlert };
