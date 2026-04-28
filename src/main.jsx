import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// STEP 1: ?reset=1 → localStorage + sessionStorage 강제 초기화
// 사용법: https://farm-job-platform.onrender.com/?reset=1
const _resetParams = new URLSearchParams(window.location.search);
if (_resetParams.get('reset') === '1') {
  localStorage.clear();
  sessionStorage.clear();
  console.log('[RESET] storage cleared — 모든 로컬 상태 초기화 완료');
  // reset 파라미터 URL에서 제거 (새로고침 루프 방지)
  window.history.replaceState({}, '', window.location.pathname);
}

// DEV: 모바일 환경 권장 경고 (1회)
if (import.meta.env.DEV && typeof navigator !== 'undefined') {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (!isMobile) {
    console.warn('⚠ [FARM UX V2] 모바일 환경에서 테스트 권장 — 전환율 측정 정확도↑');
    console.log('  크롬 DevTools → Toggle device toolbar (Ctrl+Shift+M) → 모바일 시뮬레이션');
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
