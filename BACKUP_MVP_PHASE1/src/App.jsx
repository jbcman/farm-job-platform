import React, { useState, useEffect } from 'react';
import LoginPage          from './components/LoginPage.jsx';
import HomePage           from './components/HomePage.jsx';
import JobRequestPage     from './components/JobRequestPage.jsx';
import JobListPage        from './components/JobListPage.jsx';
import ApplicantListPage  from './components/ApplicantListPage.jsx';
import ContactRevealModal from './components/ContactRevealModal.jsx';
import MyConnectionsPage  from './components/MyConnectionsPage.jsx';
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
 *   applicants      → ApplicantListPage
 *   my-connections  → MyConnectionsPage
 */
export default function App() {
  const [user,        setUser]        = useState(null);   // 로그인된 사용자
  const [page,        setPage]        = useState('home');
  const [userMode,    setUserMode]    = useState('farmer');
  const [selectedJob, setSelectedJob] = useState(null);
  const [contact,     setContact]     = useState(null);

  // 앱 시작 시 로컬스토리지 확인 + 모바일 방문 추적
  useEffect(() => {
    const storedId   = localStorage.getItem('farm-userId');
    const storedName = localStorage.getItem('farm-userName');
    const storedRole = localStorage.getItem('farm-userRole');
    if (storedId && storedName) {
      setUser({ id: storedId, name: storedName, role: storedRole || 'farmer' });
      setUserMode(storedRole === 'worker' ? 'worker' : 'farmer');
    }

    // 모바일 방문 추적 (첫 방문 여부와 무관하게 방문마다 기록)
    trackClientEvent('mobile_visit', {
      ua:     navigator.userAgent.slice(0, 80),
      screen: `${window.screen.width}x${window.screen.height}`,
    });
  }, []);

  const userId = user?.id || getUserId();

  function navigate(p, extras = {}) {
    if (extras.job) setSelectedJob(extras.job);
    setPage(p);
  }

  function goHome() { setPage('home'); }

  function handleLogin(u) {
    setUser(u);
    setUserMode(u.role === 'worker' ? 'worker' : 'farmer');
    setPage('home');
    // 로그인 성공 추적
    trackClientEvent('login_success', { role: u.role });
  }

  function handleSelectContact(contactData) {
    setContact(contactData);
    setPage('home');
  }

  // ─── 로그인 게이트 ────────────────────────────────────────────
  if (!user) {
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
