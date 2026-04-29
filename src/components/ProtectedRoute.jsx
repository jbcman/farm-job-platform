/**
 * ProtectedRoute — 역할 기반 라우트 보호
 *
 * adminOnly=true 일 때:
 *   - 일반 사용자(farmer/worker)가 /admin 접근 시 → / 로 리다이렉트
 *   - 미로그인 사용자 → AdminDashboard 자체 인증 게이트 표시 허용
 *   (AdminDashboard는 자체 admin-key 게이트를 포함하고 있음)
 *
 * requireAuth=true 일 때:
 *   - 미로그인 사용자 → / 리다이렉트
 */

import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, adminOnly = false, requireAuth = false }) {
  const { user, logout } = useAuth();

  // /admin 접근 시 farmer/worker 세션 → 렌더 후 로그아웃
  // (렌더 중 setState 호출 방지: useEffect로 분리)
  const shouldLogout = adminOnly && user && user.role !== 'admin';
  useEffect(() => {
    if (shouldLogout) {
      console.warn('[ProtectedRoute] admin 권한 없음 → 로그아웃', user?.role);
      logout();
    }
  }, [shouldLogout]); // eslint-disable-line react-hooks/exhaustive-deps

  if (adminOnly) {
    // 로그인한 일반 사용자(farmer/worker) → 홈 리다이렉트
    if (user && user.role !== 'admin') {
      return <Navigate to="/" replace />;
    }
    // 미로그인 또는 관리자 → AdminDashboard 자체 게이트로 처리
    return children;
  }

  if (requireAuth && !user) {
    return <Navigate to="/" replace />;
  }

  return children;
}
