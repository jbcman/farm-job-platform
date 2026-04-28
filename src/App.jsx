import React from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import './styles/theme.css';

import AdminDashboard   from './components/AdminDashboard.jsx';
import RevenueDashboard from './pages/RevenueDashboard.jsx';
import OperatorPage     from './components/OperatorPage.jsx';
import MapExplorePage   from './pages/MapExplorePage.jsx';
import MapPage          from './pages/MapPage.jsx';
import PayResultPage    from './components/PayResultPage.jsx';
import MainApp          from './MainApp.jsx';

// STEP 7: 진입 경로 디버그 로그
console.log('[ROUTE]', window.location.pathname);

// ── Route Wrappers (useNavigate는 BrowserRouter 내부에서만 사용 가능) ──

function AdminRoute() {
  const navigate = useNavigate();
  return (
    <div className="max-w-lg mx-auto relative min-h-screen">
      <AdminDashboard onBack={() => navigate('/')} />
    </div>
  );
}

function RevenueRoute() {
  const navigate = useNavigate();
  return (
    <div className="max-w-lg mx-auto relative min-h-screen">
      <RevenueDashboard onBack={() => navigate('/admin')} />
    </div>
  );
}

function PayRoute({ type }) {
  const navigate = useNavigate();
  return (
    <div className="max-w-lg mx-auto relative min-h-screen">
      <PayResultPage
        type={type}
        onDone={(jobId) => {
          if (jobId) navigate(`/jobs/${jobId}`);
          else navigate('/');
        }}
      />
    </div>
  );
}

// ── Router SSOT — 화면 결정은 오직 여기서만 ────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* URL 기반 직접 라우팅 */}
        <Route path="/admin/*"       element={<AdminRoute />} />
        <Route path="/revenue"       element={<RevenueRoute />} />
        <Route path="/admin/revenue" element={<RevenueRoute />} />
        <Route path="/ops"           element={
          <div className="max-w-lg mx-auto relative min-h-screen">
            <OperatorPage />
          </div>
        } />
        <Route path="/map-explore"   element={<MapExplorePage />} />
        <Route path="/map"           element={<MapPage />} />
        <Route path="/pay/success"   element={<PayRoute type="success" />} />
        <Route path="/pay/fail"      element={<PayRoute type="fail" />} />

        {/* 메인 앱 — 내부 useState 기반 페이지 라우팅 */}
        <Route path="*"              element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  );
}
