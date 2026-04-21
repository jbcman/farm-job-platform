import React, { useState, useEffect } from 'react';
import LoginPage          from './components/LoginPage.jsx';
import HomePage           from './components/HomePage.jsx';
import JobRequestPage     from './components/JobRequestPage.jsx';
import JobListPage        from './components/JobListPage.jsx';
import JobDetailPage      from './components/JobDetailPage.jsx';
import ApplicantListPage  from './components/ApplicantListPage.jsx';
import ContactRevealModal from './components/ContactRevealModal.jsx';
import MyConnectionsPage  from './components/MyConnectionsPage.jsx';
import AdminDashboard     from './components/AdminDashboard.jsx';
import JobMapView         from './components/JobMapView.jsx';
import { getUserId, trackClientEvent } from './utils/api.js';

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
 */

/** /admin 경로 감지 */
function isAdminPath() {
  return window.location.pathname.startsWith('/admin');
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
  // Phase 9: /admin 경로 → 관리자 대시보드 직접 렌더 (로그인 게이트 우회)
  if (isAdminPath()) {
    return (
      <div className="max-w-lg mx-auto relative min-h-screen">
        <AdminDashboard onBack={() => { window.history.replaceState({}, '', '/'); window.location.reload(); }} />
      </div>
    );
  }

  const [user,        setUser]        = useState(null);
  const [page,        setPage]        = useState('home');
  const [userMode,    setUserMode]    = useState('farmer');
  const [selectedJob, setSelectedJob] = useState(null);
  const [contact,     setContact]     = useState(null);
  // STEP 2: 딥링크 상태
  const [deepJobId,   setDeepJobId]   = useState(null);
  const [deepSource,  setDeepSource]  = useState('direct');

  // 앱 시작 시 로컬스토리지 확인 + 딥링크 감지
  useEffect(() => {
    const storedId   = localStorage.getItem('farm-userId');
    const storedName = localStorage.getItem('farm-userName');
    const storedRole = localStorage.getItem('farm-userRole');
    if (storedId && storedName) {
      setUser({ id: storedId, name: storedName, role: storedRole || 'farmer' });
      setUserMode(storedRole === 'worker' ? 'worker' : 'farmer');
    }

    // STEP 2: 딥링크 감지 (/jobs/:id)
    const jobId = parseJobIdFromUrl();
    if (jobId) {
      const src = parseDeeplinkSource();
      setDeepJobId(jobId);
      setDeepSource(src);
      setPage('job-detail');
      // URL 정리 (SPA 히스토리 교체)
      window.history.replaceState({}, '', `/?source=${src}`);
    }

    trackClientEvent('mobile_visit', {
      ua:     navigator.userAgent.slice(0, 80),
      screen: `${window.screen.width}x${window.screen.height}`,
    });
  }, []);

  const userId = user?.id || getUserId();

  function navigate(p, extras = {}) {
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

  function handleLogin(u) {
    setUser(u);
    setUserMode(u.role === 'worker' ? 'worker' : 'farmer');
    trackClientEvent('login_success', { role: u.role });
    // 로그인 후 딥링크가 있으면 그대로 job-detail 유지
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
        />
      )}

      {page === 'post-job' && (
        <JobRequestPage
          onBack={goHome}
          onSuccess={() => {
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
        />
      )}

      {page === 'my-applications' && (
        <JobListPage
          userId={userId}
          myApplicationsMode
          onBack={goHome}
          onViewJobDetail={(job) => navigate('job-detail', { jobId: job.id, source: 'list' })}
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

      {/* Phase 10: 지도 보기 */}
      {page === 'map-view' && (
        <JobMapView
          onBack={goHome}
          onViewDetail={(job) => navigate('job-detail', { jobId: job.id, source: 'map' })}
        />
      )}

      {/* STEP 1+2: 일 상세 페이지 (딥링크 or 카드 클릭) */}
      {page === 'job-detail' && (
        <JobDetailPage
          jobId={deepJobId}
          onBack={goHome}
          source={deepSource}
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
