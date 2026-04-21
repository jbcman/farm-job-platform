import React, { useEffect, useState } from 'react';
import {
  ArrowLeft, MapPin, Clock, Banknote,
  Maximize2, Loader2, AlertCircle, CheckCircle, Zap
} from 'lucide-react';
import { getJob, applyJob, getUserId, trackClientEvent } from '../utils/api.js';

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
export default function JobDetailPage({ jobId, job: initialJob, onBack, source = 'direct' }) {
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
      trackClientEvent('job_detail_view', { jobId, source });
      console.log(`[JOB_DETAIL_VIEW] jobId=${jobId} source=${source}`);
      return;
    }
    setLoading(true);
    getJob(jobId)
      .then(res => {
        setJob(res.job);
        trackClientEvent('job_detail_view', { jobId, source });
        console.log(`[JOB_DETAIL_VIEW] jobId=${jobId} source=${source}`);
      })
      .catch(e => {
        setError(e.message || '일자리를 찾을 수 없습니다');
        console.warn(`[JOB_DETAIL_FAIL] jobId=${jobId} err=${e.message}`);
      })
      .finally(() => setLoading(false));
  }, [jobId]); // eslint-disable-line

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
      </header>

      {/* STEP 4: 딥링크 출처 배너 */}
      {source === 'kakao' && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2.5 flex items-center gap-2">
          <span className="text-base">💬</span>
          <p className="text-xs text-amber-700 font-semibold">카카오 알림에서 연결된 일이에요</p>
        </div>
      )}

      <div className="px-4 py-5 space-y-4 animate-fade-in">

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

            {job.areaSize && (
              <div className="flex items-center gap-2.5">
                <Maximize2 size={16} className="text-farm-green shrink-0" />
                <span>{job.areaSize.toLocaleString()}{job.areaUnit}</span>
              </div>
            )}
          </div>
        </div>

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
          <div className="card bg-gray-50 text-center py-4">
            <p className="text-sm font-bold text-gray-500">이미 마감된 일이에요</p>
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
