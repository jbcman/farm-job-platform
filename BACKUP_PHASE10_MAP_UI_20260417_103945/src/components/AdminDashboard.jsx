import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, AlertTriangle, Activity, BarChart2,
  Briefcase, Users, CheckCircle, XCircle, ArrowLeft,
} from 'lucide-react';

// ── API 헬퍼 ────────────────────────────────────────────────────
async function adminFetch(path, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;
  const res  = await fetch(`/api${path}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || '요청 실패');
  return data;
}

// ── 소형 KPI 카드 ────────────────────────────────────────────────
function KpiCard({ label, value, sub, color = 'green' }) {
  const colors = {
    green:  'bg-green-50  text-green-700  border-green-200',
    amber:  'bg-amber-50  text-amber-700  border-amber-200',
    blue:   'bg-blue-50   text-blue-700   border-blue-200',
    red:    'bg-red-50    text-red-600    border-red-200',
    gray:   'bg-gray-50   text-gray-600   border-gray-200',
  };
  return (
    <div className={`rounded-2xl border p-4 ${colors[color]}`}>
      <p className="text-xs font-semibold opacity-70 mb-1">{label}</p>
      <p className="text-3xl font-black">{value ?? '—'}</p>
      {sub && <p className="text-xs mt-1 opacity-60">{sub}</p>}
    </div>
  );
}

// ── 퍼널 바 ─────────────────────────────────────────────────────
function FunnelBar({ label, rate, max = 1, color }) {
  const pct = Math.min(100, Math.round((rate / (max || 1)) * 100));
  const barColors = {
    green: 'bg-farm-green',
    amber: 'bg-amber-400',
    red:   'bg-red-400',
  };
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm text-gray-600">{label}</span>
        <span className="text-sm font-bold text-gray-800">{(rate * 100).toFixed(1)}%</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2.5">
        <div
          className={`h-2.5 rounded-full ${barColors[color] || 'bg-farm-green'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── 이벤트 아이콘 ─────────────────────────────────────────────────
function EventIcon({ type }) {
  const MAP = {
    JOB_CREATED: { icon: Briefcase, cls: 'text-farm-green' },
    APPLY:       { icon: Users,      cls: 'text-blue-500'  },
    MATCHED:     { icon: CheckCircle, cls: 'text-purple-500' },
    CLOSED:      { icon: XCircle,   cls: 'text-red-500'   },
    COMPLETED:   { icon: CheckCircle, cls: 'text-amber-500' },
  };
  const { icon: Icon, cls } = MAP[type] || { icon: Activity, cls: 'text-gray-400' };
  return <Icon size={15} className={cls} />;
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)   return `${diff}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

// ── 키 입력 게이트 ────────────────────────────────────────────────
function KeyGate({ onSubmit }) {
  const [input, setInput] = useState('');
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-6">
      <div className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl">
        <p className="text-2xl font-black text-gray-800 mb-1">관리자 대시보드</p>
        <p className="text-sm text-gray-500 mb-6">접근 키를 입력하세요</p>
        <form onSubmit={e => { e.preventDefault(); onSubmit(input); }}>
          <input
            type="password"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Admin key"
            autoFocus
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm mb-3
                       focus:outline-none focus:border-farm-green"
          />
          <button
            type="submit"
            className="w-full py-3 bg-farm-green text-white font-bold rounded-xl"
          >
            접속
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-3 text-center">
          ENV: ADMIN_KEY 미설정 시 키 없이 접속 가능
        </p>
      </div>
    </div>
  );
}

// ── 메인 대시보드 ────────────────────────────────────────────────
export default function AdminDashboard({ onBack }) {
  const [adminKey,  setAdminKey]  = useState(() => sessionStorage.getItem('admin-key') || '');
  const [showGate,  setShowGate]  = useState(false);
  const [metrics,   setMetrics]   = useState(null);
  const [activity,  setActivity]  = useState([]);
  const [stale,     setStale]     = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [lastFetch, setLastFetch] = useState(null);

  const load = useCallback(async (key) => {
    const k = key ?? adminKey;
    setLoading(true);
    setError('');
    try {
      const [m, a, s] = await Promise.all([
        adminFetch('/admin/metrics',          k),
        adminFetch('/admin/activity?limit=20', k),
        adminFetch('/admin/stale-jobs',        k),
      ]);
      setMetrics(m);
      setActivity(a.activity || []);
      setStale(s.staleJobs   || []);
      setLastFetch(new Date());
      setShowGate(false);
    } catch (e) {
      if (e.message === '관리자 키가 필요해요.') {
        setShowGate(true);
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => { load(adminKey || ''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleKeySubmit(k) {
    sessionStorage.setItem('admin-key', k);
    setAdminKey(k);
    load(k);
  }

  if (showGate) return <KeyGate onSubmit={handleKeySubmit} />;

  const m = metrics;

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-12">
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
              <p className="font-black text-white text-base">🌾 관리자 대시보드</p>
              {lastFetch && (
                <p className="text-xs text-gray-500">{timeAgo(lastFetch.toISOString())} 업데이트</p>
              )}
            </div>
          </div>
          <button
            onClick={() => load()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 rounded-xl text-sm
                       text-gray-300 hover:bg-gray-700 disabled:opacity-40 transition"
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

        {/* ── 1. 오늘 KPI ───────────────────────────────── */}
        <section>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <BarChart2 size={13} /> 오늘 현황
          </p>
          <div className="grid grid-cols-2 gap-3">
            <KpiCard label="오늘 등록"   value={m?.today.jobs}         color="green" />
            <KpiCard label="오늘 지원"   value={m?.today.applications} color="blue"  />
            <KpiCard label="오늘 매칭"   value={m?.today.matches}      color="amber" />
            <KpiCard label="오늘 마감"   value={m?.today.closed}       color="red"   />
          </div>
        </section>

        {/* ── 2. 전체 상태 현황 ─────────────────────────── */}
        <section>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <Briefcase size={13} /> 전체 일자리 상태
          </p>
          <div className="grid grid-cols-3 gap-3">
            <KpiCard label="모집중"  value={m?.totals.open}    color="green" />
            <KpiCard label="연결완료" value={m?.totals.matched} color="blue"  />
            <KpiCard label="마감"    value={m?.totals.closed}  color="gray"  />
          </div>
        </section>

        {/* ── 3. 퍼널 ───────────────────────────────────── */}
        <section>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <Activity size={13} /> 전환 퍼널
          </p>
          <div className="bg-gray-900 rounded-2xl border border-gray-800 px-5 py-4 space-y-4">
            <FunnelBar label="지원율 (지원 / 등록)"       rate={m?.funnel.applyRate || 0} max={5}  color="green" />
            <FunnelBar label="매칭율 (매칭 / 지원)"       rate={m?.funnel.matchRate || 0} max={1}  color="amber" />
            <FunnelBar label="마감율 (마감 / 매칭)"       rate={m?.funnel.closeRate || 0} max={1}  color="red"   />
            <div className="border-t border-gray-800 pt-3 grid grid-cols-3 text-center">
              <div>
                <p className="text-xl font-black text-green-400">{((m?.funnel.applyRate || 0) * 100).toFixed(0)}%</p>
                <p className="text-xs text-gray-500">지원율</p>
              </div>
              <div>
                <p className="text-xl font-black text-amber-400">{((m?.funnel.matchRate || 0) * 100).toFixed(0)}%</p>
                <p className="text-xs text-gray-500">매칭율</p>
              </div>
              <div>
                <p className="text-xl font-black text-red-400">{((m?.funnel.closeRate || 0) * 100).toFixed(0)}%</p>
                <p className="text-xs text-gray-500">마감율</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 4. 알림 현황 ──────────────────────────────── */}
        <section>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <CheckCircle size={13} /> 알림 현황
          </p>
          <div className="grid grid-cols-2 gap-3">
            <KpiCard label="오늘 발송" value={m?.alerts.sentToday} color="green" />
            <KpiCard label="누적 발송" value={m?.alerts.total}     color="gray"  />
          </div>
        </section>

        {/* ── 5. 경고: 오래된 일자리 ───────────────────── */}
        {stale.length > 0 && (
          <section>
            <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <AlertTriangle size={13} /> 24시간 미매칭 경고 ({stale.length}건)
            </p>
            <div className="space-y-2">
              {stale.slice(0, 10).map(j => (
                <div key={j.jobId}
                  className="bg-amber-950/40 border border-amber-800/60 rounded-2xl px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-amber-200 text-sm">{j.category}</p>
                    <p className="text-xs text-amber-400/80">{j.locationText}</p>
                  </div>
                  <span className="text-sm font-black text-amber-400">{j.hoursOpen}시간</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── 6. 최근 활동 ──────────────────────────────── */}
        <section>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <Activity size={13} /> 최근 활동
          </p>
          {activity.length === 0 && (
            <p className="text-gray-600 text-sm text-center py-6">이벤트 없음</p>
          )}
          <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
            {activity.map((ev, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <EventIcon type={ev.type} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-200">{ev.type}</p>
                  {ev.jobId && (
                    <p className="text-xs text-gray-500 truncate">{ev.jobId}</p>
                  )}
                </div>
                <span className="text-xs text-gray-600 shrink-0">{timeAgo(ev.time)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
