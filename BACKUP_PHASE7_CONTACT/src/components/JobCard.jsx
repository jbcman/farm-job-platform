import React from 'react';
import { MapPin, Clock, Maximize2, Zap, CheckCircle, Play, Flag, Star, Banknote } from 'lucide-react';

const CATEGORY_EMOJI = {
  '밭갈이': '🚜', '로터리': '🔄', '두둑': '⛰️',
  '방제': '💊', '수확 일손': '🌾', '예초': '✂️',
};

const STATUS_BADGE = {
  matched:     { label: '매칭완료',  cls: 'badge-matched',                    icon: CheckCircle },
  in_progress: { label: '진행중',    cls: 'bg-blue-100 text-blue-700 badge',   icon: Play       },
  done:        { label: '완료',      cls: 'bg-gray-100 text-gray-600 badge',   icon: Flag       },
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
  onStartJob, onCompleteJob, onWriteReview,
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

  return (
    <div className={`card animate-fade-in ${job.isToday ? 'border-l-4 border-l-farm-green' : ''}`}>
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

      {/* 요청자 */}
      <p className="text-sm text-gray-500 mb-2">{job.requesterName} 님의 요청</p>

      {/* 정보 행 */}
      <div className="flex flex-col gap-1.5 mb-4 text-sm text-gray-600">
        <div className="flex items-center gap-1.5">
          <MapPin size={14} className="text-farm-green shrink-0" />
          <span>{job.locationText}</span>
          {distDisplay && !job.distLabel && (
            <span className="ml-1 text-xs text-gray-400">({distDisplay})</span>
          )}
          {job.distLabel && (
            <span className="ml-1 text-xs text-gray-400">({job.distLabel})</span>
          )}
        </div>
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
          {/* 지원자 수 + 지원자 보기 */}
          {(job.status === 'open' || job.status === 'matched') && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">
                지원자 <strong className="text-farm-green">{job.applicationCount || 0}명</strong>
              </span>
              {job.status === 'open' ? (
                <button
                  onClick={() => onViewApplicants?.(job)}
                  className="btn-outline py-2 px-4 text-sm"
                >
                  누가 할 수 있나
                </button>
              ) : (
                <span className="text-sm font-bold text-blue-600">매칭 완료 ✓</span>
              )}
            </div>
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
        </div>
      )}
    </div>
  );
}
