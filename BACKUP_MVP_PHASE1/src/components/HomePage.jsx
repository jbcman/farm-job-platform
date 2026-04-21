import React, { useEffect, useState } from 'react';
import {
  PlusCircle, ClipboardList, BookOpen,
  Zap, ChevronRight, Loader2, Star, MapPin, Link2
} from 'lucide-react';
import { getJobs, getNearbyWorkers, trackClientEvent } from '../utils/api.js';
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

export default function HomePage({
  mode, onModeChange,
  onPostJob, onViewJobList,
  onViewMyJobs, onViewMyApplications,
  onViewApplicants, onViewMyConnections,
}) {
  const [urgentJobs,   setUrgentJobs]   = useState([]);
  const [recentJobs,   setRecentJobs]   = useState([]);
  const [workers,      setWorkers]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [gpsStatus,    setGpsStatus]    = useState('idle');
  const [showOnboard,  setShowOnboard]  = useState(false);

  // 최초 1회 온보딩
  useEffect(() => {
    if (!localStorage.getItem('farm-onboarded')) {
      setShowOnboard(true);
    }
  }, []);

  useEffect(() => {
    const loc = getStoredLocation();
    setLoading(true);

    Promise.all([
      getJobs({ lat: loc?.lat, lon: loc?.lon, radius: loc ? 50 : 500 }),
      getNearbyWorkers({ lat: loc?.lat, lon: loc?.lon }),
    ]).then(([jobsRes, workersRes]) => {
      const all = jobsRes.jobs || [];
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
      <header className="bg-farm-green px-4 pt-safe pt-5 pb-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-black text-white tracking-tight">🌾 농민일손</h1>
          <div className="flex items-center gap-1.5">
            {gpsStatus === 'ok' && (
              <span className="flex items-center gap-1 text-xs bg-white/20 text-green-100 rounded-full px-2 py-0.5">
                <MapPin size={10} /> 내 위치
              </span>
            )}
            {gpsStatus === 'denied' && (
              <span className="text-xs text-green-300">전국 표시</span>
            )}
            <p className="text-green-200 text-sm">바로 연결, 빠르게 해결</p>
          </div>
        </div>

        {/* 모드 토글 */}
        <div className="bg-white/20 rounded-2xl p-1 flex">
          <button
            onClick={() => onModeChange('farmer')}
            className={`flex-1 py-3 rounded-xl font-bold text-base transition-all ${
              mode === 'farmer' ? 'bg-white text-farm-green shadow-sm' : 'text-white'
            }`}
          >
            일 맡기기
          </button>
          <button
            onClick={() => onModeChange('worker')}
            className={`flex-1 py-3 rounded-xl font-bold text-base transition-all ${
              mode === 'worker' ? 'bg-white text-farm-green shadow-sm' : 'text-white'
            }`}
          >
            일 찾기
          </button>
        </div>
      </header>

      {/* 🔥 긴급 배너 */}
      {!loading && urgentJobs.length > 0 && (
        <button
          onClick={mode === 'farmer' ? onViewMyJobs : onViewJobList}
          className="w-full bg-red-500 text-white px-4 py-3 flex items-center justify-between
                     text-sm font-bold"
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

        {/* ── 농민 모드 ── */}
        {!loading && mode === 'farmer' && (
          <>
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
              <div className="card text-center py-12 text-gray-400">
                <p className="text-4xl mb-3">🌱</p>
                <p className="font-semibold text-gray-500">아직 올라온 일이 없습니다</p>
                <p className="text-sm mt-1 mb-4">첫 일을 올려보세요!</p>
                <button
                  onClick={onPostJob}
                  className="btn-primary px-6 py-3 text-base"
                >
                  + 첫 일 올리기
                </button>
              </div>
            )}
          </>
        )}

        {/* ── 작업자 모드 ── */}
        {!loading && mode === 'worker' && (
          <>
            {urgentJobs.length > 0 && (
              <section>
                <p className="section-title flex items-center gap-1.5">
                  <Zap size={18} className="text-farm-yellow" />
                  오늘 급구 작업
                </p>
                <div className="space-y-3">
                  {urgentJobs.slice(0, 2).map(job => (
                    <JobCard key={job.id} job={job} mode="worker" onApply={() => onViewJobList?.()} />
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="flex items-center justify-between mb-3">
                <p className="section-title mb-0">지금 가능한 일</p>
                <button
                  onClick={onViewJobList}
                  className="text-sm text-farm-green font-bold flex items-center gap-0.5"
                >
                  전체 보기 <ChevronRight size={14} />
                </button>
              </div>
              <div className="space-y-3">
                {[...urgentJobs, ...recentJobs].slice(0, 3).map(job => (
                  <JobCard key={job.id} job={job} mode="worker" onApply={() => onViewJobList?.()} />
                ))}
              </div>
              {urgentJobs.length === 0 && recentJobs.length === 0 && (
                <div className="card text-center py-10 text-gray-400">
                  <p className="text-4xl mb-2">🌿</p>
                  <p className="text-gray-500">아직 올라온 일이 없습니다</p>
                  <p className="text-sm text-gray-400 mt-1">나중에 다시 확인해보세요</p>
                </div>
              )}
            </section>
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
