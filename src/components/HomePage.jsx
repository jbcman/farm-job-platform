import React, { useEffect, useState } from 'react';
import {
  PlusCircle, ClipboardList, BookOpen,
  Zap, ChevronRight, Loader2, Star, MapPin, Link2, Map, Clock,
} from 'lucide-react';
import { getJobs, getNearbyWorkers, trackClientEvent } from '../utils/api.js';
import { getRecentJobs } from '../utils/recentJobs.js';
import JobCard from './JobCard.jsx';
import OnboardingOverlay from './OnboardingOverlay.jsx';

function getStoredLocation() {
  try {
    const raw = localStorage.getItem('userLocation');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function WorkerChip({ worker }) {
  return (
    <div className="card shrink-0 w-40 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="font-bold text-gray-800">{worker.name}</span>
        <div className="flex items-center gap-0.5 text-amber-400">
          <Star size={11} fill="currentColor" />
          <span className="text-xs text-gray-600">{worker.rating}</span>
        </div>
      </div>
      <p className="text-xs text-gray-500">{worker.baseLocationText}</p>
      <div className="flex flex-wrap gap-1 mt-1">
        {worker.hasTractor && <span className="text-xs bg-amber-50 text-amber-700 rounded px-1.5 py-0.5">트랙터</span>}
        {worker.hasSprayer && <span className="text-xs bg-amber-50 text-amber-700 rounded px-1.5 py-0.5">방제기</span>}
        {worker.categories.slice(0, 1).map(c => (
          <span key={c} className="text-xs bg-farm-light text-farm-green rounded px-1.5 py-0.5">{c}</span>
        ))}
      </div>
    </div>
  );
}

const CATEGORY_EMOJI = {
  '밭갈이': '🚜', '로터리': '🔄', '두둑': '⛰️',
  '방제': '💊', '수확 일손': '🌾', '예초': '✂️',
};

/** PHASE 26: 탭 배지 — 카운트 빨간 원 */
function TabBadge({ count }) {
  if (!count || count <= 0) return null;
  return (
    <span
      className="absolute -top-0.5 -right-1.5 min-w-[16px] h-4 bg-red-500 text-white
                 text-[10px] font-black rounded-full flex items-center justify-center px-1
                 leading-none shadow"
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

export default function HomePage({
  mode, onModeChange,
  onPostJob, onViewJobList,
  onViewMyJobs, onViewMyApplications,
  onViewApplicants, onViewMyConnections,
  onViewJobDetail, onViewMap,
  notif = { pendingApps: 0, selectedApps: 0 },
}) {
  const [urgentJobs,   setUrgentJobs]   = useState([]);
  const [recentJobs,   setRecentJobs]   = useState([]);
  const [recommended,  setRecommended]  = useState([]);   // Phase 6
  const [workers,      setWorkers]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [gpsStatus,    setGpsStatus]    = useState('idle');
  const [showOnboard,  setShowOnboard]  = useState(false);
  // Phase 11: 최근 본 일 (localStorage)
  const [viewHistory,    setViewHistory]    = useState([]);
  // Phase 12: CTA A/B 테스트 (마운트 시 1회 결정)
  const [ctaVariant,     setCtaVariant]     = useState(null);
  // PHASE RETENTION: 리뷰 유도 배너
  const [pendingReview,  setPendingReview]  = useState(null);
  // PHASE FARMER_PAY_UX: 결제 리마인드 배너
  const [payRemind,      setPayRemind]      = useState(null); // { jobId, category }
  // PHASE TEST_INSTRUMENTATION: 개발 패널
  const [devStats,       setDevStats]       = useState(null);
  const isDev = import.meta.env.DEV;

  // BRAND_UI: SEO 타이틀
  useEffect(() => {
    document.title = '농촌 일손 — AI 농촌 일자리 매칭';
  }, []);

  // 최초 1회 온보딩
  useEffect(() => {
    if (!localStorage.getItem('farm-onboarded')) {
      setShowOnboard(true);
    }
    // Phase 11: 최근 본 일 로드
    const recent = getRecentJobs().slice(0, 3);
    setViewHistory(recent);

    // PHASE RETENTION STEP 6: 리뷰 미작성 유도 (완료 후 1시간 경과)
    try {
      const pr = JSON.parse(localStorage.getItem('farm-pendingReview') || 'null');
      if (pr && pr.completedAt && (Date.now() - pr.completedAt) > 60 * 60 * 1000) {
        setPendingReview(pr);
      }
    } catch (_) {}

    // Phase 12: CTA A/B 테스트 — 최근 본 일이 있을 때만 노출
    if (recent.length > 0) {
      try {
        const v = Math.random() < 0.5 ? 'A' : 'B';
        setCtaVariant(v);
        trackClientEvent('retention_cta_exposed', { variant: v });
      } catch (_) { /* fail-safe */ }
    }

    // PHASE FARMER_PAY_UX: 결제 리마인드 (farm-payPending 키)
    try {
      const pending = JSON.parse(localStorage.getItem('farm-payPending') || 'null');
      if (pending?.jobId && pending?.requestedAt) {
        // 24시간 이상 경과한 pending이면 부드럽게 리마인드
        const elapsedH = (Date.now() - pending.requestedAt) / 3600000;
        if (elapsedH >= 1) {
          setPayRemind(pending);
          try { trackClientEvent('pay_remind_view', { jobId: pending.jobId }); } catch (_) {}
        }
      }
    } catch (_) {}
  }, []);

  // Phase 12: 최근 본 일 클릭 추적
  function handleRecentJobClick(job, index) {
    try {
      trackClientEvent('recent_job_click', { jobId: job.id, position: index });
    } catch (_) {}
    onViewJobDetail?.({ id: job.id });
  }

  // Phase 12: CTA 클릭 추적
  function handleCtaClick() {
    try {
      trackClientEvent('retention_cta_click', { variant: ctaVariant });
    } catch (_) {}
    // 가장 최근 본 일이 있으면 상세로 이동
    if (viewHistory[0]) onViewJobDetail?.({ id: viewHistory[0].id });
  }

  useEffect(() => {
    const loc = getStoredLocation();
    setLoading(true);

    Promise.all([
      // Phase 6: recommended=1 → 추천 정렬 API
      getJobs({ lat: loc?.lat, lon: loc?.lon, radius: loc ? 50 : 500, recommended: 1 }),
      getNearbyWorkers({ lat: loc?.lat, lon: loc?.lon }),
    ]).then(([jobsRes, workersRes]) => {
      const all = jobsRes.jobs || [];
      // 추천 정렬된 결과를 그대로 사용
      setRecommended(all.slice(0, 5));
      setUrgentJobs(all.filter(j => j.isUrgent).slice(0, 3));
      setRecentJobs(all.filter(j => !j.isUrgent).slice(0, 4));
      setWorkers((workersRes.workers || []).slice(0, 5));
    }).catch(console.error)
      .finally(() => setLoading(false));

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          localStorage.setItem('userLocation', JSON.stringify({
            lat: coords.latitude, lon: coords.longitude,
          }));
          setGpsStatus('ok');
          trackClientEvent('location_permission_granted');
        },
        () => {
          setGpsStatus('denied');
          trackClientEvent('location_permission_denied');
        },
        { timeout: 5000, maximumAge: 60000 }
      );
    }
  }, []);

  return (
    <div className="min-h-screen bg-farm-bg pb-28">

      {/* 온보딩 오버레이 */}
      {showOnboard && <OnboardingOverlay onDone={() => setShowOnboard(false)} />}

      {/* 헤더 */}
      <header className="bg-farm-green px-4 pt-safe pt-5 pb-6">
        {/* 브랜드 + GPS */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-black text-white tracking-tight">🌾 농촌 일손</h1>
          <div className="flex items-center gap-1.5">
            {gpsStatus === 'ok' && (
              <span className="flex items-center gap-1 text-xs bg-white/20 text-green-100 rounded-full px-2 py-0.5">
                <MapPin size={10} /> 내 위치
              </span>
            )}
            {gpsStatus === 'denied' && (
              <span className="text-xs text-green-300">전국 표시</span>
            )}
          </div>
        </div>

        {/* 히어로 카피 — BRAND_UI */}
        <div className="mb-5">
          <p className="text-white font-black text-2xl leading-snug mb-1">
            AI가 연결하는<br />농촌 일자리
          </p>
          <p className="text-green-200 text-sm leading-relaxed">
            위치 · 난이도 · 경험까지 자동 매칭<br />
            전화 돌릴 필요 없습니다
          </p>
        </div>

        {/* 모드 선택 버튼 — BRAND_UI */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => { onModeChange('farmer'); onPostJob(); }}
            className={`py-3.5 rounded-2xl font-bold text-base transition-all border-2 ${
              mode === 'farmer'
                ? 'bg-white text-farm-green border-white shadow'
                : 'bg-white/10 text-white border-white/30'
            }`}
          >
            ➕ 일손 구하기
          </button>
          <button
            onClick={() => { onModeChange('worker'); onViewJobList(); }}
            className={`py-3.5 rounded-2xl font-bold text-base transition-all border-2 ${
              mode === 'worker'
                ? 'bg-white text-farm-green border-white shadow'
                : 'bg-white/10 text-white border-white/30'
            }`}
          >
            🔍 일자리 찾기
          </button>
        </div>

        {/* 신뢰 요소 3포인트 — BRAND_UI */}
        <div className="flex gap-3 text-green-200 text-xs font-semibold">
          <span>✔ AI 자동 추천</span>
          <span>✔ 가까운 일자리 우선</span>
          <span>✔ 난이도 맞춤 매칭</span>
        </div>
      </header>

      {/* 위치 허용 온보딩 배너 — BRAND_UI */}
      {!localStorage.getItem('brand-location-tip') && gpsStatus === 'idle' && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-amber-700 font-medium">
            📍 위치를 허용하면 더 정확한 일자리를 추천해드려요
          </p>
          <button
            onClick={() => {
              localStorage.setItem('brand-location-tip', '1');
              // re-render로 배너 숨김
              setGpsStatus('prompted');
            }}
            className="text-xs text-amber-600 font-bold shrink-0 underline"
          >
            확인
          </button>
        </div>
      )}

      {/* PHASE RETENTION STEP 6: 리뷰 유도 배너 */}
      {pendingReview && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-amber-800 font-medium">
            ⭐ <strong>{pendingReview.category}</strong> 작업 후기를 아직 안 남기셨어요
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => { onViewMyJobs?.(); setPendingReview(null); }}
              className="text-xs bg-amber-500 text-white font-bold px-3 py-1.5 rounded-full active:scale-95 transition-transform"
            >
              후기 쓰기
            </button>
            <button
              onClick={() => {
                try { localStorage.removeItem('farm-pendingReview'); } catch (_) {}
                setPendingReview(null);
              }}
              className="text-xs text-amber-600 font-medium"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* PHASE FARMER_PAY_UX: 결제 리마인드 배너 (부드러운 안내) */}
      {payRemind && (
        <div className="bg-green-50 border-b border-green-200 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-green-800 font-medium">
            🌾 <strong>{payRemind.category}</strong> 긴급 공고 효과 어떠셨나요?
            <span className="block text-xs text-green-600 font-normal">간단히 결제하실 수 있어요</span>
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => {
                try { localStorage.removeItem('farm-payPending'); } catch (_) {}
                setPayRemind(null);
              }}
              className="bg-green-600 text-white text-xs font-bold rounded-full px-3 py-1.5 active:scale-95 transition-transform"
            >
              결제하기
            </button>
            <button
              onClick={() => {
                try { localStorage.removeItem('farm-payPending'); } catch (_) {}
                setPayRemind(null);
              }}
              className="text-xs text-green-600 font-medium"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* 🔥 긴급 배너 — UI_CONVERSION 강화 */}
      {!loading && urgentJobs.length > 0 && (
        <button
          onClick={mode === 'farmer' ? onViewMyJobs : onViewJobList}
          className="w-full bg-red-100 text-red-600 px-4 py-3.5 mx-4 mt-3
                     flex items-center justify-between text-sm font-bold
                     rounded-xl border border-red-200 active:scale-98 transition-transform"
          style={{ width: 'calc(100% - 32px)' }}
        >
          <span className="flex items-center gap-2">
            🔥 오늘 안 구하면 작업 지연됩니다
            <span className="bg-red-500 text-white text-xs font-black rounded-full px-2 py-0.5">
              {urgentJobs.length}건
            </span>
          </span>
          <ChevronRight size={16} />
        </button>
      )}

      <div className="px-4 py-5 space-y-7">
        {loading && (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 size={26} className="animate-spin mr-2" />
            <span>불러오는 중...</span>
          </div>
        )}

        {/* ── 농민 모드 콘텐츠 ── */}
        {!loading && mode === 'farmer' && (
          <>
            {/* 바로 등록 CTA */}
            <button
              onClick={onPostJob}
              className="w-full py-4 bg-farm-green text-white font-black text-lg rounded-2xl
                         shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
            >
              👉 지금 바로 연결하기
            </button>

            {workers.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <p className="section-title mb-0">오늘 가능한 작업자</p>
                  <span className="text-sm text-farm-green font-bold">{workers.length}명</span>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none -mx-4 px-4">
                  {workers.map(w => <WorkerChip key={w.id} worker={w} />)}
                </div>
              </section>
            )}

            {urgentJobs.length > 0 && (
              <section>
                <p className="section-title flex items-center gap-1.5">
                  <Zap size={18} className="text-farm-yellow" />
                  급한 요청
                </p>
                <div className="space-y-3">
                  {urgentJobs.map(job => (
                    <JobCard key={job.id} job={job} mode="farmer" onViewApplicants={onViewApplicants} />
                  ))}
                </div>
              </section>
            )}

            {recentJobs.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <p className="section-title mb-0">최근 등록 작업</p>
                  <button
                    onClick={onViewMyJobs}
                    className="text-sm text-farm-green font-bold flex items-center gap-0.5"
                  >
                    전체 보기 <ChevronRight size={14} />
                  </button>
                </div>
                <div className="space-y-3">
                  {recentJobs.slice(0, 2).map(job => (
                    <JobCard key={job.id} job={job} mode="farmer" onViewApplicants={onViewApplicants} />
                  ))}
                </div>
              </section>
            )}

            {!urgentJobs.length && !recentJobs.length && (
              <div className="card text-center py-10 text-gray-400">
                <p className="text-4xl mb-3">🌱</p>
                <p className="font-semibold text-gray-500">아직 올라온 일이 없습니다</p>
                <p className="text-sm mt-1">첫 일을 올려보세요!</p>
              </div>
            )}
          </>
        )}

        {/* ── 작업자 모드 콘텐츠 ── */}
        {!loading && mode === 'worker' && (
          <>
            {/* 바로 찾기 + 지도 CTA */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={onViewJobList}
                className="col-span-2 py-4 bg-farm-green text-white font-black text-lg rounded-2xl
                           shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
              >
                👉 지금 바로 연결하기
              </button>
              <button
                onClick={onViewMap}
                className="py-4 bg-white border-2 border-farm-green text-farm-green font-bold
                           rounded-2xl shadow-md active:scale-95 transition-transform
                           flex flex-col items-center justify-center gap-1"
              >
                <Map size={20} />
                <span className="text-xs">지도 보기</span>
              </button>
            </div>

            {/* Phase 6: 추천 섹션 (오늘 + 가까운 + 일당 우선) */}
            {recommended.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <p className="section-title mb-0 flex items-center gap-1.5">
                    <span>🔥</span> 오늘 근처 일
                  </p>
                  <button
                    onClick={onViewJobList}
                    className="text-sm text-farm-green font-bold flex items-center gap-0.5"
                  >
                    전체 보기 <ChevronRight size={14} />
                  </button>
                </div>
                <div className="space-y-3">
                  {recommended.map(job => (
                    <JobCard
                      key={job.id}
                      job={job}
                      mode="worker"
                      onApply={() => onViewJobList?.()}
                      onViewDetail={onViewJobDetail ? () => onViewJobDetail(job) : undefined}
                    />
                  ))}
                </div>
              </section>
            )}

            {recommended.length === 0 && (
              <div className="card text-center py-10 text-gray-400">
                <p className="text-4xl mb-2">🌿</p>
                <p className="text-gray-500">아직 올라온 일이 없습니다</p>
                <p className="text-sm text-gray-400 mt-1">나중에 다시 확인해보세요</p>
              </div>
            )}

            {/* PHASE GROWTH STEP 5: 우리 동네 인기 일 (applicationCount 기준) */}
            {(() => {
              // locationText 앞 2어절 기준 지역 매칭 (시/군/구 레벨)
              const userLoc = getStoredLocation();
              if (!userLoc || recommended.length === 0) return null;
              const myLocPrefix = (() => {
                try {
                  const raw = localStorage.getItem('farm-userName');
                  return null; // 텍스트 지역정보 없으면 applicationCount 상위 3개만 표시
                } catch { return null; }
              })();

              const popular = [...recommended]
                .filter(j => (j.applicationCount || 0) >= 1)
                .sort((a, b) => (b.applicationCount || 0) - (a.applicationCount || 0))
                .slice(0, 3);
              if (popular.length === 0) return null;

              return (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <p className="section-title mb-0 flex items-center gap-1.5">
                      <span>📍</span> 우리 동네 인기 일
                    </p>
                    <button
                      onClick={onViewJobList}
                      className="text-sm text-farm-green font-bold flex items-center gap-0.5"
                    >
                      전체 보기 <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {popular.map(job => (
                      <JobCard
                        key={job.id + '-popular'}
                        job={job}
                        mode="worker"
                        onApply={() => onViewJobList?.()}
                        onViewDetail={onViewJobDetail ? () => onViewJobDetail(job) : undefined}
                      />
                    ))}
                  </div>
                </section>
              );
            })()}

            {/* Phase 11: 최근 본 일자리 + Phase 12: A/B CTA */}
            {viewHistory.length > 0 && (
              <section>
                <div className="flex items-center gap-1.5 mb-3">
                  <Clock size={15} className="text-gray-400" />
                  <p className="section-title mb-0 text-gray-500">최근 본 일자리</p>
                </div>
                <div className="space-y-2">
                  {viewHistory.map((j, idx) => (
                    <button
                      key={j.id}
                      onClick={() => handleRecentJobClick(j, idx)}
                      className="w-full card text-left flex items-center gap-3 py-3 active:scale-98 transition-transform"
                    >
                      <span className="text-2xl shrink-0">{CATEGORY_EMOJI[j.category] || '🌱'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-800 text-sm">{j.category}</p>
                        <p className="text-xs text-gray-500 truncate">{j.locationText} · {j.date}</p>
                      </div>
                      {j.pay && (
                        <span className="text-xs font-semibold text-farm-green shrink-0">{j.pay}</span>
                      )}
                      <ChevronRight size={14} className="text-gray-300 shrink-0" />
                    </button>
                  ))}
                </div>
                {/* Phase 12: A/B CTA 배너 */}
                {ctaVariant && (
                  <button
                    onClick={handleCtaClick}
                    className="mt-3 w-full py-3 bg-farm-light text-farm-green font-bold rounded-2xl
                               border border-farm-green flex items-center justify-center gap-2
                               active:scale-95 transition-transform text-sm"
                  >
                    {ctaVariant === 'A'
                      ? '♻️ 다시 등록하면 바로 연결됩니다'
                      : '👥 예전에 지원한 사람에게 다시 요청해보세요'}
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {/* PHASE TEST_INSTRUMENTATION: 개발 패널 (dev 빌드만) */}
      {isDev && (
        <div className="mx-4 mb-4">
          <button
            onClick={() => {
              fetch('/api/analytics/stats')
                .then(r => r.json())
                .then(d => setDevStats(d))
                .catch(() => {});
            }}
            className="w-full py-2 bg-gray-800 text-white text-xs font-bold rounded-xl mb-2"
          >
            📊 테스트 지표 새로고침
          </button>
          {devStats && (
            <div className="bg-gray-900 text-green-400 text-xs font-mono rounded-xl p-3 space-y-1">
              <p className="text-white font-bold mb-2">📊 현장 테스트 지표</p>
              <p>상세 조회  : {devStats.funnel?.detail_view ?? 0}회</p>
              <p>지원 클릭  : {devStats.funnel?.apply_click ?? 0}회</p>
              <p>전화 클릭  : {devStats.funnel?.call_click ?? 0}회</p>
              <p>SMS 클릭   : {devStats.funnel?.sms_click ?? 0}회</p>
              <p>길찾기     : {devStats.funnel?.direction_click ?? 0}회</p>
              <p>지도 보기  : {devStats.funnel?.map_view ?? 0}회</p>
              <p>공유       : {devStats.funnel?.share_click ?? 0}회</p>
              <div className="border-t border-gray-700 pt-1 mt-1">
                <p className="text-yellow-400">상세→지원  : {devStats.conversion?.detail_to_apply}</p>
                <p className="text-yellow-400">지원→전화  : {devStats.conversion?.apply_to_call}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 하단 탭바 */}
      <nav className="tabbar">
        {mode === 'farmer' ? (
          <>
            <button onClick={onPostJob} className="tab-btn">
              <PlusCircle size={24} className="text-farm-green" />
              <span className="text-farm-green">일손 구하기</span>
            </button>
            {/* 농민: "내가 올린 일" — 새 지원자 배지 */}
            <button onClick={onViewMyJobs} className="tab-btn relative">
              <span className="relative inline-flex">
                <ClipboardList size={22} />
                <TabBadge count={notif.pendingApps} />
              </span>
              <span>내가 올린 일</span>
            </button>
            <button onClick={onViewMyApplications} className="tab-btn">
              <BookOpen size={22} />
              <span>내 지원</span>
            </button>
            <button onClick={onViewMyConnections} className="tab-btn">
              <Link2 size={22} />
              <span>내 연결</span>
            </button>
          </>
        ) : (
          <>
            <button onClick={onViewJobList} className="tab-btn">
              <ClipboardList size={22} className="text-farm-green" />
              <span className="text-farm-green">지금 가능한 일</span>
            </button>
            <button onClick={onViewMap} className="tab-btn">
              <Map size={22} />
              <span>지도</span>
            </button>
            {/* 작업자: "내 지원" — 선택 완료 배지 */}
            <button onClick={onViewMyApplications} className="tab-btn relative">
              <span className="relative inline-flex">
                <BookOpen size={22} />
                <TabBadge count={notif.selectedApps} />
              </span>
              <span>내 지원</span>
            </button>
            <button onClick={onViewMyConnections} className="tab-btn">
              <Link2 size={22} />
              <span>내 연결</span>
            </button>
          </>
        )}
      </nav>
    </div>
  );
}
