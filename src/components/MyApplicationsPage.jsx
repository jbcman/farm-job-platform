/**
 * MyApplicationsPage.jsx — PHASE FLOW_UNIFICATION
 * 작업자 전용 내 지원 현황
 *
 * 섹션 우선순위:
 *   🔥 진행중   → job.status=in_progress & app.status=selected
 *   🎯 선택됨   → app.status=selected (연락 가능)
 *   ⏳ 대기중   → app.status=applied
 *   ✅ 완료     → app.status=completed
 *   마감됨      → rejected / closed
 *
 * 선택 알림:
 *   5초 폴링 → selectedApps 증가 감지 → 상단 배너 + 진동
 *   [TRACE] SELECT_DETECTED
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowLeft, Loader2, Phone, Bell } from 'lucide-react';
import { getMyApplications, completeWork, getUserId } from '../utils/api.js';
import { logTestEvent, logCallTriggered, logCheckpoint, logVibrate } from '../utils/testLogger.js'; // REAL_USER_TEST
import ReviewModal from './ReviewModal.jsx';

// ── 상태 배지 — PHASE 5: on_the_way 포함 ────────────────────────────
function getStatusInfo(appStatus, jobStatus) {
  if (appStatus === 'completed') {
    return { label: '작업완료', cls: 'bg-blue-50 text-blue-700', icon: '✅' };
  }
  if (appStatus === 'selected') {
    if (jobStatus === 'on_the_way')
      return { label: '이동중',     cls: 'bg-orange-100 text-orange-700', icon: '🚗' };
    if (jobStatus === 'in_progress')
      return { label: '진행중',     cls: 'bg-blue-100 text-blue-800',   icon: '🔵' };
    if (jobStatus === 'done' || jobStatus === 'closed')
      return { label: '연결완료',   cls: 'bg-blue-50  text-blue-700',   icon: '🔗' };
    if (jobStatus === 'paid')
      return { label: '입금완료',   cls: 'bg-green-100 text-green-700', icon: '💰' };
    return { label: '연락가능',   cls: 'bg-green-50 text-green-700', icon: '📞' };
  }
  if (appStatus === 'rejected') {
    return { label: '미선택', cls: 'bg-gray-100 text-gray-400', icon: '—' };
  }
  if (jobStatus === 'closed') {
    return { label: '마감됨', cls: 'bg-red-50 text-red-600', icon: '🚫' };
  }
  return { label: '선택 대기중', cls: 'bg-amber-50 text-amber-700', icon: '⏳' };
}

// ── 섹션 헤더 ─────────────────────────────────────────────────────
function SectionHeader({ title, count, priority }) {
  return (
    <div className={`flex items-center gap-2 px-1 mb-2 mt-4 ${priority ? 'mt-2' : ''}`}>
      <p className={`text-sm font-black ${priority ? 'text-gray-800' : 'text-gray-500'}`}>
        {title}
      </p>
      {count > 0 && (
        <span className={`text-xs font-bold rounded-full px-2 py-0.5
                          ${priority ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-600'}`}>
          {count}
        </span>
      )}
    </div>
  );
}

// ── 지원 카드 ─────────────────────────────────────────────────────
function AppCard({ a, completing, onComplete, onReview }) {
  const job        = a.job || {};
  const statusInfo = getStatusInfo(a.status, job.status);
  const isSelected  = a.status === 'selected';
  const isCompleted = a.status === 'completed';
  const isInProgress = isSelected && job.status === 'in_progress';
  const hasReview   = !!a.review;

  return (
    <div className={`card space-y-2 ${
      isInProgress  ? 'border-l-4 border-l-blue-500'
      : isSelected  ? 'border-l-4 border-l-farm-green'
      : isCompleted ? 'border-l-4 border-l-blue-300'
      : ''
    }`}>
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
      {(isSelected || isCompleted) && a.farmerContact && (
        <div className="mt-1 pt-3 border-t border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">농민 연락처</p>
            <p className="font-semibold text-gray-800 text-sm">{a.farmerContact.farmerName}</p>
            <p className="text-sm text-gray-600">{a.farmerContact.farmerPhone}</p>
          </div>
          <a
            href={`tel:${a.farmerContact.farmerPhone}`}
            onClick={() => logCallTriggered(a.job?.id, a.workerId)} // REAL_USER_TEST STEP 13
            className="flex items-center gap-1.5 px-4 py-2.5 bg-farm-green text-white
                       rounded-xl text-sm font-bold active:scale-95 transition-transform"
          >
            <Phone size={14} /> 바로 전화
          </a>
        </div>
      )}

      {/* PHASE 5: 출발했어요 버튼 — matched 상태에서만 표시 */}
      {isSelected && job.status === 'matched' && (
        <button
          onClick={() => onComplete(a, 'depart')}
          disabled={!!completing}
          className="w-full py-2.5 bg-orange-500 text-white font-bold rounded-xl text-sm
                     flex items-center justify-center gap-2 disabled:opacity-60 mt-1
                     active:scale-95 transition-transform shadow-sm"
        >
          {completing === a.id
            ? <><Loader2 size={14} className="animate-spin" /> 처리 중...</>
            : '🚗 출발했어요'
          }
        </button>
      )}

      {/* 작업 완료 버튼 — on_the_way / in_progress 상태 */}
      {isSelected && ['on_the_way', 'in_progress'].includes(job.status) && (
        <button
          onClick={() => onComplete(a)}
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

      {/* PHASE 7: 입금 안내 (completed이고 paid 아닐 때) */}
      {isCompleted && job.paymentStatus !== 'paid' && (
        <div className="mt-1 pt-3 border-t border-dashed border-amber-200 bg-amber-50 rounded-xl px-3 py-2">
          <p className="text-xs font-bold text-amber-700">💰 입금 대기 중</p>
          <p className="text-xs text-amber-600 mt-0.5">농민분께서 작업 완료 확인 후 입금 처리를 해주셔야 해요</p>
        </div>
      )}

      {/* PHASE 8: 후기 섹션 — paid 상태일 때만 허용 */}
      {isCompleted && !hasReview && job.paymentStatus === 'paid' && (
        <div className="mt-1 pt-3 border-t border-dashed border-gray-200">
          <p className="text-xs text-gray-400 mb-2">입금 완료! 농민분께 후기를 남겨보세요 ⭐</p>
          <button
            onClick={() => onReview(a)}
            className="w-full py-2.5 bg-amber-400 text-white font-bold text-sm
                       rounded-xl flex items-center justify-center gap-1.5
                       active:scale-95 transition-transform shadow-sm"
          >
            ⭐ 후기 남기기
          </button>
        </div>
      )}
      {/* 입금 전 후기 불가 안내 */}
      {isCompleted && !hasReview && job.paymentStatus !== 'paid' && (
        <p className="text-xs text-gray-400 text-center mt-1">입금 완료 후 후기를 남길 수 있어요</p>
      )}
      {isCompleted && hasReview && (
        <div className="mt-1 pt-3 border-t border-dashed border-gray-200">
          <p className="text-xs text-gray-400 mb-1.5">내가 남긴 후기</p>
          <div className="flex items-center gap-1 flex-wrap">
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
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────
export default function MyApplicationsPage({ userId, onBack }) {
  const [applications,   setApplications]   = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [toast,          setToast]          = useState('');
  const [completing,     setCompleting]     = useState(null);
  const [reviewApp,      setReviewApp]      = useState(null);
  // STEP 4: 선택 알림 배너
  const [selectionBanner, setSelectionBanner] = useState(false);
  const [newlySelectedJob, setNewlySelectedJob] = useState(null); // { category, farmerName }
  const prevSelectedCountRef = useRef(null); // 이전 selectedApps 카운트

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

  // ── STEP 4: 5초 폴링 — 선택 알림 감지 ───────────────────────
  useEffect(() => {
    if (!userId) return;

    const checkSelection = async () => {
      try {
        const r = await fetch(`/api/jobs/my/notifications?userId=${encodeURIComponent(userId)}`);
        const d = await r.json();
        const newCount = d.selectedApps || 0;

        if (prevSelectedCountRef.current !== null && newCount > prevSelectedCountRef.current) {
          // 새 선택 발생!
          console.log(`[TRACE] SELECT_DETECTED userId=${userId} prevCount=${prevSelectedCountRef.current} newCount=${newCount}`);
          setSelectionBanner(true);
          // REAL_USER_TEST: 작업자 선택 감지
          logTestEvent('worker_selected_detected', { userId, prevCount: prevSelectedCountRef.current, newCount });
          logCheckpoint('selected_detected', { userId });
          // 진동 (모바일)
          try { navigator.vibrate?.([200, 100, 200]); logVibrate(); } catch (_) {}
          // 8초 후 자동 닫힘
          setTimeout(() => setSelectionBanner(false), 8000);
          // 목록 새로고침
          load();
        }

        prevSelectedCountRef.current = newCount;
      } catch (_) {} // fail-safe
    };

    checkSelection(); // 즉시 1회
    const interval = setInterval(checkSelection, 5000);
    return () => clearInterval(interval);
  }, [userId, load]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  // PHASE 5: 출발 처리 (on_the_way)
  async function handleDepart(a) {
    if (completing) return;
    const jobId = a.job?.id;
    if (!jobId) return;
    setCompleting(a.id);
    try {
      const res = await fetch(`/api/jobs/${jobId}/on-the-way`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerId: userId }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || '출발 처리 실패');
      showToast('출발 완료! 농민분께 알림이 갔어요 🚗');
      load();
    } catch (e) {
      showToast(`오류: ${e.message}`);
    } finally {
      setCompleting(null);
    }
  }

  async function handleComplete(a, type) {
    // PHASE 5: depart 타입이면 출발 처리
    if (type === 'depart') return handleDepart(a);

    if (completing) return;
    const jobId = a.job?.id;
    if (!jobId) return;
    setCompleting(a.id);
    try {
      await completeWork(jobId, userId);
      showToast('작업 완료 처리됐어요! 🎉');
      // REAL_USER_TEST: 작업자 완료
      logTestEvent('worker_complete', { jobId, appId: a.id });
      logCheckpoint('worker_complete_done', { jobId });
      setReviewApp({ app: a, job: a.job });
      load();
    } catch (e) {
      showToast(e.message);
    } finally {
      setCompleting(null);
    }
  }

  // ── 섹션 분류 ───────────────────────────────────────────────
  const sInProgress = applications.filter(
    a => a.status === 'selected' && a.job?.status === 'in_progress'
  );
  const sSelected = applications.filter(
    a => a.status === 'selected' && a.job?.status !== 'in_progress'
  );
  const sApplied = applications.filter(
    a => a.status === 'applied' && a.job?.status !== 'closed'
  );
  const sCompleted = applications.filter(a => a.status === 'completed');
  const sClosed = applications.filter(
    a => a.status === 'rejected' || (a.status === 'applied' && a.job?.status === 'closed')
  );

  const doneCount     = sCompleted.length;
  const reviewedCount = sCompleted.filter(a => a.review).length;
  const activeCount   = sInProgress.length + sSelected.length;

  return (
    <div className="min-h-screen bg-farm-bg pb-8">

      {/* ── STEP 4: 선택 알림 배너 ─────────────────────────────── */}
      {selectionBanner && (
        <div className="fixed top-0 left-0 right-0 z-50 shadow-xl animate-fade-in"
             style={{ background: 'linear-gradient(90deg,#2d8a4e,#16a34a)' }}>
          <div className="flex items-center gap-3 px-4 py-4">
            <Bell size={22} className="text-white animate-bounce shrink-0" />
            <div className="flex-1">
              <p className="font-black text-white text-base">🎯 선택되었습니다!</p>
              <p className="text-sm text-green-100">농민 연락처를 확인하고 전화하세요</p>
            </div>
            <button
              onClick={() => setSelectionBanner(false)}
              className="text-white text-2xl font-light leading-none shrink-0 px-2"
            >
              ✕
            </button>
          </div>
          {/* 8초 타이머 바 */}
          <div style={{
            height: 3, background: 'rgba(255,255,255,0.3)',
            animation: 'timerBar 8s linear forwards',
          }} />
          <style>{`
            @keyframes timerBar {
              from { width: 100%; }
              to   { width: 0%; }
            }
          `}</style>
        </div>
      )}

      {/* 헤더 */}
      <header className={`bg-white px-4 pt-safe pb-3 border-b border-gray-100 sticky z-30
                          ${selectionBanner ? 'top-[68px]' : 'top-0'}`}
              style={{ paddingTop: selectionBanner ? 12 : undefined }}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 text-gray-600">
            <ArrowLeft size={24} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-800">내 지원 현황</h1>
            <p className="text-xs text-gray-400 -mt-0.5">
              {activeCount > 0 && <span className="text-farm-green font-bold">활성 {activeCount}건 · </span>}
              {doneCount > 0 && `완료 ${doneCount}건 · 후기 ${reviewedCount}/${doneCount}`}
            </p>
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

      <div className="px-4 py-4">

        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={28} className="animate-spin mr-2" />
            <span>불러오는 중...</span>
          </div>
        )}
        {error && (
          <div className="card bg-red-50 text-red-600 text-sm py-3 text-center">{error}</div>
        )}

        {!loading && applications.length === 0 && !error && (
          <div className="card text-center py-12">
            <p className="text-4xl mb-3">📋</p>
            <p className="font-semibold text-gray-500">아직 지원한 일이 없어요</p>
            <p className="text-sm text-gray-400 mt-1">일 목록에서 마음에 드는 일에 지원해보세요</p>
          </div>
        )}

        {!loading && (
          <>
            {/* 🔥 진행중 */}
            {sInProgress.length > 0 && (
              <div>
                <SectionHeader title="🔵 진행중" count={sInProgress.length} priority />
                <div className="space-y-3">
                  {sInProgress.map(a => (
                    <AppCard key={a.id} a={a} completing={completing}
                      onComplete={handleComplete}
                      onReview={a2 => setReviewApp({ app: a2, job: a2.job })} />
                  ))}
                </div>
              </div>
            )}

            {/* 🎯 선택됨 */}
            {sSelected.length > 0 && (
              <div>
                <SectionHeader title="🎯 선택됨 — 지금 연락하세요" count={sSelected.length} priority />
                <div className="space-y-3">
                  {sSelected.map(a => (
                    <AppCard key={a.id} a={a} completing={completing}
                      onComplete={handleComplete}
                      onReview={a2 => setReviewApp({ app: a2, job: a2.job })} />
                  ))}
                </div>
              </div>
            )}

            {/* ⏳ 대기중 */}
            {sApplied.length > 0 && (
              <div>
                <SectionHeader title="⏳ 선택 대기중" count={sApplied.length} />
                <div className="space-y-3">
                  {sApplied.map(a => (
                    <AppCard key={a.id} a={a} completing={completing}
                      onComplete={handleComplete}
                      onReview={a2 => setReviewApp({ app: a2, job: a2.job })} />
                  ))}
                </div>
              </div>
            )}

            {/* ✅ 완료 */}
            {sCompleted.length > 0 && (
              <div>
                <SectionHeader title="✅ 완료" count={sCompleted.length} />
                <div className="space-y-3">
                  {sCompleted.map(a => (
                    <AppCard key={a.id} a={a} completing={completing}
                      onComplete={handleComplete}
                      onReview={a2 => setReviewApp({ app: a2, job: a2.job })} />
                  ))}
                </div>
              </div>
            )}

            {/* 마감됨 (접힘) */}
            {sClosed.length > 0 && (
              <div>
                <SectionHeader title="마감됨" count={sClosed.length} />
                <div className="space-y-3">
                  {sClosed.map(a => (
                    <AppCard key={a.id} a={a} completing={completing}
                      onComplete={handleComplete}
                      onReview={a2 => setReviewApp({ app: a2, job: a2.job })} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* REVIEW_UX: 후기 모달 */}
      {reviewApp && (
        <ReviewModal
          job={reviewApp.job}
          reviewerRole="worker"
          reviewerId={userId}
          targetId={reviewApp.job?.requesterId}
          showIncentive={true}
          onClose={() => setReviewApp(null)}
          onSubmit={() => {
            showToast('후기가 등록됐어요! ⭐');
            load();
          }}
        />
      )}
    </div>
  );
}
