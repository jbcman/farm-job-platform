import React, { useState, useEffect, useRef } from 'react';
import './styles/theme.css';
import LoginPage          from './components/LoginPage.jsx';
import HomePage           from './components/HomePage.jsx';
import JobRequestPage     from './components/JobRequestPage.jsx';
import JobListPage        from './components/JobListPage.jsx';
import JobDetailPage      from './components/JobDetailPage.jsx';
import ApplicantListPage  from './components/ApplicantListPage.jsx';
import ContactRevealModal from './components/ContactRevealModal.jsx';
import MyConnectionsPage  from './components/MyConnectionsPage.jsx';
import AdminDashboard     from './components/AdminDashboard.jsx';
import JobMapView            from './components/JobMapView.jsx';
import MyApplicationsPage   from './components/MyApplicationsPage.jsx';
import PayResultPage         from './components/PayResultPage.jsx';
import OperatorPage          from './components/OperatorPage.jsx';
import MapPage               from './pages/MapPage.jsx';
import MapExplorePage        from './pages/MapExplorePage.jsx';
import RevenueDashboard      from './pages/RevenueDashboard.jsx';
import { getUserId, trackClientEvent, getNotifications } from './utils/api.js';
import { getOrCreateUser } from './utils/userProfile.js';

/**
 * App.jsx — 메인 상태 관리 + 화면 라우팅
 *
 * 화면 목록:
 *   login           → LoginPage (로그인 미완료 시)
 *   home            → HomePage
 *   post-job        → JobRequestPage
 *   job-list        → JobListPage
 *   my-jobs         → JobListPage (내 요청 필터)
 *   my-applications → JobListPage (내 지원)
 *   applicants      → ApplicantListPage
 *   my-connections  → MyConnectionsPage
 *   job-detail      → JobDetailPage (딥링크 또는 카드 클릭)
 *
 * 딥링크: /jobs/:id → 앱 진입 시 pathname 파싱 → job-detail 자동 이동
 *
 * Phase 14: 외부 접속(ngrok) 자동 진입
 *   ngrok / ngrok-free.app / ngrok.io 호스트 감지 시 게스트 유저 자동 생성
 *   → 온보딩/로그인 우회, localStorage 정상 저장, 무한 리로드 없음
 */

// STEP 2: 개발 모드 모바일 환경 권장 경고 (1회)
if (import.meta.env.DEV && typeof navigator !== 'undefined') {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (!isMobile) {
    console.warn('⚠ [FARM UX V2] 모바일 환경에서 테스트 권장 — 전환율 측정 정확도↑');
    console.log('  크롬 DevTools → Toggle device toolbar (Ctrl+Shift+M) → 모바일 시뮬레이션');
  }
}

/** /admin 경로 감지 */
function isAdminPath() {
  return window.location.pathname.startsWith('/admin');
}

/** /revenue 또는 /admin/revenue 경로 감지 — 수익 대시보드 */
function isRevenuePath() {
  const p = window.location.pathname;
  return p.startsWith('/revenue') || p === '/admin/revenue';
}

/** /ops 경로 감지 — MVP 운영자 페이지 */
function isOpsPath() {
  return window.location.pathname.startsWith('/ops');
}

/** /map-explore 경로 감지 — 전체 일손 지도 탐색 (Uber-style) */
function isMapExplorePath() {
  return window.location.pathname.startsWith('/map-explore');
}

/** /map 경로 감지 — 작업 위치 단건 지도 */
function isMapDetailPath() {
  return window.location.pathname.startsWith('/map');
}

/** PHASE SCALE+: 결제 결과 경로 감지 */
function parsePayPath() {
  const p = window.location.pathname;
  if (p.startsWith('/pay/success')) return 'success';
  if (p.startsWith('/pay/fail'))    return 'fail';
  return null;
}

/**
 * Phase 14 — 외부 접속 여부 판단
 * ngrok 무료/유료, 커스텀 도메인 공통 커버
 */
function detectExternalAccess() {
  const h = window.location.hostname;
  return (
    h.includes('ngrok')          ||
    h.includes('ngrok-free.app') ||
    h.includes('ngrok-free.dev') ||
    h.includes('loca.lt')        ||
    h.includes('serveo.net')
  );
}

/** URL pathname에서 job id 추출: /jobs/abc-123 → 'abc-123' */
function parseJobIdFromUrl() {
  const m = window.location.pathname.match(/^\/jobs\/([^/?#]+)/);
  return m ? m[1] : null;
}

/** 딥링크 source 판단 */
function parseDeeplinkSource() {
  const params = new URLSearchParams(window.location.search);
  return params.get('source') || 'direct';
}

export default function App() {
  // PHASE_REVENUE_DASHBOARD_V1: /revenue → 수익 대시보드 (로그인 게이트 우회)
  if (isRevenuePath()) {
    return (
      <div className="max-w-lg mx-auto relative min-h-screen">
        <RevenueDashboard onBack={() => { window.history.replaceState({}, '', '/admin'); window.location.reload(); }} />
      </div>
    );
  }

  // Phase 9: /admin 경로 → 관리자 대시보드 직접 렌더 (로그인 게이트 우회)
  if (isAdminPath()) {
    return (
      <div className="max-w-lg mx-auto relative min-h-screen">
        <AdminDashboard onBack={() => { window.history.replaceState({}, '', '/'); window.location.reload(); }} />
      </div>
    );
  }

  // MVP 운영자 페이지: /ops (로그인 게이트 우회)
  if (isOpsPath()) {
    return (
      <div className="max-w-lg mx-auto relative min-h-screen">
        <OperatorPage />
      </div>
    );
  }

  // 전체 일손 지도 탐색: /map-explore (Uber-style — 로그인 게이트 우회)
  if (isMapExplorePath()) {
    return <MapExplorePage />;
  }

  // 작업 위치 지도: /map?lat=&lng=&title= (로그인 게이트 우회 — 공유 링크 대비)
  if (isMapDetailPath()) {
    return <MapPage />;
  }

  // PHASE SCALE+: 결제 결과 페이지 (토스 리다이렉트 복귀)
  const payPath = parsePayPath();
  if (payPath) {
    return (
      <div className="max-w-lg mx-auto relative min-h-screen">
        <PayResultPage
          type={payPath}
          onDone={(jobId) => {
            window.history.replaceState({}, '', '/');
            // jobId 있으면 상세로 이동, 없으면 홈
            if (jobId) window.location.replace(`/jobs/${jobId}`);
            else       window.location.replace('/');
          }}
        />
      </div>
    );
  }

  const [user,        setUser]        = useState(null);
  const [page,        setPage]        = useState('home');
  const [userMode,    setUserMode]    = useState('farmer');
  const [selectedJob, setSelectedJob] = useState(null);
  const [contact,     setContact]     = useState(null);
  // PHASE 26: 탭바 알림 배지 카운트
  const [notif,       setNotif]       = useState({ pendingApps: 0, selectedApps: 0 });
  const notifTimer = useRef(null);
  // STEP 2: 딥링크 상태
  const [deepJobId,   setDeepJobId]   = useState(null);
  const [deepSource,  setDeepSource]  = useState('direct');
  // Phase 11: 재등록용 prefill
  const [prefillJob,  setPrefillJob]  = useState(null);
  // BACK_NAV: job-detail에서 돌아갈 이전 페이지 추적
  const [prevPage,    setPrevPage]    = useState('home');

  // 앱 시작 시 로컬스토리지 확인 + 딥링크 감지 + Phase 14 외부 자동 진입
  useEffect(() => {
    const storedId   = localStorage.getItem('farm-userId');
    const storedName = localStorage.getItem('farm-userName');
    const storedRole = localStorage.getItem('farm-userRole');

    const isExternal = detectExternalAccess();
    console.log('[AUTO_ENTRY_CHECK]', { isExternal, hasStoredUser: !!(storedId && storedName) });

    if (storedId && storedName) {
      // ── 기존 로그인 정보 복원 (내부/외부 공통) ──
      setUser({ id: storedId, name: storedName, role: storedRole || 'farmer' });
      setUserMode(storedRole === 'worker' ? 'worker' : 'farmer');

    } else if (isExternal) {
      // ── Phase 14 + PHASE 21: 외부 접속 + 미로그인 → 안정적 userId 생성/재사용 ──
      // getOrCreateUser() : localStorage에 ID가 있으면 재사용, 없을 때만 신규 생성
      // → 재방문 시 동일 ID 보장 → "내 지원 현황" 정상 조회
      const u = getOrCreateUser();
      setUser(u);
      setUserMode('worker');

      console.log('[AUTO_LOGIN_EXTERNAL]', { userId: u.id, hostname: window.location.hostname });
      try { trackClientEvent('auto_login_external', { hostname: window.location.hostname, userId: u.id }); } catch (_) {}
    }

    // STEP 2: 딥링크 감지 (/jobs/:id)
    const jobId = parseJobIdFromUrl();
    if (jobId) {
      const src = parseDeeplinkSource();
      setDeepJobId(jobId);
      setDeepSource(src);

      // PHASE 30-31: 로그인 안 된 상태면 intent 이중 저장 후 로그인 페이지로
      // sessionStorage : 기본 (탭 재사용 시 정상 동작)
      // localStorage   : fallback (일부 환경 sessionStorage 소멸 대비)
      if (!storedId && !isExternal) {
        try { sessionStorage.setItem('deeplink-pending-jobId',  jobId); } catch (_) {}
        try { sessionStorage.setItem('deeplink-pending-source', src);   } catch (_) {}
        try { localStorage.setItem('deeplink-fallback-jobId',  jobId); } catch (_) {}
        try { localStorage.setItem('deeplink-fallback-source', src);   } catch (_) {}
        // login 게이트가 LoginPage를 자동으로 표시하므로 별도 setPage 불필요
      } else {
        setPage('job-detail');
      }

      // URL 정리 (SPA 히스토리 교체)
      window.history.replaceState({}, '', `/?source=${src}`);
    }

    trackClientEvent('mobile_visit', {
      ua:     navigator.userAgent.slice(0, 80),
      screen: `${window.screen.width}x${window.screen.height}`,
    });
  }, []);

  const userId = user?.id || getUserId();

  // PHASE 26: 알림 배지 폴링 (30초 간격, userId 확정 후 시작)
  useEffect(() => {
    if (!userId) return;
    const poll = () => {
      getNotifications(userId)
        .then(d => setNotif({ pendingApps: d.pendingApps || 0, selectedApps: d.selectedApps || 0 }))
        .catch(() => {});
    };
    poll(); // 즉시 1회 실행
    notifTimer.current = setInterval(poll, 30000);
    return () => clearInterval(notifTimer.current);
  }, [userId]);

  function navigate(p, extras = {}) {
    if (p === 'job-detail') setPrevPage(page); // 이전 페이지 저장
    if (extras.job)     setSelectedJob(extras.job);
    if (extras.jobId)   setDeepJobId(extras.jobId);
    if (extras.source)  setDeepSource(extras.source);
    setPage(p);
  }

  function goHome() {
    setPage('home');
    // 딥링크 state 초기화
    setDeepJobId(null);
    setDeepSource('direct');
  }

  // Phase 11: 재등록 (job 복사해서 post-job으로)
  function handleCopyJob(job) {
    setPrefillJob(job);
    setUserMode('farmer');
    setPage('post-job');
    try {
      trackClientEvent('retention_cta_click', { jobId: job.id, action: 'copy_job' });
      trackClientEvent('job_copy_created', { jobId: job.id, category: job.category });
    } catch (_) { /* fail-safe */ }
    console.log(`[JOB_COPY_CREATED] sourceJobId=${job.id} category=${job.category}`);
  }

  function handleLogin(u) {
    setUser(u);
    setUserMode(u.role === 'worker' ? 'worker' : 'farmer');
    trackClientEvent('login_success', { role: u.role });

    // PHASE 30-31: 로그인 후 딥링크 복원 — sessionStorage → localStorage fallback
    const pendingJobId =
      sessionStorage.getItem('deeplink-pending-jobId') ||
      localStorage.getItem('deeplink-fallback-jobId');
    const pendingSource =
      sessionStorage.getItem('deeplink-pending-source') ||
      localStorage.getItem('deeplink-fallback-source') || 'kakao';

    if (pendingJobId) {
      // 사용 후 양쪽 모두 소거
      try { sessionStorage.removeItem('deeplink-pending-jobId');  } catch (_) {}
      try { sessionStorage.removeItem('deeplink-pending-source'); } catch (_) {}
      try { localStorage.removeItem('deeplink-fallback-jobId');   } catch (_) {}
      try { localStorage.removeItem('deeplink-fallback-source');  } catch (_) {}
      setDeepJobId(pendingJobId);
      setDeepSource(pendingSource);
      setPage('job-detail');
      return;
    }

    // 이미 job-detail 중이었으면 유지, 아니면 홈으로
    if (page !== 'job-detail') setPage('home');
  }

  function handleSelectContact(contactData) {
    setContact(contactData);
    setPage('home');
  }

  // ─── 로그인 게이트 ────────────────────────────────────────────
  if (!user) {
    // 딥링크 접근이면 로그인 후 상세로 복귀할 수 있도록 LoginPage 표시
    return (
      <div className="max-w-lg mx-auto relative min-h-screen">
        <LoginPage onLogin={handleLogin} />
      </div>
    );
  }

  // ── 지도 보기: wrapper 바깥에서 전체 화면 렌더 ────────────────────
  // max-w-lg / position:relative 래퍼가 height:100dvh 지도를 clip하므로 early-return
  if (page === 'map-view') {
    return (
      <JobMapView
        onBack={goHome}
        onViewDetail={(job) => navigate('job-detail', { jobId: job.id, source: 'map' })}
        onViewMyApplications={() => navigate('my-applications')}
      />
    );
  }

  return (
    <div className="max-w-lg mx-auto relative min-h-screen">
      {/* ── 화면 라우팅 ─────────────────────────────────── */}
      {page === 'home' && (
        <HomePage
          mode={userMode}
          onModeChange={setUserMode}
          onPostJob={() => navigate('post-job')}
          onViewJobList={() => navigate('job-list')}
          onViewMyJobs={() => navigate('my-jobs')}
          onViewMyApplications={() => navigate('my-applications')}
          onViewApplicants={(job) => navigate('applicants', { job })}
          onViewMyConnections={() => navigate('my-connections')}
          onViewMap={() => navigate('map-view')}
          // STEP 2: 홈에서 job 카드 클릭 시 상세 이동 지원
          onViewJobDetail={(job) => navigate('job-detail', { jobId: job.id, source: 'list' })}
          // PHASE 26: 탭바 배지
          notif={notif}
        />
      )}

      {page === 'post-job' && (
        <JobRequestPage
          prefillJob={prefillJob}
          onBack={() => { setPrefillJob(null); goHome(); }}
          onSuccess={() => {
            setPrefillJob(null);
            setPage('home');
            setUserMode('farmer');
          }}
        />
      )}

      {page === 'job-list' && (
        <JobListPage
          userId={userId}
          onBack={goHome}
          onViewJobDetail={(job) => navigate('job-detail', { jobId: job.id, source: 'list' })}
        />
      )}

      {page === 'my-jobs' && (
        <JobListPage
          userId={userId}
          myJobsMode
          onBack={goHome}
          onViewApplicants={(job) => navigate('applicants', { job })}
          onCopyJob={handleCopyJob}
        />
      )}

      {page === 'my-applications' && (
        // PHASE 22: 전용 페이지로 교체 (완료처리 + 후기 UI)
        <MyApplicationsPage
          userId={userId}
          onBack={goHome}
        />
      )}

      {page === 'applicants' && selectedJob && (
        <ApplicantListPage
          job={selectedJob}
          userId={userId}
          onBack={() => setPage('my-jobs')}
          onSelectContact={handleSelectContact}
        />
      )}

      {page === 'my-connections' && (
        <MyConnectionsPage
          userId={userId}
          onBack={goHome}
        />
      )}

      {/* Phase 10: 지도 보기는 early-return으로 처리 (위 참조) */}

      {/* STEP 1+2: 일 상세 페이지 (딥링크 or 카드 클릭) */}
      {page === 'job-detail' && (
        <JobDetailPage
          jobId={deepJobId}
          onBack={() => {
            // 이전 페이지로 복귀 (리스트 → 상세 → 뒤로 = 리스트)
            if (prevPage && prevPage !== 'home' && prevPage !== 'job-detail') {
              setPage(prevPage);
            } else {
              goHome();
            }
          }}
          source={deepSource}
          onCopyJob={handleCopyJob}
        />
      )}

      {/* ── 연락처 공개 모달 ─────────────────────────────── */}
      {contact && (
        <ContactRevealModal
          contact={contact}
          onClose={() => setContact(null)}
        />
      )}
    </div>
  );
}
