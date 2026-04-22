import React, { useEffect, useState } from 'react';
import {
  ArrowLeft, MapPin, Clock, Banknote,
  Maximize2, Loader2, AlertCircle, CheckCircle, Zap, RefreshCw, ImageIcon, Share2,
} from 'lucide-react';
import { getJob, applyJob, getUserId, trackClientEvent } from '../utils/api.js';
import { saveRecentJob } from '../utils/recentJobs.js';
import { shareJobKakao, isKakaoAvailable } from '../utils/kakao.js';
import { getMapPageUrl, getKakaoNaviLink } from '../utils/mapLink.js';

const CATEGORY_EMOJI = {
  '밭갈이': '🚜', '로터리': '🔄', '두둑': '⛰️',
  '방제': '💊', '수확 일손': '🌾', '예초': '✂️',
};

/**
 * JobDetailPage — 일 상세 + 바로 지원
 *
 * Props:
 *   jobId    : string   — URL 딥링크 또는 선택된 job id
 *   job      : object?  — 미리 알고 있는 job 객체 (있으면 API 호출 생략)
 *   onBack   : fn
 *   source   : 'kakao' | 'list' | 'direct'
 */
export default function JobDetailPage({ jobId, job: initialJob, onBack, source = 'direct', onCopyJob }) {
  const [job,      setJob]      = useState(initialJob || null);
  const [loading,  setLoading]  = useState(!initialJob);
  const [error,    setError]    = useState('');
  const [applied,  setApplied]  = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyErr, setApplyErr] = useState('');

  const userId = getUserId();

  // STEP 3: 상세 API 조회
  useEffect(() => {
    if (!jobId) return;
    if (initialJob && initialJob.id === jobId) {
      saveRecentJob(initialJob);
      trackClientEvent('job_detail_view', { jobId, source });
      console.log(`[RECENT_JOB_VIEW] jobId=${jobId} source=${source}`);
      return;
    }
    setLoading(true);
    getJob(jobId)
      .then(res => {
        setJob(res.job);
        saveRecentJob(res.job);
        trackClientEvent('job_detail_view', { jobId, source });
        console.log(`[RECENT_JOB_VIEW] jobId=${jobId} source=${source}`);
      })
      .catch(e => {
        setError(e.message || '일자리를 찾을 수 없습니다');
        console.warn(`[JOB_DETAIL_FAIL] jobId=${jobId} err=${e.message}`);
      })
      .finally(() => setLoading(false));
  }, [jobId]); // eslint-disable-line

  // PHASE GROWTH: 공유하기
  const [copied, setCopied] = useState(false);
  async function handleShare() {
    if (!job) return;
    try { trackClientEvent('share_click', { jobId: job.id }); } catch (_) {}
    const emoji = CATEGORY_EMOJI[job.category] || '🌱';
    const shareUrl = `${window.location.origin}/jobs/${job.id}?source=share`;
    const text = `${emoji} ${job.category} (${job.pay || '일당 협의'}) / ${job.locationText} / 바로 지원 가능`;

    // ① 카카오 공유 우선 시도
    if (isKakaoAvailable()) {
      const ok = shareJobKakao(job, shareUrl);
      if (ok) { trackClientEvent('share_kakao', { jobId: job.id }); return; }
    }
    // ② navigator.share (모바일 기본)
    if (navigator.share) {
      try {
        await navigator.share({ title: text, url: shareUrl });
        trackClientEvent('share_native', { jobId: job.id });
        return;
      } catch (_) {}
    }
    // ③ fallback: 클립보드 복사
    try {
      await navigator.clipboard.writeText(`${text}\n${shareUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      trackClientEvent('share_clipboard', { jobId: job.id });
    } catch (_) {}
  }

  // STEP 5: 바로 지원
  async function handleApply() {
    if (!job) return;
    setApplying(true);
    setApplyErr('');
    try {
      await applyJob(job.id, { workerId: userId, message: '' });
      setApplied(true);
      trackClientEvent('job_apply', { jobId: job.id, source });
      console.log(`[JOB_APPLY] jobId=${job.id} userId=${userId} source=${source}`);
    } catch (e) {
      // STEP 5: 중복 지원 차단 메시지 처리
      if (e.message?.includes('이미 지원')) {
        setApplied(true);
      } else {
        setApplyErr(e.message || '지원 중 오류가 발생했어요');
      }
    } finally {
      setApplying(false);
    }
  }

  const emoji = job ? (CATEGORY_EMOJI[job.category] || '🌱') : '🌱';

  // ── STEP 7: 로딩 ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-farm-bg flex flex-col">
        <header className="bg-white px-4 pt-safe pt-4 pb-4 border-b border-gray-100 flex items-center gap-3">
          <button onClick={onBack} className="p-1 text-gray-600"><ArrowLeft size={24} /></button>
          <h1 className="text-lg font-bold text-gray-800">일 상세</h1>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-farm-green" />
        </div>
      </div>
    );
  }

  // ── STEP 7: 에러 (존재하지 않는 ID, 삭제된 job) ──────────────────
  if (error || !job) {
    return (
      <div className="min-h-screen bg-farm-bg flex flex-col">
        <header className="bg-white px-4 pt-safe pt-4 pb-4 border-b border-gray-100 flex items-center gap-3">
          <button onClick={onBack} className="p-1 text-gray-600"><ArrowLeft size={24} /></button>
          <h1 className="text-lg font-bold text-gray-800">일 상세</h1>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <AlertCircle size={48} className="text-gray-300" />
          <p className="text-lg font-bold text-gray-600">일자리를 찾을 수 없습니다</p>
          <p className="text-sm text-gray-400">삭제되었거나 존재하지 않는 일이에요<br />잠시 후 다시 시도해주세요</p>
          <button
            onClick={onBack}
            className="mt-2 px-6 py-3 bg-farm-green text-white font-bold rounded-2xl"
          >
            다른 일 찾기
          </button>
        </div>
      </div>
    );
  }

  const isClosed = job.status !== 'open';

  return (
    <div className="min-h-screen bg-farm-bg pb-32">
      {/* 헤더 */}
      <header className="bg-white px-4 pt-safe pt-4 pb-4 border-b border-gray-100 sticky top-0 z-30 flex items-center gap-3">
        <button onClick={onBack} className="p-1 text-gray-600">
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-lg font-bold text-gray-800 flex-1 truncate">
          {emoji} {job.category}
        </h1>
        {job.isUrgent && (
          <span className="flex items-center gap-1 text-xs bg-red-100 text-red-600 font-bold rounded-full px-2.5 py-1">
            <Zap size={11} />급구
          </span>
        )}
        {/* PHASE GROWTH: 공유 버튼 */}
        <button
          onClick={handleShare}
          className="p-2 text-gray-500 active:scale-90 transition-transform relative"
          title="공유하기"
        >
          {copied
            ? <span className="text-xs font-bold text-farm-green">복사됨!</span>
            : <Share2 size={20} />}
        </button>
      </header>

      {/* STEP 4: 딥링크 출처 배너 */}
      {source === 'kakao' && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2.5 flex items-center gap-2">
          <span className="text-base">💬</span>
          <p className="text-xs text-amber-700 font-semibold">카카오 알림에서 연결된 일이에요</p>
        </div>
      )}
      {/* PHASE GROWTH STEP 7: 공유 링크 접속 CTA */}
      {source === 'share' && (
        <div className="bg-green-50 border-b border-green-100 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-green-700 font-semibold">
            🌾 지인이 공유한 일이에요 — 지금 바로 근처 일 확인하기
          </p>
          <span className="text-green-600 font-black text-xs shrink-0">🔍 일자리 보기</span>
        </div>
      )}

      <div className="px-4 py-5 space-y-4 animate-fade-in">

        {/* PHASE 26: 밭 이미지 갤러리 (이미지 있을 때만) */}
        {(() => {
          const imgs = Array.isArray(job.farmImages) ? job.farmImages
                       : (job.imageUrl ? [job.imageUrl] : []);
          if (imgs.length === 0) return null;
          return (
            <div className="relative">
              {imgs.length === 1 ? (
                <div className="rounded-2xl overflow-hidden bg-gray-100 aspect-video">
                  <img
                    src={imgs[0]}
                    alt="밭 사진"
                    className="w-full h-full object-cover"
                    onError={e => { e.target.parentElement.style.display = 'none'; }}
                  />
                </div>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-4 px-4">
                  {imgs.map((url, i) => (
                    <div key={i} className="shrink-0 w-56 h-40 rounded-2xl overflow-hidden bg-gray-100 border border-gray-100">
                      <img
                        src={url}
                        alt={`밭 사진 ${i + 1}`}
                        className="w-full h-full object-cover"
                        onError={e => { e.target.parentElement.style.display = 'none'; }}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div className="absolute top-2 right-2 flex items-center gap-1
                              bg-black/40 text-white text-xs font-bold rounded-full px-2 py-1">
                <ImageIcon size={10} />
                <span>{imgs.length}장</span>
              </div>
            </div>
          );
        })()}

        {/* 핵심 정보 카드 — STEP 8: 첫 화면에 모두 표시 */}
        <div className="card space-y-3">
          {/* 카테고리 + 요청자 */}
          <div className="flex items-center gap-3">
            <span className="text-4xl">{emoji}</span>
            <div>
              <p className="text-xl font-black text-gray-800">{job.category}</p>
              <p className="text-sm text-gray-500">{job.requesterName} 님의 요청</p>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          {/* PHASE 26: 평수 강조 배너 */}
          {(job.areaPyeong || job.areaSize) && (
            <div className="flex items-center gap-2.5 bg-farm-light rounded-xl px-3.5 py-2.5">
              <Maximize2 size={18} className="text-farm-green shrink-0" />
              <span className="font-black text-farm-green text-lg">
                {job.areaPyeong
                  ? `${job.areaPyeong.toLocaleString()}평`
                  : `${job.areaSize.toLocaleString()}${job.areaUnit}`}
              </span>
              <span className="text-sm text-gray-500">규모</span>
            </div>
          )}

          {/* 정보 행 */}
          <div className="space-y-2.5 text-sm text-gray-700">
            <div className="flex items-center gap-2.5">
              <MapPin size={16} className="text-farm-green shrink-0" />
              <span>{job.locationText}</span>
              {job.distLabel && (
                <span className="ml-auto text-xs text-gray-400 shrink-0">({job.distLabel})</span>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <Clock size={16} className="text-farm-green shrink-0" />
              <span>{job.date}  {job.timeSlot}</span>
            </div>

            {job.pay && (
              <div className="flex items-center gap-2.5">
                <Banknote size={16} className="text-farm-green shrink-0" />
                <span className="font-bold text-gray-800">일당 {job.pay}</span>
              </div>
            )}
          </div>
        </div>

        {/* 🗺️ 위치 확인 — MAP_ACTIONS_FINAL: 2버튼 통일 */}
        {(() => {
          const mapUrl   = getMapPageUrl(job);
          const naviLink = getKakaoNaviLink(job);
          const hasCoords = !!mapUrl;

          return (
            <div className="card space-y-3">
              <p className="text-xs font-bold text-gray-400 uppercase">위치 확인</p>

              {/* 주소 텍스트 */}
              <div className="bg-gray-50 rounded-xl px-3 py-2.5 flex items-center gap-2">
                <MapPin size={15} className="text-farm-green shrink-0" />
                <span className="text-sm font-medium text-gray-700">
                  {job.locationText || '주소 정보 없음'}
                </span>
              </div>

              {/* 액션 버튼 2개 */}
              <div className="grid grid-cols-2 gap-2">
                {/* 📍 지도에서 보기 → MapPage */}
                <button
                  onClick={() => {
                    if (!mapUrl) return;
                    trackClientEvent('map_view', { jobId: job.id });
                    window.location.href = mapUrl;
                  }}
                  disabled={!hasCoords}
                  className={`flex items-center justify-center gap-2 py-3 font-bold text-sm rounded-2xl
                              active:scale-95 transition-transform
                              ${hasCoords
                                ? 'bg-farm-green text-white shadow-sm'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                >
                  📍 지도에서 보기
                </button>

                {/* 🧭 카카오 길찾기 */}
                {naviLink ? (
                  <a
                    href={naviLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 py-3 bg-yellow-400 text-yellow-900
                               font-bold text-sm rounded-2xl active:scale-95 transition-transform shadow-sm"
                    onClick={() => trackClientEvent('nav_kakao', { jobId: job.id })}
                  >
                    🧭 길찾기
                  </a>
                ) : (
                  /* 좌표 없음 — 주소 검색 폴백 */
                  job.locationText && (
                    <a
                      href={`https://map.kakao.com/link/search/${encodeURIComponent(job.locationText)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 py-3 bg-yellow-400 text-yellow-900
                                 font-bold text-sm rounded-2xl active:scale-95 transition-transform shadow-sm"
                    >
                      🔍 검색
                    </a>
                  )
                )}
              </div>
            </div>
          );
        })()}

        {/* 메모/설명 */}
        {job.note && (
          <div className="card">
            <p className="text-xs font-bold text-gray-400 uppercase mb-2">작업 설명</p>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{job.note}</p>
          </div>
        )}

        {/* 지원자 수 */}
        {job.applicationCount > 0 && (
          <div className="card flex items-center justify-between">
            <span className="text-sm text-gray-500">현재 지원자</span>
            <span className="font-bold text-farm-green">{job.applicationCount}명</span>
          </div>
        )}

        {/* 마감 상태 */}
        {isClosed && (
          <div className="card bg-gray-50 text-center py-4 space-y-3">
            <p className="text-sm font-bold text-gray-500">이미 마감된 일이에요</p>
            {onCopyJob && (
              <button
                onClick={() => {
                  trackClientEvent('retention_cta_click', { jobId: job.id, action: 'copy_from_detail' });
                  console.log(`[RETENTION_CTA_CLICK] jobId=${job.id} action=copy_from_detail`);
                  onCopyJob(job);
                }}
                className="w-full py-3 bg-farm-green text-white font-bold rounded-xl
                           flex items-center justify-center gap-2 active:scale-95 transition-transform"
              >
                <RefreshCw size={16} /> 비슷한 일 다시 등록하기
              </button>
            )}
          </div>
        )}
      </div>

      {/* STEP 5: 하단 고정 CTA — STEP 8: 손가락 누르기 쉬운 크기 */}
      {!isClosed && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100
                        px-4 pt-3 pb-safe pb-4 z-30 max-w-lg mx-auto">
          {applyErr && (
            <p className="text-xs text-red-500 text-center mb-2">{applyErr}</p>
          )}

          {applied ? (
            <div className="flex items-center justify-center gap-2 py-4 bg-green-50
                            rounded-2xl border-2 border-farm-green">
              <CheckCircle size={20} className="text-farm-green" />
              <span className="font-black text-farm-green text-lg">지원 완료!</span>
            </div>
          ) : (
            <button
              onClick={handleApply}
              disabled={applying}
              className="w-full py-4 bg-farm-green text-white font-black text-lg rounded-2xl
                         shadow-lg active:scale-95 transition-transform
                         disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {applying
                ? <><Loader2 size={20} className="animate-spin" /> 지원 중...</>
                : '👉 바로 지원하기'
              }
            </button>
          )}

          <p className="text-center text-xs text-gray-400 mt-2">
            지원 후 농민이 연락드릴 거예요
          </p>
        </div>
      )}
    </div>
  );
}
