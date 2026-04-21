/**
 * JobMapView.jsx — Phase 10: 지도 UI + 위치 기반 시각화
 *
 * 기능:
 *  - 내 위치 (파란 점)
 *  - open 일자리 마커 (카테고리 이모지, 오늘=초록 링, 급구=주황 링)
 *  - 마커 클릭 → 하단 카드 슬라이드
 *  - "상세 보기" → 기존 JobDetailPage 딥링크 흐름
 *  - GPS 거부 시 → 전국 폴백 + 안내 배너
 *  - 민감정보(전화번호) 미노출
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ArrowLeft, MapPin, Loader2, Navigation,
  Banknote, Clock, ChevronDown, ExternalLink,
} from 'lucide-react';
import { getMapJobs, trackClientEvent } from '../utils/api.js';

// ── 상수 ────────────────────────────────────────────────────────
const DEFAULT_CENTER = [36.5, 127.5]; // 한국 중심
const DEFAULT_ZOOM   = 10;
const MY_ZOOM        = 13;

const CATEGORY_EMOJI = {
  '밭갈이': '🚜', '로터리': '🔄', '두둑': '⛰️',
  '방제': '💊', '수확 일손': '🌾', '예초': '✂️',
};

// ── 마커 아이콘 팩토리 ───────────────────────────────────────────
function makeJobIcon(job) {
  const emoji  = CATEGORY_EMOJI[job.category] || '🌱';
  const border = job.isToday   ? '#16a34a'  // 초록 — 오늘
                : job.isUrgent ? '#f97316'  // 주황 — 급구
                :                '#6b7280'; // 회색 — 일반
  const bg     = job.isToday   ? '#f0fdf4' : '#ffffff';
  return L.divIcon({
    html: `<div style="
      background:${bg};border:3px solid ${border};border-radius:50%;
      width:44px;height:44px;display:flex;align-items:center;justify-content:center;
      font-size:20px;box-shadow:0 3px 10px rgba(0,0,0,.18);cursor:pointer;">
      ${emoji}
    </div>`,
    className:  '',
    iconSize:   [44, 44],
    iconAnchor: [22, 22],
  });
}

const MY_ICON = L.divIcon({
  html: `<div style="
    background:#3b82f6;border:3px solid white;border-radius:50%;
    width:18px;height:18px;
    box-shadow:0 0 0 6px rgba(59,130,246,.25);">
  </div>`,
  className:  '',
  iconSize:   [18, 18],
  iconAnchor: [9, 9],
});

// ── 지도 내부: 프로그래밍 pan + 클릭 이벤트 ──────────────────────
// useMapEvents 대신 직접 map.on('click') — react-leaflet v5 + React 18 호환성 이슈 회피
function MapController({ flyTo, onMapClick }) {
  const map = useMap();
  const prev = useRef(null);

  // 클릭 이벤트: 함수형 prop 안전 호출
  useEffect(() => {
    if (!map) return;
    const handler = (e) => {
      if (typeof onMapClick === 'function') {
        try { onMapClick(e); } catch (err) { console.warn('[MAP_CLICK_ERR]', err?.message); }
      }
    };
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [map, onMapClick]);

  // flyTo 처리
  useEffect(() => {
    if (!map) return;
    if (flyTo && JSON.stringify(flyTo) !== JSON.stringify(prev.current)) {
      prev.current = flyTo;
      try { map.flyTo(flyTo, MY_ZOOM, { duration: 0.6 }); } catch (_) {}
    }
  }, [flyTo, map]);

  return null;
}

// ── 하단 잡 카드 ─────────────────────────────────────────────────
function BottomCard({ job, onViewDetail, onDismiss }) {
  if (!job) return null;
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9999] bg-white rounded-t-3xl shadow-2xl
                 border-t border-gray-100 animate-fade-in"
      style={{ maxWidth: 512, margin: '0 auto' }}
    >
      {/* 드래그 핸들 */}
      <div className="flex justify-center pt-3 pb-1">
        <div className="w-10 h-1.5 bg-gray-200 rounded-full" />
      </div>

      {/* 카드 내용 */}
      <div className="px-5 pb-5 pt-2 space-y-2">
        {/* 제목 + 배지 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xl">{CATEGORY_EMOJI[job.category] || '🌱'}</span>
          <span className="text-lg font-black text-gray-800">{job.category}</span>
          {job.isToday && (
            <span className="text-xs bg-farm-green text-white font-bold rounded-full px-2 py-0.5">오늘</span>
          )}
          {job.isUrgent && (
            <span className="text-xs bg-orange-500 text-white font-bold rounded-full px-2 py-0.5">급구</span>
          )}
          {job.distKm != null && (
            <span className="text-xs bg-blue-50 text-blue-600 font-semibold rounded-full px-2 py-0.5">
              {job.distKm < 1 ? '1km 이내' : `${job.distKm}km`}
            </span>
          )}
        </div>

        {/* 상세 정보 */}
        <div className="flex flex-col gap-1 text-sm text-gray-600">
          <div className="flex items-center gap-1.5">
            <MapPin size={13} className="text-farm-green shrink-0" />
            <span>{job.locationText}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock size={13} className="text-farm-green shrink-0" />
            <span>{job.date}</span>
          </div>
          {job.pay && (
            <div className="flex items-center gap-1.5">
              <Banknote size={13} className="text-farm-green shrink-0" />
              <span className="font-semibold text-gray-700">일당 {job.pay}</span>
            </div>
          )}
        </div>

        {/* 버튼 */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => { if (typeof onDismiss === 'function') onDismiss(); }}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-sm font-bold
                       flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
          >
            <ChevronDown size={15} /> 닫기
          </button>
          <button
            onClick={() => {
              try { trackClientEvent('map_card_select', { jobId: job.id }); } catch (_) {}
              if (typeof onViewDetail === 'function') onViewDetail(job);
              else console.warn('[MAP_VIEW_DETAIL_NOT_FN]');
            }}
            className="flex-1 py-2.5 rounded-xl bg-farm-green text-white text-sm font-bold
                       flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
          >
            <ExternalLink size={15} /> 상세 보기
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────
export default function JobMapView({ onBack, onViewDetail }) {
  // 진입 시 prop 타입 로그 (크래시 원인 추적용 + 안전장치)
  console.log('[MAP_VIEW_PROPS]',
    'onBack=' + typeof onBack,
    'onViewDetail=' + typeof onViewDetail,
  );
  const safeBack       = typeof onBack       === 'function' ? onBack       : () => { console.warn('[MAP_BACK_NOOP]'); };
  const safeViewDetail = typeof onViewDetail === 'function' ? onViewDetail : (j) => { console.warn('[MAP_VIEWDETAIL_NOOP]', j?.id); };

  const [markers,     setMarkers]     = useState([]);
  const [myPos,       setMyPos]       = useState(null);       // [lat, lng]
  const [gpsDenied,   setGpsDenied]   = useState(false);
  const [gpsLoading,  setGpsLoading]  = useState(true);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState(null);
  const [flyTo,       setFlyTo]       = useState(null);
  const [error,       setError]       = useState('');

  // ── GPS 취득 ─────────────────────────────────────────────────
  const fetchGps = useCallback(() => {
    setGpsLoading(true);
    if (!navigator.geolocation) {
      setGpsDenied(true);
      setGpsLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const pos = [coords.latitude, coords.longitude];
        setMyPos(pos);
        setFlyTo(pos);
        setGpsLoading(false);
        localStorage.setItem('userLocation', JSON.stringify({ lat: coords.latitude, lon: coords.longitude }));
      },
      () => {
        setGpsDenied(true);
        setGpsLoading(false);
        trackClientEvent('map_gps_denied');
        console.log('[MAP_GPS_DENIED] 위치 권한 거부');
      },
      { timeout: 8000, maximumAge: 60000 }
    );
  }, []);

  // ── 일자리 로드 ───────────────────────────────────────────────
  const loadJobs = useCallback(async (pos) => {
    setJobsLoading(true);
    try {
      const loc = pos || (function() {
        try { const r = JSON.parse(localStorage.getItem('userLocation')); return r; } catch { return null; }
      })();
      const data = await getMapJobs({ lat: loc?.lat, lon: loc?.lon || loc?.lng });
      setMarkers(data.markers || []);
    } catch (e) {
      setError('일자리 정보를 불러올 수 없어요.');
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    trackClientEvent('map_view_open');
    console.log('[MAP_VIEW_OPEN]');

    // GPS와 일자리 로드 병렬 시작
    const storedLoc = (() => { try { return JSON.parse(localStorage.getItem('userLocation')); } catch { return null; } })();
    if (storedLoc) {
      setMyPos([storedLoc.lat, storedLoc.lon]);
      setFlyTo([storedLoc.lat, storedLoc.lon]);
      setGpsLoading(false);
    }
    loadJobs(storedLoc);
    fetchGps();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleMarkerClick(job) {
    setSelectedJob(job);
    setFlyTo([job.lat, job.lng]);
    trackClientEvent('map_marker_click', { jobId: job.id });
    console.log('[MAP_MARKER_CLICK] jobId=' + job.id);
  }

  function handleMapClick() {
    setSelectedJob(null);
  }

  const isLoading = gpsLoading || jobsLoading;
  const mapCenter = myPos || DEFAULT_CENTER;
  const mapZoom   = myPos ? MY_ZOOM : DEFAULT_ZOOM;

  return (
    <div className="relative" style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>

      {/* ── 헤더 ──────────────────────────────────────────────── */}
      <header className="absolute top-0 left-0 right-0 z-[1000] bg-white/90 backdrop-blur-sm
                         px-4 pt-safe pt-3 pb-3 flex items-center gap-3 border-b border-gray-100
                         shadow-sm">
        <button onClick={safeBack} className="p-1.5 text-gray-600">
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1">
          <p className="font-black text-gray-800 text-base leading-tight">주변 일자리 지도</p>
          <p className="text-xs text-gray-500 leading-tight">
            {gpsDenied
              ? '위치 권한 없음 · 전국 표시'
              : myPos
                ? '현재 위치 기준'
                : 'GPS 확인 중...'}
          </p>
        </div>
        {/* GPS 상태 배지 */}
        <div className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
          style={{ background: gpsDenied ? '#fef9c3' : myPos ? '#f0fdf4' : '#f3f4f6' }}>
          {gpsDenied
            ? <><MapPin size={11} className="text-amber-500" /><span className="text-amber-700">위치 없음</span></>
            : myPos
              ? <><Navigation size={11} className="text-green-600" /><span className="text-green-700">내 위치</span></>
              : <><Loader2 size={11} className="text-gray-400 animate-spin" /><span className="text-gray-500">확인 중</span></>
          }
        </div>
      </header>

      {/* ── 로딩 오버레이 ──────────────────────────────────────── */}
      {isLoading && (
        <div className="absolute inset-0 z-[900] flex items-center justify-center bg-white/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-gray-500">
            <Loader2 size={32} className="animate-spin text-farm-green" />
            <span className="text-sm font-semibold">일자리 불러오는 중...</span>
          </div>
        </div>
      )}

      {/* ── GPS 거부 안내 배너 ─────────────────────────────────── */}
      {gpsDenied && !isLoading && (
        <div className="absolute top-16 left-0 right-0 z-[999] mx-4 mt-2">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm text-amber-700 flex items-start gap-2 shadow">
            <MapPin size={15} className="shrink-0 mt-0.5" />
            <span>위치 권한을 허용하면 내 위치 기준으로 가까운 일부터 보여드려요.</span>
          </div>
        </div>
      )}

      {/* ── 에러 ──────────────────────────────────────────────── */}
      {error && (
        <div className="absolute top-20 left-0 right-0 z-[999] mx-4 mt-2">
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        </div>
      )}

      {/* ── 마커 수 배지 ───────────────────────────────────────── */}
      {!isLoading && markers.length > 0 && (
        <div className="absolute top-16 right-4 z-[999] mt-2">
          <div className="bg-farm-green text-white text-xs font-bold px-3 py-1.5 rounded-full shadow">
            일자리 {markers.length}건
          </div>
        </div>
      )}

      {/* ── 지도 ──────────────────────────────────────────────── */}
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        style={{ flex: 1, width: '100%' }}
        zoomControl={true}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        <MapController
          flyTo={flyTo}
          onMapClick={handleMapClick}
        />

        {/* 내 위치 마커 */}
        {myPos && (
          <Marker position={myPos} icon={MY_ICON} />
        )}

        {/* 일자리 마커 */}
        {markers.map(job => (
          <Marker
            key={job.id}
            position={[job.lat, job.lng]}
            icon={makeJobIcon(job)}
            eventHandlers={{ click: () => handleMarkerClick(job) }}
          />
        ))}
      </MapContainer>

      {/* ── 하단 잡 카드 ─────────────────────────────────────── */}
      <BottomCard
        job={selectedJob}
        onViewDetail={safeViewDetail}
        onDismiss={() => setSelectedJob(null)}
      />

      {/* ── 빈 상태 안내 ─────────────────────────────────────── */}
      {!isLoading && markers.length === 0 && !error && (
        <div className="absolute bottom-8 left-0 right-0 z-[999] flex justify-center">
          <div className="bg-white/95 rounded-2xl shadow px-6 py-3 text-sm text-gray-500 text-center border border-gray-100">
            <p className="font-semibold text-gray-600 mb-0.5">근처 일자리가 없어요</p>
            <p className="text-xs text-gray-400">GPS가 포함된 새 일이 등록되면 나타나요</p>
          </div>
        </div>
      )}
    </div>
  );
}
