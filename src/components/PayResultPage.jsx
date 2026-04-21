import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { confirmPayment } from '../utils/api.js';

/**
 * PayResultPage — 토스페이먼츠 리다이렉트 결과 처리
 *
 * /pay/success?paymentKey=xxx&orderId=xxx&amount=xxx
 * /pay/fail?code=xxx&message=xxx&orderId=xxx
 */
export default function PayResultPage({ type, onDone }) {
  const [status,  setStatus]  = useState('processing'); // processing | ok | fail
  const [message, setMessage] = useState('');
  const [jobId,   setJobId]   = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (type === 'success') {
      const paymentKey = params.get('paymentKey');
      const orderId    = params.get('orderId');
      const amount     = parseInt(params.get('amount'), 10) || 0;

      confirmPayment({ paymentKey, orderId, amount })
        .then(res => {
          setStatus('ok');
          setJobId(res.jobId);
          setMessage(res.isFree
            ? '🎁 무료 체험이 시작됐어요! 긴급 공고가 상단에 노출됩니다.'
            : '✅ 결제가 완료됐어요! 긴급 공고가 상단에 노출됩니다.');
          // sessionStorage 정리
          try { sessionStorage.removeItem('pay-pending-jobId'); } catch (_) {}
        })
        .catch(e => {
          setStatus('fail');
          setMessage(e.message || '결제 처리 중 오류가 발생했어요.');
        });
    } else {
      // fail
      const code    = params.get('code');
      const msg     = params.get('message');
      const orderId = params.get('orderId');
      setStatus('fail');
      setMessage(msg || '결제가 취소됐어요. 공고는 정상 등록됐으니 걱정마세요.');
      console.warn('[PAY_FAIL_REDIRECT]', code, msg, orderId);
    }

    // URL 정리 (SPA 히스토리)
    window.history.replaceState({}, '', '/');
  }, [type]);

  return (
    <div className="min-h-screen bg-farm-bg flex flex-col items-center justify-center gap-5 px-6">
      {status === 'processing' && (
        <>
          <Loader2 size={48} className="text-farm-green animate-spin" />
          <p className="text-lg font-bold text-gray-700">결제 확인 중...</p>
        </>
      )}

      {status === 'ok' && (
        <>
          <CheckCircle size={64} className="text-farm-green" />
          <p className="text-2xl font-black text-gray-800">완료!</p>
          <p className="text-sm text-center text-gray-600 leading-relaxed">{message}</p>
          <button
            onClick={() => onDone?.(jobId)}
            className="btn-primary px-8 py-3 text-base font-bold rounded-2xl mt-2"
          >
            공고 확인하러 가기
          </button>
        </>
      )}

      {status === 'fail' && (
        <>
          <XCircle size={64} className="text-red-400" />
          <p className="text-2xl font-black text-gray-800">결제 실패</p>
          <p className="text-sm text-center text-gray-500 leading-relaxed">{message}</p>
          <div className="flex flex-col gap-2 w-full max-w-xs mt-2">
            <button
              onClick={() => onDone?.(null)}
              className="btn-primary py-3 text-base font-bold rounded-2xl"
            >
              홈으로 돌아가기
            </button>
            <p className="text-xs text-center text-gray-400">
              공고는 정상 등록됐어요. 긴급 공고는 나중에 다시 신청할 수 있어요.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
