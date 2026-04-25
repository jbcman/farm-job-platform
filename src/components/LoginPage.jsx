import React, { useState, useRef, useEffect } from 'react';
import { Loader2, Bell, Zap } from 'lucide-react';
import { login, setUserName } from '../utils/api.js';
import { getOrCreateUser } from '../utils/userProfile.js';
import Button from './ui/Button.jsx';
import CallButton from './common/CallButton.jsx';

const JOB_TYPES = [
  { key: '밭갈이',    emoji: '🚜' },
  { key: '로터리',    emoji: '🔄' },
  { key: '두둑',      emoji: '⛰️' },
  { key: '방제',      emoji: '💊' },
  { key: '수확 일손', emoji: '🌾' },
  { key: '예초',      emoji: '✂️' },
];

function quickStart(onLogin) {
  const u = getOrCreateUser();
  onLogin(u);
}

/**
 * LoginPage — LANDING UX V3
 * 전화 CTA 최상단 배치 / 입력 선택 사항 / 빠른 시작 상단 이동
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
  // LANDING V3: 최상단 전화 CTA 용 상단 공고 (fire-and-forget)
  const [topJob,        setTopJob]        = useState(null);

  const nameRef = useRef(null);

  useEffect(() => {
    // GPS 사전 요청 (작업자 위치 등록용)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => { setLat(coords.latitude); setLng(coords.longitude); },
        () => {},
        { timeout: 5000, maximumAge: 60000 }
      );
    }
    // LANDING V3 STEP 1: 상단 긴급 공고 전화번호 사전 로드
    fetch('/api/jobs?isUrgent=1&limit=1')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const job = d?.jobs?.[0] ?? d?.[0] ?? null;
        if (job?.phone || job?.contact || job?.farmerPhone) setTopJob(job);
      })
      .catch(() => {});
  }, []);

  // LANDING V3 STEP 5: 빈 입력 시 빠른 시작 자동 fallback
  async function handleSubmit(e) {
    e.preventDefault();

    // 이름+전화 모두 비어있으면 → 빠른 시작 (마찰 제로)
    if (!name.trim() && !phone.trim()) {
      quickStart(onLogin);
      return;
    }

    if (!name.trim())  { setError('이름을 입력해주세요.');   return; }
    if (!phone.trim()) { setError('전화번호를 입력해주세요.'); return; }

    setLoading(true);
    setError('');
    try {
      const payload = {
        name:  name.trim(),
        phone: phone.trim(),
        role,
        ...(role === 'worker' && {
          jobType:      jobType             || null,
          locationText: locationText.trim() || null,
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
      if (user.abGroup) {
        try { localStorage.setItem('farm-abGroup', user.abGroup); } catch (_) {}
      }
      setUserName(user.name);
      onLogin(user);
    } catch (e) {
      setError(e.message || '로그인 중 오류가 발생했어요.');
    } finally {
      setLoading(false);
    }
  }

  // 전화 연결 가능 여부 (topJob 또는 null)
  const topPhone = topJob?.phone || topJob?.contact || topJob?.farmerPhone || null;

  return (
    <div className="min-h-screen bg-farm-bg flex flex-col">

      {/* ══ HERO — LANDING V3 ══ */}
      <div style={{
        background: '#2d8a4e',
        padding: '36px 20px 24px',
        textAlign: 'center',
      }}>
        {/* 브랜드 라벨 */}
        <p style={{
          color: 'rgba(255,255,255,0.55)',
          fontSize: 11, fontWeight: 700,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          margin: '0 0 12px',
        }}>농촌 일손</p>

        {/* 헤드라인 */}
        <h1 style={{
          fontFamily: "'Jalnan2','Noto Sans KR',sans-serif",
          fontSize: 28, fontWeight: 900,
          color: '#fff', lineHeight: 1.22,
          margin: '0 0 8px',
        }}>
          🔥 급할 때 바로<br/>일손 연결
        </h1>

        <p style={{
          color: 'rgba(255,255,255,0.70)',
          fontSize: 13, lineHeight: 1.5,
          margin: '0 0 20px',
        }}>
          평균 5분 내 연결됩니다
        </p>

        {/* ── STEP 1+2: CallButton 최상단 (CTA 1번) ── */}
        <CallButton
          phone={topPhone}
          jobId={topJob?.id || 'landing'}
          label="🔥 지금 바로 연결 (전화)"
          onFallback={() => quickStart(onLogin)}
          style={{ marginBottom: 10 }}
        />

        {/* CTA 2: 일자리 둘러보기 */}
        <button
          type="button"
          onClick={() => quickStart(onLogin)}
          style={{
            width: '100%', height: 46,
            background: 'transparent', color: 'rgba(255,255,255,0.90)',
            border: '1.5px solid rgba(255,255,255,0.32)', borderRadius: 14,
            fontWeight: 700, fontSize: 14,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            marginBottom: 16,
          }}
          onPointerDown={e => e.currentTarget.style.opacity = '0.72'}
          onPointerUp={e   => e.currentTarget.style.opacity = '1'}
        >
          🔍 일자리 둘러보기
        </button>

        {/* 신뢰 요소 */}
        <div style={{
          display: 'flex', justifyContent: 'center',
          gap: 12, flexWrap: 'wrap',
          color: 'rgba(255,255,255,0.62)',
          fontSize: 11, fontWeight: 700,
          marginBottom: 16,
        }}>
          <span>⭐ 평균 4.8점</span>
          <span>⚡ 평균 5분 연결</span>
          <span>✔ 완료 1,240건</span>
        </div>

        {/* STEP 4: 빠른 시작 — 히어로 내부 이동 */}
        <button
          type="button"
          onClick={() => quickStart(onLogin)}
          style={{
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.20)',
            borderRadius: 12, color: 'rgba(255,255,255,0.85)',
            fontWeight: 700, fontSize: 13,
            padding: '10px 0', width: '100%',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
          onPointerDown={e => e.currentTarget.style.opacity = '0.72'}
          onPointerUp={e   => e.currentTarget.style.opacity = '1'}
        >
          <Zap size={14} /> ⚡ 이름 없이 바로 시작
        </button>
      </div>

      {/* STEP 6: 긴급 배너 — 위치 유지 */}
      <button
        type="button"
        onClick={() => quickStart(onLogin)}
        style={{
          width: '100%',
          background: 'linear-gradient(90deg,#b91c1c,#dc2626)',
          border: 'none', cursor: 'pointer',
          padding: '11px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxShadow: '0 3px 12px rgba(185,28,28,0.40)',
        }}
      >
        <div style={{ textAlign: 'left' }}>
          <p style={{ margin: 0, color: '#fff', fontWeight: 900, fontSize: 13 }}>
            🔥 오늘 안 구하면 작업 지연됩니다
          </p>
          <p style={{ margin: '2px 0 0', color: 'rgba(255,220,220,0.9)', fontWeight: 600, fontSize: 12 }}>
            ⏰ 지금 기준 2건 남음 — 빨리 신청하세요
          </p>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 18 }}>›</span>
      </button>

      {/* ── STEP 3+5: 폼 — 역할 선택 + 선택 입력 ── */}
      <form onSubmit={handleSubmit} className="flex-1 px-5 pt-6 pb-10 space-y-5">

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

        {/* STEP 5: 선택 입력 구분선 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          color: '#9ca3af', fontSize: 12, fontWeight: 600,
        }}>
          <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
          선택 입력 (입력 없이도 시작 가능)
          <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
        </div>

        {/* 이름 (선택) */}
        <div>
          <label className="block text-sm font-semibold text-gray-500 mb-1.5">
            이름 <span className="font-normal text-gray-400">(선택)</span>
          </label>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.form?.requestSubmit()}
            placeholder="(선택) 이름 입력"
            autoComplete="name"
            className="w-full px-4 py-3.5 border border-gray-200 rounded-xl text-base
                       focus:outline-none focus:border-farm-green bg-white"
          />
        </div>

        {/* 전화번호 (선택) */}
        <div>
          <label className="block text-sm font-semibold text-gray-500 mb-1.5">
            연락처 <span className="font-normal text-gray-400">(선택)</span>
          </label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.form?.requestSubmit()}
            placeholder="(선택) 연락처 입력"
            autoComplete="tel"
            className="w-full px-4 py-3.5 border border-gray-200 rounded-xl text-base
                       focus:outline-none focus:border-farm-green bg-white"
          />
          {/* STEP 5: 가입 느낌 제거 */}
          <p className="text-xs text-gray-400 mt-1.5">입력 없이도 바로 연결 가능합니다</p>
        </div>

        {/* ── 작업자 전용 추가 입력 ── */}
        {role === 'worker' && (
          <>
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
        <Button type="submit" disabled={loading} size="lg">
          {loading
            ? <><Loader2 size={20} className="animate-spin" /> 처리 중...</>
            : '정보 입력하고 시작하기 →'
          }
        </Button>

        <p className="text-center text-xs text-gray-400 pt-1">
          개인정보는 매칭 연결에만 사용됩니다
        </p>
      </form>
    </div>
  );
}
