'use strict';
const express = require('express');
const db      = require('../db');
const { trackEvent } = require('../services/analyticsService');

const router = express.Router();

// 프론트엔드에서 전송 가능한 이벤트 목록
const ALLOWED_EVENTS = new Set([
    // 기존
    'job_viewed',
    'page_view',
    'cta_clicked',
    'onboarding_done',
    // Mission I: 모바일 실사용 추적
    'mobile_visit',
    'login_success',
    'quick_job_created',
    'call_clicked',
    'location_permission_granted',
    'location_permission_denied',
    // Phase 5: 딥링크 + 지원 추적
    'job_detail_view',
    'job_apply',
    // Phase 8: 마감 추적
    'job_closed',
    // Phase 10: 지도 이벤트
    'map_view_open',
    'map_marker_click',
    'map_gps_denied',
    'map_card_select',
    // Phase 11: 리텐션
    'retention_cta_click',
    'job_copy_created',
    // Phase 12: 전환 최적화 (conversion optimization)
    'recent_job_click',
    'job_copy_started',
    'job_copy_submitted',
    'reengage_match_found',
    'reengage_apply_returned',
    'retention_cta_exposed',
    // PHASE TEST_INSTRUMENTATION: 현장 테스트 핵심 퍼널
    'apply_click',        // 지원 CTA 클릭 (JobCard)
    'call_click',         // 전화 버튼 클릭 (PostApplySheet)
    'sms_click',          // SMS 버튼 클릭 (PostApplySheet)
    'direction_click',    // 길찾기 클릭 (JobCard / Detail)
    'map_view',           // 앱 지도보기 클릭 (JobCard)
    'share_click',        // 공유 버튼 클릭 (Detail)
    'share_kakao',        // 카카오 공유 성공
    'share_native',       // OS 공유 성공
    'share_clipboard',    // 클립보드 복사
    'nav_kakao',          // 카카오 길찾기 (Detail)
    'nav_naver',          // 네이버 길찾기 (Detail)
    // PHASE SCALE: 수익화 이벤트
    'sponsor_urgent_paid_click',  // 유료 긴급 공고 등록 클릭
    'sponsor_registered_click',   // 스폰서 상단 노출 등록 클릭
    // PHASE SCALE+: A/B + 결제 퍼널
    'ab_group_assigned',     // A/B 그룹 배정 완료
    'urgent_price_view',     // 긴급 공고 가격 노출
    'urgent_click',          // 긴급 공고 체크박스 클릭
    'payment_start',         // 결제 시작
    'payment_success',       // 결제/체험 성공
    'payment_fail',          // 결제 실패
    // PHASE FARMER_PAY_UX: 후불 결제 퍼널
    'pay_request',           // 결제 의사 표시 (method: kakao/bank/phone)
    'pay_click',             // 결제 버튼 클릭
    'pay_intent_positive',   // "효과 좋았어요" 선택
    'pay_mark_paid',         // 결제 완료 처리
    'pay_remind_view',       // 홈 결제 리마인드 배너 노출
    // KAKAO_CHANNEL: 채팅 전환 추적
    'kakao_chat_click',      // KakaoButton 클릭
    // CTA 클릭 추적 (HOMEPAGE_BRAND_POLISH)
    'cta_click',
    'contact_apply',         // 즉시 SMS/전화 연결 지원
]);

// ─── POST /api/analytics/event ────────────────────────────────
router.post('/event', (req, res) => {
    const { event, jobId, meta } = req.body;
    const userId = req.headers['x-user-id'] || req.body.userId;

    if (!event || !ALLOWED_EVENTS.has(event)) {
        return res.status(400).json({ ok: false, error: '허용되지 않는 이벤트예요.' });
    }

    trackEvent(event, { jobId, userId, meta });
    return res.json({ ok: true });
});

// ─── GET /api/analytics/summary ───────────────────────────────
router.get('/summary', async (_req, res) => {
    const rows = await db.prepare(`
        SELECT event, COUNT(*) as count,
               MAX(createdAt) as lastAt
        FROM analytics
        GROUP BY event
        ORDER BY count DESC
    `).all();

    const total = (await db.prepare('SELECT COUNT(*) as n FROM analytics').get()).n;

    return res.json({ ok: true, total, events: rows });
});

// ─── GET /api/analytics/stats — 전환 퍼널 ────────────────────
// 현장 테스트용: apply → call 전환율 계산
router.get('/stats', async (_req, res) => {
    const get = async (event) =>
        (await db.prepare("SELECT COUNT(*) as n FROM analytics WHERE event = ?").get(event))?.n || 0;

    const applyClick   = await get('apply_click')  + await get('job_apply');   // 카드 + 상세 둘 다 집계
    const callClick    = await get('call_click')   + await get('call_clicked');
    const smsClick     = await get('sms_click');
    const kakaoClick   = await get('kakao_chat_click');
    const contactApply = await get('contact_apply');
    const ctaClick     = await get('cta_click');
    const dirClick     = await get('direction_click') + await get('nav_kakao') + await get('nav_naver');
    const shareClick   = await get('share_click')  + await get('share_kakao') + await get('share_native') + await get('share_clipboard');
    const detailView   = await get('job_detail_view');
    const mapView      = await get('map_view') + await get('map_view_open') + await get('map_marker_click');
    const pageView     = await get('page_view') + await get('mobile_visit');

    const convApplyToCall = applyClick > 0
        ? Math.round(((callClick + kakaoClick) / applyClick) * 100)
        : null;
    const convDetailToApply = detailView > 0
        ? Math.round((applyClick / detailView) * 100)
        : null;
    const convCtaToDetail = ctaClick > 0
        ? Math.round((detailView / ctaClick) * 100)
        : null;

    return res.json({
        ok: true,
        funnel: {
            page_view:        pageView,
            cta_click:        ctaClick,
            detail_view:      detailView,
            apply_click:      applyClick,
            contact_apply:    contactApply,
            call_click:       callClick,
            sms_click:        smsClick,
            kakao_click:      kakaoClick,
            direction_click:  dirClick,
            map_view:         mapView,
            share_click:      shareClick,
        },
        conversion: {
            cta_to_detail:    convCtaToDetail    !== null ? `${convCtaToDetail}%`    : 'N/A',
            detail_to_apply:  convDetailToApply  !== null ? `${convDetailToApply}%`  : 'N/A',
            apply_to_contact: convApplyToCall    !== null ? `${convApplyToCall}%`    : 'N/A',
        },
    });
});

module.exports = router;
