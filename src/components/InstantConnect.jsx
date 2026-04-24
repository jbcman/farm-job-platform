/**
 * InstantConnect.jsx — 지원 완료 후 즉시 연결 UI
 *
 * DESIGN_SYSTEM_V2: 지원 완료 → 전화/문자 즉시 노출
 * 경과 타이머로 긴급감 유도, 농민 연락처 표시
 *
 * 사용법:
 *   import InstantConnect, { useApply } from './InstantConnect';
 *
 *   <InstantConnect
 *     contact="010-1234-5678"
 *     farmerName="김철수"
 *     jobCategory="수확 일손"
 *     jobLocation="경기 이천시 마장면"
 *     onClose={fn}
 *   />
 */

import React, { useState, useEffect } from 'react';
import { Phone, MessageCircle, CheckCircle, ChevronRight } from 'lucide-react';
import { trackClientEvent } from '../utils/api.js';

// ── 즉시 연결 메인 컴포넌트 ───────────────────────────────────
export default function InstantConnect({
  contact,        // 농민 전화번호
  farmerName,
  jobCategory,
  jobLocation,
  applicationId,
  onClose,
  onViewMyApplications,
}) {
  const [called,   setCalled]   = useState(false);
  const [messaged, setMessaged] = useState(false);
  const [elapsed,  setElapsed]  = useState(0); // 지원 후 경과 초

  // 경과 시간 타이머 (긴급감 유도)
  useEffect(() => {
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // 전화 연결
  function handleCall() {
    try { trackClientEvent('instant_call_click', { applicationId, contact: contact?.slice(0, 7) }); } catch (_) {}
    setCalled(true);
    window.location.href = `tel:${contact}`;
  }

  // 문자 보내기
  function handleSms() {
    const msg = encodeURIComponent(
      `안녕하세요! 농촌 일손 앱에서 "${jobCategory}" 일자리에 지원한 작업자입니다. 지금 통화 가능하신가요?`
    );
    try { trackClientEvent('instant_sms_click', { applicationId }); } catch (_) {}
    setMessaged(true);
    window.location.href = `sms:${contact}?body=${msg}`;
  }

  const formatElapsed = (s) => s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'flex-end',
      animation: 'fadeIn .18s ease-out',
    }}>
      <div style={{
        width: '100%', background: '#fff',
        borderRadius: '28px 28px 0 0',
        padding: '20px 20px 40px',
        animation: 'slideUp .25s cubic-bezier(.22,1,.36,1)',
        boxShadow: '0 -8px 40px rgba(0,0,0,.2)',
      }}>

        {/* 닫기 */}
        {onClose && (
          <button
            onClick={onClose}
            style={{
              position: 'absolute', top: 14, right: 16,
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 22, color: '#9ca3af', fontFamily: 'inherit',
            }}
          >×</button>
        )}

        {/* 성공 아이콘 */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 9999, background: '#f0fdf4',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 10,
          }}>
            <CheckCircle size={34} color="#15803d" />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: '#1f2937', marginBottom: 4 }}>
            지원 완료!
          </h2>
          <p style={{ fontSize: 14, color: '#6b7280' }}>
            {farmerName}님께 알림이 전송됐습니다
          </p>
        </div>

        {/* 긴급 배너 */}
        <div style={{
          background: 'linear-gradient(90deg,#b91c1c,#dc2626)',
          borderRadius: 14, padding: '12px 16px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 22 }}>🔥</span>
          <div>
            <p style={{ color: '#fff', fontWeight: 900, fontSize: 13, marginBottom: 2 }}>
              지금 바로 연락하세요!
            </p>
            <p style={{ color: 'rgba(255,255,255,.85)', fontSize: 11 }}>
              빠르게 연락할수록 선택 확률이 높아집니다 · 경과: {formatElapsed(elapsed)}
            </p>
          </div>
        </div>

        {/* 작업 정보 요약 */}
        <div style={{
          background: '#f9fafb', borderRadius: 14, padding: '12px 16px', marginBottom: 18,
          display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <span style={{ fontSize: 28 }}>🌾</span>
          <div>
            <p style={{ fontWeight: 700, color: '#1f2937', fontSize: 14, marginBottom: 2 }}>
              {jobCategory}
            </p>
            <p style={{ fontSize: 12, color: '#6b7280' }}>📍 {jobLocation}</p>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <p style={{ fontSize: 11, color: '#9ca3af' }}>농민</p>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#1f2937' }}>{farmerName}님</p>
          </div>
        </div>

        {/* 즉시 전화 버튼 (핵심) */}
        <a
          href={`tel:${contact}`}
          onClick={handleCall}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            width: '100%', padding: '16px', borderRadius: 16, border: 'none',
            background: '#2d8a4e', color: '#fff', fontWeight: 900, fontSize: 18,
            textDecoration: 'none', marginBottom: 10,
            boxShadow: '0 4px 16px rgba(45,138,78,.4)',
            animation: !called ? 'pulseCta 1.5s infinite' : 'none',
          }}
        >
          <Phone size={22} />
          📞 지금 전화하기
          {called && <CheckCircle size={18} color="rgba(255,255,255,.8)" />}
        </a>

        {/* 문자 보내기 */}
        <button
          onClick={handleSms}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            width: '100%', padding: '14px', borderRadius: 14, border: '1.5px solid #e5e7eb',
            background: '#fff', color: '#374151', fontWeight: 700, fontSize: 16,
            fontFamily: 'inherit', cursor: 'pointer', marginBottom: 10,
          }}
        >
          <MessageCircle size={18} color="#6b7280" />
          💬 문자 보내기
          {messaged && <CheckCircle size={16} color="#15803d" />}
        </button>

        {/* 연락처 표시 + 복사 */}
        <div style={{
          background: '#f0fdf4', borderRadius: 12, padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16, border: '1px solid #bbf7d0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Phone size={16} color="#15803d" />
            <span style={{ fontSize: 16, fontWeight: 800, color: '#1f2937', letterSpacing: 1 }}>
              {contact}
            </span>
          </div>
          <button
            onClick={() => { navigator.clipboard?.writeText(contact); }}
            style={{
              fontSize: 11, color: '#2d8a4e', fontWeight: 700,
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >복사</button>
        </div>

        {/* 내 지원 현황 보기 */}
        <button
          onClick={onViewMyApplications}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            width: '100%', padding: '12px', borderRadius: 12, border: 'none',
            background: 'none', color: '#9ca3af', fontWeight: 600, fontSize: 13,
            fontFamily: 'inherit', cursor: 'pointer',
          }}
        >
          내 지원 현황 보기 <ChevronRight size={14} />
        </button>
      </div>

      <style>{`
        @keyframes fadeIn   { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp  { from { transform: translateY(100%) } to { transform: none } }
        @keyframes pulseCta {
          0%, 100% { box-shadow: 0 4px 16px rgba(45,138,78,.4); }
          50%       { box-shadow: 0 4px 28px rgba(45,138,78,.7); }
        }
      `}</style>
    </div>
  );
}

// ── JobDetailPage 통합 훅 ──────────────────────────────────────
export function useApply({ jobId, userId, workerName, workerPhone }) {
  const [applying,  setApplying]  = useState(false);
  const [result,    setResult]    = useState(null); // { contact, farmerName, ... }
  const [error,     setError]     = useState('');

  async function applyJob() {
    if (!userId || !workerPhone) {
      setError('로그인이 필요합니다.');
      return;
    }
    setApplying(true);
    setError('');
    try {
      const res = await fetch(`/api/jobs/${jobId}/apply`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body:    JSON.stringify({ workerId: userId, workerName, workerPhone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '지원 실패');

      // 서버에서 contact 즉시 수신
      setResult(data);
      try { trackClientEvent('apply_success', { jobId, hasContact: !!data.contact }); } catch (_) {}
    } catch (e) {
      setError(e.message);
      try { trackClientEvent('apply_fail', { jobId, error: e.message }); } catch (_) {}
    } finally {
      setApplying(false);
    }
  }

  return { applyJob, applying, result, error };
}
