/**
 * MapExplorePage.jsx — Uber-style 일손 지도 탐색
 * 경로: /map-explore
 *
 * - VWorld Base 타일 (mapConfig 재사용)
 * - 내 위치(GPS) 자동 센터링
 * - 작업 마커 (🌾 초록): /api/jobs/map 데이터
 * - 지도 이동/줌 완료 시 현재 중심 기준 재조회 (movend)
 * - 마커 클릭 → 하단 팝업 (작업명/거리/일당/길찾기/상세보기)
 * - 상단: ← 뒤로 + 📍 내 위치로
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP_CONFIG } from '../config/mapConfig.js';
import { getKakaoNaviLink } from '../utils/mapLink.js';
import { estimateWork } from '../utils/workEstimator.js';
import { getOrCreateUser } from '../utils/userProfile.js';

// Vite 환경 Leaflet 기본 마커 아이콘 경로 복구
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon   from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl:     markerShadow,
});

const API_BASE = import.meta.env?.VITE_API_URL || '';

// ── 일당 포맷 ──────────────────────────────────────────────────
function fmtPay(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (s.includes('만')) return s;
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
  if (!n) return s;
  if (n >= 10000) return `${(n / 10000).toFixed(0)}만원`;
  return s;
}

// ── 거리 포맷 ──────────────────────────────────────────────────
function fmtDist(km) {
  if (km == null || !Number.isFinite(km)) return null;
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
}

// ── 작업 마커 아이콘 ───────────────────────────────────────────
// BOOST_CONVERSION: 스폰서 마커 압도적 강조 (크기+glow+애니메이션)
// JOB_INFO_ENHANCE: pay + workLabel 레이어 추가
function makeJobIcon(isToday, isUrgent, isSponsored, pay, workLabel) {
  const payHtml = pay
    ? `<div style="font-size:10px;font-weight:900;color:#fff;white-space:nowrap;
                   text-shadow:0 1px 2px rgba(0,0,0,.5);line-height:1;margin-bottom:2px;">
         💰${pay}
       </div>`
    : '';
  const labelHtml = workLabel
    ? `<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,0.9);
                   white-space:nowrap;margin-top:2px;line-height:1;">
         ${workLabel}
       </div>`
    : '';

  if (isSponsored) {
    return L.divIcon({
      html: `
        <div style="display:flex;flex-direction:column;align-items:center;">
          ${payHtml}
          <div class="boost-pulse-ring" style="position:absolute;"></div>
          <div style="
            position:relative;z-index:2;
            background:linear-gradient(135deg,#f97316,#dc2626);
            color:#fff;font-size:20px;
            width:44px;height:44px;border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            border:3px solid #fff;
            box-shadow:0 0 0 3px rgba(249,115,22,0.45),0 4px 16px rgba(220,38,38,0.6);
          ">🔥</div>
          ${labelHtml}
        </div>
      `,
      className: 'boost-marker',
      iconSize: [56, pay || workLabel ? 72 : 44],
      iconAnchor: [28, pay ? 44 : 22],
    });
  }

  const bg    = isUrgent ? '#dc2626' : isToday ? '#16a34a' : '#2563eb';
  const emoji = isUrgent ? '🔥' : '🌾';
  return L.divIcon({
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;">
        ${payHtml}
        <div style="
          background:${bg};color:#fff;font-size:15px;
          width:34px;height:34px;border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);
        ">${emoji}</div>
        ${labelHtml}
      </div>
    `,
    className: '',
    iconSize: [50, pay || workLabel ? 60 : 34],
    iconAnchor: [25, pay ? 40 : 17],
  });
}

export default function MapExplorePage() {
  const mapRef      = useRef(null);
  const mapObj      = useRef(null);
  const markersRef  = useRef([]);       // L.Marker[]
  const userMarker  = useRef(null);
  const fetchTimer  = useRef(null);

  const [selected,   setSelected]   = useState(null);   // 클릭된 마커 데이터
  const [userLoc,    setUserLoc]    = useState(null);    // { lat, lng }
  const [loading,    setLoading]    = useState(false);
  const [count,      setCount]      = useState(0);

  // BACK_NAV: 지도 상태 저장/복원 유틸
  const MAP_STATE_KEY = 'farm-mapState';

  function saveMapState() {
    if (!mapObj.current) return;
    try {
      const c = mapObj.current.getCenter();
      const z = mapObj.current.getZoom();
      sessionStorage.setItem(MAP_STATE_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: z }));
    } catch (_) {}
  }

  function restoreMapState() {
    try {
      const raw = sessionStorage.getItem(MAP_STATE_KEY);
      if (!raw || !mapObj.current) return false;
      const { lat, lng, zoom } = JSON.parse(raw);
      mapObj.current.setView([lat, lng], zoom);
      return true;
    } catch (_) { return false; }
  }

  // ── 마커 데이터 fetch ─────────────────────────────────────────
  const fetchMarkers = useCallback(async (center) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (center) { params.set('lat', center.lat); params.set('lon', center.lng); }
      const res  = await fetch(`${API_BASE}/api/jobs/map?${params}`);
      const data = await res.json();
      if (!data.ok) return;

      const map = mapObj.current;
      if (!map) return;

      // 기존 마커 제거
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      data.markers.forEach(job => {
        if (job.lat == null || job.lng == null) return;
        const { label: wLabel } = estimateWork(job.areaPyeong, job.category);
        const marker = L.marker([job.lat, job.lng], {
          icon: makeJobIcon(job.isToday, job.isUrgent, job.isSponsored, job.pay, wLabel),
        });
        marker.addTo(map);
        marker.on('click', () => setSelected(job));
        markersRef.current.push(marker);
      });

      setCount(data.markers.length);
    } catch (e) {
      console.error('[MAP_EXPLORE] fetch error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Leaflet 초기화 ────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapObj.current) return;

    const map = L.map(mapRef.current, {
      center: MAP_CONFIG.DEFAULT_CENTER,
      zoom:   MAP_CONFIG.DEFAULT_ZOOM,
      zoomControl: true,
    });
    mapObj.current = map;

    L.tileLayer(MAP_CONFIG.TILE_URL, {
      attribution: MAP_CONFIG.ATTRIBUTION,
      maxZoom:     MAP_CONFIG.MAX_ZOOM || 18,
    }).addTo(map);

    // moveend → 중심 기준 재조회 (debounce 600ms)
    map.on('moveend', () => {
      clearTimeout(fetchTimer.current);
      fetchTimer.current = setTimeout(() => {
        const c = map.getCenter();
        fetchMarkers({ lat: c.lat, lng: c.lng });
      }, 600);
    });

    // BACK_NAV: 뒤로가기로 복귀 시 이전 지도 위치/줌 복원 (GPS보다 우선)
    const hadSavedState = (() => {
      try {
        const raw = sessionStorage.getItem('farm-mapState');
        if (!raw) return false;
        const { lat, lng, zoom } = JSON.parse(raw);
        map.setView([lat, lng], zoom);
        fetchMarkers({ lat, lng });
        sessionStorage.removeItem('farm-mapState'); // 복원 후 삭제 (1회성)
        return true;
      } catch (_) { return false; }
    })();

    if (hadSavedState) {
      // 저장된 위치로 복원됐으면 GPS 오버라이드 안 함
      navigator.geolocation?.getCurrentPosition(({ coords }) => {
        const { latitude: lat, longitude: lng } = coords;
        setUserLoc({ lat, lng });
        const userIcon = L.divIcon({
          html: `<div style="background:#2563eb;color:#fff;font-size:13px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);">📍</div>`,
          className: '', iconSize: [28, 28], iconAnchor: [14, 14],
        });
        userMarker.current = L.marker([lat, lng], { icon: userIcon }).addTo(map).bindPopup('내 위치');
        // 지도 이동 안 함 — 저장 상태 유지
      });
      return; // GPS setView 건너뜀
    }

    // GPS 확보
    navigator.geolocation?.getCurrentPosition(
      ({ coords }) => {
        const { latitude: lat, longitude: lng } = coords;
        setUserLoc({ lat, lng });

        const userIcon = L.divIcon({
          html: `<div style="
            background:#2563eb;color:#fff;font-size:13px;
            width:28px;height:28px;border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);
          ">📍</div>`,
          className: '', iconSize: [28, 28], iconAnchor: [14, 14],
        });
        userMarker.current = L.marker([lat, lng], { icon: userIcon }).addTo(map).bindPopup('내 위치');
        map.setView([lat, lng], MAP_CONFIG.MY_ZOOM || 13);
        fetchMarkers({ lat, lng });
      },
      () => {
        // GPS 거부 → localStorage 저장 위치 우선, 없으면 기본 중심
        try {
          const stored = JSON.parse(localStorage.getItem('userLocation') || 'null');
          if (stored?.lat && stored?.lon) {
            mapObj.current?.setView([stored.lat, stored.lon], MAP_CONFIG.MY_ZOOM || 13);
            fetchMarkers({ lat: stored.lat, lng: stored.lon });
            return;
          }
        } catch (_) {}
        fetchMarkers(null);
      }
    );

    return () => {
      clearTimeout(fetchTimer.current);
      map.remove();
      mapObj.current = null;
    };
  }, [fetchMarkers]);

  // ── 내 위치로 이동 ─────────────────────────────────────────────
  const goToMyLocation = () => {
    if (!mapObj.current) return;
    if (userLoc) {
      mapObj.current.setView([userLoc.lat, userLoc.lng], MAP_CONFIG.MY_ZOOM || 13);
    } else {
      navigator.geolocation?.getCurrentPosition(({ coords }) => {
        const { latitude: lat, longitude: lng } = coords;
        setUserLoc({ lat, lng });
        mapObj.current?.setView([lat, lng], MAP_CONFIG.MY_ZOOM || 13);
      });
    }
  };

  const naviLink = selected ? getKakaoNaviLink({ latitude: selected.lat, longitude: selected.lng, category: selected.category }) : null;

  // ── 렌더 ─────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100dvh' }}>

      {/* BOOST_CONVERSION: 스폰서 마커 펄스 + 지도 전역 스타일 */}
      <style>{`
        .boost-marker { overflow: visible !important; background: none !important; border: none !important; }
        .boost-pulse-ring {
          position: absolute; inset: -6px; border-radius: 50%; z-index: 1;
          border: 2.5px solid rgba(249,115,22,0.6);
          animation: boostMarkerPulse 1.6s ease-in-out infinite;
        }
        @keyframes boostMarkerPulse {
          0%,100% { transform: scale(1);    opacity: .7; }
          50%      { transform: scale(1.35); opacity: .1; }
        }
      `}</style>

      {/* 상단 컨트롤 */}
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 1000, display: 'flex', gap: 8 }}>
        <button
          onClick={() => {
            saveMapState(); // BACK_NAV: 뒤로가기 전 지도 상태 저장 (혹시 몰라서)
            window.history.back();
          }}
          style={{
            background: '#fff', border: 'none', borderRadius: 12,
            padding: '8px 14px', fontWeight: 700, fontSize: 14,
            boxShadow: '0 2px 8px rgba(0,0,0,.18)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >← 뒤로</button>

        <div style={{
          flex: 1, background: '#fff', borderRadius: 12,
          padding: '8px 14px', fontSize: 13, fontWeight: 600, color: '#374151',
          boxShadow: '0 2px 8px rgba(0,0,0,.18)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          🌾 주변 일손 {loading ? '로딩 중…' : `${count}건`}
        </div>

        <button
          onClick={goToMyLocation}
          style={{
            background: '#2563eb', color: '#fff', border: 'none', borderRadius: 12,
            padding: '8px 12px', fontWeight: 700, fontSize: 14,
            boxShadow: '0 2px 8px rgba(0,0,0,.18)', cursor: 'pointer',
          }}
          title="내 위치로"
        >📍</button>
      </div>

      {/* 지도 */}
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* 마커 클릭 팝업 (하단 시트) */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'absolute', inset: 0, zIndex: 999,
            background: 'transparent',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              background: '#fff', borderRadius: '20px 20px 0 0',
              padding: '16px 16px 28px',
              boxShadow: '0 -4px 24px rgba(0,0,0,.15)',
            }}
          >
            {/* 핸들 */}
            <div style={{ width: 40, height: 4, background: '#d1d5db', borderRadius: 2, margin: '0 auto 14px' }} />

            {/* 작업명 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: '#166534' }}>
                {selected.isSponsored ? '⭐' : selected.isUrgent ? '🔥' : '🌾'} {selected.category || '작업'}
              </p>
              <button
                onClick={() => setSelected(null)}
                style={{ background: 'none', border: 'none', fontSize: 18, color: '#9ca3af', cursor: 'pointer', lineHeight: 1 }}
              >✕</button>
            </div>
            {/* 스폰서 배지 — BOOST_CONVERSION */}
            {selected.isSponsored && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'linear-gradient(90deg,#fff7ed,#fef3c7)',
                border: '1.5px solid #f97316',
                borderRadius: 9999, padding: '4px 12px', marginBottom: 10,
                fontSize: 12, fontWeight: 900, color: '#c2410c',
                boxShadow: '0 2px 8px rgba(249,115,22,0.2)',
              }}>
                🔥 지원자 몰리는 공고 · 추천 1순위
              </div>
            )}

            {/* 메타 */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {selected.distKm != null && (
                <span style={{ fontSize: 13, color: '#2563eb', fontWeight: 700 }}>
                  📏 {fmtDist(selected.distKm)}
                </span>
              )}
              {selected.pay && (
                <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 700 }}>
                  💰 {fmtPay(selected.pay)}
                </span>
              )}
              {selected.date && (
                <span style={{ fontSize: 13, color: '#6b7280' }}>
                  📅 {selected.date}
                  {selected.isToday && <span style={{ marginLeft: 4, color: '#dc2626', fontWeight: 800 }}>오늘!</span>}
                </span>
              )}
              {selected.locationText && (
                <span style={{ fontSize: 12, color: '#9ca3af' }}>📍 {selected.locationText}</span>
              )}
            </div>

            {/* 전화 CTA — primary (phone 있을 때) */}
            {(selected.phone || selected.contact || selected.phoneFull || selected.farmerPhone) && (() => {
              const tel = (selected.phone || selected.contact || selected.phoneFull || selected.farmerPhone).replace(/[^0-9+]/g, '');
              return (
                <a
                  href={`tel:${tel}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    width: '100%', height: 56,
                    background: '#ff4d00', color: '#fff',
                    fontSize: 18, fontWeight: 900,
                    borderRadius: 14, marginBottom: 10,
                    textDecoration: 'none',
                    boxShadow: '0 4px 16px rgba(255,77,0,0.38)',
                  }}
                >📞 지금 전화하기</a>
              );
            })()}

            {/* 버튼 */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  getOrCreateUser();
                  saveMapState(); // BACK_NAV: 상세 이동 전 지도 위치/줌 저장
                  // 브라우저 history에 /map-explore 추가 → 뒤로가기 시 지도 복귀
                  window.history.pushState(null, '', '/map-explore');
                  window.location.href = `/jobs/${selected.id}`;
                }}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                  background: '#16a34a', color: '#fff', fontWeight: 800, fontSize: 14,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >📄 상세보기</button>

              {naviLink ? (
                <a href={naviLink} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textDecoration: 'none' }}>
                  <button style={{
                    width: '100%', padding: '12px 0', borderRadius: 12, border: 'none',
                    background: '#FAE100', color: '#1a1a1a', fontWeight: 800, fontSize: 14,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}>🧭 길찾기</button>
                </a>
              ) : (
                <button disabled style={{
                  flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                  background: '#e5e7eb', color: '#9ca3af', fontWeight: 800, fontSize: 14,
                }}>🧭 길찾기</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
