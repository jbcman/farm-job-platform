import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowLeft, Loader2, MapPin, Phone, Navigation } from 'lucide-react';
import { getJobs, getMyJobs, getMyApplications, applyJob, startJob, completeJob, closeJob, getNearbyJobs, getJobContact, rematchJob, getUserId } from '../utils/api.js';
import { logTestEvent, logCallTriggered, logClickFail, logCheckpoint } from '../utils/testLogger.js'; // REAL_USER_TEST
import { filterUrgentOnly } from '../utils/sortJobs.js';
import { sortJobsByRecommend, RECOMMEND_BADGE_THRESHOLD } from '../utils/recommendJobs.js';
import { getUserProfile, saveUserInteraction } from '../utils/userProfile.js';
import { connectWS } from '../services/ws.js';
import { useUserLocation } from '../hooks/useUserLocation.js';
import JobCard from './JobCard.jsx';
import ReviewModal from './ReviewModal.jsx';
import PostApplySheet from './PostApplySheet.jsx';
import FilterModal from './FilterModal.jsx';
import { getBehaviorScore, getHotJobIds } from '../utils/behaviorScore.js';

const CATEGORIES = ['전체', '밭갈이', '로터리', '두둑', '방제', '수확 일손', '예초'];

// ── SMART_V3: 시간대 기반 추천 카테고리 + 이유 ─────────────────
function getSmartCategories() {
  const hour = new Date().getHours();
  if (hour < 12) return ['밭갈이', '로터리'];
  if (hour < 18) return ['수확', '방제'];
  return ['방제', '예초'];
}
function getSmartReason() {
  const hour = new Date().getHours();
  if (hour < 12) return { label: '🌅 오전 작업 추천', desc: `오전이라 ${getSmartCategories().join('·')} 추천 중` };
  if (hour < 18) return { label: '☀️ 오후 작업 추천', desc: `오후라 ${getSmartCategories().join('·')} 추천 중` };
  return { label: '🌙 야간 작업 추천', desc: `저녁이라 ${getSmartCategories().join('·')} 추천 중` };
}

/**
 * SMART_V4: 스마트 점수
 *   urgent      +50  (급구/오늘)
 *   근거리 ≤5km +30
 *   시간대 일치 +20
 *   클릭 횟수   ×10  (내 행동)
 *   전화 횟수   ×30  (내 행동 — 가장 강한 신호)
 */
function smartScore(job) {
  let score = 0;
  if (job.isUrgent || job.isToday) score += 50;
  const km = job.distKm;
  if (km != null && Number.isFinite(km) && km <= 5) score += 30;
  const smartCats = getSmartCategories();
  if (smartCats.includes(job.category)) score += 20;
  score += getBehaviorScore(job.id);   // 클릭×10 + 전화×30
  return score;
}

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
/** 지원 상태 배지 — job.status와 조합하여 결정 */
function getAppStatus(appStatus, jobStatus) {
  if (appStatus === 'selected') {
    return jobStatus === 'closed'
      ? { label: '연결 완료',      cls: 'bg-blue-50  text-blue-700'  }
      : { label: '연락 가능합니다', cls: 'bg-green-50 text-green-700' };
  }
  if (jobStatus === 'closed') {
    return { label: '마감됨', cls: 'bg-red-50 text-red-600' };
  }
  if (appStatus === 'rejected') {
    return { label: '미선택', cls: 'bg-gray-100 text-gray-500' };
  }
  return { label: '선택 대기중', cls: 'bg-amber-50 text-amber-700' };
}

export default function JobListPage({ userId, myJobsMode, myApplicationsMode, onBack, onViewApplicants, onViewJobDetail, onCopyJob }) {
  const [jobs,         setJobs]         = useState([]);
  const [applications, setApplications] = useState([]); // myApplicationsMode 전용
  const [loading,      setLoading]      = useState(true);
  const [category,     setCategory]     = useState('전체');
  const [applied,      setApplied]      = useState(new Set());
  const [toast,        setToast]        = useState('');
  const [error,        setError]        = useState('');
  const [reviewJob,    setReviewJob]    = useState(null); // ReviewModal 대상
  // UI_INTEGRATION: 지원 후 강제 행동 시트
  const [postApply,    setPostApply]    = useState(null); // { phone, jobName }
  // PHASE 18: 급구 필터 (일반 목록 전용)
  const [urgentOnly,   setUrgentOnly]   = useState(false);
  // PHASE NEARBY_MATCH: 내 근처 필터
  const [nearbyMode,    setNearbyMode]    = useState(false);
  const [nearbyJobs,    setNearbyJobs]    = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  // FILTER_V1: 다중 카테고리 선택 + 모달
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [showFilterModal,    setShowFilterModal]    = useState(false);
  // SMART_V2: 자동 추천 상태 (true = 시스템 추천 활성)
  const [smartMode, setSmartMode] = useState(false);
  // FINAL POLISH: localStorage에서 마지막 사용 반경 복원
  const [radius, setRadius] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem('nearby_radius'), 10);
      return [3, 5, 10].includes(saved) ? saved : 3;
    } catch { return 3; }
  });

  // AB_TEST: 세션 내 impression 중복 방지 (jobId Set)
  const impressedIds = useRef(new Set());

  const loc = getStoredLocation();
  const { location: gpsLoc } = useUserLocation();

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
        .then(d => {
          setJobs(d.jobs || []);
          logTestEvent('worker_view_jobs', { count: (d.jobs || []).length, category: cat || '전체' }); // REAL_USER_TEST STEP 4
        })
        .catch(e => {
          setError(e.message);
          logClickFail('view_jobs', e.message); // REAL_USER_TEST STEP 5
        })
        .finally(() => setLoading(false));
    }
  }, [myJobsMode, myApplicationsMode, userId, category]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // REALTIME_ROOM_V2: WS 구독 + 룸 join (내 작업 목록 자동 구독)
  useEffect(() => {
    const handle = connectWS((data) => {
      // SSOT: job_update — 서버에서 내려온 완전한 job 객체로 덮어쓰기
      if (data.type === 'job_update' && data.job) {
        setJobs(prev => prev.map(j => j.id === data.job.id ? { ...j, ...data.job } : j));
        return;
      }
      // 레거시 이벤트 하위호환
      if (data.type === 'job_completed') {
        setJobs(prev => prev.map(j =>
          j.id === data.jobId
            ? { ...j, status: 'completed', paid: true, payAmount: data.payAmount, completedAt: data.completedAt }
            : j
        ));
      }
      if (data.type === 'job_rescheduled') {
        setJobs(prev => prev.map(j =>
          j.id === data.jobId ? { ...j, scheduledAt: data.scheduledAt } : j
        ));
      }
      if (data.type === 'job_matched') {
        setJobs(prev => prev.map(j =>
          j.id === data.jobId ? { ...j, status: 'matched', selectedWorkerId: data.workerId } : j
        ));
      }
    });
    return () => handle.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // REALTIME_ROOM_V2: 내 작업 목록 변경 시 룸 구독 갱신
  const wsHandleRef = React.useRef(null);
  useEffect(() => {
    if (!myJobsMode || !userId) return;
    // jobs 목록에서 내 jobId 추출 후 룸 구독
    const handle = connectWS(() => {}); // 구독용 별도 연결 (jobId join 전용)
    wsHandleRef.current = handle;
    jobs.forEach(j => handle.joinJob(j.id));
    return () => handle.close();
  }, [jobs.map(j => j.id).join(','), myJobsMode, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // FALLBACK_POLL: WS 불안정 환경 대비 5초 폴링
  useEffect(() => {
    if (!myJobsMode && !myApplicationsMode) return;
    const t = setInterval(() => { load(); }, 5000);
    return () => clearInterval(t);
  }, [myJobsMode, myApplicationsMode, load]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  // ── PHASE NEARBY_MATCH: 내 근처 일자리 ─────────────────────────

  /** 핵심 fetcher — 반경(km) 지정하여 호출 가능, 토글 로직 없음 */
  async function runNearby(useLoc, km) {
    if (!useLoc) return false;
    setNearbyLoading(true);
    try {
      const data = await getNearbyJobs(useLoc.lat, useLoc.lng, km);
      const jobs = data.jobs || [];

      if (jobs.length === 0) {
        // ── FINAL BOOST: 빈 결과 자동 fallback ──────────────────
        // ① 3km → 5km 자동 확장
        if (km === 3) {
          const wider = await getNearbyJobs(useLoc.lat, useLoc.lng, 5);
          if ((wider.jobs || []).length > 0) {
            setRadius(5);
            setNearbyJobs(wider.jobs);
            setNearbyMode(true);
            showToast(`📍 5km로 넓혀서 ${wider.jobs.length}건 찾았어요!`);
            return true;
          }
        }
        // ② 여전히 없음 → 전체 목록 유지 (이탈 방지)
        showToast('근처 일자리가 없어 전체 목록을 보여드려요.');
        setNearbyMode(false);
        return false;
      }

      setNearbyJobs(jobs);
      setNearbyMode(true);
      return true;
    } catch (e) {
      showToast('근처 일자리를 불러오지 못했어요.');
      return false;
    } finally {
      setNearbyLoading(false);
    }
  }

  /** 버튼 클릭 핸들러 — 토글 동작 */
  async function handleNearby() {
    if (nearbyMode) {
      setNearbyMode(false); // 이미 근처 모드 → 전체로
      return;
    }
    const useLoc = gpsLoc || (loc ? { lat: loc.lat, lng: loc.lon } : null);
    if (!useLoc) {
      showToast('📍 위치 정보가 없어요. GPS를 허용해주세요.');
      return;
    }
    await runNearby(useLoc, radius);
  }

  /** 반경 변경 버튼 — 즉시 재조회 + localStorage 저장 */
  async function handleRadiusChange(km) {
    setRadius(km);
    try { localStorage.setItem('nearby_radius', String(km)); } catch (_) {}
    const useLoc = gpsLoc || (loc ? { lat: loc.lat, lng: loc.lon } : null);
    if (!useLoc || !nearbyMode) return;
    await runNearby(useLoc, km);
  }

  // ── FINAL BOOST: 앱 진입 시 최초 1회 자동 실행 (sessionStorage guard) ──
  useEffect(() => {
    // 공개 작업자 목록에서만, myJobsMode/myApplicationsMode 제외
    if (myJobsMode || myApplicationsMode) return;
    if (!gpsLoc) return; // GPS 준비 안 됐으면 대기
    if (sessionStorage.getItem('nearby_auto_run')) return; // 이미 실행됨
    sessionStorage.setItem('nearby_auto_run', '1');
    runNearby(gpsLoc, radius);
  }, [gpsLoc]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SMART_V3: 첫 진입 자동 추천 (시간대 기반, 1회) ──────────────
  useEffect(() => {
    if (myJobsMode || myApplicationsMode) return;
    if (sessionStorage.getItem('smart_auto_run')) return;
    sessionStorage.setItem('smart_auto_run', '1');
    setSelectedCategories(getSmartCategories());
    setSmartMode(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // BACK_NAV: 스크롤 위치 저장/복원
  const SCROLL_KEY = 'farm-listScroll';
  useEffect(() => {
    // 마운트 시 저장된 스크롤 복원
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: Number(saved), behavior: 'instant' });
      });
      sessionStorage.removeItem(SCROLL_KEY); // 1회 복원 후 삭제
    }
    // 스크롤 이벤트 저장 (상세 이동 직전 포지션 기록)
    const onScroll = () => {
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** SMART_V3: 🤖 추천 버튼 핸들러 */
  function applySmartFilter() {
    setSelectedCategories(getSmartCategories());
    setUrgentOnly(true);
    setSmartMode(true);
  }

  // ── 작업자: 지원하기 ──────────────────────────────────────────
  async function handleApply(job) {
    try {
      await applyJob(job.id, { workerId: userId, message: '' });
      setApplied(prev => new Set([...prev, job.id]));
      showToast(`${job.category} 신청됐어요!`);
      // REAL_USER_TEST: 작업자 지원 완료
      logTestEvent('worker_apply', { jobId: job.id, category: job.category });
      logCheckpoint('apply_done', { jobId: job.id });
      // PHASE 19: 지원 행동으로 추천 프로필 업데이트
      try { saveUserInteraction(job); } catch (_) {}

      // UI_INTEGRATION: 지원 직후 연락처 조회 → PostApplySheet 강제 행동 유도
      try {
        const res = await getJobContact(job.id, userId);
        const phone = res?.phoneFull || res?.phoneMasked || null;
        setPostApply({ phone, jobName: job.category, jobId: job.id, job });
      } catch (_) {
        setPostApply({ phone: null, jobName: job.category, jobId: job.id, job });
      }
      // PHASE FARMER_PAY_UX: 긴급 유료 공고면 결제 리마인드 localStorage 마킹
      if (job.isUrgentPaid && job.payStatus !== 'paid') {
        try {
          localStorage.setItem('farm-payPending', JSON.stringify({
            jobId:       job.id,
            category:    job.category,
            requestedAt: Date.now(),
          }));
        } catch (_) {}
      }
    } catch (e) {
      logClickFail('apply_job', e.message); // REAL_USER_TEST STEP 5
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
      // REAL_USER_TEST: 농민 작업 완료
      logTestEvent('farmer_complete_job', { jobId: job.id, category: job.category });
      logCheckpoint('complete_done', { jobId: job.id });
      // PHASE RETENTION: 리뷰 유도용 localStorage 마킹
      try {
        localStorage.setItem('farm-pendingReview', JSON.stringify({
          jobId:       job.id,
          category:    job.category,
          completedAt: Date.now(),
        }));
      } catch (_) {}
      load();
      setReviewJob(job); // 완료 후 리뷰 모달 자동 팝업
    } catch (e) {
      showToast(e.message);
    }
  }

  // ── PHASE 7: 농민 → 입금 완료 처리 (done → paid) ──────────────
  async function handleMarkPaid(job) {
    try {
      const res = await fetch(`/api/jobs/${job.id}/mark-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requesterId: userId }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || '입금 처리 실패');
      showToast('💰 입금 완료 처리됐어요!');
      load();
    } catch (e) {
      showToast(e.message);
    }
  }

  // ── 농민: 재매칭 ─────────────────────────────────────────────
  async function handleRematch(job) {
    try {
      const res = await rematchJob(job.id, userId);
      showToast(res.count > 0
        ? `👥 ${res.count}명에게 재매칭 알림을 보냈어요!`
        : '재매칭 가능한 지원자가 없습니다.');
    } catch (e) {
      showToast(e.message || '재매칭 요청에 실패했어요.');
    }
  }

  // ── 농민: 마감하기 ───────────────────────────────────────────
  async function handleClose(job) {
    if (!window.confirm(`"${job.category}" 일자리를 마감할까요?\n마감 후에는 새 지원을 받을 수 없습니다.`)) return;
    try {
      await closeJob(job.id, userId);
      showToast('마감되었어요.');
      load();
    } catch (e) {
      showToast(e.message);
    }
  }

  const title = myApplicationsMode ? '내 지원 현황' : myJobsMode ? '내 요청 관리' : '지금 가능한 일';
  const mode  = myJobsMode ? 'farmer' : 'worker';

  // FILTER_V1: 다중 카테고리 제거 핸들러
  const removeCategory = (cat) => {
    setSelectedCategories(prev => prev.filter(c => c !== cat));
  };

  // FILTER_V1: 전체 초기화 (smartMode도 해제)
  const clearFilters = () => {
    setSelectedCategories([]);
    setUrgentOnly(false);
    setSmartMode(false);
  };

  // PHASE 16+18+19+FILTER_V1: 일반 목록 → 급구 필터 → 카테고리 다중필터 → 추천 정렬
  const isPublicList = !myJobsMode && !myApplicationsMode;
  const userProfile  = isPublicList ? getUserProfile() : {};

  function applyFilters(list) {
    let result = filterUrgentOnly(list, urgentOnly);
    if (selectedCategories.length > 0) {
      result = result.filter(j => selectedCategories.includes(j.category));
    }
    return result;
  }

  // SMART_V3: smartMode일 때 스코어 기반 정렬, 아니면 기존 추천 정렬
  function sortForDisplay(list) {
    if (smartMode) {
      return [...list].sort((a, b) => smartScore(b) - smartScore(a));
    }
    return sortJobsByRecommend(list, userProfile);
  }

  const displayJobs = isPublicList
    ? nearbyMode
      ? applyFilters(nearbyJobs)
      : sortForDisplay(applyFilters(jobs))
    : jobs;

  const urgentCount = isPublicList ? jobs.filter(j => j.isUrgent).length : 0;
  const listCount   = myApplicationsMode ? applications.length : displayJobs.length;

  // AB_TEST: 작업자 공개 목록 노출 시 impression 기록 (세션 내 jobId당 1회)
  useEffect(() => {
    if (!isPublicList || !userId || displayJobs.length === 0) return;
    const newJobs = displayJobs.filter(j => !impressedIds.current.has(j.id));
    if (newJobs.length === 0) return;
    newJobs.forEach(j => {
      impressedIds.current.add(j.id);
      fetch('/api/behavior', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({
          jobId:   j.id,
          action:  'impression',
          jobType: j.category || null,
          lat:     j.latitude  ?? null,
          lng:     j.longitude ?? null,
        }),
      }).catch(() => {});
    });
  }, [displayJobs, isPublicList, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // v4: sort state
  const [sortBy, setSortBy] = useState('거리순');

  return (
    <div className="min-h-screen bg-farm-bg pb-8">
      {/* ── v4 헤더: 녹색 배경 + 검색바 + 필터 칩 ── */}
      <header className="pt-safe sticky top-0 z-30"
        style={{ background: '#2d8a4e' }}>

        {/* 상단: 뒤로가기 + 타이틀 + 건수 */}
        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          <button onClick={onBack} className="flex items-center gap-1 text-white active:scale-90 transition-transform px-1 py-1">
            <ArrowLeft size={20} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>홈</span>
          </button>
          <div className="flex-1">
            <h1 style={{ fontFamily: "'Jalnan2','Noto Sans KR',sans-serif", fontSize: 18, color: '#fff', margin: 0 }}>
              {title}
            </h1>
            {!myJobsMode && !myApplicationsMode && (loc || gpsLoc) && (
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 3 }}>
                {nearbyMode
                  ? <><Navigation size={10} /> {radius}km 내 결과</>
                  : <><MapPin size={10} /> 내 위치 기준</>
                }
              </p>
            )}
          </div>
          <span style={{ background: 'rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.9)', borderRadius: 9999, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>
            📍 {listCount}건
          </span>
        </div>

        {/* 검색바 (작업자 공개 목록 전용) */}
        {!myJobsMode && !myApplicationsMode && (
          <div className="px-4 pb-2">
            <div style={{
              background: 'rgba(255,255,255,0.15)',
              borderRadius: 12,
              padding: '9px 13px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              border: '1px solid rgba(255,255,255,0.2)',
            }}>
              <span style={{ fontSize: 14 }}>🔍</span>
              <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>지역 또는 작업 종류 검색</span>
            </div>
          </div>
        )}

        {/* FILTER_V1: 핵심 4개 칩 + 반경 서브 칩 (작업자 공개 목록) */}
        {!myJobsMode && !myApplicationsMode && (
          <>
            {/* 메인 필터 칩 행 */}
            <div className="flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-none">
              {/* 내 근처 */}
              <button
                onClick={handleNearby}
                disabled={nearbyLoading}
                style={{
                  flexShrink: 0,
                  padding: '5px 12px',
                  borderRadius: 9999,
                  fontWeight: 700,
                  fontSize: 12,
                  background: nearbyMode ? '#fff' : 'transparent',
                  color: nearbyMode ? '#2d8a4e' : 'rgba(255,255,255,0.85)',
                  border: nearbyMode ? '2px solid #fff' : '2px solid rgba(255,255,255,0.4)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                  opacity: nearbyLoading ? 0.6 : 1,
                }}
              >
                {nearbyLoading ? <Loader2 size={11} className="animate-spin" /> : <Navigation size={11} />}
                {nearbyMode ? '전체 보기' : '내 근처'}
              </button>

              {/* 🔥 급구 */}
              <button
                onClick={() => setUrgentOnly(v => !v)}
                style={{
                  flexShrink: 0,
                  padding: '5px 12px',
                  borderRadius: 9999,
                  fontWeight: 700,
                  fontSize: 12,
                  background: urgentOnly ? '#dc2626' : 'transparent',
                  color: urgentOnly ? '#fff' : 'rgba(255,255,255,0.85)',
                  border: urgentOnly ? '2px solid #dc2626' : '2px solid rgba(255,255,255,0.4)',
                  cursor: 'pointer',
                }}
              >🔥 급구{urgentCount > 0 && !urgentOnly ? ` ${urgentCount}` : ''}</button>

              {/* 전체 (필터 초기화) */}
              {(urgentOnly || selectedCategories.length > 0) && (
                <button
                  onClick={clearFilters}
                  style={{
                    flexShrink: 0,
                    padding: '5px 12px',
                    borderRadius: 9999,
                    fontWeight: 700,
                    fontSize: 12,
                    background: 'rgba(255,255,255,0.15)',
                    color: 'rgba(255,255,255,0.85)',
                    border: '2px solid rgba(255,255,255,0.4)',
                    cursor: 'pointer',
                  }}
                >✕ 초기화</button>
              )}

              {/* 🤖 추천 버튼 */}
              <button
                onClick={applySmartFilter}
                style={{
                  flexShrink: 0,
                  padding: '5px 12px',
                  borderRadius: 9999,
                  fontWeight: 700,
                  fontSize: 12,
                  background: smartMode ? '#f59e0b' : 'transparent',
                  color: smartMode ? '#fff' : 'rgba(255,255,255,0.85)',
                  border: smartMode ? '2px solid #f59e0b' : '2px solid rgba(255,255,255,0.4)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                🤖 추천
              </button>

              {/* 🗂 종류 (카테고리 모달) */}
              <button
                onClick={() => { setShowFilterModal(true); setSmartMode(false); }}
                style={{
                  flexShrink: 0,
                  padding: '5px 12px',
                  borderRadius: 9999,
                  fontWeight: 700,
                  fontSize: 12,
                  background: selectedCategories.length > 0 && !smartMode ? '#fff' : 'transparent',
                  color: selectedCategories.length > 0 && !smartMode ? '#2d8a4e' : 'rgba(255,255,255,0.85)',
                  border: selectedCategories.length > 0 && !smartMode ? '2px solid #fff' : '2px solid rgba(255,255,255,0.4)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                🗂 종류{selectedCategories.length > 0 && !smartMode ? ` ${selectedCategories.length}` : ''}
              </button>
            </div>

            {/* 반경 서브 칩 (nearbyMode일 때만) */}
            {nearbyMode && (
              <div className="flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-none">
                {[3, 5, 10].map(km => (
                  <button
                    key={km}
                    onClick={() => handleRadiusChange(km)}
                    disabled={nearbyLoading}
                    style={{
                      flexShrink: 0,
                      padding: '4px 10px',
                      borderRadius: 9999,
                      fontWeight: 700,
                      fontSize: 11,
                      background: radius === km ? '#fff' : 'transparent',
                      color: radius === km ? '#2d8a4e' : 'rgba(255,255,255,0.85)',
                      border: radius === km ? '2px solid #fff' : '2px solid rgba(255,255,255,0.4)',
                      cursor: 'pointer',
                    }}
                  >{km}km</button>
                ))}
              </div>
            )}

            {/* SMART_V4: 추천 이유 배너 (행동 데이터 있으면 문구 변경) */}
            {smartMode && selectedCategories.length > 0 && (() => {
              const reason   = getSmartReason();
              const hotIds   = getHotJobIds();
              const hasHuman = hotIds.length > 0;
              return (
                <div style={{
                  margin: '0 16px 6px',
                  padding: '7px 12px',
                  borderRadius: 10,
                  background: hasHuman
                    ? 'rgba(37,99,235,0.18)'
                    : 'rgba(245,158,11,0.18)',
                  border: `1px solid ${hasHuman ? 'rgba(37,99,235,0.4)' : 'rgba(245,158,11,0.45)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}>
                  <div>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', display: 'block' }}>
                      {hasHuman ? '👥 사람 흔적 기반' : reason.label}
                    </span>
                    <span style={{ fontSize: 11, color: '#fff', fontWeight: 800 }}>
                      🤖 {hasHuman
                        ? `사람들이 많이 선택한 작업 · ${selectedCategories.join('·')}`
                        : reason.desc}
                    </span>
                  </div>
                  <button
                    onClick={clearFilters}
                    style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
                  >
                    전체 보기
                  </button>
                </div>
              );
            })()}

            {/* 선택된 카테고리 태그 표시 행 */}
            {selectedCategories.length > 0 && (
              <div className="flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-none">
                {selectedCategories.map(cat => (
                  <span
                    key={cat}
                    onClick={() => removeCategory(cat)}
                    style={{
                      flexShrink: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'rgba(255,255,255,0.9)',
                      color: '#2d8a4e',
                      padding: '3px 10px',
                      borderRadius: 9999,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {cat} <span style={{ fontSize: 10, opacity: 0.7 }}>✕</span>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </header>

      {/* ── v4 정렬 바 (작업자 공개 목록 전용) ── */}
      {!myJobsMode && !myApplicationsMode && (
        <div style={{
          background: '#fff',
          padding: '8px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #f0f0f0',
        }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>{listCount}개의 일자리</span>
          <div style={{ display: 'flex', gap: 12 }}>
            {['거리순', '급구 우선', '일당 높은순'].map(s => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                style={{
                  fontSize: 12,
                  color: sortBy === s ? '#2d8a4e' : '#9ca3af',
                  fontWeight: sortBy === s ? 800 : 400,
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                }}
              >{s}</button>
            ))}
          </div>
        </div>
      )}

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
              const statusInfo = getAppStatus(a.status, job.status);
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
            <p className="text-4xl mb-3">🌾</p>
            <p className="font-semibold text-gray-500">
              {myJobsMode ? '등록한 작업이 없어요' : '주변에 일자리가 없어요'}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {myJobsMode ? '홈에서 새 작업을 등록해보세요' : '조금 더 넓게 찾아볼까요?'}
            </p>
          </div>
        )}

        {error && (
          <div className="card bg-red-50 text-red-600 text-sm py-3 text-center">{error}</div>
        )}

        {!myApplicationsMode && displayJobs.map(job => (
          <div key={job.id} style={{ position: 'relative' }}>
            {/* PHASE 19: 추천 배지 — 카드 우상단 플로팅 */}
            {isPublicList && (job._score ?? 0) >= RECOMMEND_BADGE_THRESHOLD && (
              <div style={{
                position: 'absolute', top: 10, right: 10, zIndex: 10,
                background: '#2563eb', color: '#fff',
                fontSize: 10, fontWeight: 800, borderRadius: 99,
                padding: '2px 8px', letterSpacing: 0.2,
                boxShadow: '0 2px 6px rgba(37,99,235,.35)',
              }}>
                ⭐ 추천
              </div>
            )}
            <JobCard
              job={job}
              mode={mode}
              userId={userId}
              applied={applied.has(job.id)}
              onApply={handleApply}
              onViewApplicants={onViewApplicants}
              onStartJob={handleStart}
              onCompleteJob={handleComplete}
              onMarkPaid={myJobsMode ? handleMarkPaid : undefined}
              onWriteReview={setReviewJob}
              onCloseJob={myJobsMode ? handleClose : undefined}
              onCopyJob={myJobsMode ? onCopyJob : undefined}
              onViewDetail={onViewJobDetail ? (j) => onViewJobDetail(j) : undefined}
              userLocation={gpsLoc || loc}
              isSmartMatch={smartMode && selectedCategories.includes(job.category)}
            />
          </div>
        ))}
      </div>

      {/* 리뷰 모달 */}
      {reviewJob && (
        <ReviewModal
          job={reviewJob}
          reviewerRole="farmer"
          reviewerId={userId}
          targetId={reviewJob.selectedWorkerId}
          showIncentive
          onClose={() => setReviewJob(null)}
          onSubmit={() => {
            showToast('후기가 등록되었어요!');
            // PHASE RETENTION: 리뷰 작성 완료 → 유도 플래그 해제
            try { localStorage.removeItem('farm-pendingReview'); } catch (_) {}
            load();
          }}
          onReRegister={myJobsMode && onCopyJob ? (job) => onCopyJob(job) : undefined}
          onRematch={myJobsMode ? (job) => handleRematch(job) : undefined}
        />
      )}

      {/* UI_INTEGRATION: 지원 후 강제 행동 시트 */}
      {postApply && (
        <PostApplySheet
          phone={postApply.phone}
          jobName={postApply.jobName}
          jobId={postApply.jobId}
          job={postApply.job}
          onClose={() => setPostApply(null)}
        />
      )}

      {/* FILTER_V1: 카테고리 다중 선택 모달 */}
      {showFilterModal && (
        <FilterModal
          selectedCategories={selectedCategories}
          setSelectedCategories={setSelectedCategories}
          onClose={() => setShowFilterModal(false)}
        />
      )}
    </div>
  );
}
