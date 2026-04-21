import React, { useState } from 'react';
import { Star, Loader2, MessageSquare, Building2, Phone } from 'lucide-react';
import { trackClientEvent, requestPay } from '../utils/api.js';
import { getPaySmsLink, getPhoneLink, getBankCopyText, BANK_INFO } from '../utils/payLink.js';

/**
 * JobCompleteModal — PHASE FEEDBACK_LOOP_AI + PHASE FARMER_PAY_UX
 *
 * 작업 완료 후 평점 + 실제 난이도 수집.
 * isUrgentPaid=true이고 payStatus!='paid'이면 결제 CTA 표시.
 *
 * Props:
 *   job      { id, category, isUrgentPaid, payStatus }
 *   user     { id }
 *   onClose  () => void
 */
const DIFFICULTY_LABELS = [
  { value: 0.1, label: '매우 쉬움' },
  { value: 0.3, label: '쉬움' },
  { value: 0.5, label: '보통' },
  { value: 0.7, label: '어려움' },
  { value: 0.9, label: '매우 어려움' },
];

export default function JobCompleteModal({ job, user, onClose }) {
  const [rating,     setRating]     = useState(5);
  const [difficulty, setDifficulty] = useState(0.5);
  const [comment,    setComment]    = useState('');
  const [loading,    setLoading]    = useState(false);
  const [hoverStar,  setHoverStar]  = useState(null);

  // PHASE FARMER_PAY_UX
  const [showPay,  setShowPay]  = useState(false);
  const [copied,   setCopied]   = useState(false);
  const [payDone,  setPayDone]  = useState(false);

  const showPayBlock = job?.isUrgentPaid && job?.payStatus !== 'paid';

  const submit = async () => {
    setLoading(true);
    const userId = localStorage.getItem('farm-userId') || user?.id;
    const headers = { 'Content-Type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) };

    // ① AI 학습용 피드백 (fire-and-forget)
    fetch('/api/feedback', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jobId:            job.id,
        workerId:         user?.id,
        rating,
        actualDifficulty: difficulty,
      }),
    }).catch(() => {});

    // ② 신뢰 기반 리뷰
    try {
      await fetch('/api/reviews', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jobId:   job.id,
          rating,
          comment: comment.trim(),
        }),
      });
    } catch (_) {}

    setLoading(false);

    // PHASE FARMER_PAY_UX: 효과 좋으면(4~5점) 결제 CTA 표시
    if (showPayBlock && rating >= 4) {
      setShowPay(true);
      try { trackClientEvent('pay_intent_positive', { jobId: job.id }); } catch (_) {}
    } else {
      onClose?.();
    }
  };

  async function handlePayClick(method) {
    try {
      trackClientEvent('pay_click', { jobId: job.id, method });
      await requestPay(job.id, method);
      setPayDone(true);
    } catch (_) {}
  }

  function copyBank() {
    const text = getBankCopyText();
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {});
    handlePayClick('bank');
  }

  // ── 결제 CTA 화면 ──────────────────────────────────────────────
  if (showPay) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
      >
        <div className="bg-white w-full max-w-md rounded-t-2xl px-6 pt-6 pb-8 shadow-2xl animate-fade-in">
          <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
          <h3 className="text-lg font-black text-green-700 mb-1">🌾 효과 좋으셨군요!</h3>
          <p className="text-sm text-gray-500 mb-5">
            긴급 공고 덕분에 빨리 매칭됐다면 결제 부탁드려요.
            <br /><span className="text-xs">강제가 아닙니다 — 부담 없이 해주세요.</span>
          </p>

          {payDone ? (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-4 text-center mb-4">
              <p className="text-base font-black text-green-700">✅ 결제 요청 감사합니다!</p>
              <p className="text-xs text-gray-500 mt-1">확인 후 연락드릴게요.</p>
            </div>
          ) : (
            <div className="space-y-2 mb-4">
              <a href={getPaySmsLink(job)} onClick={() => handlePayClick('kakao')} className="block">
                <button className="w-full bg-yellow-400 text-gray-800 font-bold text-sm py-3 rounded-xl
                                   flex items-center justify-center gap-2 active:scale-95 transition-transform">
                  <MessageSquare size={16} />
                  💬 카카오/문자로 결제 요청
                </button>
              </a>
              <button
                onClick={copyBank}
                className="w-full bg-blue-50 border border-blue-200 text-blue-700 font-bold text-sm py-3 rounded-xl
                           flex items-center justify-center gap-2 active:scale-95 transition-transform"
              >
                <Building2 size={16} />
                {copied ? '✅ 복사됐어요!' : `🏦 계좌이체 (${BANK_INFO.bank} ${BANK_INFO.account})`}
              </button>
              <a href={getPhoneLink()} onClick={() => handlePayClick('phone')} className="block">
                <button className="w-full bg-white border border-gray-200 text-gray-600 font-bold text-sm py-3 rounded-xl
                                   flex items-center justify-center gap-2 active:scale-95 transition-transform">
                  <Phone size={16} />
                  📞 전화로 결제 안내
                </button>
              </a>
            </div>
          )}

          <button
            onClick={onClose}
            className="w-full py-2.5 text-sm text-gray-400 font-medium"
          >
            {payDone ? '닫기' : '나중에 할게요'}
          </button>
        </div>
      </div>
    );
  }

  // ── 기본 평가 화면 ─────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="bg-white w-full max-w-md rounded-t-2xl px-6 pt-6 pb-8 shadow-2xl animate-fade-in">
        {/* 핸들 */}
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />

        <h3 className="text-lg font-bold text-gray-800 mb-1">작업 평가</h3>
        <p className="text-sm text-gray-500 mb-5">
          {job.category} 작업 어떠셨나요?
          {showPayBlock && (
            <span className="ml-1.5 text-xs text-green-600 font-semibold">
              (효과 좋으면 결제 CTA가 나와요)
            </span>
          )}
        </p>

        {/* 별점 */}
        <div className="mb-5">
          <p className="text-sm font-semibold text-gray-700 mb-2">만족도</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHoverStar(n)}
                onMouseLeave={() => setHoverStar(null)}
                className="text-3xl transition-transform active:scale-90"
                style={{ lineHeight: 1 }}
              >
                <Star
                  size={28}
                  className={(hoverStar ?? rating) >= n
                    ? 'fill-amber-400 text-amber-400'
                    : 'text-gray-200'}
                />
              </button>
            ))}
          </div>
        </div>

        {/* 실제 난이도 */}
        <div className="mb-6">
          <p className="text-sm font-semibold text-gray-700 mb-3">실제 난이도</p>
          <div className="flex gap-2 flex-wrap">
            {DIFFICULTY_LABELS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setDifficulty(value)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all
                  ${difficulty === value
                    ? 'bg-farm-green text-white border-farm-green'
                    : 'bg-white text-gray-600 border-gray-200 active:scale-95'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 후기 코멘트 */}
        <div className="mb-6">
          <p className="text-sm font-semibold text-gray-700 mb-2">후기 <span className="text-gray-400 font-normal">(선택)</span></p>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            maxLength={200}
            rows={3}
            placeholder="작업 경험을 남겨주세요 (최대 200자)"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700
                       resize-none focus:outline-none focus:border-farm-green transition-colors"
          />
          <p className="text-right text-xs text-gray-400 mt-1">{comment.length}/200</p>
        </div>

        {/* 제출 */}
        <button
          onClick={submit}
          disabled={loading}
          className="btn-primary btn-full flex items-center justify-center gap-2"
        >
          {loading
            ? <><Loader2 size={16} className="animate-spin" /> 저장 중...</>
            : showPayBlock && rating >= 4
              ? '👍 평가 완료 → 결제 안내'
              : '평가 완료'}
        </button>

        <button
          onClick={onClose}
          className="w-full mt-3 py-2.5 text-sm text-gray-400 font-medium"
        >
          건너뛰기
        </button>
      </div>
    </div>
  );
}
