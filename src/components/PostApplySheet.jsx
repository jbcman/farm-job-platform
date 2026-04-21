import React, { useEffect, useState } from 'react';
import { Phone, X, Clock, MessageSquare, CreditCard, Building2 } from 'lucide-react';
import { trackClientEvent, requestPay } from '../utils/api.js';
import { getPaySmsLink, getPhoneLink, getBankCopyText, BANK_INFO } from '../utils/payLink.js';

/**
 * PostApplySheet — 지원 직후 강제 행동 유도 바텀시트
 *
 * Props:
 *   phone      string | null
 *   jobName    string
 *   jobId      string
 *   job        object | null  — full job object (isUrgentPaid, payStatus 등)
 *   onClose    () => void
 */
const URGENCY_SEC = 300;

export default function PostApplySheet({ phone, jobName, jobId, job, onClose }) {
  const [sec,      setSec]      = useState(URGENCY_SEC);
  const [copied,   setCopied]   = useState(false);
  const [payDone,  setPayDone]  = useState(false);  // 결제 요청 완료 상태

  // 카운트다운
  useEffect(() => {
    const t = setInterval(() => setSec(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const mm     = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss_str = String(sec % 60).padStart(2, '0');
  const urgent = sec < 60;

  // 결제 유도 블록 표시 조건
  const showPayBlock = job?.isUrgentPaid && job?.payStatus !== 'paid' && !payDone;

  async function handlePayClick(method) {
    try {
      trackClientEvent('pay_click', { jobId, method });
      await requestPay(jobId, method);
      setPayDone(true);
    } catch (_) {}
  }

  function copyBank() {
    const text = getBankCopyText();
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {});
    try { handlePayClick('bank'); } catch (_) {}
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white w-full max-w-md rounded-t-2xl px-6 pt-5 pb-8 shadow-2xl animate-fade-in">
        {/* 핸들 */}
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />

        {/* 닫기 */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 active:scale-90 transition-transform"
        >
          <X size={20} />
        </button>

        {/* 헤드라인 */}
        <h2 className="text-lg font-black text-red-500 mb-1">
          🔥 지금 바로 연락하세요
        </h2>
        <p className="text-sm font-semibold text-red-500 mb-4">
          ⏳ 5분 안에 연락 안 하면 다른 사람이 가져갈 수 있습니다
        </p>

        {/* 카운트다운 */}
        <div className={`flex items-center justify-center gap-2 rounded-xl py-3 mb-5
          ${urgent ? 'bg-red-50' : 'bg-amber-50'}`}>
          <Clock size={18} className={urgent ? 'text-red-500' : 'text-amber-500'} />
          <span className={`text-2xl font-black tabular-nums ${urgent ? 'text-red-600' : 'text-amber-600'}`}>
            {mm}:{ss_str}
          </span>
          <span className="text-sm text-gray-500">남았습니다</span>
        </div>

        {/* 전화 + SMS 버튼 */}
        {phone ? (
          <>
            <a
              href={`tel:${phone.replace(/[^0-9]/g, '')}`}
              className="block mb-2"
              onClick={() => { try { trackClientEvent('call_click', { jobId, jobName }); } catch (_) {} }}
            >
              <button
                className="w-full bg-red-500 text-white font-black text-lg py-4 rounded-2xl
                           flex items-center justify-center gap-2
                           active:scale-95 transition-transform shadow-lg"
              >
                <Phone size={20} />
                📞 지금 전화하기 ({phone})
              </button>
            </a>
            <a
              href={`sms:${phone.replace(/[^0-9]/g, '')}`}
              className="block"
              onClick={() => { try { trackClientEvent('sms_click', { jobId, jobName }); } catch (_) {} }}
            >
              <button
                className="w-full bg-white border-2 border-red-300 text-red-500 font-bold text-base py-3 rounded-2xl
                           flex items-center justify-center gap-2
                           active:scale-95 transition-transform"
              >
                <MessageSquare size={18} />
                💬 문자 보내기
              </button>
            </a>
          </>
        ) : (
          <div className="w-full bg-gray-100 text-gray-500 font-bold text-base py-4 rounded-2xl
                          flex items-center justify-center gap-2 text-center">
            <Clock size={18} />
            농민이 확인 후 연락이 갑니다<br />
            <span className="text-xs font-normal">{jobName} 지원 완료</span>
          </div>
        )}

        {/* ─── PHASE FARMER_PAY_UX: 긴급 공고 결제 유도 블록 ─────── */}
        {showPayBlock && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-2xl px-4 py-4">
            <p className="text-sm font-black text-green-700 mb-3">
              🌾 긴급 공고 효과 좋으면 결제 부탁드려요
            </p>
            <div className="space-y-2">
              {/* 카카오/문자 결제 요청 */}
              <a
                href={getPaySmsLink(job)}
                onClick={() => handlePayClick('kakao')}
                className="block"
              >
                <button className="w-full bg-yellow-400 text-gray-800 font-bold text-sm py-2.5 rounded-xl
                                   flex items-center justify-center gap-2 active:scale-95 transition-transform">
                  <MessageSquare size={15} />
                  💬 카카오/문자로 결제 요청
                </button>
              </a>

              {/* 계좌이체 */}
              <button
                onClick={copyBank}
                className="w-full bg-blue-50 border border-blue-200 text-blue-700 font-bold text-sm py-2.5 rounded-xl
                           flex items-center justify-center gap-2 active:scale-95 transition-transform"
              >
                <Building2 size={15} />
                {copied ? '✅ 복사됐어요!' : `🏦 계좌이체 (${BANK_INFO.bank} ${BANK_INFO.account})`}
              </button>

              {/* 전화 결제 안내 */}
              <a
                href={getPhoneLink()}
                onClick={() => handlePayClick('phone')}
                className="block"
              >
                <button className="w-full bg-white border border-gray-200 text-gray-600 font-bold text-sm py-2.5 rounded-xl
                                   flex items-center justify-center gap-2 active:scale-95 transition-transform">
                  <Phone size={15} />
                  📞 전화로 결제 안내
                </button>
              </a>
            </div>
            <p className="text-xs text-gray-400 text-center mt-2">결제는 강제가 아니에요 — 효과 보신 후 편하게 해주세요</p>
          </div>
        )}
        {payDone && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center">
            <p className="text-sm font-bold text-green-700">✅ 결제 요청이 접수됐어요. 감사합니다!</p>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full mt-3 py-2.5 text-sm text-gray-400 font-medium"
        >
          나중에 하기
        </button>
      </div>
    </div>
  );
}
