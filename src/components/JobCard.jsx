import React, { useState, useEffect } from 'react';
import { MapPin, Clock, Maximize2, Zap, CheckCircle, Play, Flag, Star, Banknote, XCircle, RefreshCw, ImageIcon } from 'lucide-react';
import { trackClientEvent } from '../utils/api.js';
import { formatDistance } from '../utils/formatDistance.js';
import { formatDriveTime } from '../utils/formatDriveTime.js';
import { getMapPageUrl } from '../utils/mapLink.js';
import { getSMSLink, getCallLink } from '../utils/contactLink.js';
import { getUserSkillLevel, incrementApplyCount } from '../utils/userProfile.js';
import { distBadgeColor, SHADOW } from '../config/designSystem.js';
import CallButton from './common/CallButton.jsx';
import { logView, logDetail } from '../utils/conversionTracker.js';
import { estimateWork } from '../utils/workEstimator.js';
import { trackClick } from '../utils/behaviorScore.js';

// ── 디자인 시스템 V2: 거리 체감 라벨 ─────────────────────────
function distLabel(km) {
  if (km == null || !Number.isFinite(km)) return null;
  if (km <= 3) return '🚜 차량 5분 거리';
  if (km <= 5) return '🚜 차량 10분 거리';
  return `📍 ${km.toFixed(1)}km`;
}

// ── CTA 텍스트 ──────────────────────────────────────────────────
function ctaCopy(n) {
  if (n >= 3) return `🔥 3초 연결 (경쟁 ${n}명, 지금 안 하면 늦음)`;
  if (n >= 1) return '🔥 3초 연결 (지금 안 하면 늦음)';
  return '🔥 3초 연결 (지금 안 하면 늦음)';
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

// UX_V2 STEP 7: 장비 타입 → 아이콘
const EQUIPMENT_ICON = {
  tractor: '🚜', drone: '🚁', sprayer: '🚁',
  forklift: '🏗️', excavator: '⛏️', none: '🧤',
};
// 카테고리 기반 폴백
function resolveEquipmentIcon(job) {
  if (job.equipmentType && EQUIPMENT_ICON[job.equipmentType]) return EQUIPMENT_ICON[job.equipmentType];
  return CATEGORY_EMOJI[job.category] || '🧤';
}

// PHASE IMAGE_JOBTYPE_AI: autoJobType 아이콘 (같은 맵 재사용)
const JOB_ICONS = CATEGORY_EMOJI;

const STATUS_BADGE = {
  matched:     { label: '연결완료',  cls: 'badge-matched',                       icon: CheckCircle },
  on_the_way:  { label: '이동중',    cls: 'bg-orange-100 text-orange-700 badge',  icon: Flag        },
  in_progress: { label: '진행중',    cls: 'bg-blue-100 text-blue-700 badge',      icon: Play        },
  completed:   { label: '완료',      cls: 'bg-gray-100 text-gray-600 badge',      icon: Flag        },
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
  onStartJob, onCompleteJob, onMarkPaid, onWriteReview, onCloseJob, onCopyJob,
  onViewMap,        // UI_INTEGRATION: 위치보기 콜백
  onViewDetail,     // 카드 클릭 시 상세 이동 콜백
  applied = false,
  userId,
  userLocation,     // DISTANCE_FIX: { lat, lng } | null — 프론트 폴백 거리 계산용
  isSmartMatch = false, // SMART_V3: 🤖 추천 매칭 여부
}) {
  // PHASE IMAGE_JOBTYPE_AI: autoJobType 확정 시 우선 아이콘
  const resolvedType = job.autoJobType || job.category;
  const emoji    = JOB_ICONS[resolvedType] || '🌱';
  const statusBadge = STATUS_BADGE[job.status];
  const isOwner  = userId && job.requesterId === userId;

  // STEP 1: 역할 배지 — 사용자가 이 카드에서 맡는 역할을 즉시 인지
  const roleBadge = (() => {
    if (isOwner) {
      if (job.status === 'in_progress') return { label: '🔵 진행중',    cls: 'bg-blue-100 text-blue-700' };
      if (job.status === 'completed') return { label: '⭐ 완료', cls: 'bg-gray-100 text-gray-600' };
      return { label: '🧑‍🌾 내가 올린 일', cls: 'bg-farm-light text-farm-green border border-farm-green' };
    }
    if (userId && job.selectedWorkerId === userId)
      return { label: '🎯 선택됨',       cls: 'bg-green-100 text-green-700 border border-green-300' };
    if (applied)
      return { label: '👷 내가 지원한 일', cls: 'bg-blue-50 text-blue-600 border border-blue-200' };
    return null;
  })();

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

  // BRAND_SYSTEM_V1: 거리 배지 색상 — designSystem.distBadgeColor 기반
  const distKm = (job.distKm != null && Number.isFinite(job.distKm)) ? job.distKm : null;
  // v4: ≤3km → danger(red), ≤5km → accent(amber), >5km → info(blue)
  const distBadgeStyle = distKm !== null
    ? distKm <= 3
      ? 'bg-red-50 text-red-600 font-bold'
      : distKm <= 5
        ? 'bg-amber-50 text-amber-600 font-bold'
        : 'bg-blue-50 text-blue-600 font-semibold'
    : 'bg-blue-50 text-blue-600 font-medium';

  // PHASE 18: 급구/오늘 카드 강조 클래스
  const urgentBorder = job.isUrgent && job.status === 'open'
    ? 'border-l-4 border-l-red-500'
    : job.isToday
      ? 'border-l-4 border-l-farm-green'
      : '';

  // HOMEPAGE_BRAND_POLISH_V1 STEP 7: 전화 유도 UX — 0.5초 "연결 중..." 로딩
  const [connecting, setConnecting] = useState(false);

  // UX_V2 STEP 1: 카드 노출 로그 (worker+open 전환율 측정)
  useEffect(() => {
    if (mode === 'worker' && job.status === 'open' && !applied) {
      logView(job.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

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

  // ══ UX_V2: worker + open → 심플 전화 카드 ══
  if (mode === 'worker' && job.status === 'open' && !applied) {
    const phone      = job.phone || job.contact || job.phoneFull || job.farmerPhone || null;
    const callLink   = getCallLink(job);
    const driveLabel = formatDriveTime(job) ||
                       (distKm != null ? `🚗 ${distKm < 1 ? `${Math.round(distKm*1000)}m` : `${distKm.toFixed(1)}km`}` : null);
    const equipIcon  = resolveEquipmentIcon(job);
    const region     = job.locationText ? job.locationText.split(' ').slice(0, 2).join(' ') : null;
    const isUrgentNow = job.isUrgent || job.isToday || false;
    const workEst     = estimateWork(job.areaPyeong, job.category);

    return (
      <div
        className={`card animate-fade-in ${urgentBorder}`}
        style={{ padding: '14px 16px' }}
      >
        {/* STEP 1: 역할 배지 */}
        {roleBadge && (
          <div className={`inline-flex items-center text-xs font-black rounded-full px-3 py-1 mb-2 ${roleBadge.cls}`}>
            {roleBadge.label}
          </div>
        )}

        {/* SMART_V3: 🤖 추천 뱃지 */}
        {isSmartMatch && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'linear-gradient(90deg,#d97706,#f59e0b)',
            color: '#fff', fontWeight: 900, fontSize: 11,
            borderRadius: 9999, padding: '3px 10px', marginBottom: 8,
          }}>
            🤖 추천
          </div>
        )}

        {/* STEP 9: 긴급 태그 */}
        {isUrgentNow && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'linear-gradient(90deg,#b91c1c,#dc2626)',
            color: '#fff', fontWeight: 900, fontSize: 12,
            borderRadius: 9999, padding: '3px 10px', marginBottom: 10,
          }}>
            🔥 지금 필요
          </div>
        )}

        {/* 스폰서 배너 */}
        {job.isSponsored && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'linear-gradient(90deg,#f97316,#dc2626)',
            color: '#fff', fontWeight: 900, fontSize: 11,
            borderRadius: 8, padding: '4px 10px', marginBottom: 10,
          }}>
            <span>🔥 지원자 몰리는 공고</span>
            <span style={{ opacity: 0.85 }}>추천 1순위</span>
          </div>
        )}

        {/* 가격 + 지역 */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          {job.pay && (
            <span style={{ fontSize: 28, fontWeight: 900, color: '#15803d', lineHeight: 1 }}>
              💰 {job.pay}
            </span>
          )}
          {region && (
            <span style={{ fontSize: 15, color: '#6b7280', fontWeight: 600 }}>
              📍 {region}
            </span>
          )}
        </div>

        {/* STEP 8: 거리/이동 + 장비 아이콘 */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {driveLabel && (
            <span style={{ fontSize: 16, fontWeight: 700, color: '#374151' }}>{driveLabel}</span>
          )}
          <span style={{ fontSize: 22 }}>{equipIcon}</span>
          {job.date && (
            <span style={{ fontSize: 14, color: '#9ca3af' }}>📅 {job.date}</span>
          )}
        </div>

        {/* STEP 4: 즉시성 트리거 + 작업 시간 추정 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
          {isUrgentNow ? (
            <span style={{
              fontSize: 13, fontWeight: 800, color: '#15803d',
              background: '#dcfce7', borderRadius: 8, padding: '4px 10px',
            }}>
              ⏰ 오늘 바로 시작 가능
            </span>
          ) : (
            <span style={{
              fontSize: 13, fontWeight: 700, color: '#6b7280',
              background: '#f3f4f6', borderRadius: 8, padding: '4px 10px',
            }}>
              ⏰ 지금 바로 가능
            </span>
          )}

          {/* STEP 2/3: 작업 시간 추정 (메인) */}
          {workEst.label && (
            <span className="work-time">{workEst.label}</span>
          )}

          {/* STEP 5: 숫자 트리거 — applicantCount 존재 시 */}
          {(job.applicationCount ?? 0) > 0 && (
            <span style={{
              fontSize: 13, fontWeight: 800, color: '#b91c1c',
              background: '#fef2f2', borderRadius: 8, padding: '4px 10px',
            }}>
              🔥 현재 {job.applicationCount}명 확인 중
            </span>
          )}
        </div>

        {/* STEP 3: 평수 보조 표시 */}
        {job.areaPyeong && (
          <div className="work-area">
            🌾 {job.areaPyeong.toLocaleString()}평
            {workEst.sublabel && <span style={{ marginLeft: 6, color: '#9ca3af' }}>({workEst.sublabel})</span>}
          </div>
        )}

        {/* STEP 2/10: CallButton — 전화 CTA 주인공 */}
        <CallButton
          phone={callLink ? (phone || 'has_link') : null}
          jobId={job.id}
          onFallback={() => {
            // 연락처 없음 → SMS 지원 흐름
            incrementApplyCount();
            try { trackClientEvent('contact_apply', { jobId: job.id }); } catch (_) {}
            const storedId   = localStorage.getItem('farm-userId') || 'anonymous';
            const storedName = localStorage.getItem('farm-userName') || '작업자';
            fetch(`/api/jobs/${job.id}/contact-apply`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ workerId: storedId, workerName: storedName }),
            }).catch(() => {});
            const sms = getSMSLink(job, getUserSkillLevel());
            if (sms) setTimeout(() => { window.location.href = sms; }, 500);
            else onApply?.(job);
          }}
        />

        {/* STEP 5/6: 상세 — Secondary, 작게, 채팅 없음 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            logDetail(job.id);
            logBehavior(job, 'view');
            trackClick(job.id);    // SMART_V4: 클릭 행동 기록
            onViewDetail?.(job);
          }}
          style={{
            display: 'block', width: '100%',
            marginTop: 8, padding: '6px 0',
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, color: '#9ca3af', textDecoration: 'underline',
            textAlign: 'center',
          }}
        >
          상세보기
        </button>
      </div>
    );
  }
  // ══ END UX_V2 ══

  return (
    <div
      className={`card animate-fade-in ${urgentBorder}`}
      onClick={(e) => {
        if (e.target.closest('button, a')) return;
        logBehavior(job, 'view');
        trackClick(job.id);    // SMART_V4: 카드 클릭 행동 기록
        onViewDetail && onViewDetail(job);
      }}
    >

      {/* STEP 1: 역할 배지 (풀 카드) */}
      {roleBadge && (
        <div className={`inline-flex items-center text-xs font-black rounded-full px-3 py-1 mb-2 ${roleBadge.cls}`}>
          {roleBadge.label}
        </div>
      )}

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
          {/* v4: 🤖 AI 배지 TOP-LEFT */}
          <div style={{
            position: 'absolute', top: 8, left: 8,
            background: '#4f46e5', color: '#fff',
            borderRadius: 9999, padding: '3px 9px',
            fontSize: 10, fontWeight: 900,
            boxShadow: '0 2px 8px rgba(79,70,229,0.5)',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>🤖 AI 추천</div>
          {/* v4: 경쟁자 수 배지 BOTTOM-RIGHT */}
          {(job.applicationCount ?? 0) > 0 && (
            <div style={{
              position: 'absolute', bottom: 6, right: 8,
              background: 'rgba(0,0,0,0.55)', color: '#fff',
              borderRadius: 9999, padding: '2px 8px',
              fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 3,
            }}>👥 경쟁 {job.applicationCount}명</div>
          )}
        </div>
      )}

      {/* BOOST_CONVERSION: 스폰서 배너 — "지원자 몰리는 공고" 강조 */}
      {job.isSponsored && job.status === 'open' && (
        <div style={{
          background: 'linear-gradient(90deg,#f97316 0%,#dc2626 100%)',
          color: '#fff', fontWeight: 900, fontSize: 12,
          padding: '7px 14px', borderRadius: '8px 8px 0 0',
          marginTop: -16, marginLeft: -16, marginRight: -16, marginBottom: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxShadow: '0 2px 8px rgba(220,38,38,0.30)',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            🔥 지원자 몰리는 공고
          </span>
          <span style={{ fontSize: 10, opacity: 0.88, fontWeight: 700, letterSpacing: '0.04em' }}>
            추천 1순위
          </span>
        </div>
      )}

      {/* STEP 6: 급구 강조 배너 — HOMEPAGE_BRAND_POLISH_V1 */}
      {!job.isSponsored && job.isUrgent && job.status === 'open' && (
        <div style={{
          background: 'linear-gradient(90deg, #b91c1c 0%, #dc2626 100%)',
          color: '#fff', fontWeight: 900, fontSize: 12,
          padding: '6px 12px', borderRadius: '8px 8px 0 0',
          marginTop: -16, marginLeft: -16, marginRight: -16, marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 5, letterSpacing: 0.3,
          boxShadow: '0 2px 6px rgba(185,28,28,0.3)',
        }}>
          🔥 지금 안 구하면 늦습니다
        </div>
      )}

      {/* FINAL_CONVERSION: 오늘 N명 지원 중 스트립 (worker + open, 스폰서·급구 없는 일반 공고) */}
      {mode === 'worker' && job.status === 'open' && !job.isSponsored && !job.isUrgent && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: -16, marginLeft: -16, marginRight: -16, marginBottom: 12,
          background: 'linear-gradient(90deg,#7c3aed,#4f46e5)',
          padding: '5px 14px', borderRadius: '8px 8px 0 0',
          fontSize: 11, fontWeight: 800, color: '#fff',
          letterSpacing: '0.02em',
        }}>
          {/* 숫자 우선: applicationCount 있으면 "N명", 없으면 기본값 7 표시 */}
          <span>🔥 오늘 {(job.applicationCount ?? 0) > 0 ? job.applicationCount : 7}명 지원 중</span>
          <span style={{ opacity: 0.75, fontSize: 10, fontWeight: 700 }}>지금 안 하면 늦음</span>
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

      {/* 요청자 + 별점 (컴팩트) */}
      <div className="flex items-center gap-2 mb-1.5">
        <p className="text-xs text-gray-400">{job.requesterName}</p>
        {job.avgRating != null && job.ratingCount > 0 && (
          <span className="flex items-center gap-0.5 text-xs font-semibold text-amber-600">
            <Star size={10} className="fill-amber-400 text-amber-400" />
            {job.avgRating.toFixed(1)}
          </span>
        )}
      </div>

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
              {(() => { const w = estimateWork(job.areaPyeong, job.category); return w.label ? (
                <span className="work-time" style={{ marginLeft: 2 }}>{w.label}</span>
              ) : null; })()}
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

      {/* 메모 — 1줄만 */}
      {job.note && (
        <p className="text-xs text-gray-400 mb-3 line-clamp-1">
          {job.note}
        </p>
      )}

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
              disabled={connecting}
              className={`flex-1 py-3 rounded-2xl font-black text-white text-base
                          flex items-center justify-center gap-2
                          transition-all shadow-md
                          ${connecting ? 'opacity-80 scale-95' : 'active:scale-95'}
                          ${(job.isUrgent || (job.applicationCount ?? 0) >= 3)
                            ? 'bg-red-500' : 'bg-farm-green'}`}
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (connecting) return;

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

                // STEP 7: 0.5초 "연결 중..." 로딩 → 전화번호 표시 + tel 링크
                setConnecting(true);
                incrementApplyCount();
                try { trackClientEvent('contact_apply', { jobId: job.id, skillLevel }); } catch (_) {}

                // ① 자동 지원 (fail-safe)
                const storedId = localStorage.getItem('farm-userId') || 'anonymous';
                const storedName = localStorage.getItem('farm-userName') || '작업자';
                fetch(`/api/jobs/${job.id}/contact-apply`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ workerId: storedId, workerName: storedName }),
                }).catch(() => {});

                // ② 0.5초 후 SMS/전화 앱 오픈
                setTimeout(() => {
                  setConnecting(false);
                  window.location.href = link;
                }, 500);
              }}
            >
              {connecting
                ? <><span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />연결 중...</>
                : ctaCopy(job.applicationCount ?? 0)
              }</button>

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
          </div>
          </div>
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

          {/* 지원자 보기 버튼 (마감·매칭·오픈 공통) */}
          {job.status !== 'in_progress' && job.status !== 'completed' && (() => {
            const cnt = job.applicationCount || 0;
            const isOpen = job.status !== 'closed' && job.status !== 'matched';
            const hasApplicants = isOpen && cnt > 0;
            const label =
              job.status === 'closed'   ? '지원자 확인' :
              job.status === 'matched'  ? '연결 확인' :
              hasApplicants             ? `📩 지원자 ${cnt}명 보기` :
                                          '지원자 보기';

            return (
              <button
                onClick={() => onViewApplicants?.(job)}
                className={
                  hasApplicants
                    ? 'btn-full py-2.5 text-sm font-bold rounded-xl border transition-transform active:scale-95'
                    : 'btn-outline py-2 px-4 text-sm w-full'
                }
                style={hasApplicants ? {
                  background: '#f0fdf4',
                  borderColor: '#16a34a',
                  color: '#15803d',
                } : undefined}
              >
                {label}
              </button>
            );
          })()}

          {/* FINAL_CONVERSION: 실패 공포 — open 상태 + 스폰서 미등록 공고에만 */}
          {job.status === 'open' && !job.isSponsored && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 10, padding: '7px 12px',
              fontSize: 11, fontWeight: 700, color: '#b91c1c',
            }}>
              <span style={{ fontSize: 14 }}>⚠️</span>
              <span>지금 상단 노출 안 하면 다른 공고에 밀립니다</span>
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

          {/* PHASE 7: 입금 완료 버튼 (completed 상태, 아직 paid 아닐 때, 오너만) */}
          {job.status === 'completed' && isOwner && job.paymentStatus !== 'paid' && onMarkPaid && (
            <button
              onClick={() => onMarkPaid(job)}
              className="btn-full py-2.5 bg-emerald-500 text-white font-bold rounded-xl
                         flex items-center justify-center gap-1.5"
            >
              💰 입금 완료 처리
            </button>
          )}
          {/* completed + paid 완료 안내 */}
          {job.status === 'completed' && job.paymentStatus === 'paid' && isOwner && (
            <p className="text-xs text-center text-emerald-600 font-semibold py-1">💰 입금 완료 처리됨</p>
          )}

          {/* 리뷰 작성 버튼 (completed + paid 상태, 오너만) */}
          {job.status === 'completed' && job.paymentStatus === 'paid' && isOwner && onWriteReview && (
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
