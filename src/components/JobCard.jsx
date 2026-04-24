import React from 'react';
import { MapPin, Clock, Maximize2, Zap, CheckCircle, Play, Flag, Star, Banknote, XCircle, RefreshCw, ImageIcon } from 'lucide-react';
import { trackClientEvent } from '../utils/api.js';
import { formatDistance } from '../utils/formatDistance.js';
import { formatDriveTime } from '../utils/formatDriveTime.js';
import { getMapPageUrl } from '../utils/mapLink.js';
import { getSMSLink, getCallLink } from '../utils/contactLink.js';
import { getUserSkillLevel, incrementApplyCount } from '../utils/userProfile.js';

// ── 디자인 시스템 V2: 거리 체감 라벨 ─────────────────────────
function distLabel(km) {
  if (km == null || !Number.isFinite(km)) return null;
  if (km <= 3) return '🚜 차량 5분 거리';
  if (km <= 5) return '🚜 차량 10분 거리';
  return `📍 ${km.toFixed(1)}km`;
}

// ── 디자인 시스템 V2: 경쟁 심리 CTA 텍스트 ──────────────────
function ctaCopy(n) {
  if (n >= 3) return `지금 지원하기 (경쟁 ${n}명)`;
  if (n >= 1) return '지금 지원하기 (마감 임박)';
  return '🔥 지금 바로 연결';
}

/** PHASE PERSONALIZATION_SCORE — 행동 기록 (fire-and-forget) */
function logBehavior(job, action) {
  try {
    const userId = localStorage.getItem('farm-userId');
    if (!userId) return;
    fetch('/api/behavior', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      body: JSON.stringify({
        jobId:   job.id,
        action,
        jobType: job.category || null,
        lat:     job.latitude  ?? null,
        lng:     job.longitude ?? null,
      }),
    }).catch(() => {}); // 실패 무시
  } catch (_) {}
}

const CATEGORY_EMOJI = {
  '밭갈이': '🚜', '로터리': '🔄', '두둑': '⛰️',
  '방제': '💊', '수확 일손': '🌾', '예초': '✂️',
};

// PHASE IMAGE_JOBTYPE_AI: autoJobType 아이콘 (같은 맵 재사용)
const JOB_ICONS = CATEGORY_EMOJI;

const STATUS_BADGE = {
  matched:     { label: '연결완료',  cls: 'badge-matched',                       icon: CheckCircle },
  in_progress: { label: '진행중',    cls: 'bg-blue-100 text-blue-700 badge',      icon: Play        },
  done:        { label: '완료',      cls: 'bg-gray-100 text-gray-600 badge',      icon: Flag        },
  closed:      { label: '마감',      cls: 'bg-red-50   text-red-600   badge',     icon: XCircle     },
};

/**
 * JobCard — 작업 카드
 *
 * @param {object}   job
 * @param {'worker'|'farmer'} mode
 * @param {function} [onApply]          작업자: 지원 클릭
 * @param {function} [onViewApplicants] 농민: 지원자 보기
 * @param {function} [onStartJob]       농민: 작업 시작
 * @param {function} [onCompleteJob]    농민: 작업 완료
 * @param {function} [onWriteReview]    농민: 리뷰 작성
 * @param {boolean}  [applied]          이미 지원 여부
 * @param {string}   [userId]           현재 사용자 ID (오너 체크)
 */
export default function JobCard({
  job, mode,
  onApply, onViewApplicants,
  onStartJob, onCompleteJob, onWriteReview, onCloseJob, onCopyJob,
  onViewMap,        // UI_INTEGRATION: 위치보기 콜백
  onViewDetail,     // 카드 클릭 시 상세 이동 콜백
  applied = false,
  userId,
  userLocation,     // DISTANCE_FIX: { lat, lng } | null — 프론트 폴백 거리 계산용
}) {
  // PHASE IMAGE_JOBTYPE_AI: autoJobType 확정 시 우선 아이콘
  const resolvedType = job.autoJobType || job.category;
  const emoji    = JOB_ICONS[resolvedType] || '🌱';
  const statusBadge = STATUS_BADGE[job.status];
  const isOwner  = userId && job.requesterId === userId;

  // PHASE 26: 평수 표시 문자열 (areaPyeong 우선, fallback → areaSize+areaUnit)
  const areaDisplay = job.areaPyeong
    ? `${job.areaPyeong.toLocaleString()}평`
    : (job.areaSize ? `${job.areaSize.toLocaleString()}${job.areaUnit}` : null);

  // PHASE 26: 썸네일 — farmImages[0] 또는 thumbUrl 또는 imageUrl
  const thumbUrl = job.thumbUrl
    || (Array.isArray(job.farmImages) && job.farmImages[0])
    || job.imageUrl
    || null;

  // PHASE IMAGE_DIFFICULTY_AI: 난이도 배지
  const difficultyLabel = (() => {
    const d = job.difficulty;
    if (d == null || !Number.isFinite(d)) return null;
    if (d >= 0.8) return { text: '고난이도', cls: 'bg-red-50 text-red-600 font-bold' };
    if (d >= 0.5) return { text: '중난이도', cls: 'bg-orange-50 text-orange-500 font-semibold' };
    return { text: '저난이도', cls: 'bg-green-50 text-green-600 font-semibold' };
  })();

  // PHASE DRIVE_TIME V2: Kakao 실제 경로 우선, distKm 추정 폴백
  const driveMinLabel = formatDriveTime(job);

  // UI_INTEGRATION: 인기 표시 — 지원자 수 경쟁 심리
  const popularLabel = (() => {
    const n = job.applicationCount ?? 0;
    if (n <= 0) return null;
    if (n >= 5) return { text: `🔥 ${n}명 지원`, cls: 'text-red-600 font-bold' };
    if (n >= 3) return { text: `👥 ${n}명 지원`, cls: 'text-orange-600 font-semibold' };
    return { text: `${n}명 지원`, cls: 'text-gray-500' };
  })();

  // DISTANCE_FIX: formatDistance — NaN/null 완전 방어, 서버값 우선, 클라이언트 폴백
  const distDisplay = formatDistance(job, userLocation);

  // DISTANCE_FIX: 거리 배지 색상 (실제 km값 기준)
  const distKm = (job.distKm != null && Number.isFinite(job.distKm)) ? job.distKm : null;
  const distBadgeStyle = distKm !== null
    ? distKm < 1
      ? 'bg-red-50 text-red-600 font-bold'        // 1km 이내 → 빨강
      : distKm < 3
        ? 'bg-orange-50 text-orange-600 font-bold' // 3km 이내 → 주황
        : 'bg-blue-50 text-blue-600 font-semibold' // 그 외 → 파랑
    : 'bg-blue-50 text-blue-600 font-medium';      // 거리 미확인 → 연파랑

  // PHASE 18: 급구/오늘 카드 강조 클래스
  const urgentBorder = job.isUrgent && job.status === 'open'
    ? 'border-l-4 border-l-red-500'
    : job.isToday
      ? 'border-l-4 border-l-farm-green'
      : '';

  // 지도 버튼 핸들러 — 카드 이벤트와 완전 분리
  const handleMapClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const url = getMapPageUrl(job);
    try { trackClientEvent('map_view', { jobId: job.id }); } catch (_) {}
    if (!url) {
      alert('📍 위치 정보가 없어 지도를 열 수 없습니다');
      return;
    }
    window.location.href = url;
  };

  return (
    <div
      className={`card animate-fade-in ${urgentBorder}`}
      onClick={(e) => {
        if (e.target.closest('button, a')) return;
        logBehavior(job, 'view');
        onViewDetail && onViewDetail(job);
      }}
    >

      {/* VISUAL_JOB_LITE: 카테고리 대표 이미지 배너 (imageUrl 또는 기본 이미지) */}
      {(thumbUrl || job.imageUrl) && !job.isUrgent && (
        <div style={{
          width: 'calc(100% + 32px)', height: 100, overflow: 'hidden',
          marginTop: -16, marginLeft: -16, marginRight: -16, marginBottom: 12,
          borderRadius: '8px 8px 0 0', position: 'relative',
        }}>
          <img
            src={thumbUrl || job.imageUrl}
            alt={job.category}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { e.target.parentElement.style.display = 'none'; }}
          />
          {/* 카테고리 아이콘 오버레이 */}
          <span style={{
            position: 'absolute', top: 8, left: 10,
            fontSize: 22, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
          }}>
            {emoji}
          </span>
        </div>
      )}

      {/* PHASE SCALE: 스폰서 공고 배너 (최상단, 급구보다 우선) */}
      {job.isSponsored && job.status === 'open' && (
        <div style={{
          background: 'linear-gradient(90deg, #b45309 0%, #d97706 100%)',
          color: '#fff', fontWeight: 800, fontSize: 12,
          padding: '5px 12px', borderRadius: '8px 8px 0 0',
          marginTop: -16, marginLeft: -16, marginRight: -16, marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 5, letterSpacing: 0.3,
        }}>
          ⭐ 추천 공고 — 검증된 농민이 올린 공고예요
        </div>
      )}

      {/* PHASE 18: 급구 강조 배너 — 카드 최상단 */}
      {!job.isSponsored && job.isUrgent && job.status === 'open' && (
        <div style={{
          background: 'linear-gradient(90deg, #dc2626 0%, #ef4444 100%)',
          color: '#fff', fontWeight: 800, fontSize: 12,
          padding: '5px 12px', borderRadius: '8px 8px 0 0',
          marginTop: -16, marginLeft: -16, marginRight: -16, marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 5, letterSpacing: 0.3,
        }}>
          🔥 급구 — 즉시 연결 가능
        </div>
      )}

      {/* 상단: 카테고리 + 배지 */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{emoji}</span>
          <span className="text-lg font-bold text-gray-800">{job.category}</span>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end">
          {/* Phase 6: 오늘 배지 */}
          {job.isToday && (
            <span className="text-xs bg-farm-green text-white font-bold rounded-full px-2 py-0.5">
              오늘
            </span>
          )}
          {/* Phase 6 / FINAL POLISH: 거리 배지 — 거리에 따라 색상 강도 변화 */}
          {distDisplay && (
            <span className={`text-xs rounded-full px-2 py-0.5 ${distBadgeStyle}`}>
              📏 {distDisplay}
            </span>
          )}
          {/* PHASE SCALE: 유료 긴급 공고 배지 */}
          {job.isUrgentPaid && job.status === 'open' && (
            <span className="text-xs bg-red-500 text-white font-black rounded-full px-2 py-0.5">
              🔥 긴급 공고
            </span>
          )}
          {/* PHASE SCALE: 스폰서 배지 (배너 없을 경우 폴백) */}
          {job.isSponsored && job.status === 'open' && (
            <span className="text-xs bg-amber-500 text-white font-black rounded-full px-2 py-0.5">
              ⭐ 추천
            </span>
          )}
          {/* UI_INTEGRATION: 마감 임박 배지 (지원자 3명 초과) */}
          {!job.isUrgent && !job.isUrgentPaid && job.status === 'open' && (job.applicationCount || 0) > 2 && (
            <span className="text-xs bg-orange-100 text-orange-600 font-bold rounded-full px-2 py-0.5">
              🔥 마감 임박
            </span>
          )}
          {difficultyLabel && (
            <span className={`text-xs rounded-full px-2 py-0.5 ${difficultyLabel.cls}`}>
              ⚒️ {difficultyLabel.text}
            </span>
          )}
          {job.isUrgent && job.status === 'open' && (
            <span className="badge-urgent flex items-center gap-1">
              <Zap size={12} />급구
            </span>
          )}
          {statusBadge && job.status !== 'open' && (
            <span className={`${statusBadge.cls} flex items-center gap-1`}>
              <statusBadge.icon size={12} />
              {statusBadge.label}
            </span>
          )}
        </div>
      </div>

      {/* 가격 — 최우선 시각 요소 (카테고리 바로 아래) */}
      {job.pay && (
        <div className="flex items-center gap-1.5 mb-2">
          <Banknote size={16} className="text-green-600 shrink-0" />
          <span className="font-black text-green-600 text-xl leading-none">💰 {job.pay}</span>
        </div>
      )}

      {/* 경쟁/긴급 통합 배지 — 가격 바로 아래 */}
      {job.status === 'open' && (job.isUrgent || (job.applicationCount ?? 0) >= 3) && (
        <div className="flex items-center gap-1.5 bg-red-50 rounded-xl px-3 py-1.5 mb-2 w-fit">
          <span className="text-sm font-black text-red-500">
            🔥 마감 임박
            {(job.applicationCount ?? 0) > 0 && ` (지원 ${job.applicationCount}명)`}
          </span>
        </div>
      )}

      {/* 요청자 + PHASE 22 신뢰도 + BRAND_UI AI 추천 배지 */}
      <div className="flex items-center gap-2 mb-1.5">
        <p className="text-sm text-gray-500">{job.requesterName} 님의 요청</p>
        {/* AI 추천 배지 — 디자인 V2: farm-ai 색상 */}
        <span className="text-xs text-farm-ai bg-indigo-50 rounded-full px-2 py-0.5 font-semibold">
          ✦ AI 추천
        </span>
        {job.avgRating != null && job.ratingCount > 0 ? (
          <span className="flex items-center gap-0.5 text-xs font-semibold text-amber-600
                           bg-amber-50 rounded-full px-2 py-0.5">
            <Star size={10} className="fill-amber-400 text-amber-400" />
            {job.avgRating.toFixed(1)}
            <span className="text-gray-400 font-normal">({job.ratingCount}회)</span>
            {job.ratingCount >= 10 && (
              <span className="ml-0.5 text-red-500">🔥</span>
            )}
          </span>
        ) : (
          <span className="text-xs bg-blue-50 text-blue-500 rounded-full px-2 py-0.5 font-medium">
            🆕 신규
          </span>
        )}
      </div>

      {/* ── 디자인 V2: 신뢰 시그널 행 ── */}
      {mode === 'worker' && job.status === 'open' && (
        <div className="flex items-center gap-2 mb-2 text-xs text-gray-400 flex-wrap">
          {job.avgRating != null && job.ratingCount > 0 && (
            <span>⭐ {job.avgRating.toFixed(1)} (후기 {job.ratingCount})</span>
          )}
          {(job.completedJobs ?? 0) > 0 && (
            <span>✔ 최근 {job.completedJobs}건 완료</span>
          )}
          <span>⚡ 평균 5분 연결</span>
          {/* 거리 체감 라벨 */}
          {distLabel(job.distKm) && (
            <span className="text-farm-green font-semibold">{distLabel(job.distKm)}</span>
          )}
        </div>
      )}

      {/* 정보 행 */}
      <div className="flex gap-3 mb-4">
        {/* 텍스트 정보 (flex-1) */}
        <div className="flex-1 flex flex-col gap-1.5 text-sm text-gray-600 min-w-0">
          {/* PHASE 23/24: 주소 항상 표시 + 좌표 없음 경고 */}
          <div className="flex items-center gap-1.5">
            <MapPin size={14} className="text-farm-green shrink-0" />
            <span className={`truncate ${job.locationText ? '' : 'text-gray-400 italic'}`}>
              {job.locationText || '위치 정보 없음'}
            </span>
            {distDisplay && (
              <span className={`ml-1 text-xs shrink-0 ${
                distKm !== null && distKm < 3 ? 'font-bold text-orange-500' : 'text-gray-400'
              }`}>
                ({distDisplay})
              </span>
            )}
          </div>
          {/* DISTANCE_FIX: 좌표 미등록 경고 (null-safe) */}
          {(!Number.isFinite(job.latitude) || !Number.isFinite(job.longitude)) && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600
                            bg-amber-50 rounded-lg px-2.5 py-1.5 font-semibold">
              ⚠️ 위치 확인 필요 — 지도 미표시
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Clock size={14} className="text-farm-green shrink-0" />
            <span>{job.date}  {job.timeSlot}</span>
          </div>
          {/* PHASE 26: 평수 */}
          {areaDisplay && (
            <div className="flex items-center gap-1.5">
              <Maximize2 size={14} className="text-farm-green shrink-0" />
              <span className="font-semibold text-farm-green">{areaDisplay}</span>
            </div>
          )}
          {driveMinLabel && (
            <div className="flex items-center gap-1 text-xs text-gray-500">
              {driveMinLabel}
            </div>
          )}
        </div>

        {/* PHASE 26: 밭 이미지 썸네일 */}
        {thumbUrl ? (
          <div className="shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-gray-100 border border-gray-100">
            <img
              src={thumbUrl}
              alt="밭 사진"
              className="w-full h-full object-cover"
              onError={e => { e.target.style.display = 'none'; }}
            />
          </div>
        ) : null}
      </div>

      {/* 메모 */}
      {job.note && (
        <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-3 py-2 mb-4 line-clamp-2">
          {job.note}
        </p>
      )}

      {/* PHASE IMAGE_JOBTYPE_AI: AI 태그 (파싱 안정화) */}
      {(() => {
        let tags = [];
        try { tags = job.tags ? JSON.parse(job.tags) : []; } catch (_) { tags = []; }
        if (!Array.isArray(tags)) tags = [];
        if (tags.length === 0) return null;
        return (
          <div className="flex flex-wrap gap-1 mb-3">
            {tags.map(t => (
              <span key={t} className="text-xs bg-farm-light text-farm-green rounded-full px-2 py-0.5 font-medium">
                #{t}
              </span>
            ))}
          </div>
        );
      })()}

      {/* ── 작업자 모드 액션 — ACTION_BUTTON_SIMPLIFY_V2 ── */}

      {/* CASE: worker + open + 미지원 → 버튼 2개 */}
      {mode === 'worker' && job.status === 'open' && (
        applied ? (
          <button disabled className="btn btn-full bg-gray-100 text-gray-400 cursor-not-allowed">
            신청됨 ✓
          </button>
        ) : (
          <div className="mt-2">
            {/* ── 디자인 V2: 액션 이유 텍스트 (버튼 위) ── */}
            <div className="flex gap-2 text-xs text-green-600 font-semibold flex-wrap mb-1.5">
              <span>✔ 지금 바로 작업 가능</span>
              {job.isToday && <span>✔ 오늘 마감 가능성 높음</span>}
            </div>
          <div className="flex gap-2">
            {/* PRIMARY: CTA — 디자인 V2 ctaCopy 패턴 */}
            <button
              className={`flex-1 py-3 rounded-2xl font-black text-white text-base
                          flex items-center justify-center gap-2
                          active:scale-95 transition-transform shadow-md
                          ${(job.isUrgent || (job.applicationCount ?? 0) >= 3)
                            ? 'bg-red-500' : 'bg-farm-green'}`}
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                const skillLevel = getUserSkillLevel();
                const link = getSMSLink(job, skillLevel);

                if (!link) {
                  // 연락처 없음 → 기존 지원 흐름
                  logBehavior(job, 'apply');
                  incrementApplyCount();
                  try { trackClientEvent('apply_click', { jobId: job.id, category: job.category }); } catch (_) {}
                  onApply?.(job);
                  return;
                }

                // ① 자동 지원 + 상태 전환 (fail-safe: 실패해도 SMS 진행)
                const storedId = localStorage.getItem('farm-userId') || 'anonymous';
                const storedName = localStorage.getItem('farm-userName') || '작업자';
                fetch(`/api/jobs/${job.id}/contact-apply`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ workerId: storedId, workerName: storedName }),
                }).catch(() => {});

                // ② 이벤트 로그
                incrementApplyCount();
                try { trackClientEvent('contact_apply', { jobId: job.id, skillLevel }); } catch (_) {}

                // ③ SMS 앱 오픈 (항상 실행)
                window.location.href = link;
              }}
            >
              {ctaCopy(job.applicationCount ?? 0)}</button>

            {/* SECONDARY: 📍 지도 */}
            <button
              onClick={handleMapClick}
              style={{ position: 'relative', zIndex: 999999, pointerEvents: 'auto', cursor: 'pointer' }}
              className="px-4 py-3 border-2 border-gray-200 rounded-2xl text-sm font-bold
                         text-gray-600 flex items-center gap-1.5
                         active:scale-95 transition-transform bg-white"
            >
              <MapPin size={15} /> 지도
            </button>
          </div>{/* end flex gap-2 buttons */}
          </div>{/* end mt-2 wrapper */}
        )
      )}

      {/* STEP 5: worker + matched → "연락 완료" 상태 배지 */}
      {mode === 'worker' && job.status === 'matched' &&
       job.selectedWorkerId === ((() => { try { return localStorage.getItem('farm-userId'); } catch(_){return null;} })()) && (
        <div className="bg-green-50 border border-green-200 text-green-800
                        px-4 py-3 rounded-2xl mt-2
                        flex items-center gap-2 text-sm font-bold">
          ✅ 연락 완료 — 농민 확인 대기 중
        </div>
      )}

      {/* CASE: worker + matched/in_progress → 전화 + 문자 */}
      {mode === 'worker' && (job.status === 'matched' || job.status === 'in_progress') && (() => {
        const skillLevel = getUserSkillLevel();
        const smsLink    = getSMSLink(job, skillLevel);
        const callLink   = getCallLink(job);
        const hasContact = !!(smsLink || callLink);
        return (
          <div className="flex flex-col gap-2 mt-2">
            {!hasContact && (
              <p className="text-xs text-center text-amber-600 bg-amber-50 rounded-xl px-3 py-2 font-medium">
                ⏳ 연락처는 매칭 완료 후 공개됩니다
              </p>
            )}
            {/* 📞 전화하기 */}
            <button
              style={{ position: 'relative', zIndex: 999999, pointerEvents: 'auto', cursor: 'pointer' }}
              className={`py-3 rounded-2xl text-sm font-black
                          flex items-center justify-center gap-2
                          active:scale-95 transition-transform
                          ${callLink ? 'bg-emerald-600 text-white shadow-md' : 'bg-gray-100 text-gray-400'}`}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!callLink) { alert('📞 연락처가 아직 공개되지 않았습니다.'); return; }
                fetch(`/api/jobs/${job.id}/contact`, { method: 'POST' }).catch(() => {});
                try { trackClientEvent('call_click', { jobId: job.id }); } catch (_) {}
                window.location.href = callLink;
              }}
            >
              📞 {callLink ? '전화하기' : '전화 미공개'}
            </button>
            {/* 📩 문자 보내기 */}
            <button
              style={{ position: 'relative', zIndex: 999999, pointerEvents: 'auto', cursor: 'pointer' }}
              className={`py-3 rounded-2xl text-sm font-black
                          flex items-center justify-center gap-2
                          active:scale-95 transition-transform
                          ${smsLink ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-100 text-gray-400'}`}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!smsLink) { alert('📩 연락처가 공개되지 않았습니다.'); return; }
                fetch(`/api/jobs/${job.id}/contact`, { method: 'POST' }).catch(() => {});
                try { trackClientEvent('sms_click', { jobId: job.id, skillLevel }); } catch (_) {}
                window.location.href = smsLink;
              }}
            >
              📩 {smsLink ? '문자 보내기' : '문자 미공개'}
            </button>
          </div>
        );
      })()}

      {/* ── 농민 모드 액션 ── */}
      {mode === 'farmer' && (
        <div className="space-y-2">
          {/* 지도 버튼 — 농민도 자기 밭 위치 확인 가능 (handleMapClick 공유) */}
          <button
            onClick={handleMapClick}
            style={{ position: 'relative', zIndex: 999999, pointerEvents: 'auto', cursor: 'pointer' }}
            className="btn-full py-2 rounded-xl text-sm font-semibold
                       flex items-center justify-center gap-1.5
                       bg-green-50 text-green-700 border border-green-200
                       active:scale-95 transition-transform"
          >
            <MapPin size={14} /> 📍 내 밭 지도 보기
          </button>

          {/* 지원자 수 + 지원자 보기 (마감 포함 항상 표시) */}
          {job.status !== 'in_progress' && job.status !== 'done' && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">
                지원자 <strong className="text-farm-green">{job.applicationCount || 0}명</strong>
              </span>
              <button
                onClick={() => onViewApplicants?.(job)}
                className="btn-outline py-2 px-4 text-sm"
              >
                {job.status === 'closed' ? '지원자 확인' : job.status === 'matched' ? '연결 확인' : '누가 할 수 있나'}
              </button>
            </div>
          )}

          {/* 마감하기 버튼 (open / matched, 오너만) */}
          {(job.status === 'open' || job.status === 'matched') && isOwner && onCloseJob && (
            <button
              onClick={() => onCloseJob(job)}
              className="btn-full py-2.5 bg-red-50 text-red-600 font-bold rounded-xl border border-red-200
                         flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
            >
              <XCircle size={16} /> 마감하기
            </button>
          )}

          {/* 작업 시작 버튼 (matched 상태, 오너만) */}
          {job.status === 'matched' && isOwner && onStartJob && (
            <button
              onClick={() => onStartJob(job)}
              className="btn-full py-2.5 bg-blue-500 text-white font-bold rounded-xl
                         flex items-center justify-center gap-1.5"
            >
              <Play size={16} /> 작업 시작
            </button>
          )}

          {/* 작업 완료 버튼 (in_progress 상태, 오너만) */}
          {job.status === 'in_progress' && isOwner && onCompleteJob && (
            <button
              onClick={() => onCompleteJob(job)}
              className="btn-full py-2.5 bg-farm-green text-white font-bold rounded-xl
                         flex items-center justify-center gap-1.5"
            >
              <Flag size={16} /> 작업 완료
            </button>
          )}

          {/* 리뷰 작성 버튼 (done 상태, 오너만) */}
          {job.status === 'done' && isOwner && onWriteReview && (
            <button
              onClick={() => onWriteReview(job)}
              className="btn-full py-2.5 bg-amber-400 text-white font-bold rounded-xl
                         flex items-center justify-center gap-1.5"
            >
              <Star size={16} /> 후기 작성
            </button>
          )}

          {/* 다시 등록하기 (closed 상태, 오너만) — Phase 12: 퍼널 시작 이벤트 */}
          {job.status === 'closed' && isOwner && onCopyJob && (
            <button
              onClick={() => {
                try { trackClientEvent('job_copy_started', { jobId: job.id }); } catch (_) {}
                onCopyJob(job);
              }}
              className="btn-full py-2.5 bg-farm-light text-farm-green font-bold rounded-xl border border-farm-green
                         flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
            >
              <RefreshCw size={16} /> 다시 등록하기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
