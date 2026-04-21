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

export default function HomePage({
  mode, onModeChange,
  onPostJob, onViewJobList,
  onViewMyJobs, onViewMyApplications,
  onViewApplicants, onViewMyConnections,
  onViewJobDetail, onViewMap,
}) {
  const [urgentJobs,   setUrgentJobs]   = useState([]);
  const [recentJobs,   setRecentJobs]   = useState([]);
  const [recommended,  setRecommended]  = useState([]);   // Phase 6
  const [workers,      setWorkers]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [gpsStatus,    setGpsStatus]    = useState('idle');
  const [showOnboard,  setShowOnboard]  = useState(false);
  // Phase 11: 최근 본 일 (localStorage)
  const [viewHistory,  setViewHistory]  = useState([]);
  // Phase 12: CTA A/B 테스트 (마운트 시 1회 결정)
  const [ctaVariant,   setCtaVariant]   = useState(null);

  // 최초 1회 온보딩
  useEffect(() => {
    if (!localStorage.getItem('farm-onboarded')) {
      setShowOnboard(true);
    }
    // Phase 11: 최근 본 일 로드
    const recent = getRecentJobs().slice(0, 3);
    setViewHistory(recent);

    // Phase 12: CTA A/B 테스트 — 최근 본 일이 있을 때만 노출
    if (recent.length > 0) {
      try {
        const v = Math.random() < 0.5 ? 'A' : 'B';
        setCtaVariant(v);
        trackClientEvent('retention_cta_exposed', { variant: v });
      } catch (_) { /* fail-safe */ }
    }
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
          <h1 className="text-xl font-black text-white tracking-tight">🌾 농민일손</h1>
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

        {/* 히어로 카피 */}
        <div className="mb-5">
          <p className="text-white font-black text-2xl leading-snug mb-1">
            오늘 당장 사람<br />필요하신가요?
          </p>
          <p className="text-green-200 text-sm leading-relaxed">
            전화 돌릴 필요 없습니다<br />
            근처 일손 바로 연결됩니다
          </p>
        </div>

        {/* 모드 선택 버튼 */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => { onModeChange('farmer'); onPostJob(); }}
            className={`py-3.5 rounded-2xl font-bold text-base transition-all border-2 ${
              mode === 'farmer'
                ? 'bg-white text-farm-green border-white shadow'
                : 'bg-white/10 text-white border-white/30'
            }`}
          >
            👉 사람 구해요
          </button>
          <button
            onClick={() => { onModeChange('worker'); onViewJobList(); }}
            className={`py-3.5 rounded-2xl font-bold text-base transition-all border-2 ${
              mode === 'worker'
                ? 'bg-white text-farm-green border-white shadow'
                : 'bg-white/10 text-white border-white/30'
            }`}
          >
            👉 일 찾고 있어요
          </button>
        </div>
      </header>

      {/* 🔥 긴급 배너 */}
      {!loading && urgentJobs.length > 0 && (
        <button
          onClick={mode === 'farmer' ? onViewMyJobs : onViewJobList}
          className="w-full bg-red-500 text-white px-4 py-3 flex items-center justify-between text-sm font-bold"
        >
          <span>🔥 지금 급한 일 있습니다 ({urgentJobs.length}건)</span>
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

      {/* 하단 탭바 */}
      <nav className="tabbar">
        {mode === 'farmer' ? (
          <>
            <button onClick={onPostJob} className="tab-btn">
              <PlusCircle size={24} className="text-farm-green" />
              <span className="text-farm-green">일손 구하기</span>
            </button>
            <button onClick={onViewMyJobs} className="tab-btn">
              <ClipboardList size={22} />
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
            <button onClick={onViewMyApplications} className="tab-btn">
              <BookOpen size={22} />
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
