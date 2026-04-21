import { useEffect, useState, useCallback } from 'react';
import { Activity, BarChart2, RefreshCw } from 'lucide-react';

/**
 * AdminRealtime — PHASE ADMIN_REALTIME_LOG
 *
 * SSE(/api/admin/stream/sse)로 추천 로그 실시간 수신
 * /api/admin/logs/stats 집계 병렬 표시
 */
const ADMIN_TOKEN = () => localStorage.getItem('admin_token') || '';

export default function AdminRealtime() {
  const [logs,  setLogs]  = useState([]);
  const [stats, setStats] = useState(null);
  const [conn,  setConn]  = useState('connecting');

  // 집계 조회
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/logs/stats', {
        headers: { 'x-admin-token': ADMIN_TOKEN() },
      });
      setStats(await res.json());
    } catch (_) {}
  }, []);

  // SSE 연결
  useEffect(() => {
    fetchStats();

    // EventSource는 커스텀 헤더 미지원 → 쿼리 파라미터로 토큰 전달
    const token = ADMIN_TOKEN();
    const url   = token
      ? `/api/admin/stream/sse?token=${encodeURIComponent(token)}`
      : '/api/admin/stream/sse';

    const es = new EventSource(url);

    es.onopen    = ()  => setConn('live');
    es.onerror   = ()  => setConn('error');
    es.onmessage = (e) => {
      try {
        const row = JSON.parse(e.data);
        setLogs(prev => [row, ...prev].slice(0, 200));
      } catch (_) {}
    };

    return () => es.close();
  }, [fetchStats]);

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: '0 auto', fontFamily: 'monospace' }}>

      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Activity size={22} color={conn === 'live' ? '#16a34a' : '#dc2626'} />
        <h2 style={{ margin: 0, fontFamily: 'sans-serif', fontWeight: 800 }}>
          🛰 실시간 추천 로그
        </h2>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
          background: conn === 'live' ? '#dcfce7' : '#fee2e2',
          color:      conn === 'live' ? '#16a34a' : '#dc2626',
        }}>
          {conn === 'live' ? '● LIVE' : conn === 'error' ? '● ERROR' : '● …'}
        </span>
        <button
          onClick={fetchStats}
          style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer' }}
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* 집계 */}
      {stats && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <StatBox title="총 로그" value={stats.total?.toLocaleString()} />
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 16px', minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <BarChart2 size={14} /><strong style={{ fontSize: 12 }}>Variant 분포</strong>
            </div>
            {stats.byVariant.map(v => (
              <div key={v.variantKey} style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
                <span>{v.variantKey ?? '(none)'}</span>
                <span>{v.cnt}건 avg:{v.avgScore}</span>
              </div>
            ))}
          </div>
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 16px', minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <BarChart2 size={14} /><strong style={{ fontSize: 12 }}>JobType 분포</strong>
            </div>
            {stats.byType.map(v => (
              <div key={v.type} style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
                <span>{v.type ?? '(미분류)'}</span>
                <span>{v.cnt}건 avg:{v.avgScore}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 실시간 로그 테이블 */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
              {['id','jobId','workerId','score','distKm','diff','variant','type','time'].map(h => (
                <th key={h} style={{ padding: '6px 8px', fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.length === 0
              ? <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>대기 중…</td></tr>
              : logs.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{l.id}</td>
                  <td style={{ padding: '5px 8px' }}>{l.jobId}</td>
                  <td style={{ padding: '5px 8px' }}>{l.workerId?.slice(0,8)}</td>
                  <td style={{ padding: '5px 8px', fontWeight: 700, color: '#16a34a' }}>{l.score?.toFixed(1)}</td>
                  <td style={{ padding: '5px 8px' }}>{l.distKm != null ? l.distKm.toFixed(2) : '-'}</td>
                  <td style={{ padding: '5px 8px' }}>{l.difficulty != null ? l.difficulty.toFixed(2) : '-'}</td>
                  <td style={{ padding: '5px 8px' }}>{l.variantKey ?? '-'}</td>
                  <td style={{ padding: '5px 8px' }}>{l.autoJobType || l.jobType}</td>
                  <td style={{ padding: '5px 8px', color: '#94a3b8' }}>
                    {new Date(l.createdAt).toLocaleTimeString('ko-KR')}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatBox({ title, value }) {
  return (
    <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 20px', textAlign: 'center', minWidth: 100 }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'sans-serif' }}>{value ?? '-'}</div>
    </div>
  );
}
