import React from 'react';
import { MapPin, Clock, Maximize2, Zap, CheckCircle, Play, Flag, Star, Banknote, XCircle, RefreshCw } from 'lucide-react';
import { trackClientEvent } from '../utils/api.js';

const CATEGORY_EMOJI = {
  '밭갈이': '🚜', '로터리': '🔄', '두둑': '⛰️',
  '방제': '💊', '수확 일손': '🌾', '예초': '✂️',
};

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
  applied = false,
  userId,
}) {
  const emoji    = CATEGORY_EMOJI[job.category] || '🌱';
  const statusBadge = STATUS_BADGE[job.status];
  const isOwner  = userId && job.requesterId === userId;

  // Phase 6: distanceKm 표시 (distLabel 우선, 없으면 distanceKm 직접 사용)
  const distDisplay = job.distLabel
    ? job.distLabel
    : job.distanceKm != null
      ? (job.distanceKm < 1 ? '1km 이내' : `${job.distanceKm}km`)
      : null;

  // PHASE 18: 급구/오늘 카드 강조 클래스
  const urgentBorder = job.isUrgent && job.status === 'open'
    ? 'border-l-4 border-l-red-500'
    : job.isToday
      ? 'border-l-4 border-l-farm-green'
      : '';

  return (
    <div className={`card animate-fade-in ${urgentBorder}`}>

      {/* PHASE 18: 급구 강조 배너 — 카드 최상단 */}
      {job.isUrgent && job.status === 'open' && (
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
          {/* Phase 6: 거리 배지 */}
          {distDisplay && (
            <span className="text-xs bg-blue-50 text-blue-600 font-semibold rounded-full px-2 py-0.5">
              {distDisplay}
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

      {/* 요청자 + PHASE 22 신뢰도 */}
      <div className="flex items-center gap-2 mb-2">
        <p className="text-sm text-gray-500">{job.requesterName} 님의 요청</p>
        {job.avgRating != null && job.ratingCount > 0 && (
          <span className="flex items-center gap-0.5 text-xs font-semibold text-amber-600
                           bg-amber-50 rounded-full px-2 py-0.5">
            <Star size={10} className="fill-amber-400 text-amber-400" />
            {job.avgRating.toFixed(1)}
            <span className="text-gray-400 font-normal">({job.ratingCount}명)</span>
          </span>
        )}
      </div>

      {/* 정보 행 */}
      <div className="flex flex-col gap-1.5 mb-4 text-sm text-gray-600">
        {/* PHASE 23/24: 주소 항상 표시 + 좌표 없음 경고 */}
        <div className="flex items-center gap-1.5">
          <MapPin size={14} className="text-farm-green shrink-0" />
          <span className={job.locationText ? '' : 'text-gray-400 italic'}>
            {job.locationText || '위치 정보 없음'}
          </span>
          {distDisplay && !job.distLabel && (
            <span className="ml-1 text-xs text-gray-400">({distDisplay})</span>
          )}
          {job.distLabel && (
            <span className="ml-1 text-xs text-gray-400">({job.distLabel})</span>
          )}
        </div>
        {/* PHASE 24: 좌표 미등록 경고 — 지도에 표시되지 않음 안내 */}
        {!job.latitude && !job.longitude && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600
                          bg-amber-50 rounded-lg px-2.5 py-1.5 font-semibold">
            ⚠️ 위치 확인 필요 — 지도 미표시
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Clock size={14} className="text-farm-green shrink-0" />
          <span>{job.date}  {job.timeSlot}</span>
        </div>
        {job.areaSize && (
          <div className="flex items-center gap-1.5">
            <Maximize2 size={14} className="text-farm-green shrink-0" />
            <span>{job.areaSize.toLocaleString()}{job.areaUnit}</span>
          </div>
        )}
        {job.pay && (
          <div className="flex items-center gap-1.5">
            <Banknote size={14} className="text-farm-green shrink-0" />
            <span className="font-semibold text-gray-700">일당 {job.pay}</span>
          </div>
        )}
      </div>

      {/* 메모 */}
      {job.note && (
        <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-3 py-2 mb-4 line-clamp-2">
          {job.note}
        </p>
      )}

      {/* ── 작업자 모드 액션 ── */}
      {mode === 'worker' && job.status === 'open' && (
        applied ? (
          <button disabled className="btn btn-full bg-gray-100 text-gray-400 cursor-not-allowed">
            신청됨 ✓
          </button>
        ) : (
          <button onClick={() => onApply?.(job)} className="btn-primary btn-full">
            이 일 할게요
          </button>
        )
      )}

      {/* ── 농민 모드 액션 ── */}
      {mode === 'farmer' && (
        <div className="space-y-2">
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
