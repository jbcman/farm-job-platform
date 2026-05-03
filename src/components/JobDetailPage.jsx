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
        <button onClick={onBack} className="flex items-center gap-1 text-gray-600 active:scale-90 transition-transform">
          <ArrowLeft size={20} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>뒤로</span>
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

      {/* PHASE_PAYMENT_ESCROW_V1: 결제 버튼 (오너 + matched 상태) */}
      {job.requesterId === userId && job.status === 'matched' && (
        <div className="mx-4 mb-4 space-y-2">
          {/* 결제 예약 (pending 상태) */}
          {(!job.paymentStatus || job.paymentStatus === 'pending') && (
            <button
              onClick={async () => {
                if (!window.confirm('💳 결제를 시작하시겠어요?\n(에스크로 — 작업 완료 후 자동 정산)')) return;
                try {
                  const res = await fetch(`/api/jobs/${job.id}/pay`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ requesterId: userId }),
                  });
                  const data = await res.json();
                  if (data.ok) {
                    setJob(prev => ({ ...prev, paymentStatus: 'reserved', paymentId: data.payment?.paymentId, fee: data.payment?.fee, netAmount: data.payment?.net }));
                    alert(`✅ 결제 요청이 생성됐어요!\n금액: ${(data.payment?.amount || 0).toLocaleString()}원\n수수료: ${(data.payment?.fee || 0).toLocaleString()}원\n작업자 수령: ${(data.payment?.net || 0).toLocaleString()}원`);
                  } else {
                    alert('⚠️ ' + (data.error || '결제 요청 실패'));
                  }
                } catch { alert('서버 연결 오류'); }
              }}
              className="w-full py-3 bg-blue-600 text-white font-black rounded-2xl
                         flex items-center justify-center gap-2 active:scale-95 transition-transform shadow"
            >
              💳 결제하기 (에스크로)
            </button>
          )}

          {/* 결제 확정 (reserved 상태) */}
          {job.paymentStatus === 'reserved' && (
            <div className="space-y-2">
              <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3">
                <p className="text-xs text-blue-500 font-bold mb-1">🔒 결제 대기 중</p>
                <p className="text-sm text-blue-800 font-black">결제 예약 완료</p>
                {job.netAmount > 0 && (
                  <p className="text-xs text-blue-600 mt-1">
                    작업자 수령 {(job.netAmount || 0).toLocaleString()}원 (수수료 {(job.fee || 0).toLocaleString()}원 제외)
                  </p>
                )}
              </div>
              <button
                onClick={async () => {
                  if (!window.confirm('✅ 결제를 최종 확정하시겠어요?')) return;
                  try {
                    const res = await fetch(`/api/jobs/${job.id}/pay/confirm`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ requesterId: userId }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      setJob(prev => ({ ...prev, paymentStatus: 'paid' }));
                      alert('✅ 결제 확정 완료!\n작업이 진행될 수 있어요.');
                    } else {
                      alert('⚠️ ' + (data.error || '결제 확정 실패'));
                    }
                  } catch { alert('서버 연결 오류'); }
                }}
                className="w-full py-3 bg-green-600 text-white font-black rounded-2xl
                           flex items-center justify-center gap-2 active:scale-95 transition-transform shadow"
              >
                ✅ 결제 확정
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm('⚠️ 환불하시겠어요? 매칭이 취소될 수 있어요.')) return;
                  try {
                    const res = await fetch(`/api/jobs/${job.id}/refund`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ requesterId: userId }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      setJob(prev => ({ ...prev, paymentStatus: 'refunded' }));
                      alert('🔄 환불 처리됐어요.');
                    } else {
                      alert('⚠️ ' + (data.error || '환불 실패'));
                    }
                  } catch { alert('서버 연결 오류'); }
                }}
                className="w-full py-2.5 bg-gray-100 text-gray-600 font-bold rounded-2xl
                           flex items-center justify-center gap-2 active:scale-95 transition-transform text-sm"
              >
                🔄 환불 신청
              </button>
            </div>
          )}

          {/* 결제 완료 배지 (paid) */}
          {job.paymentStatus === 'paid' && (
            <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3 flex items-center gap-3">
              <span className="text-xl">✅</span>
              <div>
                <p className="font-black text-green-800 text-sm">결제 확정 완료</p>
                <p className="text-xs text-green-600">작업 진행 후 자동 정산됩니다</p>
              </div>
            </div>
          )}

          {/* 환불 완료 배지 */}
          {job.paymentStatus === 'refunded' && (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-3">
              <span className="text-xl">🔄</span>
              <div>
                <p className="font-black text-gray-700 text-sm">환불 처리 완료</p>
                <p className="text-xs text-gray-500">결제가 취소됐어요</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PHASE_COMPLETE_SETTLEMENT_WS_V1: 운영 버튼 (오너 + in_progress 상태) */}
      {job.requesterId === userId && job.status === 'in_progress' && (
        <div className="mx-4 mb-4 space-y-2">
          {/* ✅ 작업 완료 + 자동 정산 */}
          <button
            onClick={async () => {
              if (!window.confirm('작업을 완료 처리하고 정산하시겠어요?')) return;
              try {
                const res = await fetch(`/api/jobs/${job.id}/complete`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ requesterId: userId }),
                });
                const data = await res.json();
                if (data.ok) {
                  setJob(prev => ({ ...prev, status: 'completed', paid: true, payAmount: data.payAmount, completedAt: data.completedAt }));
                  alert(`✅ 완료 처리됐어요!\n${data.payAmount ? `💰 정산: ${data.payAmount.toLocaleString()}원` : ''}`);
                } else {
                  alert('⚠️ ' + (data.error || '완료 처리 실패'));
                }
              } catch { alert('서버 연결 오류'); }
            }}
            className="w-full py-3 bg-farm-green text-white font-black rounded-2xl
                       flex items-center justify-center gap-2 active:scale-95 transition-transform shadow"
          >
            ✅ 작업 완료 + 자동 정산
          </button>

          {/* 📅 일정 변경 */}
          <button
            onClick={async () => {
              const newDate = window.prompt('새 일정을 입력하세요 (예: 2026-05-01 오전 9시)');
              if (!newDate?.trim()) return;
              try {
                const res = await fetch(`/api/jobs/${job.id}/reschedule`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ scheduledAt: newDate.trim(), requesterId: userId }),
                });
                const data = await res.json();
                if (data.ok) {
                  setJob(prev => ({ ...prev, scheduledAt: data.scheduledAt }));
                  alert(`📅 일정이 변경됐어요!\n${data.scheduledAt}`);
                } else {
                  alert('⚠️ ' + (data.error || '일정 변경 실패'));
                }
              } catch { alert('서버 연결 오류'); }
            }}
            className="w-full py-3 bg-blue-50 text-blue-700 font-bold rounded-2xl border border-blue-200
                       flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            📅 일정 변경 → 자동 알림
          </button>
        </div>
      )}

      {/* 완료 + 정산 완료 배지 */}
      {job.status === 'completed' && job.paid && (
        <div className="mx-4 mb-4 bg-green-50 border border-green-200 rounded-2xl px-4 py-3
                        flex items-center gap-3">
          <span className="text-2xl">💰</span>
          <div>
            <p className="font-black text-green-800 text-sm">정산 완료</p>
            {job.payAmount && (
              <p className="text-green-600 text-xs font-bold">{job.payAmount.toLocaleString()}원 지급 완료</p>
            )}
          </div>
        </div>
      )}

      {/* v4 STEP 8: 하단 고정 CTA — 📞 지금 바로 연결 */}
      {!isClosed && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#fff', borderTop: '1px solid #f0f0f0',
          padding: '12px 16px max(env(safe-area-inset-bottom),16px)',
          zIndex: 30,
          maxWidth: 512, margin: '0 auto',
        }}>
          {/* v4 신뢰 배지 — 위 */}
          {!applied && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: '#15803d', fontWeight: 700 }}>⚡ 평균 5분 연결</span>
              <span style={{ fontSize: 11, color: '#15803d', fontWeight: 700 }}>✔ 즉시 작업 가능</span>
              {(job.applicationCount ?? 0) > 0 && (
                <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 700 }}>
                  🔥 경쟁 {job.applicationCount}명
                </span>
              )}
            </div>
          )}

          {applyErr && (
            <p className="text-xs text-red-500 text-center mb-2">{applyErr}</p>
          )}

          {applied ? (
            /* v4: 연락처 공개 카드 */
            <div style={{
              background: '#f0fdf4',
              borderRadius: 14,
              padding: '14px 16px',
              textAlign: 'center',
              border: '1px solid #bbf7d0',
            }}>
              <p style={{ color: '#15803d', fontWeight: 900, fontSize: 15, marginBottom: 4 }}>
                ✅ 연락처 공개됨!
              </p>
              <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                농민이 곧 연락드립니다. 먼저 전화해도 좋아요.
              </p>
              {job.contact && (
                <a
                  href={`tel:${job.contact}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    color: '#2d8a4e', fontWeight: 800, fontSize: 17, textDecoration: 'none',
                  }}
                >📞 {job.contact}</a>
              )}
              {!job.contact && (
                <p style={{ color: '#2d8a4e', fontWeight: 700, fontSize: 14 }}>
                  지원 완료 — 농민 확인 대기 중
                </p>
              )}
            </div>
          ) : (
            /* v4: 강조 CTA — 급구면 red gradient, 일반이면 green */
            <button
              onClick={handleApply}
              disabled={applying}
              style={{
                width: '100%',
                height: 52,
                background: (job.isUrgent || (job.applicationCount ?? 0) >= 3)
                  ? 'linear-gradient(90deg,#b91c1c,#dc2626)'
                  : '#2d8a4e',
                color: '#fff',
                border: 'none',
                borderRadius: 14,
                fontWeight: 900,
                fontSize: 17,
                fontFamily: "'Noto Sans KR',sans-serif",
                cursor: applying ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                boxShadow: (job.isUrgent || (job.applicationCount ?? 0) >= 3)
                  ? '0 4px 16px rgba(185,28,28,0.38)'
                  : '0 4px 16px rgba(45,138,78,0.38)',
                opacity: applying ? 0.7 : 1,
                transition: 'transform 0.1s',
              }}
            >
              {applying
                ? <><Loader2 size={20} className="animate-spin" /> 연결 중...</>
                : (job.isUrgent || (job.applicationCount ?? 0) >= 3)
                  ? '🔥 지금 바로 연결 (마감 임박)'
                  : '📞 지금 바로 연결'
              }
            </button>
          )}

          {!applied && (
            <p style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', marginTop: 7 }}>
              지원 즉시 농민 연락처가 공개됩니다
            </p>
          )}
        </div>
      )}
    </div>
  );
}
