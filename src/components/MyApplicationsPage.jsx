/**
 * MyApplicationsPage.jsx — PHASE 22
 * 작업자 전용 내 지원 현황
 *
 * 상태 흐름:
 *   applied   → 선택 대기 중
 *   selected  → 연결됨 (농민 연락처 공개) + [작업 완료] 버튼
 *   completed → 작업완료 + 후기 UI (미작성) / 후기 확인 (작성 완료)
 *   rejected  → 미선택
 */
import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Loader2, Phone } from 'lucide-react';
import { getMyApplications, completeWork, submitJobReview } from '../utils/api.js';

// ── 상태 배지 ────────────────────────────────────────────────────
function getStatusInfo(appStatus, jobStatus) {
  if (appStatus === 'completed') {
    return { label: '작업완료', cls: 'bg-blue-50 text-blue-700', icon: '✅' };
  }
  if (appStatus === 'selected') {
    return jobStatus === 'closed'
      ? { label: '연결완료',    cls: 'bg-blue-50  text-blue-700'  , icon: '🔗' }
      : { label: '연락가능합니다', cls: 'bg-green-50 text-green-700', icon: '📞' };
  }
  if (appStatus === 'rejected') {
    return { label: '미선택', cls: 'bg-gray-100 text-gray-400', icon: '—' };
  }
  if (jobStatus === 'closed') {
    return { label: '마감됨', cls: 'bg-red-50 text-red-600', icon: '🚫' };
  }
  return { label: '선택 대기중', cls: 'bg-amber-50 text-amber-700', icon: '⏳' };
}

// ── 별점 선택 컴포넌트 ────────────────────────────────────────────
function StarRating({ value, onChange, disabled = false }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange?.(n)}
          style={{
            background: 'none', border: 'none', padding: '2px 3px',
            fontSize: 28, cursor: disabled ? 'default' : 'pointer',
            color: n <= value ? '#f59e0b' : '#e5e7eb',
            transition: 'color .1s',
          }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ── 인라인 후기 폼 ────────────────────────────────────────────────
function ReviewForm({ jobId, workerId, onSubmitted }) {
  const [rating,  setRating]  = useState(0);
  const [review,  setReview]  = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit() {
    if (rating === 0) { setError('별점을 먼저 선택해주세요.'); return; }
    setLoading(true);
    setError('');
    try {
      await submitJobReview(jobId, { workerId, rating, review });
      onSubmitted();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
      <p className="text-xs font-semibold text-gray-500 mb-2">이 농민에게 후기를 남겨주세요</p>
      <StarRating value={rating} onChange={setRating} />
      <textarea
        value={review}
        onChange={e => setReview(e.target.value)}
        placeholder="작업 경험을 공유해주세요 (선택 사항)"
        rows={2}
        className="w-full mt-2 px-3 py-2 border border-gray-200 rounded-xl text-sm
                   focus:outline-none focus:border-farm-green resize-none"
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="mt-2 w-full py-2.5 bg-amber-400 text-white font-black text-sm
                   rounded-xl flex items-center justify-center gap-2 disabled:opacity-60
                   active:scale-95 transition-transform shadow-sm"
      >
        {loading
          ? <><Loader2 size={14} className="animate-spin" /> 등록 중...</>
          : '⭐ 후기 등록하기'
        }
      </button>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────
export default function MyApplicationsPage({ userId, onBack }) {
  const [applications, setApplications] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [toast,        setToast]        = useState('');
  const [completing,   setCompleting]   = useState(null); // 완료 처리 중인 appId

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getMyApplications(userId);
      setApplications(data.applications || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  async function handleComplete(app) {
    if (completing) return;
    const jobId = app.job?.id;
    if (!jobId) return;
    setCompleting(app.id);
    try {
      await completeWork(jobId, userId);
      showToast('작업 완료 처리됐어요!');
      load();
    } catch (e) {
      showToast(e.message);
    } finally {
      setCompleting(null);
    }
  }

  const doneCount    = applications.filter(a => a.status === 'completed').length;
  const reviewedCount = applications.filter(a => a.status === 'completed' && a.review).length;

  return (
    <div className="min-h-screen bg-farm-bg pb-8">

      {/* 헤더 */}
      <header className="bg-white px-4 pt-safe pt-4 pb-3 border-b border-gray-100 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 text-gray-600">
            <ArrowLeft size={24} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-800">내 지원 현황</h1>
            {doneCount > 0 && (
              <p className="text-xs text-farm-green -mt-0.5">
                완료 {doneCount}건 · 후기 {reviewedCount}/{doneCount}
              </p>
            )}
          </div>
          <span className="ml-auto text-sm text-gray-400">{applications.length}건</span>
        </div>
      </header>

      {/* 토스트 */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white
                        rounded-full px-5 py-2.5 text-sm font-bold shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      <div className="px-4 py-4 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={28} className="animate-spin mr-2" />
            <span>불러오는 중...</span>
          </div>
        )}

        {!loading && applications.length === 0 && !error && (
          <div className="card text-center py-12">
            <p className="text-4xl mb-3">📋</p>
            <p className="font-semibold text-gray-500">아직 지원한 일이 없어요</p>
            <p className="text-sm text-gray-400 mt-1">일 목록에서 마음에 드는 일에 지원해보세요</p>
          </div>
        )}

        {error && (
          <div className="card bg-red-50 text-red-600 text-sm py-3 text-center">{error}</div>
        )}

        {!loading && applications.map(a => {
          const job         = a.job || {};
          const statusInfo  = getStatusInfo(a.status, job.status);
          const isSelected  = a.status === 'selected';
          const isCompleted = a.status === 'completed';
          const hasReview   = !!a.review;
          const isActive    = isSelected || isCompleted;

          return (
            <div
              key={a.id}
              className={`card space-y-2 ${
                isCompleted ? 'border-l-4 border-l-blue-400'
                : isSelected ? 'border-l-4 border-l-farm-green'
                : ''
              }`}
            >
              {/* 상단 행 */}
              <div className="flex items-start justify-between gap-2">
                <span className="font-bold text-gray-800 text-base">{job.category || '—'}</span>
                <span className={`shrink-0 text-xs px-2.5 py-0.5 rounded-full font-semibold ${statusInfo.cls}`}>
                  {statusInfo.icon} {statusInfo.label}
                </span>
              </div>

              {/* 일자리 정보 */}
              <p className="text-sm text-gray-500">
                {job.locationText && <span>{job.locationText}</span>}
                {job.locationText && job.date && <span> · </span>}
                {job.date && <span>{job.date}</span>}
              </p>
              {job.pay && (
                <p className="text-sm font-semibold text-farm-green">일당 {job.pay}</p>
              )}

              {/* 연락처 (selected / completed) */}
              {isActive && a.farmerContact && (
                <div className="mt-1 pt-3 border-t border-gray-100 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400">농민 연락처</p>
                    <p className="font-semibold text-gray-800 text-sm">{a.farmerContact.farmerName}</p>
                    <p className="text-sm text-gray-600">{a.farmerContact.farmerPhone}</p>
                  </div>
                  <a
                    href={`tel:${a.farmerContact.farmerPhone}`}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-farm-green text-white
                               rounded-xl text-sm font-bold active:scale-95 transition-transform"
                  >
                    <Phone size={14} /> 바로 전화
                  </a>
                </div>
              )}

              {/* 작업 완료 버튼 (selected 상태) */}
              {isSelected && (
                <button
                  onClick={() => handleComplete(a)}
                  disabled={!!completing}
                  className="w-full py-2.5 bg-blue-500 text-white font-bold rounded-xl text-sm
                             flex items-center justify-center gap-2 disabled:opacity-60 mt-1
                             active:scale-95 transition-transform shadow-sm"
                >
                  {completing === a.id
                    ? <><Loader2 size={14} className="animate-spin" /> 처리 중...</>
                    : '✅ 작업 완료 처리하기'
                  }
                </button>
              )}

              {/* 후기 섹션 (completed) */}
              {isCompleted && !hasReview && (
                <ReviewForm
                  jobId={job.id}
                  workerId={userId}
                  onSubmitted={() => { showToast('후기가 등록됐어요! ⭐'); load(); }}
                />
              )}

              {isCompleted && hasReview && (
                <div className="mt-1 pt-3 border-t border-dashed border-gray-200">
                  <p className="text-xs text-gray-400 mb-1.5">내가 남긴 후기</p>
                  <div className="flex items-center gap-1">
                    {[1,2,3,4,5].map(n => (
                      <span key={n} style={{ fontSize: 18, color: n <= a.review.rating ? '#f59e0b' : '#e5e7eb' }}>★</span>
                    ))}
                    <span className="text-xs text-gray-400 ml-1.5">
                      {a.review.comment || '(코멘트 없음)'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
