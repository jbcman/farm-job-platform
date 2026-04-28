/**
 * MainApp.jsx — 메인 상태 관리 + 내부 페이지 라우팅
 *
 * App.jsx(BrowserRouter)의 catch-all Route("*")에서 렌더됩니다.
 * URL 기반 라우팅(admin/map/ops/pay 등)은 App.jsx Router가 담당하며,
 * 이 컴포넌트는 오직 내부 페이지 전환(useState)만 담당합니다.
 *
 * STEP 4: autoEntry(localStorage) 감지 시 Router navigate로 이동
 *         → 화면 고정/잔존 상태 문제 0%
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate as useRouterNavigate } from 'react-router-dom';

import LoginPage          from './components/LoginPage.jsx';
import HomePage           from './components/HomePage.jsx';
import JobRequestPage     from './components/JobRequestPage.jsx';
import JobListPage        from './components/JobListPage.jsx';
import JobDetailPage      from './components/JobDetailPage.jsx';
import ApplicantListPage  from './components/ApplicantListPage.jsx';
import ContactRevealModal from './components/ContactRevealModal.jsx';
import MyConnectionsPage  from './components/MyConnectionsPage.jsx';
import JobMapView         from './components/JobMapView.jsx';
import MyApplicationsPage from './components/MyApplicationsPage.jsx';
import { getUserId, trackClientEvent, getNotifications } from './utils/api.js';
import { getOrCreateUser } from './utils/userProfile.js';
import { pushView, replaceView } from './utils/historyManager.js';

// ── 헬퍼 함수 ──────────────────────────────────────────────────────────

/** Phase 14: 외부 접속(ngrok 등) 여부 판단 */
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

/** 딥링크 source 파라미터 추출 */
function parseDeeplinkSource() {
  const params = new URLSearchParams(window.location.search);
  return params.get('source') || 'direct';
}

// ── STEP 5: autoEntry 안전 저장 유틸 ──────────────────────────────────
// 외부에서 autoEntry를 설정할 때는 반드시 이 함수를 사용
// (기존 값을 덮어쓰지 않음 → 화면 고정 방지)
export function setAutoEntrySafe(value) {
  const existing = localStorage.getItem('autoEntry');
  if (!existing) {
    localStorage.setItem('autoEntry', JSON.stringify(value));
  }
}

// ── 메인 컴포넌트 ───────────────────────────────────────────────────────
export default function MainApp() {
  // React Router navigate (외부 URL 이동용)
  const routerNavigate = useRouterNavigate();

  // 내부 페이지 상태
  const [user,        setUser]        = useState(null);
  const [page,        setPage]        = useState('home');
  const [userMode,    setUserMode]    = useState('farmer');
  const [selectedJob, setSelectedJob] = useState(null);
  const [contact,     setContact]     = useState(null);
  const [notif,       setNotif]       = useState({ pendingApps: 0, selectedApps: 0 });
  const notifTimer = useRef(null);
  const [deepJobId,   setDeepJobId]   = useState(null);
  const [deepSource,  setDeepSource]  = useState('direct');
  const [prefillJob,  setPrefillJob]  = useState(null);
  const [prevPage,    setPrevPage]    = useState('home');

  // STEP 4: autoEntry → Router navigate
  // localStorage에 { type: 'admin'|'worker'|'farmer' } 저장 시 자동 이동
  useEffect(() => {
    const autoEntry = JSON.parse(localStorage.getItem('autoEntry') || 'null');
    if (!autoEntry) return;
    console.log('[AUTO_ENTRY]', autoEntry);
    if (autoEntry.type === 'admin') {
      routerNavigate('/admin');
    } else if (autoEntry.type === 'worker' || autoEntry.type === 'farmer') {
      // 내부 페이지 이동 (Router 경로 변경 없이 page 상태만 전환)
      setPage('job-list');
    }
    // 사용 후 제거 (재진입 루프 방지)
    localStorage.removeItem('autoEntry');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 앱 시작: localStorage 복원 + 딥링크 감지 + Phase 14 외부 자동 진입
  useEffect(() => {
    const storedId   = localStorage.getItem('farm-userId');
    const storedName = localStorage.getItem('farm-userName');
    const storedRole = localStorage.getItem('farm-userRole');

    const isExternal = detectExternalAccess();
    console.log('[AUTO_ENTRY_CHECK]', { isExternal, hasStoredUser: !!(storedId && storedName) });

    if (storedId && storedName) {
      // 기존 로그인 정보 복원 (내부/외부 공통)
      setUser({ id: storedId, name: storedName, role: storedRole || 'farmer' });
      setUserMode(storedRole === 'worker' ? 'worker' : 'farmer');

    } else if (isExternal) {
      // Phase 14: 외부 접속 + 미로그인 → 안정적 userId 생성/재사용
      const u = getOrCreateUser();
      setUser(u);
      setUserMode('worker');
      console.log('[AUTO_LOGIN_EXTERNAL]', { userId: u.id, hostname: window.location.hostname });
      try { trackClientEvent('auto_login_external', { hostname: window.location.hostname, userId: u.id }); } catch (_) {}
    }

    // 딥링크 감지 (/jobs/:id)
    const jobId = parseJobIdFromUrl();
    if (jobId) {
      const src = parseDeeplinkSource();
      setDeepJobId(jobId);
      setDeepSource(src);

      if (!storedId && !isExternal) {
        // 로그인 필요 → intent 저장 후 LoginPage 표시
        try { sessionStorage.setItem('deeplink-pending-jobId',  jobId); } catch (_) {}
        try { sessionStorage.setItem('deeplink-pending-source', src);   } catch (_) {}
        try { localStorage.setItem('deeplink-fallback-jobId',  jobId); } catch (_) {}
        try { localStorage.setItem('deeplink-fallback-source', src);   } catch (_) {}
      } else {
        setPage('job-detail');
      }
      window.history.replaceState({}, '', `/?source=${src}`);
    }

    trackClientEvent('mobile_visit', {
      ua:     navigator.userAgent.slice(0, 80),
      screen: `${window.screen.width}x${window.screen.height}`,
    });

    if (!jobId) replaceView('home', {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const userId = user?.id || getUserId();

  // PHASE 26: 알림 배지 폴링 (30초 간격)
  useEffect(() => {
    if (!userId) return;
    const poll = () => {
      getNotifications(userId)
        .then(d => setNotif({ pendingApps: d.pendingApps || 0, selectedApps: d.selectedApps || 0 }))
        .catch(() => {});
    };
    poll();
    notifTimer.current = setInterval(poll, 30000);
    return () => clearInterval(notifTimer.current);
  }, [userId]);

  // BACK_NAV: OS 뒤로가기(popstate) → 이전 뷰 복원
  useEffect(() => {
    const handler = (e) => {
      const state = e.state;
      if (!state?.view) {
        console.log('[BACK_NAV] no state → 홈 유지');
        return;
      }
      const { view, params = {} } = state;
      console.log('[BACK_NAV]', view, params);
      if (params.job)    setSelectedJob(params.job);
      if (params.jobId)  setDeepJobId(params.jobId);
      if (params.source) setDeepSource(params.source);
      setPrevPage(page);
      setPage(view);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [page]);

  // ── 내부 navigate (page 상태 전환) ────────────────────────────────
  function navigate(p, extras = {}) {
    if (p === 'job-detail') setPrevPage(page);
    if (extras.job)     setSelectedJob(extras.job);
    if (extras.jobId)   setDeepJobId(extras.jobId);
    if (extras.source)  setDeepSource(extras.source);

    const histParams = {
      jobId:  extras.jobId  ?? extras.job?.id ?? null,
      source: extras.source ?? null,
      job: extras.job ? {
        id:           extras.job.id,
        category:     extras.job.category,
        locationText: extras.job.locationText,
        date:         extras.job.date,
        status:       extras.job.status,
        requesterId:  extras.job.requesterId,
        pay:          extras.job.pay,
      } : null,
    };

    if (p === page) {
      replaceView(p, histParams);
    } else {
      pushView(p, histParams);
    }
    setPage(p);
  }

  function goHome() {
    replaceView('home', {});
    setPage('home');
    setDeepJobId(null);
    setDeepSource('direct');
  }

  // Phase 11: 재등록 (job 복사 → post-job 페이지)
  function handleCopyJob(job) {
    setPrefillJob(job);
    setUserMode('farmer');
    setPage('post-job');
    try {
      trackClientEvent('retention_cta_click', { jobId: job.id, action: 'copy_job' });
      trackClientEvent('job_copy_created',    { jobId: job.id, category: job.category });
    } catch (_) {}
    console.log(`[JOB_COPY_CREATED] sourceJobId=${job.id} category=${job.category}`);
  }

  function handleLogin(u) {
    setUser(u);
    setUserMode(u.role === 'worker' ? 'worker' : 'farmer');
    trackClientEvent('login_success', { role: u.role });

    // PHASE 30-31: 로그인 후 딥링크 복원
    const pendingJobId =
      sessionStorage.getItem('deeplink-pending-jobId') ||
      localStorage.getItem('deeplink-fallback-jobId');
    const pendingSource =
      sessionStorage.getItem('deeplink-pending-source') ||
      localStorage.getItem('deeplink-fallback-source') || 'kakao';

    if (pendingJobId) {
      try { sessionStorage.removeItem('deeplink-pending-jobId');  } catch (_) {}
      try { sessionStorage.removeItem('deeplink-pending-source'); } catch (_) {}
      try { localStorage.removeItem('deeplink-fallback-jobId');   } catch (_) {}
      try { localStorage.removeItem('deeplink-fallback-source');  } catch (_) {}
      setDeepJobId(pendingJobId);
      setDeepSource(pendingSource);
      setPage('job-detail');
      return;
    }

    if (page !== 'job-detail') setPage('home');
  }

  function handleSelectContact(contactData) {
    setContact(contactData);
    setPage('home');
  }

  // ── 로그인 게이트 ────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="max-w-lg mx-auto relative min-h-screen">
        <LoginPage onLogin={handleLogin} />
      </div>
    );
  }

  // ── 지도 보기: 전체화면 (wrapper 바깥 early-return) ──────────────────
  if (page === 'map-view') {
    return (
      <JobMapView
        onBack={goHome}
        onViewDetail={(job) => navigate('job-detail', { jobId: job.id, source: 'map' })}
        onViewMyApplications={() => navigate('my-applications')}
      />
    );
  }

  // REAL_USER_TEST STEP 10: TEST_MODE 배너
  const TEST_MODE_ON = import.meta.env.VITE_TEST_MODE === 'true';

  return (
    <div className="max-w-lg mx-auto relative min-h-screen">
      {/* TEST MODE 배너 */}
      {TEST_MODE_ON && (
        <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center
                        bg-yellow-400 text-yellow-900 text-xs font-bold py-1 gap-2"
             style={{ maxWidth: 512, margin: '0 auto' }}>
          <span>🧪 TEST MODE ON</span>
          <span className="opacity-60">현재 페이지: {page}</span>
        </div>
      )}

      {/* ── 화면 라우팅 (내부 page 상태 기반) ──────────────────────── */}

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
          onViewJobDetail={(job) => navigate('job-detail', { jobId: job.id, source: 'list' })}
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

      {page === 'job-detail' && (
        <JobDetailPage
          jobId={deepJobId}
          onBack={() => {
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

      {/* 연락처 공개 모달 */}
      {contact && (
        <ContactRevealModal
          contact={contact}
          onClose={() => setContact(null)}
        />
      )}
    </div>
  );
}
