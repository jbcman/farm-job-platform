import React, { useState, useRef, useEffect } from 'react';
import { Loader2, Bell } from 'lucide-react';
import { login, setUserName } from '../utils/api.js';

const JOB_TYPES = [
  { key: '밭갈이',    emoji: '🚜' },
  { key: '로터리',    emoji: '🔄' },
  { key: '두둑',      emoji: '⛰️' },
  { key: '방제',      emoji: '💊' },
  { key: '수확 일손', emoji: '🌾' },
  { key: '예초',      emoji: '✂️' },
];

/**
 * LoginPage — 최초 진입 시 이름/전화번호/역할 등록
 * 작업자(worker)는 관심 분야 + 지역 + 알림 동의 추가 입력
 */
export default function LoginPage({ onLogin }) {
  const [name,          setName]          = useState('');
  const [phone,         setPhone]         = useState('');
  const [role,          setRole]          = useState('farmer');
  const [jobType,       setJobType]       = useState('');
  const [locationText,  setLocationText]  = useState('');
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [lat,           setLat]           = useState(null);
  const [lng,           setLng]           = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');

  const nameRef = useRef(null);

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 300);
    // GPS 사전 요청 (작업자 위치 등록용)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          setLat(coords.latitude);
          setLng(coords.longitude);
        },
        () => { /* denied → lat/lng null, locationText 폴백 사용 */ },
        { timeout: 5000, maximumAge: 60000 }
      );
    }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim())  { setError('이름을 입력해주세요.');   return; }
    if (!phone.trim()) { setError('전화번호를 입력해주세요.'); return; }

    setLoading(true);
    setError('');
    try {
      const payload = {
        name:    name.trim(),
        phone:   phone.trim(),
        role,
        // 작업자만 관심 분야 + GPS 전송
        ...(role === 'worker' && {
          jobType:       jobType              || null,
          locationText:  locationText.trim()  || null,
          notifyEnabled,
          lat: lat ?? null,
          lng: lng ?? null,
        }),
      };
      const res  = await login(payload);
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
      <form onSubmit={handleSubmit} className="flex-1 px-5 pt-8 pb-10 space-y-5">

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

        {/* ── 작업자 전용 추가 입력 ─────────────────────────────── */}
        {role === 'worker' && (
          <>
            {/* 관심 분야 */}
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-2">
                관심 분야 <span className="font-normal text-gray-400">(선택)</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {JOB_TYPES.map(({ key, emoji }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setJobType(prev => prev === key ? '' : key)}
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl
                                text-sm font-semibold border-2 transition-all ${
                      jobType === key
                        ? 'border-farm-green bg-farm-light text-farm-green'
                        : 'border-gray-100 bg-white text-gray-600'
                    }`}
                  >
                    <span>{emoji}</span>{key}
                  </button>
                ))}
              </div>
            </div>

            {/* 내 지역 */}
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-1.5">
                내 지역 <span className="font-normal text-gray-400">(선택)</span>
              </label>
              <input
                type="text"
                value={locationText}
                onChange={e => setLocationText(e.target.value)}
                placeholder="예: 경기 화성시"
                className="w-full px-4 py-3.5 border border-gray-200 rounded-xl text-base
                           focus:outline-none focus:border-farm-green bg-white"
              />
            </div>

            {/* 알림 동의 */}
            <div
              className={`flex items-center justify-between px-4 py-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                notifyEnabled
                  ? 'border-farm-green bg-farm-light'
                  : 'border-gray-200 bg-white'
              }`}
              onClick={() => setNotifyEnabled(v => !v)}
            >
              <div className="flex items-center gap-2.5">
                <Bell size={18} className={notifyEnabled ? 'text-farm-green' : 'text-gray-400'} />
                <div>
                  <p className="text-sm font-bold text-gray-700">관심 분야 일 알림 받기</p>
                  <p className="text-xs text-gray-400 mt-0.5">관심 분야 일이 생기면 카카오로 알려드릴게요</p>
                </div>
              </div>
              {/* 토글 */}
              <div className={`w-11 h-6 rounded-full transition-colors relative ${
                notifyEnabled ? 'bg-farm-green' : 'bg-gray-300'
              }`}>
                <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  notifyEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </div>
            </div>
          </>
        )}

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
