/**
 * api.js — 백엔드 API 클라이언트
 * BASE = '/api' → 프로덕션 빌드 후 동일 오리진(Express)에서 서빙
 *                 개발 시 Vite 프록시가 localhost:3002 로 전달
 */

const BASE = '/api';

async function req(method, path, body) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    // x-user-id 헤더: 서버 측 사용자 컨텍스트
    const userId = localStorage.getItem('farm-userId');
    if (userId) opts.headers['x-user-id'] = userId;

    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || '요청 실패');
    return data;
}

// ─── 작업 API ─────────────────────────────────────────────────

/** 작업 목록 조회 */
export async function getJobs({ category, date, lat, lon, radius, recommended } = {}) {
    const params = new URLSearchParams();
    if (category)    params.set('category', category);
    if (date)        params.set('date', date);
    if (lat)         params.set('lat', lat);
    if (lon)         params.set('lon', lon);
    if (recommended) params.set('recommended', String(recommended));
    params.set('radius', String(radius || 500));
    return req('GET', `/jobs?${params}`);
}

/** 작업 상세 */
export async function getJob(id) {
    return req('GET', `/jobs/${id}`);
}

/** 작업 등록 */
export async function createJob(payload) {
    return req('POST', '/jobs', payload);
}

/** 작업 지원 */
export async function applyJob(jobId, { workerId, message }) {
    return req('POST', `/jobs/${jobId}/apply`, { workerId, message });
}

/** 농민 연락처 조회 (지원 완료 후) */
export async function getJobContact(jobId, workerId) {
    return req('GET', `/jobs/${jobId}/contact?workerId=${workerId}`);
}

/** 지원자 목록 */
export async function getApplicants(jobId, requesterId) {
    return req('GET', `/jobs/${jobId}/applicants?requesterId=${requesterId}`);
}

/** 작업자 선택 */
export async function selectWorker(jobId, { requesterId, workerId }) {
    return req('POST', `/jobs/${jobId}/select-worker`, { requesterId, workerId });
}

/** PHASE 29: 전화 연결 정보 조회 */
export async function connectCall(jobId, requestingUserId) {
    return req('POST', `/jobs/${jobId}/connect-call`, { requestingUserId });
}

/** 내가 등록한 요청 */
export async function getMyJobs(userId) {
    return req('GET', `/jobs/my/jobs?userId=${userId}`);
}

/** 내가 지원한 목록 */
export async function getMyApplications(userId) {
    return req('GET', `/jobs/my/applications?userId=${userId}`);
}

// ─── 작업자 API ───────────────────────────────────────────────

/** 근처 작업자 */
export async function getNearbyWorkers({ lat, lon, category } = {}) {
    const params = new URLSearchParams();
    if (lat)      params.set('lat', lat);
    if (lon)      params.set('lon', lon);
    if (category) params.set('category', category);
    return req('GET', `/workers/nearby?${params}`);
}

// ─── AI 보조 ─────────────────────────────────────────────────

/** 카테고리 자동 추천 */
export async function smartAssist(payload) {
    return req('POST', '/jobs/smart-assist', payload);
}

// ─── 작업 상태 API ────────────────────────────────────────────

/** 작업 시작 */
export async function startJob(jobId, requesterId) {
    return req('POST', `/jobs/${jobId}/start`, { requesterId });
}

/** 작업 완료 */
export async function completeJob(jobId, requesterId) {
    return req('POST', `/jobs/${jobId}/complete`, { requesterId });
}

/** 채용 마감 */
export async function closeJob(jobId, requesterId) {
    return req('POST', `/jobs/${jobId}/close`, { requesterId });
}

/** PHASE 22: 작업자 완료 처리 (application status → completed) */
export async function completeWork(jobId, workerId) {
    return req('POST', `/jobs/${jobId}/complete-work`, { workerId });
}

/** PHASE 22 / REVIEW_UX: 후기 작성 (양방향, 태그, 블라인드 지원) */
export async function submitJobReview(jobId, {
    workerId,                // backward compat
    reviewerId,              // 명시적 작성자 ID
    targetId,                // 명시적 대상 ID
    reviewerRole,            // 'farmer' | 'worker'
    rating,
    review,                  // comment alias
    comment,
    tags,                    // string[]
}) {
    return req('POST', `/jobs/${jobId}/review`, {
        workerId,
        reviewerId,
        targetId,
        reviewerRole,
        rating,
        review: review || comment || '',
        tags,
    });
}

/** PHASE 26: 탭바 배지 카운트 (30초 폴링) */
export async function getNotifications(userId) {
    return req('GET', `/jobs/my/notifications?userId=${encodeURIComponent(userId)}`);
}

/** PHASE NEARBY_MATCH: 내 위치 기준 N km 내 일자리 */
export async function getNearbyJobs(lat, lng, radius = 3) {
    return req('GET', `/jobs/nearby?lat=${lat}&lng=${lng}&radius=${radius}`);
}

/** PHASE RETENTION: 미선택 지원자 재매칭 */
export async function rematchJob(jobId, requesterId) {
    return req('POST', `/jobs/${jobId}/rematch`, { requesterId });
}

/** AUTO_MATCH: 긴급 전환 (무료 — isUrgent=1, 매칭 +100 boost) */
export async function setJobUrgent(jobId, requesterId) {
    return req('POST', `/jobs/${jobId}/urgent`, { requesterId });
}

/** AI_MATCH_V2: 농민 명시적 자동 배정 — 지금 바로 최적 작업자 선택 */
export async function autoAssignWorker(jobId, requesterId) {
    return req('POST', `/jobs/${jobId}/auto-assign`, { requesterId });
}

/** AI_MATCH_V2: 자동 배정 opt-in 토글 (enable: true=켜기 / false=끄기) */
export async function setAutoAssign(jobId, requesterId, enable) {
    return req('POST', `/jobs/${jobId}/set-auto-assign`, { requesterId, enable });
}

/** PHASE SCALE: 스폰서 등록 (type: 'sponsored' | 'urgentPaid') */
export async function sponsorJob(jobId, { requesterId, type = 'sponsored', hours = 24, boost = 20 }) {
    return req('POST', `/jobs/${jobId}/sponsor`, { requesterId, type, hours, boost });
}

// ─── PHASE SCALE+: 결제 API ───────────────────────────────────

/** A/B 그룹별 긴급 공고 가격 조회 */
export async function getUrgentPrice() {
    return req('GET', '/pay/urgent-price');
}

/** 결제 주문 생성 (orderId 발급) */
export async function createPayment(jobId) {
    return req('POST', '/pay/create', { jobId });
}

/** 결제 승인 (토스 리다이렉트 후 or 무료 자동 처리) */
export async function confirmPayment({ paymentKey, orderId, amount }) {
    return req('POST', '/pay/confirm', { paymentKey, orderId, amount });
}

/** PHASE FARMER_PAY_UX: 결제 의사 표시 후불 (method: 'kakao'|'bank'|'phone') */
export async function requestPay(jobId, method) {
    return req('POST', '/pay/request', { jobId, method });
}

/** 지도 마커 데이터 */
export async function getMapJobs({ lat, lon } = {}) {
    const params = new URLSearchParams();
    if (lat != null) params.set('lat', lat);
    if (lon != null) params.set('lon', lon);
    return req('GET', `/jobs/map?${params}`);
}

// ─── 리뷰 API ─────────────────────────────────────────────────

/** 후기 작성 */
export async function submitReview({ jobId, rating, comment }) {
    return req('POST', '/reviews', { jobId, rating, comment });
}

/** 후기 조회 */
export async function getReviews({ userId, jobId } = {}) {
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId);
    if (jobId)  params.set('jobId', jobId);
    return req('GET', `/reviews?${params}`);
}

// ─── 신고 API ─────────────────────────────────────────────────

/** 신고 접수 */
export async function submitReport({ jobId, reason }) {
    return req('POST', '/reports', { jobId, reason });
}

// ─── 인증 API ─────────────────────────────────────────────────

/** 로그인 (신규면 생성, 기존이면 조회) */
export async function login(payload) {
    return req('POST', '/auth/login', payload);
}

/** 내 정보 조회 */
export async function getMe() {
    return req('GET', '/auth/me');
}

// ─── 연결 이력 API ────────────────────────────────────────────

/** 내 연결 목록 */
export async function getMyContacts() {
    return req('GET', '/contacts/my');
}

// ─── 메시지 API ───────────────────────────────────────────────

/** 메시지 목록 */
export async function getMessages(jobId) {
    return req('GET', `/messages?jobId=${jobId}`);
}

/** 메시지 전송 */
export async function sendMessage(jobId, text) {
    return req('POST', '/messages', { jobId, text });
}

// ─── 클라이언트 사이드 이벤트 추적 ──────────────────────────────

/**
 * 모바일 실사용 이벤트 추적 (fail-safe, 실패해도 UX 영향 없음)
 * @param {'mobile_visit'|'login_success'|'quick_job_created'|'call_clicked'|
 *          'location_permission_granted'|'location_permission_denied'|
 *          'onboarding_done'|'cta_clicked'|'job_viewed'|'page_view'} event
 * @param {object} [meta]
 */
export function trackClientEvent(event, meta = {}) {
    const userId = localStorage.getItem('farm-userId');
    fetch(`${BASE}/analytics/event`, {
        method:  'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(userId ? { 'x-user-id': userId } : {}),
        },
        body: JSON.stringify({ event, meta }),
    }).catch(() => {}); // fire-and-forget
}

// ─── 유틸 ────────────────────────────────────────────────────

/** 사용자 ID 가져오기 또는 생성 */
export function getUserId() {
    let id = localStorage.getItem('farm-userId');
    if (!id) {
        id = 'user-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        localStorage.setItem('farm-userId', id);
    }
    return id;
}

/** 이름 가져오기 */
export function getUserName() {
    return localStorage.getItem('farm-userName') || '익명';
}

export function setUserName(name) {
    localStorage.setItem('farm-userName', name);
}
