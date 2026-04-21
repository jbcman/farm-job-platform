/**
 * JobMapView.jsx — PHASE 13
 *
 * 변경: 일(밭) 위치 기준 지도 + 마커 클릭 → 즉시 지원 UX
 * - 지도 중심: 일자리 위치 (jobs fitBounds) / GPS 있으면 내 위치
 * - 마커 클릭 → 하단 카드 (카테고리·위치·날짜·일당·거리)
 * - 카드 CTA: "👉 이 일 할게요" → 바로 상세/지원 페이지 이동 (클릭 2회 이내)
 * - 순수 Leaflet + OSM 타일 유지 (react-leaflet 미사용)
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ArrowLeft, MapPin, Loader2, Navigation,
  Banknote, Clock, ChevronDown, Sprout, Maximize2,
} from 'lucide-react';
import { getMapJobs, applyJob, trackClientEvent } from '../utils/api.js';
import { MAP_CONFIG, isValidLatLng } from '../config/mapConfig.js';
import { filterUrgentOnly } from '../utils/sortJobs.js';
import { sortJobsByRecommend, RECOMMEND_BADGE_THRESHOLD } from '../utils/recommendJobs.js';
import { getUserProfile, saveUserInteraction } from '../utils/userProfile.js';

// ── 상수 ────────────────────────────────────────────────────────
const DEFAULT_CENTER = MAP_CONFIG.DEFAULT_CENTER;  // [36.5, 127.5]
const DEFAULT_ZOOM   = MAP_CONFIG.DEFAULT_ZOOM;    // 10
const MY_ZOOM        = MAP_CONFIG.MY_ZOOM;         // 13

// OSM — API 키 불필요, 항상 안정적
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR     = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const CATEGORY_EMOJI = {
  '밭갈이': '🚜', '로터리': '🔄', '두둑': '⛰️',
  '방제': '💊', '수확 일손': '🌾', '예초': '✂️',
};

// ── 일자리 마커 아이콘 ───────────────────────────────────────────
// PHASE 27: applied 파라미터 추가 — 지원 완료 시 회색 체크 아이콘
function makeJobIcon(job, selected = false, applied = false) {
  // 지원 완료 → 회색 체크마크
  if (applied) {
    return L.divIcon({
      html: `<div style="background:#f3f4f6;border:3px solid #9ca3af;border-radius:50%;
        width:40px;height:40px;display:flex;align-items:center;justify-content:center;
        font-size:17px;box-shadow:0 2px 6px rgba(0,0,0,.12);cursor:pointer;
        opacity:0.75;">✓</div>`,
      className: '', iconSize: [40, 40], iconAnchor: [20, 20],
    });
  }
  const emoji  = CATEGORY_EMOJI[job.category] || '🌱';
  // PHASE 18: 급구=빨강(#dc2626), 오늘=초록, 선택=파랑, 일반=회색
  const border = selected      ? '#2563eb'
               : job.isUrgent ? '#dc2626'
               : job.isToday  ? '#16a34a'
               :                '#6b7280';
  const bg     = selected      ? '#eff6ff'
               : job.isUrgent ? '#fef2f2'
               : job.isToday  ? '#f0fdf4'
               :                '#ffffff';
  const size   = selected ? 52 : 44;
  const shadow = selected
    ? '0 0 0 4px rgba(37,99,235,0.25), 0 4px 16px rgba(0,0,0,0.22)'
    : '0 3px 10px rgba(0,0,0,.18)';
  return L.divIcon({
    html: `<div style="background:${bg};border:3px solid ${border};border-radius:50%;
      width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;
      font-size:${selected ? 24 : 20}px;box-shadow:${shadow};cursor:pointer;
      transition:all .15s;">${emoji}</div>`,
    className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  });
}

// ── 내 위치 마커 아이콘 ──────────────────────────────────────────
function makeMyIcon() {
  return L.divIcon({
    html: `<div style="background:#3b82f6;border:3px solid white;border-radius:50%;
      width:18px;height:18px;box-shadow:0 0 0 6px rgba(59,130,246,.25);"></div>`,
    className: '', iconSize: [18, 18], iconAnchor: [9, 9],
  });
}

// ── 거리 포맷 ────────────────────────────────────────────────────
function fmtDist(km) {
  if (km == null) return null;
  return km < 1 ? '1km 이내' : `${km}km`;
}

// ── 하단 잡 카드 (PHASE 20: 지원 → 즉시 전화/문자 연결) ────────
// PHASE 27: onApplySuccess(jobId) — 지원 완료 시 부모에서 마커 아이콘 업데이트
function BottomCard({ job, onQuickApply, onFallback, onDismiss, onViewMyApplications, onApplySuccess }) {
  const [isApplying,    setIsApplying]    = useState(false);
  const [applyState,    setApplyState]    = useState('idle'); // idle | loading | success | error | duplicate
  const [errorMsg,      setErrorMsg]      = useState('');
  // PHASE 20: 연락처 상태
  const [contact,       setContact]       = useState(null);   // { name, phoneMasked, phoneFull, noPhone }
  const [showFullPhone, setShowFullPhone] = useState(false);
  const [contactLoading, setContactLoading] = useState(false);

  // job 변경 시 모든 상태 초기화
  useEffect(() => {
    setIsApplying(false);
    setApplyState('idle');
    setErrorMsg('');
    setContact(null);
    setShowFullPhone(false);
    setContactLoading(false);
  }, [job?.id]);

  if (!job) return null;

  const emoji   = CATEGORY_EMOJI[job.category] || '🌱';
  const distTxt = fmtDist(job.distKm);

  // ── PHASE 20: 연락처 조회 ─────────────────────────────────────
  async function fetchContact(jobId) {
    const userId = localStorage.getItem('farm-userId');
    if (!userId) return;
    setContactLoading(true);
    try {
      const res  = await fetch(`/api/jobs/${jobId}/contact?workerId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (data.ok) {
        setContact(data);
        console.log('[CONTACT_READY]', { name: data.name, masked: data.phoneMasked, noPhone: data.noPhone });
      }
    } catch (e) {
      console.error('[CONTACT_FETCH_FAIL]', e.message);
    } finally {
      setContactLoading(false);
    }
  }

  async function handleApplyClick() {
    if (isApplying) return;
    const userId = localStorage.getItem('farm-userId');
    console.log('[PHASE15_CLICK_FLOW]', { jobId: job.id, userId, category: job.category });
    try { trackClientEvent('map_quick_apply_tap', { jobId: job.id, category: job.category }); } catch (_) {}
    setIsApplying(true);
    setApplyState('loading');

    try {
      await applyJob(job.id, { workerId: userId, message: '지도에서 바로 지원했어요.' });
      setApplyState('success');
      try { saveUserInteraction(job); } catch (_) {}
      try { trackClientEvent('map_quick_apply_success', { jobId: job.id, category: job.category }); } catch (_) {}
      console.log('[QUICK_APPLY_SUCCESS] jobId=' + job.id);
      // PHASE 27: 부모에 지원 완료 알림 → 마커 아이콘 즉시 변경
      try { onApplySuccess?.(job.id); } catch (_) {}
      // PHASE 20: 지원 성공 → 연락처 자동 로드 (카드 닫지 않음)
      fetchContact(job.id);

    } catch (err) {
      const msg = err.message || '';
      console.error('[QUICK_APPLY_FAIL]', msg);
      if (msg.includes('이미 지원')) {
        setApplyState('duplicate');
        // PHASE 27: 이미 지원 → 마커도 동일하게 applied 처리
        try { onApplySuccess?.(job.id); } catch (_) {}
        // 이미 지원 → 연락처도 조회 가능
        fetchContact(job.id);
        setTimeout(() => { setIsApplying(false); }, 500);
      } else if (msg.includes('마감') || msg.includes('closed')) {
        setApplyState('error');
        setErrorMsg('마감된 일자리입니다.');
        setTimeout(() => { setApplyState('idle'); setIsApplying(false); }, 2500);
      } else {
        setApplyState('idle');
        setIsApplying(false);
        try { trackClientEvent('map_quick_apply_fallback', { jobId: job.id, reason: msg }); } catch (_) {}
        if (typeof onFallback === 'function') onFallback(job);
      }
    }
  }

  const isApplied = applyState === 'success' || applyState === 'duplicate';

  // ── CTA 버튼 상태별 내용 ──
  const ctaContent = (() => {
    switch (applyState) {
      case 'loading':   return { label: '지원 중...', bg: '#15803d', icon: <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />, disabled: true };
      case 'success':   return { label: '✅ 지원 완료!', bg: '#15803d', icon: null, disabled: true };
      case 'duplicate': return { label: '✔ 이미 지원했어요', bg: '#6b7280', icon: null, disabled: true };
      case 'error':     return { label: errorMsg || '지원 불가', bg: '#dc2626', icon: null, disabled: true };
      default:          return { label: '👉 이 일 할게요', bg: '#16a34a', icon: <Sprout size={16} />, disabled: false };
    }
  })();

  return (
    <div
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        zIndex: 9999, maxWidth: 512, margin: '0 auto',
        background: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
        boxShadow: '0 -4px 32px rgba(0,0,0,0.14)',
        borderTop: '1px solid #f3f4f6',
        animation: 'slideUp .22s cubic-bezier(.4,0,.2,1)',
      }}
    >
      {/* 드래그 핸들 */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
        <div style={{ width: 40, height: 4, background: '#e5e7eb', borderRadius: 99 }} />
      </div>

      <div style={{ padding: '4px 20px 20px' }}>
        {/* 제목 행 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 26 }}>{emoji}</span>
          <span style={{ fontSize: 18, fontWeight: 900, color: '#111827' }}>{job.category}</span>
          {(job._score ?? 0) >= RECOMMEND_BADGE_THRESHOLD && (
            <span style={{ fontSize: 11, background: '#2563eb', color: '#fff', fontWeight: 700,
              borderRadius: 99, padding: '2px 8px' }}>⭐ 추천</span>
          )}
          {job.isToday && (
            <span style={{ fontSize: 11, background: '#16a34a', color: '#fff', fontWeight: 700,
              borderRadius: 99, padding: '2px 8px' }}>오늘</span>
          )}
          {job.isUrgent && (
            <span style={{ fontSize: 11, background: '#dc2626', color: '#fff', fontWeight: 700,
              borderRadius: 99, padding: '2px 8px' }}>🔥 급구</span>
          )}
          {distTxt && (
            <span style={{ fontSize: 11, background: '#eff6ff', color: '#2563eb', fontWeight: 700,
              borderRadius: 99, padding: '2px 8px', marginLeft: 'auto' }}>📏 {distTxt}</span>
          )}
        </div>

        {/* PHASE 23: 주소 강조 블록 + PHASE 26: 썸네일 나란히 */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
          {/* 텍스트 정보 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 600, color: '#374151',
              marginBottom: job.farmAddress ? 2 : 6,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              📍 {job.locationText || '위치 정보 없음'}
            </div>
            {job.farmAddress && (
              <div style={{
                fontSize: 12, color: '#16a34a', fontWeight: 500,
                marginBottom: 6, paddingLeft: 2,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                🏡 {job.farmAddress}
              </div>
            )}

            {/* 상세 정보 (날짜·평수·일당) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <InfoRow icon={<Clock size={13} color="#16a34a" />} text={job.date} />
              {/* PHASE 26: 평수 */}
              {job.areaPyeong && (
                <InfoRow
                  icon={<Maximize2 size={13} color="#16a34a" />}
                  text={<span style={{ fontWeight: 700, color: '#16a34a' }}>{job.areaPyeong.toLocaleString()}평</span>}
                />
              )}
              {job.pay && (
                <InfoRow icon={<Banknote size={13} color="#16a34a" />}
                  text={<span style={{ fontWeight: 700, color: '#111827' }}>일당 {job.pay}</span>} />
              )}
            </div>
          </div>

          {/* PHASE 26: 밭 사진 썸네일 */}
          {job.thumbUrl && (
            <div style={{
              width: 72, height: 72, borderRadius: 12, overflow: 'hidden',
              border: '1px solid #e5e7eb', flexShrink: 0, background: '#f3f4f6',
            }}>
              <img
                src={job.thumbUrl}
                alt="밭"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { e.target.style.display = 'none'; }}
              />
            </div>
          )}
        </div>

        {/* ── PHASE 20: 연락처 패널 (지원 완료 후 표시) ─────────── */}
        {isApplied && (
          <div style={{
            background: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: 16, padding: '14px 16px', marginBottom: 14,
          }}>
            {contactLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 13 }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                <span>농민 연락처 불러오는 중...</span>
              </div>
            ) : contact && !contact.noPhone ? (
              <>
                {/* 농민 이름 */}
                <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#15803d' }}>
                  👤 {contact.name} 님
                </p>

                {/* 전화번호 (마스킹 → 클릭 시 전체) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#111827', letterSpacing: 1 }}>
                    📞 {showFullPhone ? contact.phoneFull : contact.phoneMasked}
                  </span>
                  {!showFullPhone && (
                    <button
                      onClick={() => {
                        setShowFullPhone(true);
                        try { trackClientEvent('contact_phone_reveal', { jobId: job.id }); } catch (_) {}
                      }}
                      style={{
                        background: '#dcfce7', border: '1px solid #86efac',
                        color: '#15803d', fontSize: 11, fontWeight: 700,
                        borderRadius: 99, padding: '3px 10px', cursor: 'pointer',
                      }}
                    >
                      번호 보기
                    </button>
                  )}
                </div>

                {/* 전화 / 문자 버튼 */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <a
                    href={`tel:${contact.phoneFull}`}
                    onClick={() => { try { trackClientEvent('contact_call', { jobId: job.id }); } catch (_) {} }}
                    style={{
                      flex: 1, padding: '11px 0',
                      background: '#16a34a', color: '#fff',
                      borderRadius: 12, textAlign: 'center',
                      fontSize: 14, fontWeight: 800,
                      textDecoration: 'none', display: 'block',
                      boxShadow: '0 2px 8px rgba(22,163,74,.3)',
                    }}
                  >
                    📞 전화하기
                  </a>
                  <a
                    href={`sms:${contact.phoneFull}`}
                    onClick={() => { try { trackClientEvent('contact_sms', { jobId: job.id }); } catch (_) {} }}
                    style={{
                      flex: 1, padding: '11px 0',
                      background: '#2563eb', color: '#fff',
                      borderRadius: 12, textAlign: 'center',
                      fontSize: 14, fontWeight: 800,
                      textDecoration: 'none', display: 'block',
                      boxShadow: '0 2px 8px rgba(37,99,235,.25)',
                    }}
                  >
                    💬 문자
                  </a>
                </div>
              </>
            ) : contact?.noPhone ? (
              <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
                농민 연락처가 아직 등록되지 않았어요. 상세 페이지에서 확인하세요.
              </p>
            ) : null}

            {/* PHASE 21: 내 지원 현황 바로가기 */}
            {typeof onViewMyApplications === 'function' && (
              <button
                onClick={onViewMyApplications}
                style={{
                  display: 'block', width: '100%', marginTop: 10,
                  padding: '9px 0', background: 'transparent',
                  border: '1px solid #86efac', borderRadius: 10,
                  color: '#15803d', fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', letterSpacing: 0.2,
                }}
              >
                📋 내 지원 현황 보기 →
              </button>
            )}
          </div>
        )}

        {/* 버튼 행 */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => { if (typeof onDismiss === 'function') onDismiss(); }}
            style={{
              flex: '0 0 72px', padding: '13px 0',
              borderRadius: 14, background: '#f3f4f6',
              color: '#4b5563', fontSize: 13, fontWeight: 700,
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}
          >
            <ChevronDown size={15} /> 닫기
          </button>

          <button
            onClick={handleApplyClick}
            disabled={ctaContent.disabled}
            style={{
              flex: 1, padding: '13px 0',
              borderRadius: 14, background: ctaContent.bg,
              color: '#fff', fontSize: 15, fontWeight: 900,
              border: 'none', cursor: ctaContent.disabled ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              boxShadow: ctaContent.disabled ? 'none' : '0 2px 12px rgba(22,163,74,.35)',
              transition: 'background .2s',
            }}
          >
            {ctaContent.icon}
            {ctaContent.label}
          </button>
        </div>

        {/* 상세 보기 링크 (보조 — fallback 경로) */}
        {applyState === 'idle' && (
          <p style={{ textAlign: 'center', marginTop: 10, marginBottom: 0 }}>
            <button
              onClick={() => { if (typeof onFallback === 'function') onFallback(job); }}
              style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 11,
                cursor: 'pointer', textDecoration: 'underline' }}
            >
              상세 페이지에서 보기
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

function InfoRow({ icon, text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#4b5563' }}>
      {icon}
      <span>{text}</span>
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────
export default function JobMapView({ onBack, onViewDetail, onViewMyApplications }) {
  const safeBack               = typeof onBack               === 'function' ? onBack               : () => {};
  const safeViewDetail         = typeof onViewDetail         === 'function' ? onViewDetail         : () => {};
  const safeViewMyApplications = typeof onViewMyApplications === 'function' ? onViewMyApplications : null;

  const [markers,        setMarkers]        = useState([]);
  const [myPos,          setMyPos]          = useState(null);
  const [gpsDenied,      setGpsDenied]      = useState(false);
  const [jobsLoading,    setJobsLoading]    = useState(true);
  const [selectedJob,    setSelectedJob]    = useState(null);
  const [error,          setError]          = useState('');
  // PHASE 18: 급구 필터
  const [urgentOnly,     setUrgentOnly]     = useState(false);

  // PHASE 27: 지원 완료된 job ID 집합 (마커 아이콘 변경용)
  const [appliedIds,     setAppliedIds]     = useState(new Set());

  const mapContainerRef  = useRef(null);
  const leafletMap       = useRef(null);
  const leafletMarkers   = useRef([]);   // { id, marker, job } 쌍으로 저장
  const myMarkerRef      = useRef(null);
  const selectedIdRef    = useRef(null); // 아이콘 복원용
  // PHASE 27: 마커 연속 클릭 디바운스 (200ms)
  const lastClickTimeRef = useRef(0);
  // PHASE 27: 현재 appliedIds를 클로저 안에서 최신값으로 읽기 위한 ref
  const appliedIdsRef    = useRef(new Set());

  // PHASE 27: appliedIds 변경 시 ref 동기화 (Leaflet 클로저에서 최신값 접근)
  useEffect(() => { appliedIdsRef.current = appliedIds; }, [appliedIds]);

  // ── 순수 Leaflet 초기화 ─────────────────────────────────────
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || leafletMap.current) return;

    console.log('[MAP_CONTAINER_SIZE]', container.offsetWidth + 'x' + container.offsetHeight);

    // 저장된 위치 있으면 사용, 없으면 한국 중앙 기본값
    const storedLoc = (() => {
      try { return JSON.parse(localStorage.getItem('userLocation')); } catch { return null; }
    })();
    const initCenter = (storedLoc && isValidLatLng(storedLoc.lat, storedLoc.lon))
      ? [storedLoc.lat, storedLoc.lon]
      : DEFAULT_CENTER;
    const initZoom = (storedLoc && isValidLatLng(storedLoc.lat, storedLoc.lon))
      ? MY_ZOOM
      : DEFAULT_ZOOM;

    let map;
    try {
      map = L.map(container, { center: initCenter, zoom: initZoom, zoomControl: true, attributionControl: true });
    } catch (e) {
      console.error('[MAP_CREATE_FAIL]', e);
      return;
    }

    // OSM 타일 (VWorld fallback)
    let osmFailed = false;
    const osmLayer = L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTR, maxZoom: 19 });
    osmLayer.on('tileload', () => { if (!osmFailed) console.log('[TILE_OSM_OK]'); });
    osmLayer.on('tileerror', (e) => {
      if (osmFailed) return;
      osmFailed = true;
      console.warn('[TILE_OSM_FAIL] → VWorld fallback');
      try {
        osmLayer.remove();
        L.tileLayer(MAP_CONFIG.TILE_URL, {
          attribution: MAP_CONFIG.ATTRIBUTION,
          maxZoom: MAP_CONFIG.MAX_ZOOM,
          minZoom: MAP_CONFIG.MIN_ZOOM,
        }).addTo(map);
      } catch (_) {}
    });
    osmLayer.addTo(map);

    // 레이아웃 완료 후 크기 재계산
    requestAnimationFrame(() => { try { map.invalidateSize(); } catch (_) {} });
    setTimeout(() => { try { map.invalidateSize(); } catch (_) {} }, 250);
    setTimeout(() => { try { map.invalidateSize(); } catch (_) {} }, 700);

    map.on('click', () => setSelectedJob(null));
    leafletMap.current = map;
    console.log('[MAP_CREATED] center:', initCenter, 'zoom:', initZoom);

    // UI_INTEGRATION: move-map 이벤트 → 해당 일자리 위치로 포커스
    function handleMoveMap(e) {
      try {
        const job = e.detail;
        if (!job) return;
        const lat = job.latitude ?? job.lat;
        const lng = job.longitude ?? job.lng;
        if (!isValidLatLng(lat, lng)) return;
        map.setView([lat, lng], MY_ZOOM, { animate: true });
        setSelectedJob(job);
      } catch (_) {}
    }
    window.addEventListener('move-map', handleMoveMap);

    return () => {
      window.removeEventListener('move-map', handleMoveMap);
      leafletMap.current = null;
      try { map.remove(); } catch (_) {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 마커 동기화 + 지도 중심 → 일자리 위치 기준 ─────────────────
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    // 기존 마커 제거
    leafletMarkers.current.forEach(({ marker }) => { try { marker.remove(); } catch (_) {} });
    leafletMarkers.current = [];

    // PHASE 23: 좌표 검증 로그 — 마커 생성 전 전수 검사
    markers.forEach(j => {
      const lat  = Number(j.lat);
      const lng  = Number(j.lng);
      const ok   = isValidLatLng(lat, lng);
      console.log('[MAP_CHECK]', j.id, j.locationText, lat, lng, ok ? '✓' : '✗ INVALID');
      if (!ok) console.warn('[INVALID_COORD]', j.id, j.locationText, { lat: j.lat, lng: j.lng });
    });

    // PHASE 24: 유효 좌표만 허용 — null·NaN·fallback(37.5/127.0) 완전 차단
    const baseJobs = markers
      .map(j => ({ ...j, lat: Number(j.lat), lng: Number(j.lng) }))
      .filter(j => {
        if (!isValidLatLng(j.lat, j.lng)) return false;
        // fallback 좌표 이중 차단 (DB 정리 전 레거시 데이터 대비)
        if (j.lat === 37.5 && j.lng === 127.0) {
          console.warn('[PHASE24_FAKE_COORD_BLOCKED]', j.id, j.locationText);
          return false;
        }
        return true;
      });
    const userProfile = getUserProfile();
    const safeJobs    = sortJobsByRecommend(filterUrgentOnly(baseJobs, urgentOnly), userProfile);

    // PHASE 23: 빈 지도 경고
    if (safeJobs.length === 0) {
      console.warn('[MAP_EMPTY] 표시할 좌표 없음. 원본:', markers.length, '건 (좌표 없거나 필터됨)');
    }

    const urgentCount = baseJobs.filter(j => j.isUrgent).length;
    console.log('[PHASE18_URGENT]',    { urgentCount, total: baseJobs.length, urgentOnly });
    console.log('[PHASE19_RECOMMEND]', safeJobs.slice(0, 5).map(j =>
      `${j.category}|score=${j._score}|urgent=${j.isUrgent}|dist=${j.distKm ?? 'N/A'}km`
    ));

    safeJobs.forEach(job => {
      const isSelected = selectedIdRef.current === job.id;
      const isApplied  = appliedIdsRef.current.has(job.id);
      const marker = L.marker([job.lat, job.lng], {
        icon: makeJobIcon(job, isSelected, isApplied),
      })
        .addTo(map)
        .on('click', (e) => {
          // PHASE 27: 200ms 디바운스 — 빠른 연속 클릭 방지
          const now = Date.now();
          if (now - lastClickTimeRef.current < 200) return;
          lastClickTimeRef.current = now;

          L.DomEvent.stopPropagation(e);

          // 이미 지원한 마커는 클릭해도 재선택 가능 (정보 확인용)
          // 이전 선택 마커 아이콘 복원
          if (selectedIdRef.current && selectedIdRef.current !== job.id) {
            const prev = leafletMarkers.current.find(m => m.id === selectedIdRef.current);
            if (prev) {
              const wasApplied = appliedIdsRef.current.has(prev.id);
              prev.marker.setIcon(makeJobIcon(prev.job, false, wasApplied));
            }
          }

          // 현재 마커 선택 상태 아이콘 (이미 지원 → selected+applied 합성)
          marker.setIcon(makeJobIcon(job, true, appliedIdsRef.current.has(job.id)));
          selectedIdRef.current = job.id;

          setSelectedJob(job);
          // PHASE 27: flyTo 제거 → 지도 이동 없음 (UX 끊김 방지)
          // map.flyTo 호출 삭제
          try { trackClientEvent('map_marker_click', { jobId: job.id, category: job.category }); } catch (_) {}
          console.log('[MAP_MARKER_CLICK] id=' + job.id + ' cat=' + job.category);
        });
      // PHASE 27: job 객체도 함께 저장 (마커 아이콘 업데이트 시 필요)
      leafletMarkers.current.push({ id: job.id, marker, job });
    });

    // ── PHASE 13 핵심: 일자리 위치 기준으로 지도 중심 설정 ──
    // GPS 위치가 없을 때 → 일자리 전체가 보이도록 fitBounds
    if (safeJobs.length > 0 && !myPos) {
      try {
        if (safeJobs.length === 1) {
          map.setView([safeJobs[0].lat, safeJobs[0].lng], MY_ZOOM);
        } else {
          const group = L.featureGroup(leafletMarkers.current.map(m => m.marker));
          map.fitBounds(group.getBounds().pad(0.15), { maxZoom: MY_ZOOM });
        }
        console.log('[MAP_CENTER_JOB] jobs=' + safeJobs.length);
      } catch (e) {
        console.warn('[MAP_FIT_FAIL]', e);
      }
    }
  }, [markers, urgentOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // 선택 해제 시 아이콘 복원 (PHASE 27: applied 상태 유지)
  useEffect(() => {
    if (!selectedJob && selectedIdRef.current) {
      const prev = leafletMarkers.current.find(m => m.id === selectedIdRef.current);
      if (prev) {
        const wasApplied = appliedIdsRef.current.has(prev.id);
        prev.marker.setIcon(makeJobIcon(prev.job, false, wasApplied));
      }
      selectedIdRef.current = null;
    }
  }, [selectedJob]);

  // ── 내 위치 마커 동기화 ─────────────────────────────────────
  useEffect(() => {
    const map = leafletMap.current;
    if (!map || !myPos || !isValidLatLng(myPos[0], myPos[1])) return;
    if (myMarkerRef.current) { try { myMarkerRef.current.remove(); } catch (_) {} }
    myMarkerRef.current = L.marker(myPos, { icon: makeMyIcon() }).addTo(map);
  }, [myPos]);

  // ── GPS 취득 ─────────────────────────────────────────────────
  const fetchGps = useCallback(() => {
    if (!navigator.geolocation) { setGpsDenied(true); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!isValidLatLng(coords.latitude, coords.longitude)) { setGpsDenied(true); return; }
        const pos = [coords.latitude, coords.longitude];
        setMyPos(pos);
        try {
          localStorage.setItem('userLocation', JSON.stringify({ lat: coords.latitude, lon: coords.longitude }));
        } catch (_) {}
        // GPS 확인되면 내 위치로 이동
        if (leafletMap.current) {
          try { leafletMap.current.flyTo(pos, MY_ZOOM, { duration: 0.8 }); } catch (_) {}
        }
      },
      () => {
        setGpsDenied(true);
        try { trackClientEvent('map_gps_denied'); } catch (_) {}
      },
      { timeout: 8000, maximumAge: 60000 }
    );
  }, []);

  // ── 일자리 로드 ───────────────────────────────────────────────
  const loadJobs = useCallback(async (loc) => {
    setJobsLoading(true);
    try {
      const data = await getMapJobs({ lat: loc?.lat, lon: loc?.lon || loc?.lng });
      setMarkers(data.markers || []);
      console.log('[MAP_JOBS_LOADED] count=' + (data.markers?.length || 0));
    } catch (e) {
      setError('일자리 정보를 불러올 수 없어요.');
      console.error('[MAP_JOBS_FAIL]', e);
    } finally {
      setJobsLoading(false);
    }
  }, []);

  // ── 초기 데이터 로드 ─────────────────────────────────────────
  useEffect(() => {
    try { trackClientEvent('map_view_open'); } catch (_) {}
    console.log('[MAP_VIEW_OPEN]');

    const storedLoc = (() => {
      try { return JSON.parse(localStorage.getItem('userLocation')); } catch { return null; }
    })();
    if (storedLoc && isValidLatLng(storedLoc.lat, storedLoc.lon)) {
      setMyPos([storedLoc.lat, storedLoc.lon]);
    }
    loadJobs(storedLoc);
    fetchGps();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const allValid    = markers.filter(m => isValidLatLng(Number(m.lat), Number(m.lng)));
  const urgentCount = allValid.filter(m => m.isUrgent).length;
  const validCount  = urgentOnly ? urgentCount : allValid.length;

  // ── 렌더 ─────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, background: '#e5e7eb' }}>

      {/* ── CSS 애니메이션 ── */}
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);   opacity: 1; }
        }
      `}</style>

      {/* ── 헤더 (56px 고정) ───────────────────────────────────── */}
      <header style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 56, zIndex: 200,
        background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #f3f4f6', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px',
      }}>
        <button
          onClick={safeBack}
          style={{ padding: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#374151' }}
          aria-label="뒤로"
        >
          <ArrowLeft size={22} />
        </button>

        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 900, fontSize: 15, color: '#111827', lineHeight: 1.3 }}>
            주변 일자리 지도
          </p>
          <p style={{ margin: 0, fontSize: 11, color: '#6b7280', lineHeight: 1.3 }}>
            {gpsDenied ? '위치 권한 없음 · 전국 표시' : myPos ? '현재 위치 기준' : 'GPS 확인 중...'}
          </p>
        </div>

        {/* PHASE 18: 급구 필터 토글 버튼 */}
        <button
          onClick={() => setUrgentOnly(v => !v)}
          style={{
            padding: '5px 10px', borderRadius: 99, border: 'none', cursor: 'pointer',
            fontWeight: 800, fontSize: 11,
            background: urgentOnly ? '#dc2626' : '#fef2f2',
            color:      urgentOnly ? '#fff'    : '#dc2626',
            boxShadow:  urgentOnly ? '0 2px 8px rgba(220,38,38,.35)' : 'none',
            transition: 'all .15s',
            flexShrink: 0,
          }}
          title="급구만 보기"
        >
          🔥 {urgentOnly ? '급구만' : '급구'}
        </button>

        {/* 위치 상태 배지 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700,
          padding: '4px 10px', borderRadius: 99,
          background: gpsDenied ? '#fef9c3' : myPos ? '#f0fdf4' : '#f3f4f6',
          flexShrink: 0,
        }}>
          {gpsDenied
            ? <><MapPin size={11} color="#d97706" /><span style={{ color: '#92400e' }}>위치 없음</span></>
            : myPos
              ? <><Navigation size={11} color="#16a34a" /><span style={{ color: '#15803d' }}>내 위치</span></>
              : <><Loader2 size={11} color="#9ca3af" style={{ animation: 'spin 1s linear infinite' }} /><span style={{ color: '#6b7280' }}>확인 중</span></>
          }
        </div>
      </header>

      {/* ── Leaflet 지도 컨테이너 (헤더 56px 아래 전부) ──────────── */}
      <div
        ref={mapContainerRef}
        style={{ position: 'absolute', top: 56, left: 0, right: 0, bottom: 0, zIndex: 100 }}
      />

      {/* ── 오버레이 UI ─────────────────────────────────────────── */}

      {/* 로딩 배지 */}
      {jobsLoading && (
        <div style={{ position: 'absolute', top: 68, left: 16, zIndex: 160 }}>
          <div style={{
            background: 'rgba(255,255,255,0.96)', borderRadius: 99,
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 600, color: '#4b5563',
          }}>
            <Loader2 size={12} color="#16a34a" style={{ animation: 'spin 1s linear infinite' }} />
            <span>일자리 불러오는 중...</span>
          </div>
        </div>
      )}

      {/* GPS 거부 배너 */}
      {gpsDenied && !jobsLoading && (
        <div style={{ position: 'absolute', top: 68, left: 16, right: 16, zIndex: 160 }}>
          <div style={{
            background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: 16, padding: '10px 14px',
            display: 'flex', alignItems: 'flex-start', gap: 8,
            fontSize: 12, color: '#92400e', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}>
            <MapPin size={14} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>위치 권한을 허용하면 내 위치 기준으로 가까운 일부터 보여드려요.</span>
          </div>
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div style={{ position: 'absolute', top: 68, left: 16, right: 16, zIndex: 160 }}>
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 16, padding: '10px 14px',
            fontSize: 13, color: '#b91c1c',
          }}>{error}</div>
        </div>
      )}

      {/* 마커 수 배지 + 급구 필터 상태 표시 */}
      {!jobsLoading && validCount > 0 && (
        <div style={{ position: 'absolute', top: 68, right: 16, zIndex: 160, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <div style={{
            background: urgentOnly ? '#dc2626' : '#16a34a',
            color: '#fff', fontSize: 12, fontWeight: 700,
            padding: '5px 12px', borderRadius: 99,
            boxShadow: urgentOnly ? '0 2px 8px rgba(220,38,38,.35)' : '0 2px 8px rgba(22,163,74,.35)',
          }}>
            {urgentOnly ? `🔥 급구 ${validCount}건` : `일자리 ${validCount}건`}
          </div>
          {urgentOnly && (
            <div style={{
              background: 'rgba(220,38,38,0.12)', color: '#dc2626',
              fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
              border: '1px solid rgba(220,38,38,0.3)',
            }}>
              🔥 급구만 표시 중
            </div>
          )}
        </div>
      )}

      {/* 빈 상태 */}
      {!jobsLoading && validCount === 0 && !error && (
        <div style={{
          position: 'absolute', bottom: 32, left: 0, right: 0, zIndex: 160,
          display: 'flex', justifyContent: 'center',
        }}>
          <div style={{
            background: 'rgba(255,255,255,0.96)', borderRadius: 18,
            boxShadow: '0 2px 16px rgba(0,0,0,0.10)',
            padding: '12px 24px', textAlign: 'center',
            border: '1px solid #f3f4f6',
          }}>
            <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 14, color: '#374151' }}>근처 일자리가 없어요</p>
            <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>GPS 좌표가 포함된 일이 등록되면 나타나요</p>
          </div>
        </div>
      )}

      {/* ── 하단 카드 (PHASE 15: 2탭 즉시 지원) ── */}
      <BottomCard
        job={selectedJob}
        onQuickApply={null}                     // 내부 handleApplyClick으로 처리
        onFallback={safeViewDetail}             // 실패 시 → job-detail 상세 페이지
        onDismiss={() => setSelectedJob(null)}
        onViewMyApplications={safeViewMyApplications}  // PHASE 21: 내 지원 현황 이동
        // PHASE 27: 지원 완료 시 마커 아이콘 즉시 변경
        onApplySuccess={(jobId) => {
          setAppliedIds(prev => {
            const next = new Set(prev);
            next.add(jobId);
            return next;
          });
          // Leaflet 마커 아이콘 직접 업데이트 (re-render 없이 즉시 반영)
          const entry = leafletMarkers.current.find(m => m.id === jobId);
          if (entry) {
            entry.marker.setIcon(makeJobIcon(entry.job, selectedIdRef.current === jobId, true));
          }
          console.log('[PHASE27_APPLIED_MARKER]', jobId);
        }}
      />
    </div>
  );
}
