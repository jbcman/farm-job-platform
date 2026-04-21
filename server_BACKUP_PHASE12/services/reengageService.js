'use strict';
/**
 * reengageService.js — 미선택 지원자 재매칭 알림
 *
 * 새 job이 등록될 때, 같은 카테고리의 과거 closed/matched job에 지원했지만
 * 선택되지 않은 작업자에게 새 일자리 알림을 보낸다.
 *
 * 실제 푸시/카카오 발송 대신 console.log + analyticsService로 처리
 * (외부 서비스 연동은 Phase 12 이후)
 */
const db           = require('../db');
const { trackEvent } = require('./analyticsService');

/**
 * 새 job 등록 직후 호출 — setImmediate 내부에서 비동기 실행
 * @param {object} newJob  — { id, category, locationText, date, requesterId }
 */
function reengageUnselectedApplicants(newJob) {
    try {
        if (!newJob?.id || !newJob?.category) return;

        // 같은 카테고리의 최근 closed/matched job (최대 30일)
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const pastJobs = db.prepare(`
            SELECT id FROM jobs
            WHERE category = ?
              AND status IN ('closed', 'matched')
              AND createdAt > ?
              AND requesterId != ?
        `).all(newJob.category, cutoff, newJob.requesterId);

        if (pastJobs.length === 0) return;

        const pastJobIds = pastJobs.map(j => j.id);

        // 해당 job에 지원했지만 선택되지 않은 고유 작업자
        const placeholders = pastJobIds.map(() => '?').join(',');
        const unselected = db.prepare(`
            SELECT DISTINCT workerId FROM applications
            WHERE jobRequestId IN (${placeholders})
              AND status IN ('pending', 'rejected')
        `).all(...pastJobIds);

        if (unselected.length === 0) return;

        console.log(`[REENGAGE_ALERT_SENT] newJobId=${newJob.id} category=${newJob.category} targets=${unselected.length}`);

        // 각 작업자에게 알림 (현재는 analytics 이벤트로만 기록)
        unselected.forEach(({ workerId }) => {
            trackEvent('reengage_alert', {
                jobId:    newJob.id,
                userId:   workerId,
                meta: {
                    category:     newJob.category,
                    locationText: newJob.locationText,
                    date:         newJob.date,
                },
            });
        });

    } catch (e) {
        // fail-safe — 재매칭 실패가 job 등록을 막으면 안됨
        console.error('[REENGAGE_ERROR]', e.message);
    }
}

module.exports = { reengageUnselectedApplicants };
