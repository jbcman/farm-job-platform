import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, AlertTriangle, Activity, BarChart2,
  Briefcase, Users, CheckCircle, XCircle, ArrowLeft,
  TrendingUp, Star, Award,
  ShieldOff, Shield, MapPin, Flag, Search, ChevronDown,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

// ── API 헬퍼 ────────────────────────────────────────────────────
async function adminFetch(path, key, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;
  const { method = 'GET', body } = options;
  const res  = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
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

// ── 매출 포맷 ────────────────────────────────────────────────────
function fmtRevenue(n) {
  if (!n || n === 0) return '₩0';
  if (n >= 100_000_000) return `₩${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000)      return `₩${Math.round(n / 10_000)}만`;
  return `₩${n.toLocaleString()}`;
}

// ── 별점 렌더 ────────────────────────────────────────────────────
function StarRating({ rating }) {
  const full = Math.round(rating || 0);
  return (
    <span className="text-amber-400 text-xs">
      {'★'.repeat(Math.min(full, 5))}{'☆'.repeat(Math.max(0, 5 - full))}
      <span className="text-gray-400 ml-1">{(rating || 0).toFixed(1)}</span>
    </span>
  );
}

// ── 메인 대시보드 ────────────────────────────────────────────────
export default function AdminDashboard({ onBack }) {
  const [adminKey,    setAdminKey]    = useState(() => sessionStorage.getItem('admin-key') || '');
  const [showGate,    setShowGate]    = useState(false);
  const [metrics,     setMetrics]     = useState(null);
  const [stats,       setStats]       = useState(null);
  const [topWorkers,  setTopWorkers]  = useState([]);
  const [activity,    setActivity]    = useState([]);
  const [todayRevenue,setTodayRevenue]= useState(null); // DESIGN_V3: 오늘 매출
  const [stale,       setStale]       = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [lastFetch,   setLastFetch]   = useState(null);
  // P1 자동 경보 (60초 폴링)
  const [alertStatus,  setAlertStatus]  = useState(null); // null | { p1, p1Count, p2Count, lastP1Type }
  const [alertDismissed, setAlertDismissed] = useState(false); // 수동 닫기 (새 P1 발생 시 재노출)
  const alertDismissedCountRef = useRef(0); // 닫을 당시 p1Count → 새 P1이면 재노출

  // ANALYTICS_TAB: 전환 퍼널
  const [activeTab,   setActiveTab]   = useState('ops'); // 'ops' | 'analytics' | 'users' | 'jobs-mgmt' | 'reports' | 'geo'
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  // ADMIN_TABS: 사용자 / 작업 / 신고 / 지도품질
  const [usersData,        setUsersData]        = useState([]);
  const [usersSearch,      setUsersSearch]       = useState('');
  const [usersLoading,     setUsersLoading]      = useState(false);
  const [jobsMgmtData,     setJobsMgmtData]      = useState([]);
  const [jobsMgmtSearch,   setJobsMgmtSearch]    = useState('');
  const [jobsMgmtLoading,  setJobsMgmtLoading]   = useState(false);
  const [reportsData,      setReportsData]       = useState([]);
  const [reportsLoading,   setReportsLoading]    = useState(false);
  const [geoData,          setGeoData]           = useState(null);
  const [geoLoading,       setGeoLoading]        = useState(false);
  // AUDIT_TAB
  const [auditLogs,        setAuditLogs]         = useState([]);
  const [auditLoading,     setAuditLoading]      = useState(false);
  // TEST_TAB
  const [testLogs,         setTestLogs]          = useState([]);
  const [testSummary,      setTestSummary]       = useState(null);
  const [testLoading,      setTestLoading]       = useState(false);
  const [testPriority,     setTestPriority]      = useState(''); // '' | '1' | '2' | '3'
  // E2E_TEST
  const [e2eRunning,  setE2eRunning]  = useState(false);
  const [e2eResults,  setE2eResults]  = useState(null); // null | { allOk, totalMs, steps[] }

  const load = useCallback(async (key) => {
    const k = key ?? adminKey;
    setLoading(true);
    setError('');
    try {
      const [m, st, tw, a, s, rev] = await Promise.all([
        adminFetch('/admin/metrics',           k),
        adminFetch('/admin/stats',             k),
        adminFetch('/admin/top-workers',       k),
        adminFetch('/admin/activity?limit=20', k),
        adminFetch('/admin/stale-jobs',        k),
        adminFetch('/admin/revenue',           k).catch(() => null), // DESIGN_V3: 오늘 매출
      ]);
      setMetrics(m);
      setStats(st);
      setTopWorkers(tw.workers || []);
      setActivity(a.activity || []);
      // DESIGN_V3: 오늘 매출 — daily 배열에서 오늘 날짜 엔트리 추출
      if (rev?.daily?.length) {
        const today = new Date().toISOString().slice(0, 10);
        const todayRow = rev.daily.find(r => r.date === today);
        setTodayRevenue(todayRow ? todayRow.total : 0);
      } else {
        setTodayRevenue(0);
      }
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

  // ── P1 자동 경보: 60초 폴링 ─────────────────────────────────────
  // Admin 탭이 열려 있는 동안 백그라운드에서 P1 감시
  useEffect(() => {
    if (showGate) return; // 인증 전에는 폴링 안 함

    async function checkAlert() {
      try {
        const d = await adminFetch('/admin/alert-status', adminKey);
        setAlertStatus(d);
        // 새 P1 발생 → dismiss 해제 (다시 배너 노출)
        if (d.p1Count > alertDismissedCountRef.current) {
          setAlertDismissed(false);
        }
      } catch (_) {} // 폴링 실패는 무시
    }

    checkAlert(); // 즉시 1회
    const id = setInterval(checkAlert, 60_000); // 60초마다
    return () => clearInterval(id);
  }, [adminKey, showGate]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleKeySubmit(k) {
    sessionStorage.setItem('admin-key', k);
    setAdminKey(k);
    load(k);
  }

  // ANALYTICS_TAB: 퍼널 데이터 로드
  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const [statsRes, summaryRes] = await Promise.all([
        fetch('/api/analytics/stats').then(r => r.json()),
        fetch('/api/analytics/summary').then(r => r.json()),
      ]);
      setAnalyticsData({ stats: statsRes, summary: summaryRes });
    } catch (e) {
      console.error('[ANALYTICS_TAB]', e);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'analytics') loadAnalytics();
  }, [activeTab, loadAnalytics]);

  // ── 사용자 탭 ─────────────────────────────────────────────────
  const loadUsers = useCallback(async (q = '') => {
    setUsersLoading(true);
    try {
      const d = await adminFetch(`/admin/users?q=${encodeURIComponent(q)}`, adminKey);
      setUsersData(d.users || []);
    } catch (e) { console.error('[ADMIN_TAB:users]', e); }
    finally { setUsersLoading(false); }
  }, [adminKey]);

  const handleBlock = async (userId, currentBlocked) => {
    const newBlocked = currentBlocked ? 0 : 1;
    try {
      await adminFetch(`/admin/user/${userId}/block`, adminKey, { method: 'PATCH', body: { blocked: newBlocked } });
      // optimistic update
      setUsersData(prev => prev.map(u => u.id === userId ? { ...u, blocked: newBlocked } : u));
    } catch (e) { alert(e.message); }
  };

  // ── 작업관리 탭 ────────────────────────────────────────────────
  const loadJobsMgmt = useCallback(async (q = '') => {
    setJobsMgmtLoading(true);
    try {
      const d = await adminFetch(`/admin/jobs-list?q=${encodeURIComponent(q)}`, adminKey);
      setJobsMgmtData(d.jobs || []);
    } catch (e) { console.error('[ADMIN_TAB:jobs-mgmt]', e); }
    finally { setJobsMgmtLoading(false); }
  }, [adminKey]);

  const handleStatusChange = async (jobId, newStatus) => {
    try {
      await adminFetch(`/admin/job/${jobId}/status`, adminKey, { method: 'PATCH', body: { status: newStatus } });
      setJobsMgmtData(prev => prev.map(j => j.id === jobId ? { ...j, status: newStatus } : j));
    } catch (e) { alert(e.message); }
  };

  // ── 신고 탭 ────────────────────────────────────────────────────
  const loadReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const d = await adminFetch('/admin/reports', adminKey);
      setReportsData(d.reports || []);
    } catch (e) { console.error('[ADMIN_TAB:reports]', e); }
    finally { setReportsLoading(false); }
  }, [adminKey]);

  // ── 지도품질 탭 ────────────────────────────────────────────────
  const loadGeo = useCallback(async () => {
    setGeoLoading(true);
    try {
      const d = await adminFetch('/admin/geo-quality', adminKey);
      setGeoData(d);
    } catch (e) { console.error('[ADMIN_TAB:geo]', e); }
    finally { setGeoLoading(false); }
  }, [adminKey]);

  // ── SAFE_RESET: DB 초기화 ──────────────────────────────────────
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    const ok1 = window.confirm('⚠️ 전체 테스트 데이터를 삭제합니다.\n(users 제외: jobs/workers/applications 등)\n\n계속하시겠습니까?');
    if (!ok1) return;
    const ok2 = window.confirm('🚨 마지막 확인: 되돌릴 수 없습니다.\n삭제 후 데모 데이터가 자동 재시드됩니다.');
    if (!ok2) return;

    setResetting(true);
    try {
      const d = await adminFetch('/admin/reset-db', adminKey, {
        method: 'POST',
        body:   { confirm: 'RESET_OK' },
      });
      alert(`✅ 초기화 완료\n${d.message || ''}`);
      localStorage.clear();
      sessionStorage.clear();
      window.location.reload();
    } catch (e) {
      alert(`❌ 초기화 실패: ${e.message}`);
    } finally {
      setResetting(false);
    }
  };

  // ── 감사 로그 탭 ───────────────────────────────────────────────
  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const d = await adminFetch('/admin/audit-log?limit=100', adminKey);
      setAuditLogs(d.logs || []);
    } catch (e) { console.error('[ADMIN_TAB:audit]', e); }
    finally { setAuditLoading(false); }
  }, [adminKey]);

  // ── 테스트 탭 ──────────────────────────────────────────────────
  const loadTest = useCallback(async (priority = '') => {
    setTestLoading(true);
    try {
      const [logsRes, summaryRes] = await Promise.all([
        adminFetch(`/admin/test-logs?limit=100${priority ? `&priority=${priority}` : ''}`, adminKey),
        adminFetch('/admin/test-summary', adminKey),
      ]);
      setTestLogs(logsRes.logs || []);
      setTestSummary(summaryRes.summary || null);
    } catch (e) { console.error('[ADMIN_TAB:test]', e); }
    finally { setTestLoading(false); }
  }, [adminKey]);

  // ── E2E 시나리오 테스트 ────────────────────────────────────────
  const handleRunE2E = async () => {
    setE2eRunning(true);
    setE2eResults(null);
    try {
      const d = await adminFetch('/admin/run-e2e-test', adminKey, { method: 'POST' });
      setE2eResults(d);
    } catch (e) {
      setE2eResults({ allOk: false, totalMs: 0, steps: [{ step: '❌ 요청 실패', ok: false, error: e.message, ms: 0 }] });
    } finally {
      setE2eRunning(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'users')     { loadUsers(usersSearch); }
    if (activeTab === 'jobs-mgmt') { loadJobsMgmt(jobsMgmtSearch); }
    if (activeTab === 'reports')   { loadReports(); }
    if (activeTab === 'geo')       { loadGeo(); }
    if (activeTab === 'test')      { loadTest(testPriority); }
    if (activeTab === 'audit')     { loadAudit(); }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  if (showGate) return <KeyGate onSubmit={handleKeySubmit} />;

  const m = metrics;

  // P1 배너 노출 여부 판단
  const showP1Banner = alertStatus?.p1 && !alertDismissed;

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-12">

      {/* ── P1 자동 경보 배너 ────────────────────────────────────────
          조건: P1 발생 && 수동으로 닫지 않음
          클릭: 🧪 테스트 탭으로 이동
          닫기: 현재 p1Count 기준으로 dismiss → 새 P1 발생 시 재노출
      ─────────────────────────────────────────────────────────────── */}
      {showP1Banner && (
        <div
          className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between
                     bg-red-600 text-white px-4 py-2.5 gap-3 shadow-lg"
          style={{ maxWidth: 512, margin: '0 auto' }}
        >
          <button
            onClick={() => { setActiveTab('test'); window.scrollTo(0, 0); }}
            className="flex items-center gap-2 flex-1 text-left hover:opacity-90 transition"
          >
            <span className="text-lg animate-pulse">🔴</span>
            <div>
              <p className="text-sm font-black leading-tight">
                P1 긴급 오류 {alertStatus.p1Count}건 발생
              </p>
              {alertStatus.lastP1Type && (
                <p className="text-xs opacity-80 font-mono">{alertStatus.lastP1Type}</p>
              )}
            </div>
            <span className="text-xs opacity-70 ml-1">→ 테스트 탭</span>
          </button>
          <button
            onClick={() => {
              alertDismissedCountRef.current = alertStatus.p1Count;
              setAlertDismissed(true);
            }}
            className="shrink-0 text-white/70 hover:text-white text-lg leading-none px-1"
            aria-label="닫기"
          >✕</button>
        </div>
      )}

      {/* 헤더 */}
      <header className={`bg-gray-900 border-b border-gray-800 px-4 py-4 sticky z-30 ${showP1Banner ? 'top-[48px]' : 'top-0'}`}>
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
          <div className="flex items-center gap-2">
            {/* STEP 6: 강제 초기화 버튼 — localStorage/sessionStorage 전체 삭제 후 홈 이동 */}
            <button
              onClick={() => {
                if (!window.confirm('⚠️ 모든 로컬 상태(로그인 정보 포함)를 초기화하고 홈으로 이동합니다.\n계속할까요?')) return;
                localStorage.clear();
                sessionStorage.clear();
                window.location.href = '/';
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-900/60 border border-red-700
                         rounded-xl text-xs text-red-300 hover:bg-red-800 transition"
              title="localStorage + sessionStorage 초기화 후 홈 이동"
            >
              🔄 초기화
            </button>
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
        </div>
      </header>

      {/* ── 탭 전환 ── */}
      <div className={`bg-gray-900 border-b border-gray-800 sticky z-20 overflow-x-auto ${showP1Banner ? 'top-[113px]' : 'top-[65px]'}`}>
        <div className="max-w-2xl mx-auto px-4 flex gap-1 pt-1 min-w-max">
          {[
            { key: 'ops',       label: '🌾 운영'   },
            { key: 'analytics', label: '📊 분석'   },
            { key: 'users',     label: '👥 사용자' },
            { key: 'jobs-mgmt', label: '📋 작업'   },
            { key: 'reports',   label: '🚨 신고'   },
            { key: 'geo',       label: '🗺 지도'   },
            { key: 'test',  label: '🧪 테스트', badge: alertStatus?.p1Count || 0 },
            { key: 'audit', label: '🔐 감사로그' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`relative px-4 py-2.5 text-sm font-bold border-b-2 whitespace-nowrap transition-colors ${
                activeTab === t.key
                  ? 'border-farm-green text-farm-green'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
              {t.badge > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px]
                                 font-black rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-6">
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-2xl px-4 py-3 text-red-300 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* ══ ANALYTICS TAB ══════════════════════════════════════════ */}
        {activeTab === 'analytics' && (
          <AnalyticsTab data={analyticsData} loading={analyticsLoading} onRefresh={loadAnalytics} />
        )}

        {/* ══ USERS TAB ════════════════════════════════════════════ */}
        {activeTab === 'users' && (
          <UsersTab
            users={usersData}
            loading={usersLoading}
            search={usersSearch}
            onSearch={q => { setUsersSearch(q); loadUsers(q); }}
            onBlock={(id, blocked) => handleBlock(id, blocked)}
            onRefresh={() => loadUsers(usersSearch)}
          />
        )}

        {/* ══ JOBS-MGMT TAB ════════════════════════════════════════ */}
        {activeTab === 'jobs-mgmt' && (
          <JobsMgmtTab
            jobs={jobsMgmtData}
            loading={jobsMgmtLoading}
            search={jobsMgmtSearch}
            onSearch={q => { setJobsMgmtSearch(q); loadJobsMgmt(q); }}
            onStatusChange={handleStatusChange}
            onRefresh={() => loadJobsMgmt(jobsMgmtSearch)}
            adminKey={adminKey}
          />
        )}

        {/* ══ REPORTS TAB ══════════════════════════════════════════ */}
        {activeTab === 'reports' && (
          <ReportsTab
            reports={reportsData}
            loading={reportsLoading}
            onRefresh={loadReports}
          />
        )}

        {/* ══ GEO TAB ══════════════════════════════════════════════ */}
        {activeTab === 'geo' && (
          <GeoTab data={geoData} loading={geoLoading} onRefresh={loadGeo} />
        )}

        {/* ══ AUDIT TAB ════════════════════════════════════════════ */}
        {activeTab === 'audit' && (
          <>
            <AuditTab logs={auditLogs} loading={auditLoading} onRefresh={loadAudit} />

            {/* ── SAFE_RESET: 위험 영역 ─────────────────────────── */}
            <div className="mx-4 mt-6 mb-2 rounded-2xl border-2 border-red-200 bg-red-50 p-4">
              <p className="text-sm font-black text-red-700 flex items-center gap-1.5 mb-1">
                🚨 위험 영역 — DB 초기화
              </p>
              <p className="text-xs text-red-500 mb-3">
                테스트용 전체 데이터 삭제 후 데모 데이터로 재시드합니다.
                (users 테이블 제외 · 되돌릴 수 없음 · ALLOW_DB_RESET=true 필요)
              </p>
              <button
                onClick={handleReset}
                disabled={resetting}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl
                           bg-red-600 text-white text-sm font-bold
                           disabled:opacity-50 active:scale-95 transition-transform"
              >
                {resetting
                  ? <><span className="animate-spin">⏳</span> 초기화 중...</>
                  : '🚨 테스트 DB 초기화'
                }
              </button>
            </div>
          </>
        )}

        {/* ══ TEST TAB ═════════════════════════════════════════════ */}
        {activeTab === 'test' && (
          <>
            {/* ── E2E 1클릭 시나리오 테스트 ─────────────────────── */}
            <E2ETestSection
              running={e2eRunning}
              results={e2eResults}
              onRun={handleRunE2E}
            />
            <TestTab
              logs={testLogs}
              summary={testSummary}
              loading={testLoading}
              priority={testPriority}
              onPriorityChange={p => { setTestPriority(p); loadTest(p); }}
              onRefresh={() => loadTest(testPriority)}
            />
          </>
        )}

        {activeTab === 'ops' && (
          <>
        {/* ── 수익 대시보드 바로가기 ────────────────────────── */}
        <a
          href="/revenue"
          className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r
                     from-green-900/60 to-green-800/40 border border-green-700/50
                     rounded-2xl hover:from-green-800/60 transition"
        >
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-green-400" />
            <span className="font-bold text-green-300 text-sm">💰 수익 대시보드</span>
          </div>
          <span className="text-green-500 text-xs">일별/월별 매출 →</span>
        </a>

        {/* ── 0. 핵심 운영 지표 (PHASE_ADMIN_DASHBOARD_AI_V2 + DESIGN_V3) ─ */}
        <section>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <TrendingUp size={13} /> 핵심 운영 지표
          </p>
          <div className="grid grid-cols-2 gap-3">
            {/* DESIGN_V3: 💰 오늘 매출 — 사업 관점 1순위 */}
            <KpiCard
              label="💰 오늘 매출"
              value={todayRevenue !== null ? fmtRevenue(todayRevenue) : '—'}
              sub="오늘 paid=1 기준"
              color="green"
            />
            <KpiCard
              label="누적 매출"
              value={fmtRevenue(stats?.revenue)}
              sub="정산 완료 기준"
              color="amber"
            />
            <KpiCard
              label="전체 공고"
              value={stats?.totalJobs ?? '—'}
              sub={`진행중 ${stats?.inProgress ?? 0}건`}
              color="blue"
            />
            <KpiCard
              label="완료율"
              value={stats?.completeRate != null ? `${stats.completeRate}%` : '—'}
              sub="완료 / 전체"
              color="gray"
            />
          </div>
        </section>

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

        {/* ── 5-B. TOP 작업자 (PHASE_ADMIN_DASHBOARD_AI_V2) ─ */}
        <section>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <Award size={13} /> AI 신뢰도 TOP 작업자
          </p>
          {topWorkers.length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-4">데이터 없음 (작업 완료 후 갱신)</p>
          ) : (
            <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
              {topWorkers.map((w, i) => (
                <div key={w.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`text-lg font-black w-6 text-center ${
                    i === 0 ? 'text-amber-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-700' : 'text-gray-600'
                  }`}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-200 truncate">{w.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StarRating rating={w.rating} />
                      {w.categories.length > 0 && (
                        <span className="text-xs text-gray-500">{w.categories.slice(0, 2).join(' · ')}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-black text-green-400">{w.completedJobs}건</p>
                    <p className="text-xs text-gray-500">성공률 {w.successRate}%</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

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
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// ANALYTICS TAB — 전환 퍼널 + 이벤트 분포
// ══════════════════════════════════════════════════════════════════
function AnalyticsTab({ data, loading, onRefresh }) {
  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <RefreshCw size={22} className="animate-spin mr-2" />
        <span>분석 데이터 로딩 중...</span>
      </div>
    );
  }

  const { stats, summary } = data;
  const funnel    = stats?.funnel    || {};
  const conv      = stats?.conversion || {};
  const events    = summary?.events   || [];
  const totalEv   = summary?.total    || 0;

  // 퍼널 차트 데이터
  const funnelData = [
    { name: '페이지뷰', value: funnel.page_view     || 0, color: '#6366f1' },
    { name: 'CTA 클릭', value: funnel.cta_click     || 0, color: '#2563eb' },
    { name: '상세보기', value: funnel.detail_view   || 0, color: '#0891b2' },
    { name: '지원하기', value: funnel.apply_click   || 0, color: '#059669' },
    { name: '즉시연결', value: funnel.contact_apply || 0, color: '#16a34a' },
    { name: '전화클릭', value: funnel.call_click    || 0, color: '#dc2626' },
    { name: 'SMS',      value: funnel.sms_click     || 0, color: '#f59e0b' },
    { name: '카카오톡', value: funnel.kakao_click   || 0, color: '#FEE500' },
  ].filter(d => d.value > 0);

  // 전환율 카드
  const convCards = [
    { label: 'CTA → 상세보기', value: conv.cta_to_detail,    color: 'blue'  },
    { label: '상세 → 지원',   value: conv.detail_to_apply,  color: 'green' },
    { label: '지원 → 연락',   value: conv.apply_to_contact, color: 'amber' },
  ];

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-black text-white text-base">📊 전환 퍼널 분석</p>
          <p className="text-xs text-gray-500 mt-0.5">총 이벤트: {totalEv.toLocaleString()}건</p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 rounded-xl text-sm text-gray-300"
        >
          <RefreshCw size={14} />새로고침
        </button>
      </div>

      {/* 전환율 카드 3개 */}
      <div className="grid grid-cols-3 gap-3">
        {convCards.map(c => {
          const colors = {
            blue:  'bg-blue-900/40  border-blue-700/50  text-blue-300',
            green: 'bg-green-900/40 border-green-700/50 text-green-300',
            amber: 'bg-amber-900/40 border-amber-700/50 text-amber-300',
          };
          return (
            <div key={c.label} className={`rounded-2xl border p-3 ${colors[c.color]}`}>
              <p className="text-xs opacity-70 mb-1 leading-tight">{c.label}</p>
              <p className="text-2xl font-black">{c.value || 'N/A'}</p>
            </div>
          );
        })}
      </div>

      {/* 퍼널 막대 차트 */}
      {funnelData.length > 0 ? (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
            클릭/전환 퍼널
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={funnelData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 10 }}
                labelStyle={{ color: '#e5e7eb', fontWeight: 700 }}
                itemStyle={{ color: '#a3e635' }}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {funnelData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center text-gray-500">
          <p className="text-3xl mb-2">📉</p>
          <p className="font-semibold">아직 이벤트 데이터가 없어요</p>
          <p className="text-xs mt-1">앱을 사용하면 자동으로 집계됩니다</p>
        </div>
      )}

      {/* 개별 수치 */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4 space-y-2">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">이벤트별 수치</p>
        {[
          { label: '📍 지도뷰',      val: funnel.map_view        || 0 },
          { label: '🔗 공유 클릭',   val: funnel.share_click     || 0 },
          { label: '🧭 길찾기',      val: funnel.direction_click || 0 },
          { label: '💬 카카오 채팅', val: funnel.kakao_click     || 0 },
        ].map(r => (
          <div key={r.label} className="flex items-center justify-between">
            <span className="text-sm text-gray-400">{r.label}</span>
            <span className="text-sm font-bold text-gray-200">{r.val.toLocaleString()}건</span>
          </div>
        ))}
      </div>

      {/* 이벤트 TOP 10 */}
      {events.length > 0 && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
            이벤트 TOP {Math.min(events.length, 10)}
          </p>
          <div className="space-y-2">
            {events.slice(0, 10).map((ev, i) => {
              const pct = totalEv > 0 ? Math.round((ev.count / totalEv) * 100) : 0;
              return (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-300 font-medium">{ev.event}</span>
                    <span className="text-gray-500">{ev.count.toLocaleString()}건 ({pct}%)</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full bg-farm-green"
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// USERS TAB — 사용자 목록 + 차단
// ══════════════════════════════════════════════════════════════════
function UsersTab({ users, loading, search, onSearch, onBlock, onRefresh }) {
  const [query, setQuery] = useState(search || '');
  function handleSearch(e) { e.preventDefault(); onSearch(query); }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-black text-white text-base">👥 사용자 관리</p>
        <button onClick={onRefresh} className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-xl text-xs text-gray-300 hover:bg-gray-700">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="이름 / 전화번호 검색…"
          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-farm-green"
        />
        <button type="submit" className="px-4 py-2 bg-farm-green text-white rounded-xl text-sm font-bold">
          <Search size={14} />
        </button>
      </form>

      {loading && <div className="flex justify-center py-8 text-gray-500"><RefreshCw size={20} className="animate-spin" /></div>}
      {!loading && users.length === 0 && <div className="text-center py-10 text-gray-500 text-sm">사용자 없음</div>}

      <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
        {users.map(u => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold text-gray-200">{u.name || '(이름없음)'}</p>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  u.role === 'farmer' ? 'bg-green-900/50 text-green-400' : 'bg-blue-900/50 text-blue-400'
                }`}>{u.role === 'farmer' ? '🌾 농민' : '👷 작업자'}</span>
                {u.blocked ? <span className="text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded-full font-semibold">🚫 차단됨</span> : null}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{u.phone || '전화없음'} · 평점 {(u.rating || 0).toFixed(1)} ★</p>
            </div>
            <button
              onClick={() => onBlock(u.id, u.blocked)}
              className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                u.blocked ? 'bg-green-900/40 text-green-400 hover:bg-green-900/70' : 'bg-red-900/40 text-red-400 hover:bg-red-900/70'
              }`}
            >
              {u.blocked ? <><Shield size={12} /> 차단해제</> : <><ShieldOff size={12} /> 차단</>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// JOBS-MGMT TAB — 작업 목록 + 상태/위치 수정
// ══════════════════════════════════════════════════════════════════
const JOB_STATUSES   = ['open','matched','on_the_way','in_progress','completed','closed'];
const STATUS_LABELS  = { open:'모집중', matched:'연결완료', on_the_way:'이동중', in_progress:'진행중', completed:'완료', closed:'마감' };
const STATUS_COLORS  = {
  open:        'bg-green-900/40  text-green-300',
  matched:     'bg-blue-900/40   text-blue-300',
  on_the_way:  'bg-orange-900/40 text-orange-300',
  in_progress: 'bg-purple-900/40 text-purple-300',
  completed:   'bg-amber-900/40  text-amber-300',
  closed:      'bg-gray-800      text-gray-500',
};

function JobsMgmtTab({ jobs, loading, search, onSearch, onStatusChange, onRefresh, adminKey }) {
  const [query,      setQuery]      = useState(search || '');
  const [fixingId,   setFixingId]   = useState(null);
  const [fixLat,     setFixLat]     = useState('');
  const [fixLng,     setFixLng]     = useState('');
  const [fixLoading, setFixLoading] = useState(false);

  function handleSearch(e) { e.preventDefault(); onSearch(query); }

  async function handleFixLocation(jobId) {
    if (!fixLat || !fixLng) return;
    setFixLoading(true);
    try {
      await adminFetch(`/admin/job/${jobId}/fix-location`, adminKey, {
        method: 'PATCH',
        body: { lat: parseFloat(fixLat), lng: parseFloat(fixLng) },
      });
      setFixingId(null);
      onRefresh();
    } catch (e) { alert(e.message); }
    finally { setFixLoading(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-black text-white text-base">📋 작업 관리</p>
        <button onClick={onRefresh} className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-xl text-xs text-gray-300 hover:bg-gray-700">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="카테고리 / 주소 검색…"
          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-farm-green"
        />
        <button type="submit" className="px-4 py-2 bg-farm-green text-white rounded-xl text-sm font-bold">
          <Search size={14} />
        </button>
      </form>

      {loading && <div className="flex justify-center py-8 text-gray-500"><RefreshCw size={20} className="animate-spin" /></div>}
      {!loading && jobs.length === 0 && <div className="text-center py-10 text-gray-500 text-sm">작업 없음</div>}

      <div className="space-y-3">
        {jobs.map(j => (
          <div key={j.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-4 pt-3 pb-2 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${STATUS_COLORS[j.status] || 'bg-gray-800 text-gray-400'}`}>
                    {STATUS_LABELS[j.status] || j.status}
                  </span>
                  <p className="text-sm font-bold text-gray-200">{j.category}</p>
                </div>
                <p className="text-xs text-gray-500 truncate">{j.locationText}</p>
                <p className="text-xs text-gray-600 mt-0.5">농민: {j.farmerName || '—'} · {timeAgo(j.createdAt)}</p>
              </div>
            </div>
            <div className="px-4 pb-3 flex gap-2 flex-wrap">
              <select
                value={j.status}
                onChange={e => onStatusChange(j.id, e.target.value)}
                className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-xl text-xs text-gray-200 focus:outline-none"
              >
                {JOB_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
              <button
                onClick={() => { setFixingId(fixingId === j.id ? null : j.id); setFixLat(''); setFixLng(''); }}
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-900/40 text-amber-400 rounded-xl text-xs font-bold hover:bg-amber-900/70 transition"
              >
                <MapPin size={11} /> 위치 수정
              </button>
            </div>
            {fixingId === j.id && (
              <div className="px-4 pb-3 flex gap-2 items-center border-t border-gray-800 pt-3">
                <input
                  value={fixLat} onChange={e => setFixLat(e.target.value)}
                  placeholder="위도 (lat)"
                  className="flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-xl text-xs text-gray-200 placeholder-gray-500 focus:outline-none"
                />
                <input
                  value={fixLng} onChange={e => setFixLng(e.target.value)}
                  placeholder="경도 (lng)"
                  className="flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-xl text-xs text-gray-200 placeholder-gray-500 focus:outline-none"
                />
                <button
                  onClick={() => handleFixLocation(j.id)}
                  disabled={fixLoading}
                  className="px-3 py-1.5 bg-amber-500 text-white rounded-xl text-xs font-bold disabled:opacity-40"
                >
                  {fixLoading ? '…' : '저장'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// REPORTS TAB — 신고 목록
// ══════════════════════════════════════════════════════════════════
const REPORT_TYPE_LABELS = { spam:'스팸', fraud:'사기', abuse:'욕설/비방', inappropriate:'부적절', other:'기타' };

function ReportsTab({ reports, loading, onRefresh }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-black text-white text-base">🚨 신고 관리</p>
        <button onClick={onRefresh} className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-xl text-xs text-gray-300 hover:bg-gray-700">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      {loading && <div className="flex justify-center py-8 text-gray-500"><RefreshCw size={20} className="animate-spin" /></div>}
      {!loading && reports.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Flag size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">신고 없음</p>
        </div>
      )}

      <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
        {reports.map(r => (
          <div key={r.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs bg-red-900/50 text-red-400 px-2 py-0.5 rounded-full font-bold">
                    {REPORT_TYPE_LABELS[r.type] || r.type}
                  </span>
                  <span className="text-xs text-gray-500">{timeAgo(r.createdAt)}</span>
                </div>
                <p className="text-sm text-gray-200 font-semibold truncate">{r.jobTitle || r.jobId || '(일자리 정보 없음)'}</p>
                {r.reason && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{r.reason}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-600">
              {r.reporterName && <span>신고자: {r.reporterName}</span>}
              {r.targetName   && <span>대상: {r.targetName}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// GEO TAB — 지도 품질 대시보드
// ══════════════════════════════════════════════════════════════════
function GeoTab({ data, loading, onRefresh }) {
  if (loading) {
    return <div className="flex items-center justify-center py-20 text-gray-500"><RefreshCw size={22} className="animate-spin mr-2" /><span>로딩 중…</span></div>;
  }
  if (!data) {
    return (
      <div className="text-center py-12 text-gray-500">
        <MapPin size={32} className="mx-auto mb-2 opacity-30" />
        <p className="text-sm">지도 품질 데이터 없음</p>
        <button onClick={onRefresh} className="mt-3 px-4 py-2 bg-gray-800 rounded-xl text-xs text-gray-300">불러오기</button>
      </div>
    );
  }

  const geo    = data.geoQuality || data || {};
  const summary    = geo.summary    || {};
  const precision  = geo.precision  || {};
  const normalized = geo.normalized || {};
  const recent     = geo.recent     || [];

  const totalJobs       = summary.total        ?? '—';
  const withFarmAddr    = summary.withFarmAddr  ?? '—';
  const farmAddrRate    = summary.farmAddrRate  ?? null;
  const fullCount       = precision.full        ?? 0;
  const partialCount    = precision.partial     ?? 0;
  const normalizedCount = normalized.count      ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="font-black text-white text-base">🗺 지도 품질 현황</p>
        <button onClick={onRefresh} className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-xl text-xs text-gray-300 hover:bg-gray-700">
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="전체 공고"    value={totalJobs}  color="gray"  />
        <KpiCard
          label="농지주소 입력율"
          value={farmAddrRate !== null ? `${farmAddrRate}%` : '—'}
          sub={`${withFarmAddr} / ${totalJobs}`}
          color={farmAddrRate !== null && farmAddrRate < 30 ? 'red' : farmAddrRate !== null && farmAddrRate < 60 ? 'amber' : 'green'}
        />
        <KpiCard label="정확도 Full"    value={fullCount}    sub="완전 주소 성공"       color="green" />
        <KpiCard label="정확도 Partial" value={partialCount} sub="도시/군 수준 fallback" color="amber" />
      </div>

      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4 space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">정규화 통계</p>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">정규화 성공 건수</span>
          <span className="text-sm font-black text-amber-400">{normalizedCount}건</span>
        </div>
        {(fullCount + partialCount) > 0 && (
          <>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Full 비율</span>
              <span className="text-green-400 font-bold">
                {Math.round(fullCount / (fullCount + partialCount) * 100)}%
              </span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div className="h-2 rounded-full bg-farm-green" style={{ width: `${Math.round(fullCount / (fullCount + partialCount) * 100)}%` }} />
            </div>
          </>
        )}
      </div>

      {recent.length > 0 && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">최근 처리 ({recent.length}건)</p>
          <div className="space-y-2">
            {recent.slice(0, 10).map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={`shrink-0 px-1.5 py-0.5 rounded-full font-bold ${r.precision === 'full' ? 'bg-green-900/50 text-green-400' : 'bg-amber-900/50 text-amber-400'}`}>
                  {r.precision}
                </span>
                <span className="text-gray-400 truncate flex-1">{r.addr || r.address || '—'}</span>
                <span className={`shrink-0 ${r.normalized ? 'text-amber-400' : 'text-gray-600'}`}>
                  {r.normalized ? '정규화' : '원본'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {farmAddrRate !== null && farmAddrRate < 30 && (
        <div className="bg-red-900/40 border border-red-700/50 rounded-2xl px-4 py-3 text-red-300 text-sm">
          ⚠️ 농지주소 입력율 {farmAddrRate}% — A/B 하드블록 조건 충족 (30% 미만)
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// TEST TAB — 실사용 테스트 로그 + 버그 우선순위 대시보드
// STEP 7, 15, 16 (REAL_USER_TEST_AND_BUG_PRIORITY_LOOP)
// ══════════════════════════════════════════════════════════════════
const PRIORITY_COLORS = {
  1: { bg: 'bg-red-900/50',    text: 'text-red-300',    border: 'border-red-700/50',    label: 'P1 긴급' },
  2: { bg: 'bg-amber-900/50',  text: 'text-amber-300',  border: 'border-amber-700/50',  label: 'P2 중간' },
  3: { bg: 'bg-gray-800',      text: 'text-gray-400',   border: 'border-gray-700',      label: 'P3 낮음' },
};

// STEP 17: 전체 E2E 흐름 스텝 정의
const FLOW_STEPS = [
  { key: 'farmer_create_job',    label: '공고 생성',  icon: '📝' },
  { key: 'worker_apply',         label: '지원',       icon: '🙋' },
  { key: 'farmer_select_worker', label: '작업자 선택', icon: '✅' },
  { key: 'farmer_call_worker',   label: '전화 연결',  icon: '📞' },
  { key: 'farmer_complete_job',  label: '작업 완료',  icon: '🏁' },
];

// ══════════════════════════════════════════════════════════════════
// E2E_TEST_SECTION — 1클릭 전체 시나리오 테스트
// open→matched→on_the_way→in_progress→completed 자동 실행 + PASS/FAIL
// ══════════════════════════════════════════════════════════════════
function E2ETestSection({ running, results, onRun }) {
  const r = results;

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4 space-y-4">
      {/* 헤더 + 실행 버튼 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-black text-white text-base flex items-center gap-2">
            🎬 E2E 시나리오 테스트
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            샘플 데이터 생성 → 전체 상태 흐름 자동 실행 → 정리
          </p>
        </div>
        <button
          onClick={onRun}
          disabled={running}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition
            ${running
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-farm-green text-white active:scale-95 hover:opacity-90'
            }`}
        >
          {running
            ? <><span className="animate-spin inline-block">⏳</span> 실행 중…</>
            : '▶ 1클릭 테스트'
          }
        </button>
      </div>

      {/* 흐름 다이어그램 (항상 표시) */}
      <div className="flex items-center gap-1 flex-wrap">
        {[
          { label: 'open',        icon: '📋', api: null             },
          { label: 'matched',     icon: '🔗', api: '/select-worker' },
          { label: 'on_the_way',  icon: '🚗', api: '/on-the-way'    },
          { label: 'in_progress', icon: '⚙️', api: '/start'         },
          { label: 'completed',   icon: '✅', api: '/complete'       },
          { label: 'paid',        icon: '💳', api: '/mark-paid'      },
        ].map((s, i, arr) => (
          <React.Fragment key={s.label}>
            <div className="flex flex-col items-center">
              <span className="text-base">{s.icon}</span>
              <span className="text-[10px] text-gray-500 mt-0.5">{s.label}</span>
              {s.api && <span className="text-[9px] text-gray-700 font-mono">{s.api}</span>}
            </div>
            {i < arr.length - 1 && (
              <span className="text-gray-700 text-sm mb-5">→</span>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* 결과 없을 때 안내 */}
      {!r && !running && (
        <p className="text-xs text-gray-600 text-center py-2">
          ▶ 버튼을 누르면 전체 시나리오를 자동 실행합니다
        </p>
      )}

      {/* 로딩 표시 */}
      {running && (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
          <RefreshCw size={14} className="animate-spin" />
          시나리오 실행 중… DB 쓰기/읽기/정리 중
        </div>
      )}

      {/* 결과 테이블 */}
      {r && (
        <div className="space-y-2">
          {/* 총 결과 배너 */}
          <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl font-bold text-sm
            ${r.allOk
              ? 'bg-green-900/40 border border-green-700 text-green-300'
              : 'bg-red-900/40   border border-red-700   text-red-300'
            }`}
          >
            <span>{r.allOk ? '✅ 전체 PASS' : '❌ 일부 FAIL'}</span>
            <span className="text-xs font-mono opacity-70">{r.totalMs}ms</span>
          </div>

          {/* 단계별 결과 */}
          <div className="divide-y divide-gray-800 rounded-xl border border-gray-800 overflow-hidden">
            {(r.steps || []).map((s, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-2.5 text-sm
                  ${s.ok ? 'bg-gray-900' : 'bg-red-950/30'}`}
              >
                <span className={`shrink-0 text-base ${s.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {s.ok ? '✅' : '❌'}
                </span>
                <span className={`flex-1 font-medium ${s.ok ? 'text-gray-200' : 'text-red-300'}`}>
                  {s.step}
                </span>
                <span className="text-xs text-gray-600 font-mono shrink-0">{s.ms}ms</span>
              </div>
            ))}
          </div>

          {/* FAIL 상세 에러 */}
          {r.steps?.filter(s => !s.ok).map((s, i) => (
            <div key={i} className="bg-red-950/40 border border-red-800/60 rounded-xl px-4 py-2.5">
              <p className="text-xs font-bold text-red-400 mb-0.5">{s.step}</p>
              <p className="text-xs text-red-300 font-mono">{s.error}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TestTab({ logs, summary, loading, priority, onPriorityChange, onRefresh }) {
  if (loading) {
    return <div className="flex items-center justify-center py-20 text-gray-500"><RefreshCw size={22} className="animate-spin mr-2" /><span>로딩 중…</span></div>;
  }

  const s = summary || {};

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-black text-white text-base">🧪 실사용 테스트 모니터</p>
          <p className="text-xs text-gray-500 mt-0.5">총 로그 {s.total || 0}건 · 세션 {(s.recentSessions || []).length}개</p>
        </div>
        <button onClick={onRefresh} className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-xl text-xs text-gray-300 hover:bg-gray-700">
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>

      {/* STEP 15: 핵심 요약 */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard
          label="🔄 플로우 성공률"
          value={`${s.flowSuccessRate ?? 0}%`}
          sub={`완료 ${s.completed || 0} / 생성 ${s.started || 0}`}
          color={s.flowSuccessRate >= 70 ? 'green' : s.flowSuccessRate >= 40 ? 'amber' : 'red'}
        />
        <KpiCard label="🔴 P1 긴급 오류" value={s.p1Count || 0} sub="즉시 수정 필요" color={s.p1Count > 0 ? 'red' : 'green'} />
        <KpiCard label="API 실패"        value={s.apiFail || 0}   sub="ERROR_API_FAIL"   color={s.apiFail > 0 ? 'red' : 'gray'} />
        <KpiCard label="클릭 실패"       value={s.clickFail || 0} sub="ERROR_CLICK_FAIL" color={s.clickFail > 0 ? 'red' : 'gray'} />
        <KpiCard label="지도 오류"        value={s.mapErrors || 0} sub="MAP/GEO FAIL"     color={s.mapErrors > 0 ? 'amber' : 'gray'} />
        <KpiCard label="흐름 끊김"        value={s.flowBroken || 0} sub="FLOW_BROKEN"    color={s.flowBroken > 0 ? 'amber' : 'gray'} />
      </div>

      {/* STEP 17: E2E 플로우 시각화 */}
      {(s.recentSessions || []).length > 0 && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
            E2E 플로우 현황 (최근 {s.recentSessions.length}개 세션)
          </p>
          <div className="flex items-center gap-1 mb-3 flex-wrap">
            {FLOW_STEPS.map((step, i) => {
              const doneCount = s.recentSessions.filter(sess => sess[Object.keys(sess).find(k => k.toLowerCase().includes(step.key.split('_')[1]))]).length;
              const allCount  = s.recentSessions.length;
              const pct = allCount > 0 ? Math.round(doneCount / allCount * 100) : 0;
              return (
                <React.Fragment key={step.key}>
                  <div className="flex flex-col items-center">
                    <span className="text-lg">{step.icon}</span>
                    <span className="text-xs text-gray-400 mt-0.5">{step.label}</span>
                    <span className={`text-xs font-black ${pct >= 70 ? 'text-green-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400'}`}>{pct}%</span>
                  </div>
                  {i < FLOW_STEPS.length - 1 && (
                    <span className="text-gray-700 text-lg mb-4">→</span>
                  )}
                </React.Fragment>
              );
            })}
          </div>
          {/* 세션 상세 */}
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {s.recentSessions.slice(0, 10).map((sess, i) => (
              <div key={i} className="flex items-center gap-1 text-xs">
                <span className="text-gray-600 font-mono shrink-0">{sess.sessionId?.slice(0, 6) || '???'}</span>
                {['created','applied','selected','called','completed'].map(k => (
                  <span key={k} className={`px-1 py-0.5 rounded ${sess[k] ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-600'}`}>
                    {sess[k] ? '✓' : '·'}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STEP 16: 우선순위 필터 + 로그 목록 */}
      <div className="flex gap-2 flex-wrap">
        {[{ v: '', l: '전체' }, { v: '1', l: '🔴 P1 긴급' }, { v: '2', l: '🟡 P2 중간' }, { v: '3', l: '⚪ P3 낮음' }].map(opt => (
          <button
            key={opt.v}
            onClick={() => onPriorityChange(opt.v)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
              priority === opt.v
                ? 'bg-farm-green text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >{opt.l}</button>
        ))}
      </div>

      {logs.length === 0 && (
        <div className="text-center py-10 text-gray-500 text-sm">
          <p className="text-3xl mb-2">🧪</p>
          <p>아직 테스트 로그 없음</p>
          <p className="text-xs mt-1">앱을 사용하면 자동으로 수집됩니다</p>
        </div>
      )}

      <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
        {logs.map(log => {
          const pc = PRIORITY_COLORS[log.priority] || PRIORITY_COLORS[3];
          return (
            <div key={log.id} className="px-4 py-3">
              <div className="flex items-start gap-2 justify-between">
                <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold border ${pc.bg} ${pc.text} ${pc.border}`}>
                    {pc.label}
                  </span>
                  <span className={`text-sm font-bold ${log.priority === 1 ? 'text-red-300' : log.priority === 2 ? 'text-amber-300' : 'text-gray-200'}`}>
                    {log.type}
                  </span>
                </div>
                <span className="text-xs text-gray-600 shrink-0">{timeAgo(log.createdAt)}</span>
              </div>
              {log.payload && Object.keys(log.payload).length > 0 && (
                <div className="mt-1 text-xs text-gray-500 font-mono truncate">
                  {Object.entries(log.payload)
                    .filter(([k]) => k !== 'userId')
                    .map(([k, v]) => `${k}=${v}`)
                    .join(' · ')
                  }
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// AUDIT TAB — 관리자 조치 이력 (DB 저장된 로그)
// ❗ 보완: console만 찍으면 휘발 → DB에 영구 보존
// ══════════════════════════════════════════════════════════════════
const AUDIT_TYPE_META = {
  user_block:    { icon: '🚫', label: '사용자 차단', color: 'text-red-400'    },
  status_change: { icon: '🔄', label: '상태 변경',   color: 'text-blue-400'   },
  geo_fix:       { icon: '📍', label: '위치 수정',   color: 'text-amber-400'  },
};

function AuditTab({ logs, loading, onRefresh }) {
  if (loading) {
    return <div className='flex items-center justify-center py-20 text-gray-500'><RefreshCw size={22} className='animate-spin mr-2' /><span>로딩 중…</span></div>;
  }
  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <p className='font-black text-white text-base'>🔐 관리자 조치 이력</p>
          <p className='text-xs text-gray-500 mt-0.5'>총 {logs.length}건 기록됨</p>
        </div>
        <button onClick={onRefresh} className='flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-xl text-xs text-gray-300 hover:bg-gray-700'>
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>
      {logs.length === 0 && (
        <div className='text-center py-12 text-gray-500'>
          <p className='text-3xl mb-2'>🔐</p>
          <p className='text-sm'>아직 관리자 조치 없음</p>
          <p className='text-xs mt-1'>사용자 차단 / 상태 변경 / 위치 수정 시 자동 기록됩니다</p>
        </div>
      )}
      <div className='bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden'>
        {logs.map(log => {
          const m = AUDIT_TYPE_META[log.type] || { icon: '⚙️', label: log.type, color: 'text-gray-400' };
          return (
            <div key={log.id} className='px-4 py-3'>
              <div className='flex items-center gap-2 justify-between'>
                <div className='flex items-center gap-2 flex-1 min-w-0'>
                  <span className='text-base'>{m.icon}</span>
                  <div className='min-w-0'>
                    <span className={'text-sm font-bold ' + m.color}>{m.label}</span>
                    {log.targetId && (
                      <span className='text-xs text-gray-600 font-mono ml-2'>#{log.targetId.slice(0, 8)}</span>
                    )}
                  </div>
                </div>
                <span className='text-xs text-gray-600 shrink-0'>{timeAgo(log.createdAt)}</span>
              </div>
              {log.meta && Object.keys(log.meta).length > 0 && (
                <div className='mt-1 text-xs text-gray-500 font-mono'>
                  {Object.entries(log.meta).map(([k, v]) => k + '=' + v).join(' · ')}
                  {log.ip && <span className='ml-2 text-gray-700'>ip={log.ip}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
