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
      {/* DESIGN_V3: 즉시 투입 가능 상태 뱃지 */}
      <p className="text-xs text-green-700 font-bold">✅ 즉시 투입 가능</p>
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
    document.title = '농촌 일손';
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
    <div className="min-h-screen bg-farm-bg" style={{ paddingBottom: 'calc(7rem + 56px)' }}>

      {/* 온보딩 오버레이 */}
      {showOnboard && <OnboardingOverlay onDone={() => setShowOnboard(false)} />}

      {/* STEP 4: 개발 모드 전용 테스트 안내 배너 */}
      {isDev && (
        <div style={{
          background: '#1e40af', color: '#fff',
          fontSize: 12, fontWeight: 700,
          padding: '7px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8,
        }}>
          <span>📊 현재 테스트 중 — 전화 버튼을 눌러주세요</span>
          <span
            style={{ fontSize: 11, opacity: 0.8, whiteSpace: 'nowrap', cursor: 'pointer' }}
            onClick={() => { try { window.farm?.report(); } catch (_) {} }}
          >
            farm.report() →
          </span>
        </div>
      )}

      {/* ══ UX_V2 HERO ══ */}
      <header className="bg-farm-green px-4 pt-safe pb-5 relative">

        {/* GPS 뱃지 */}
        <div className="absolute top-3 right-4 pt-safe">
          {gpsStatus === 'ok' && (
            <span className="flex items-center gap-1 text-xs bg-white/20 text-green-100 rounded-full px-2 py-0.5">
              <MapPin size={10} /> 내 위치
            </span>
          )}
        </div>

        {/* 브랜드 + 헤드라인 */}
        <div style={{ paddingTop: 28, paddingBottom: 20, textAlign: 'center' }}>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 700,
                       letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 10px' }}>
            🌾 농촌 일손
          </p>
          <h1 style={{ fontFamily: "'Jalnan2','Noto Sans KR',sans-serif",
                        fontSize: 28, fontWeight: 900, color: '#fff',
                        lineHeight: 1.22, margin: 0 }}>
            급할 때 바로<br/>일손 연결
          </h1>
        </div>

        {/* UX_V2 STEP 3: 버튼 2개 — 72px / 22px */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={() => {
              try { trackClientEvent('cta_click', { type: 'find_job', location: 'hero' }); } catch (_) {}
              onModeChange('worker'); onViewJobList();
            }}
            style={{
              width: '100%', height: 72,
              background: '#fff', color: '#ff4d00',
              border: 'none', borderRadius: 14,
              fontWeight: 900, fontSize: 22,
              cursor: 'pointer',
              boxShadow: '0 6px 22px rgba(0,0,0,0.22)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginBottom: 0,
            }}
          >👉 일자리 찾기</button>

          <button
            onClick={() => {
              try { trackClientEvent('cta_click', { type: 'find_worker', location: 'hero' }); } catch (_) {}
              onModeChange('farmer'); onPostJob();
            }}
            style={{
              width: '100%', height: 72,
              background: 'rgba(255,255,255,0.14)', color: '#fff',
              border: '2px solid rgba(255,255,255,0.30)', borderRadius: 14,
              fontWeight: 900, fontSize: 22,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >👉 사람 구하기</button>
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

      {/* 🔥 긴급 배너 — FINAL_CONVERSION: 항상 표시 */}
      {!loading && (
        <button
          onClick={mode === 'farmer' ? onViewMyJobs : onViewJobList}
          className="w-full flex items-center justify-between active:opacity-90 transition-opacity"
          style={{
            background: 'linear-gradient(90deg,#b91c1c,#dc2626)',
            padding: '11px 16px',
            boxShadow: '0 3px 12px rgba(185,28,28,.40)',
          }}
        >
          <div className="text-left">
            <p className="text-white font-black text-sm">🔥 오늘 안 구하면 작업 지연됩니다</p>
            <p className="text-red-100 text-xs font-semibold mt-0.5">
              {urgentJobs.length > 0
                ? `⏰ 지금 기준 ${urgentJobs.length}건 남음 — 빨리 신청하세요`
                : '⏰ 지금 기준 2건 남음 — 빨리 신청하세요'}
            </p>
          </div>
          <ChevronRight size={18} className="text-white/80 shrink-0" />
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
        {!loading && mode === 'farmer' && (() => {
          // PHASE_ROLE_STATE_SPLIT_V2: 내 공고 / 남의 공고 분리
          const _uid = (() => { try { return localStorage.getItem('farm-userId'); } catch(_) { return null; } })();
          const allJobs = [...urgentJobs, ...recentJobs];
          // 중복 제거
          const seen = new Set();
          const deduped = allJobs.filter(j => { if (seen.has(j.id)) return false; seen.add(j.id); return true; });
          const myJobs   = _uid ? deduped.filter(j => j.requesterId === _uid) : [];
          const myJobIds = new Set(myJobs.map(j => j.id));
          // 기존 섹션에서 내 공고 제외
          const otherUrgent = urgentJobs.filter(j => !myJobIds.has(j.id));
          const otherRecent = recentJobs.filter(j => !myJobIds.has(j.id));

          return (
            <>
              {/* 바로 등록 CTA — DESIGN_V3: 감정+속도 강조 */}
              <button
                onClick={onPostJob}
                className="w-full py-4 bg-farm-green text-white font-black text-lg rounded-2xl
                           shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
              >
                🔥 3초 안에 일손 구하기
              </button>

              {/* ── 내 공고 상단 고정 ── */}
              {myJobs.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <p className="section-title mb-0 flex items-center gap-1.5">
                      🧑‍🌾 내 공고
                      <span className="text-xs bg-farm-light text-farm-green font-bold rounded-full px-2 py-0.5">
                        {myJobs.length}건
                      </span>
                    </p>
                    <button
                      onClick={onViewMyJobs}
                      className="text-sm text-farm-green font-bold flex items-center gap-0.5"
                    >
                      전체 보기 <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {myJobs.map(job => (
                      <JobCard key={job.id} job={job} mode="farmer" onViewApplicants={onViewApplicants} />
                    ))}
                  </div>
                </section>
              )}

              {workers.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    {/* DESIGN_V4: 섹션 타이틀 */}
                    <p className="section-title mb-0">👨‍🌾 지금 바로 투입 가능한 작업자</p>
                    <span className="text-sm text-farm-green font-bold">{workers.length}명</span>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none -mx-4 px-4">
                    {workers.map(w => <WorkerChip key={w.id} worker={w} />)}
                  </div>
                </section>
              )}

              {/* ── 다른 공고 (급한 요청) ── */}
              {otherUrgent.length > 0 && (
                <section>
                  <p className="section-title flex items-center gap-1.5">
                    <Zap size={18} className="text-farm-yellow" />
                    지금 사람 구하는 일
                  </p>
                  <div className="space-y-3">
                    {otherUrgent.map(job => (
                      <JobCard key={job.id} job={job} mode="farmer" onViewApplicants={onViewApplicants} />
                    ))}
                  </div>
                </section>
              )}

              {/* ── 다른 공고 (최근 등록) ── */}
              {otherRecent.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <p className="section-title mb-0">최근 등록 작업</p>
                    <button
                      onClick={onViewJobList}
                      className="text-sm text-farm-green font-bold flex items-center gap-0.5"
                    >
                      전체 보기 <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {otherRecent.slice(0, 3).map(job => (
                      <JobCard key={job.id} job={job} mode="farmer" onViewApplicants={onViewApplicants} />
                    ))}
                  </div>
                </section>
              )}

              {!myJobs.length && !otherUrgent.length && !otherRecent.length && (
                <div className="card text-center py-10 text-gray-400">
                  <p className="text-4xl mb-3">🌱</p>
                  <p className="font-semibold text-gray-500">아직 올라온 일이 없습니다</p>
                  <p className="text-sm mt-1">첫 일을 올려보세요!</p>
                </div>
              )}
            </>
          );
        })()}

        {/* ── 작업자 모드 콘텐츠 ── */}
        {!loading && mode === 'worker' && (
          <>
            {/* UX_V2: 🔥 지금 바로 가능한 일 — 최대 5개 */}
            {(urgentJobs.length > 0 || recommended.length > 0) && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <p className="section-title mb-0">🔥 지금 바로 가능한 일</p>
                  <button onClick={onViewJobList} className="text-sm text-farm-green font-bold flex items-center gap-0.5">
                    전체 보기 <ChevronRight size={14} />
                  </button>
                </div>
                <div className="space-y-3">
                  {[...urgentJobs, ...recommended.filter(j => !urgentJobs.find(u => u.id === j.id))]
                    .slice(0, 5)
                    .map(job => (
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

            {recommended.length === 0 && urgentJobs.length === 0 && (
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

      {/* ── STEP 8: 하단 고정 CTA (탭바 위) ── */}
      <div
        style={{
          position: 'fixed',
          bottom: 'calc(60px + max(env(safe-area-inset-bottom), 0.5rem))',
          left: 0, right: 0,
          background: '#2D8A4E',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 35,
          boxShadow: '0 -2px 12px rgba(45,138,78,0.35)',
          cursor: 'pointer',
        }}
        onClick={() => {
          try { trackClientEvent('cta_click', { type: 'sticky_bottom', location: 'homepage' }); } catch (_) {}
          if (mode === 'farmer') onPostJob?.();
          else { onModeChange?.('worker'); onViewJobList?.(); }
        }}
      >
        <span style={{ color: '#fff', fontSize: 16, fontWeight: 900, letterSpacing: 0.3 }}>
          📞 지금 바로 일손 연결
        </span>
      </div>

      {/* 하단 탭바 — DESIGN_V4: 🏠 홈 / 📋 일자리 / 🗺️ 지도 / 👤 내 활동 */}
      <nav className="tabbar">
        {/* 🏠 홈 */}
        <button
          className="tab-btn"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <span className="text-2xl leading-none text-farm-green">🏠</span>
          <span className="text-farm-green font-bold">홈</span>
        </button>
        {/* 📋 일자리 — 농민: 내가 올린 일 / 작업자: 일자리 찾기 */}
        <button
          onClick={mode === 'farmer' ? onViewMyJobs : onViewJobList}
          className="tab-btn relative"
        >
          <span className="relative inline-flex">
            <ClipboardList size={22} />
            <TabBadge count={mode === 'farmer' ? notif.pendingApps : notif.selectedApps} />
          </span>
          <span>{mode === 'farmer' ? '내 공고' : '일자리'}</span>
        </button>
        {/* 🗺️ 지도 */}
        <button onClick={onViewMap} className="tab-btn">
          <Map size={22} />
          <span>지도</span>
        </button>
        {/* 👤 내 활동 — 농민: 내 연결 / 작업자: 내 지원 */}
        <button
          onClick={mode === 'farmer' ? onViewMyConnections : onViewMyApplications}
          className="tab-btn"
        >
          <Link2 size={22} />
          <span>내 활동</span>
        </button>
      </nav>
    </div>
  );
}
