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

import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, adminOnly = false, requireAuth = false }) {
  const { user, logout } = useAuth();

  if (adminOnly) {
    // 로그인한 일반 사용자(farmer/worker)는 /admin 차단
    // → 자동 로그아웃 후 홈으로 (직접 URL 입력 케이스 대응)
    if (user && user.role !== 'admin') {
      console.warn('[ProtectedRoute] admin 권한 없음 → 로그아웃 후 / 리다이렉트', user.role);
      logout();
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
