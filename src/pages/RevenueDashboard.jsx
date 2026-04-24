import React, { useState, useEffect, useCallback } from 'react';
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from 'recharts';
import { RefreshCw, ArrowLeft, TrendingUp, DollarSign, Percent, Award } from 'lucide-react';

// ─── 포맷 헬퍼 ───────────────────────────────────────────────────
function fmt(n) {
  if (!n || n === 0) return '₩0';
  if (n >= 100_000_000) return `₩${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000)      return `₩${Math.round(n / 10_000)}만`;
  return `₩${Number(n).toLocaleString()}`;
}
function fmtFull(n) {
  return n ? `₩${Number(n).toLocaleString()}` : '₩0';
}
function timeAgo(iso) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (d < 60)   return `${d}초 전`;
  if (d < 3600) return `${Math.floor(d / 60)}분 전`;
  return `${Math.floor(d / 3600)}시간 전`;
}

// ─── recharts 커스텀 툴팁 ────────────────────────────────────────
function RevenueTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm shadow-xl">
      <p className="text-gray-300 font-bold mb-2">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-mono">
          {p.name}: {fmtFull(p.value)}
        </p>
      ))}
    </div>
  );
}

// ─── 요약 카드 ───────────────────────────────────────────────────
function SummaryCard({ icon: Icon, label, value, sub, color }) {
  const colors = {
    green:  'text-green-400  border-green-800  bg-green-950/30',
    blue:   'text-blue-400   border-blue-800   bg-blue-950/30',
    amber:  'text-amber-400  border-amber-800  bg-amber-950/30',
    purple: 'text-purple-400 border-purple-800 bg-purple-950/30',
  };
  return (
    <div className={`rounded-2xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-2 opacity-70">
        <Icon size={13} />
        <p className="text-xs font-bold">{label}</p>
      </div>
      <p className="text-2xl font-black">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
    </div>
  );
}

// ─── 메인 ────────────────────────────────────────────────────────
export default function RevenueDashboard({ onBack }) {
  const [data,      setData]      = useState({ daily: [], monthly: [], summary: {} });
  const [tab,       setTab]       = useState('daily');
  const [chartType, setChartType] = useState('bar');   // 'bar' | 'line'
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [lastFetch, setLastFetch] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/admin/revenue');
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || '조회 실패');
      setData(json);
      setLastFetch(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows    = tab === 'daily' ? data.daily : data.monthly;
  const xKey    = tab === 'daily' ? 'date'     : 'month';
  const s       = data.summary || {};

  // 차트용 데이터 (라벨 단축)
  const chartData = rows.map(r => ({
    ...r,
    label: tab === 'daily'
      ? (r.date || '').slice(5)        // 'MM-DD'
      : (r.month || '').slice(0, 7),   // 'YYYY-MM'
  }));

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-16">

      {/* 헤더 */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-4 sticky top-0 z-30">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onBack && (
              <button onClick={onBack} className="p-1 text-gray-400 hover:text-white">
                <ArrowLeft size={20} />
              </button>
            )}
            <div>
              <p className="font-black text-white text-base">💰 수익 대시보드</p>
              {lastFetch && (
                <p className="text-xs text-gray-500">{timeAgo(lastFetch.toISOString())} 업데이트</p>
              )}
            </div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 rounded-xl
                       text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40 transition"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            새로고침
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-6">

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-2xl px-4 py-3 text-red-300 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* ── 누적 요약 카드 4종 ────────────────────────────── */}
        <section>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <Award size={13} /> 누적 수익 현황
          </p>
          <div className="grid grid-cols-2 gap-3">
            <SummaryCard icon={DollarSign} label="총 매출"        color="blue"
              value={fmt(s.totalRevenue)}  sub={`${s.totalCount ?? 0}건 완료`} />
            <SummaryCard icon={TrendingUp} label="플랫폼 수수료"  color="green"
              value={fmt(s.totalFee)}      sub="10% 기준" />
            <SummaryCard icon={Percent}    label="작업자 정산액"  color="amber"
              value={fmt(s.totalNet)}      sub="수수료 제외" />
            <SummaryCard icon={Award}      label="건당 평균 매출" color="purple"
              value={fmt(s.totalCount > 0 ? Math.round(s.totalRevenue / s.totalCount) : 0)}
              sub="완료 작업 기준" />
          </div>
        </section>

        {/* ── 탭 + 차트 종류 전환 ──────────────────────────── */}
        <div className="flex gap-2">
          <div className="flex flex-1 bg-gray-900 rounded-2xl p-1 border border-gray-800">
            {['daily', 'monthly'].map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition ${
                  tab === t ? 'bg-green-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'
                }`}>
                {t === 'daily' ? '📅 일별' : '🗓 월별'}
              </button>
            ))}
          </div>
          <div className="flex bg-gray-900 rounded-2xl p-1 border border-gray-800">
            {['bar', 'line'].map(c => (
              <button key={c} onClick={() => setChartType(c)}
                className={`px-3 py-2.5 rounded-xl text-sm font-bold transition ${
                  chartType === c ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'
                }`}>
                {c === 'bar' ? '📊' : '📈'}
              </button>
            ))}
          </div>
        </div>

        {/* ── 매출 차트 ─────────────────────────────────────── */}
        <section>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
            {tab === 'daily' ? '📅 일별 매출 그래프' : '🗓 월별 매출 그래프'}
          </p>

          {rows.length === 0 ? (
            <div className="bg-gray-900 border border-dashed border-gray-700 rounded-2xl px-5 py-12 text-center space-y-2">
              <p className="text-4xl">📊</p>
              <p className="text-gray-400 font-bold text-sm">아직 완료된 작업이 없어요</p>
              <p className="text-gray-600 text-xs">작업 완료 + paid=1 이후 차트가 표시됩니다</p>
              {/* 샘플 미리보기 */}
              <div className="mt-4 bg-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 font-bold mb-3">샘플 예시</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={[
                    { label: '04-20', total: 100000, fee: 10000, net: 90000 },
                    { label: '04-21', total: 150000, fee: 15000, net: 135000 },
                    { label: '04-22', total: 80000,  fee: 8000,  net: 72000  },
                    { label: '04-23', total: 200000, fee: 20000, net: 180000 },
                    { label: '04-24', total: 120000, fee: 12000, net: 108000 },
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={v => `${v/10000}만`} />
                    <Tooltip content={<RevenueTooltip />} />
                    <Bar dataKey="total" name="총매출" fill="#3b82f6" radius={[4,4,0,0]} opacity={0.5} />
                    <Bar dataKey="net"   name="순수익" fill="#22c55e" radius={[4,4,0,0]} opacity={0.5} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <ResponsiveContainer width="100%" height={280}>
                {chartType === 'bar' ? (
                  <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                    <YAxis
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                      tickFormatter={v => v >= 10000 ? `${Math.round(v/10000)}만` : v}
                      width={45}
                    />
                    <Tooltip content={<RevenueTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: 12, color: '#9ca3af' }}
                    />
                    <Bar dataKey="total" name="총매출" fill="#3b82f6" radius={[4,4,0,0]} />
                    <Bar dataKey="fee"   name="수수료" fill="#f59e0b" radius={[4,4,0,0]} />
                    <Bar dataKey="net"   name="순수익" fill="#22c55e" radius={[4,4,0,0]} />
                  </BarChart>
                ) : (
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                    <YAxis
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                      tickFormatter={v => v >= 10000 ? `${Math.round(v/10000)}만` : v}
                      width={45}
                    />
                    <Tooltip content={<RevenueTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                    <Line type="monotone" dataKey="total" name="총매출"
                      stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="fee"   name="수수료"
                      stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} strokeDasharray="5 3" />
                    <Line type="monotone" dataKey="net"   name="순수익"
                      stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* ── 상세 데이터 테이블 ────────────────────────────── */}
        <section>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
            📋 {tab === 'daily' ? '일별' : '월별'} 상세 데이터
          </p>
          {rows.length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-6">데이터 없음</p>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              {/* 헤더 */}
              <div className="grid grid-cols-4 gap-2 px-4 py-2.5 bg-gray-800/60 border-b border-gray-700
                              text-xs font-bold text-gray-400">
                <span>{tab === 'daily' ? '날짜' : '월'}</span>
                <span className="text-right text-blue-400">총 매출</span>
                <span className="text-right text-amber-400">수수료</span>
                <span className="text-right text-green-400">순수익</span>
              </div>
              {/* 행 (최신순 역방향 출력) */}
              {[...rows].reverse().map(r => (
                <div key={r[xKey]}
                  className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-gray-800/60
                             last:border-0 hover:bg-gray-800/30 transition text-sm">
                  <div>
                    <p className="font-bold text-gray-200">{r[xKey]}</p>
                    <p className="text-xs text-gray-500">{r.count}건</p>
                  </div>
                  <p className="text-right font-mono text-blue-300">{fmtFull(r.total)}</p>
                  <p className="text-right font-mono text-amber-400">{fmtFull(r.fee)}</p>
                  <p className="text-right font-mono font-black text-green-400">{fmtFull(r.net)}</p>
                </div>
              ))}
              {/* 합계 행 */}
              <div className="grid grid-cols-4 gap-2 px-4 py-3 bg-gray-800/40 text-sm font-black">
                <p className="text-gray-400">합계</p>
                <p className="text-right font-mono text-blue-300">{fmtFull(s.totalRevenue)}</p>
                <p className="text-right font-mono text-amber-400">{fmtFull(s.totalFee)}</p>
                <p className="text-right font-mono text-green-400">{fmtFull(s.totalNet)}</p>
              </div>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
