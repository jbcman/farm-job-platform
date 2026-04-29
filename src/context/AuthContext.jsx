/**
 * AuthContext — 전역 사용자 인증 상태 관리
 *
 * 제공값:
 *   user      : { id, name, role: 'farmer'|'worker' } | null
 *   login(u)  : user 저장 + localStorage 동기화
 *   logout()  : user 초기화 + localStorage 삭제
 *
 * 사용:
 *   import { useAuth } from '../context/AuthContext';
 *   const { user, login, logout } = useAuth();
 */

import React, { createContext, useContext, useState, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // localStorage에서 초기값 복원 (새로고침 시 로그인 유지)
  const [user, setUser] = useState(() => {
    const id   = localStorage.getItem('farm-userId');
    const name = localStorage.getItem('farm-userName');
    const role = localStorage.getItem('farm-userRole');
    if (id && name) return { id, name, role: role || 'farmer' };
    return null;
  });

  const login = useCallback((u) => {
    const userData = { id: u.id, name: u.name, role: u.role || 'farmer' };
    setUser(userData);
    localStorage.setItem('farm-userId', u.id);
    localStorage.setItem('farm-userName', u.name);
    localStorage.setItem('farm-userRole', u.role || 'farmer');
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('farm-userId');
    localStorage.removeItem('farm-userName');
    localStorage.removeItem('farm-userRole');
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
