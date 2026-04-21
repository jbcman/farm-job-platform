import React, { useEffect, useState, useCallback } from 'react';
import { Phone, CheckCircle, RefreshCw, Loader2 } from 'lucide-react';

/**
 * OperatorPage — MVP 운영자 페이지
 * 경로: /ops
 *
 * 구성:
 *   [오늘 요약] 공고 N / 매칭 N / 결제 pending N
 *   [공고 리스트] 농민 | 작업 | 상태 | 결제 | 버튼 2개
 *     - ✅ 결제완료: POST /api/pay/mark-paid
 *     - 📞 전화하기: tel: link
 */

const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || '';

const STATUS_LABEL = {
  open:     { text: '모집중',  cls: 'bg-blue-100 text-blue-700' },
  matched:  { text: '매칭됨',  cls: 'bg-green-100 text-green-700' },
  closed:   { text: '완료',    cls: 'bg-gray-100 text-gray-500' },
  started:  { text: '진행중',  cls: 'bg-yellow-100 text-yellow-700' },
  completed:{ text: '종료',    cls: 'bg-gray-100 text-gray-400' },
};

const PAY_LABEL = {
  none:    { text: '-',        cls: 'text-gray-400' },
  pending: { text: '⏳ pending', cls: 'text-amber-600 font-bold' },
  paid:    { text: '✅ 완료',  cls: 'text-green-600 font-bold' },
};

export default function OperatorPage() {
  const [summary,  setSummary]  = useState(null);
  const [jobs,     setJobs]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [marking,  setMarking]  = useState(null); // jobId being marked
  const [error,    setError]    = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = ADMIN_KEY ? `?key=${encodeURIComponent(ADMIN_KEY)}` : '';
      const res  = await fetch(`/api/admin/ops/jobs${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '조회 실패');
      setSummary(data.summary);
      setJobs(data.jobs || []);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markPaid(jobId) {
    setMarking(jobId);
    try {
      const adminKey = ADMIN_KEY || prompt('관리자 키를 입력하세요') || '';
      const res  = await fetch('/api/pay/mark-paid', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ jobId, adminKey }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '처리 실패');
      // 로컬 상태 즉시 반영
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, payStatus: 'paid' } : j));
      if (summary) setSummary(s => ({ ...s, payPending: Math.max(0, (s.payPending || 0) - 1) }));
    } catch (e) {
      alert('오류: ' + e.message);
    } finally {
      setMarking(null);
    }
  }

  const fmtDate = (iso) => {
    if (!iso) return '-';
    return iso.slice(0, 10);
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between sticky top-0 z-10">
        <h1 className="text-lg font-black text-green-700">🌾 운영자</h1>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-gray-500 active:scale-95 transition-transform"
        >
          {loading
            ? <Loader2 size={15} className="animate-spin" />
            : <RefreshCw size={15} />}
          새로고침
        </button>
      </div>

      {/* 오늘 요약 */}
      {summary && (
        <div className="mx-4 mt-4 bg-white rounded-2xl border border-gray-200 px-5 py-4">
          <p className="text-xs text-gray-400 mb-3 font-medium">오늘 요약</p>
          <div className="flex gap-6">
            <div className="text-center">
              <p className="text-2xl font-black text-gray-800">{summary.jobsToday}</p>
              <p className="text-xs text-gray-500 mt-0.5">공고</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-black text-green-700">{summary.matchedToday}</p>
              <p className="text-xs text-gray-500 mt-0.5">매칭</p>
            </div>
            <div className="text-center">
              <p className={`text-2xl font-black ${summary.payPending > 0 ? 'text-amber-500' : 'text-gray-400'}`}>
                {summary.payPending}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">결제 pending</p>
            </div>
          </div>
          {lastRefresh && (
            <p className="text-xs text-gray-300 mt-3">
              {lastRefresh.toLocaleTimeString('ko-KR')} 기준
            </p>
          )}
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div className="mx-4 mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
          ⚠️ {error}
        </div>
      )}

      {/* 공고 리스트 */}
      <div className="mx-4 mt-4 space-y-2.5">
        {loading && !jobs.length && (
          <div className="text-center py-10 text-gray-400 text-sm">불러오는 중...</div>
        )}
        {!loading && !jobs.length && !error && (
          <div className="text-center py-10 text-gray-400 text-sm">공고가 없어요.</div>
        )}

        {jobs.map(job => {
          const statusInfo = STATUS_LABEL[job.status] || { text: job.status, cls: 'bg-gray-100 text-gray-500' };
          const payInfo    = PAY_LABEL[job.payStatus]  || PAY_LABEL['none'];
          const isMarking  = marking === job.id;

          return (
            <div
              key={job.id}
              className={`bg-white rounded-2xl border px-4 py-4 shadow-sm
                ${job.payStatus === 'pending' ? 'border-amber-300' : 'border-gray-200'}`}
            >
              {/* 상단: 농민 + 작업 + 날짜 */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-800 truncate">
                    {job.farmerName || '(이름 없음)'}
                    {job.farmerPhone && (
                      <span className="ml-1.5 text-xs text-gray-400 font-normal">{job.farmerPhone}</span>
                    )}
                  </p>
                  <p className="text-sm text-gray-600 mt-0.5">
                    {job.category}
                    {job.locationText && <span className="text-gray-400"> · {job.locationText}</span>}
                  </p>
                </div>
                <p className="text-xs text-gray-400 whitespace-nowrap mt-0.5">{fmtDate(job.workDate || job.createdAt)}</p>
              </div>

              {/* 배지 행 */}
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.cls}`}>
                  {statusInfo.text}
                </span>
                {job.isUrgentPaid ? (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600">
                    🔥 긴급
                  </span>
                ) : null}
                <span className={`text-xs ${payInfo.cls}`}>
                  {payInfo.text}
                  {job.payMethod && job.payStatus === 'pending' && (
                    <span className="ml-1 text-gray-400 font-normal">({job.payMethod})</span>
                  )}
                </span>
              </div>

              {/* 버튼 행 */}
              <div className="flex gap-2">
                {/* 결제 완료 버튼: payStatus가 pending일 때만 활성 */}
                <button
                  onClick={() => markPaid(job.id)}
                  disabled={job.payStatus !== 'pending' || isMarking}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-bold
                    transition-all active:scale-95
                    ${job.payStatus === 'pending'
                      ? 'bg-green-500 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                >
                  {isMarking
                    ? <Loader2 size={14} className="animate-spin" />
                    : <CheckCircle size={14} />}
                  {job.payStatus === 'paid' ? '결제 완료됨' : '✅ 결제완료'}
                </button>

                {/* 전화하기 버튼 */}
                {job.farmerPhone ? (
                  <a
                    href={`tel:${job.farmerPhone.replace(/[^0-9]/g, '')}`}
                    className="flex-1"
                  >
                    <button className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl
                                       text-sm font-bold bg-blue-50 text-blue-600 border border-blue-200
                                       active:scale-95 transition-transform">
                      <Phone size={14} />
                      📞 전화하기
                    </button>
                  </a>
                ) : (
                  <button
                    disabled
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl
                               text-sm font-bold bg-gray-100 text-gray-400 cursor-not-allowed"
                  >
                    <Phone size={14} />
                    번호 없음
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
