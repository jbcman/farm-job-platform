import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Loader2, MapPin, Phone } from 'lucide-react';
import { getJobs, getMyJobs, getMyApplications, applyJob, startJob, completeJob } from '../utils/api.js';
import JobCard from './JobCard.jsx';
import ReviewModal from './ReviewModal.jsx';

const CATEGORIES = ['전체', '밭갈이', '로터리', '두둑', '방제', '수확 일손', '예초'];

function getStoredLocation() {
  try {
    const raw = localStorage.getItem('userLocation');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * JobListPage
 *   mode=worker  : 일자리 목록 (작업자용)
 *   myJobsMode   : 내 요청 관리 (농민용 — 시작/완료/리뷰 포함)
 */
const APP_STATUS = {
  applied:  { label: '선택 대기중',     cls: 'bg-amber-50 text-amber-700' },
  selected: { label: '연락 가능합니다', cls: 'bg-green-50 text-green-700' },
  rejected: { label: '미선택',          cls: 'bg-gray-100 text-gray-500'  },
};

export default function JobListPage({ userId, myJobsMode, myApplicationsMode, onBack, onViewApplicants, onViewJobDetail }) {
  const [jobs,         setJobs]         = useState([]);
  const [applications, setApplications] = useState([]); // myApplicationsMode 전용
  const [loading,      setLoading]      = useState(true);
  const [category,     setCategory]     = useState('전체');
  const [applied,      setApplied]      = useState(new Set());
  const [toast,        setToast]        = useState('');
  const [error,        setError]        = useState('');
  const [reviewJob,    setReviewJob]    = useState(null); // ReviewModal 대상
  const loc = getStoredLocation();

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    if (myApplicationsMode) {
      // 작업자: 내 지원 목록
      getMyApplications(userId)
        .then(d => setApplications(d.applications || []))
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    } else if (myJobsMode) {
      // 농민: 내 등록 작업만
      getMyJobs(userId)
        .then(d => setJobs(d.jobs || []))
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      // 작업자: 전체 목록 + GPS 필터
      const cat = category === '전체' ? undefined : category;
      getJobs({ category: cat, lat: loc?.lat, lon: loc?.lon, radius: loc ? 50 : 500 })
        .then(d => setJobs(d.jobs || []))
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [myJobsMode, myApplicationsMode, userId, category]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  // ── 작업자: 지원하기 ──────────────────────────────────────────
  async function handleApply(job) {
    try {
      await applyJob(job.id, { workerId: userId, message: '' });
      setApplied(prev => new Set([...prev, job.id]));
      showToast(`${job.category} 신청됐어요!`);
    } catch (e) {
      showToast(e.message);
    }
  }

  // ── 농민: 작업 시작 ───────────────────────────────────────────
  async function handleStart(job) {
    try {
      await startJob(job.id, userId);
      showToast('작업이 시작되었어요!');
      load();
    } catch (e) {
      showToast(e.message);
    }
  }

  // ── 농민: 작업 완료 ───────────────────────────────────────────
  async function handleComplete(job) {
    try {
      await completeJob(job.id, userId);
      showToast('작업이 완료되었어요!');
      load();
      setReviewJob(job); // 완료 후 리뷰 모달 자동 팝업
    } catch (e) {
      showToast(e.message);
    }
  }

  const title = myApplicationsMode ? '내 지원 현황' : myJobsMode ? '내 요청 관리' : '지금 가능한 일';
  const mode  = myJobsMode ? 'farmer' : 'worker';
  const listCount = myApplicationsMode ? applications.length : jobs.length;

  return (
    <div className="min-h-screen bg-farm-bg pb-8">
      {/* 헤더 */}
      <header className="bg-white px-4 pt-safe pt-4 pb-3 border-b border-gray-100 sticky top-0 z-30">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onBack} className="p-1 text-gray-600">
            <ArrowLeft size={24} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-800">{title}</h1>
            {!myJobsMode && !myApplicationsMode && loc && (
              <p className="text-xs text-farm-green flex items-center gap-0.5 -mt-0.5">
                <MapPin size={10} /> 내 위치 기준
              </p>
            )}
          </div>
          <span className="ml-auto text-sm text-gray-400">{listCount}건</span>
        </div>

        {/* 카테고리 필터 (작업자 목록에서만) */}
        {!myJobsMode && !myApplicationsMode && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                  category === cat ? 'bg-farm-green text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
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
            <Loader2 size={28} className="animate-spin mr-2" /><span>불러오는 중...</span>
          </div>
        )}

        {/* ── 내 지원 현황 (작업자 전용) ── */}
        {!loading && myApplicationsMode && (
          <>
            {applications.length === 0 && (
              <div className="card text-center py-12">
                <p className="text-4xl mb-3">📋</p>
                <p className="font-semibold text-gray-500">아직 지원한 일이 없어요</p>
                <p className="text-sm text-gray-400 mt-1">일 목록에서 마음에 드는 일에 지원해보세요</p>
              </div>
            )}
            {applications.map(a => {
              const job = a.job || {};
              const statusInfo = APP_STATUS[a.status] || APP_STATUS.applied;
              const isSelected = a.status === 'selected';
              return (
                <div key={a.id} className={`card space-y-2 ${isSelected ? 'border-l-4 border-l-farm-green' : ''}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-gray-800">{job.category || '—'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusInfo.cls}`}>
                      {statusInfo.label}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">{job.locationText} · {job.date}</p>
                  {job.pay && <p className="text-sm text-farm-green font-semibold">일당 {job.pay}</p>}
                  {/* 선택됐을 때: 농민 연락처 공개 */}
                  {isSelected && a.farmerContact && (
                    <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-400">농민 연락처</p>
                        <p className="font-semibold text-gray-800">{a.farmerContact.farmerName}</p>
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
                </div>
              );
            })}
          </>
        )}

        {/* ── 일반 목록 (농민 내 요청 / 작업자 전체 목록) ── */}
        {!loading && !myApplicationsMode && jobs.length === 0 && (
          <div className="card text-center py-12">
            <p className="text-4xl mb-3">🌱</p>
            <p className="font-semibold text-gray-500">
              {myJobsMode ? '등록한 작업이 없어요' : '근처 작업이 없어요'}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {myJobsMode ? '홈에서 새 작업을 등록해보세요' : '카테고리를 바꿔보세요'}
            </p>
          </div>
        )}

        {error && (
          <div className="card bg-red-50 text-red-600 text-sm py-3 text-center">{error}</div>
        )}

        {!myApplicationsMode && jobs.map(job => (
          <JobCard
            key={job.id}
            job={job}
            mode={mode}
            userId={userId}
            applied={applied.has(job.id)}
            onApply={handleApply}
            onViewApplicants={onViewApplicants}
            onStartJob={handleStart}
            onCompleteJob={handleComplete}
            onWriteReview={setReviewJob}
          />
        ))}
      </div>

      {/* 리뷰 모달 */}
      {reviewJob && (
        <ReviewModal
          job={reviewJob}
          onClose={() => setReviewJob(null)}
          onSubmit={() => { showToast('후기가 등록되었어요!'); load(); }}
        />
      )}
    </div>
  );
}
