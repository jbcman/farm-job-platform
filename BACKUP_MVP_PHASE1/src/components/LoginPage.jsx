import React, { useState, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { login, setUserName } from '../utils/api.js';

/**
 * LoginPage — 최초 진입 시 이름/전화번호/역할 등록
 * 전화번호 기준으로 기존 사용자면 그대로 로그인
 */
export default function LoginPage({ onLogin }) {
  const [name,    setName]    = useState('');
  const [phone,   setPhone]   = useState('');
  const [role,    setRole]    = useState('farmer'); // 'farmer' | 'worker'
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const nameRef = useRef(null);

  // 첫 입력창 자동 포커스
  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 300);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('이름을 입력해주세요.'); return; }
    if (!phone.trim()) { setError('전화번호를 입력해주세요.'); return; }

    setLoading(true);
    setError('');
    try {
      const res = await login({ name: name.trim(), phone: phone.trim(), role });
      const user = res.user;

      localStorage.setItem('farm-userId',   user.id);
      localStorage.setItem('farm-userName', user.name);
      localStorage.setItem('farm-userRole', user.role);
      setUserName(user.name);

      onLogin(user);
    } catch (e) {
      setError(e.message || '로그인 중 오류가 발생했어요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-farm-bg flex flex-col">
      {/* 헤더 */}
      <div className="bg-farm-green px-6 pt-16 pb-10 text-center">
        <p className="text-5xl mb-3">🌾</p>
        <h1 className="text-2xl font-black text-white tracking-tight">농민일손</h1>
        <p className="text-white/90 font-bold text-base mt-1">급할 때 바로 일손 구하세요</p>
        <p className="text-green-200 text-sm mt-1">근처 사람 연결해드립니다</p>
      </div>

      {/* 폼 */}
      <form onSubmit={handleSubmit} className="flex-1 px-5 pt-8 space-y-5">

        {/* 역할 선택 */}
        <div>
          <p className="text-sm font-semibold text-gray-600 mb-2">나는</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setRole('farmer')}
              className={`py-4 rounded-2xl font-bold text-base border-2 transition-all ${
                role === 'farmer'
                  ? 'border-farm-green bg-farm-green text-white shadow-sm'
                  : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              🌾 일 맡길게요
            </button>
            <button
              type="button"
              onClick={() => setRole('worker')}
              className={`py-4 rounded-2xl font-bold text-base border-2 transition-all ${
                role === 'worker'
                  ? 'border-farm-green bg-farm-green text-white shadow-sm'
                  : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              💪 일 할게요
            </button>
          </div>
        </div>

        {/* 이름 */}
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">이름</label>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.form?.requestSubmit()}
            placeholder="이름 입력"
            autoComplete="name"
            className="w-full px-4 py-3.5 border border-gray-200 rounded-xl text-base
                       focus:outline-none focus:border-farm-green bg-white"
          />
        </div>

        {/* 전화번호 */}
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">전화번호</label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.form?.requestSubmit()}
            placeholder="010-0000-0000"
            autoComplete="tel"
            className="w-full px-4 py-3.5 border border-gray-200 rounded-xl text-base
                       focus:outline-none focus:border-farm-green bg-white"
          />
          <p className="text-xs text-gray-400 mt-1.5">번호만 입력하면 바로 시작됩니다 · 회원가입 없이 바로 사용 가능</p>
        </div>

        {/* 에러 */}
        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>
        )}

        {/* 시작하기 */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-4 bg-farm-green text-white font-black text-lg rounded-2xl
                     disabled:opacity-60 flex items-center justify-center gap-2
                     shadow-lg active:scale-95 transition-transform"
        >
          {loading
            ? <><Loader2 size={20} className="animate-spin" /> 처리 중...</>
            : '지금 시작하기 →'
          }
        </button>

        <p className="text-center text-xs text-gray-400 pt-2">
          개인정보는 매칭 연결에만 사용됩니다
        </p>
      </form>
    </div>
  );
}
