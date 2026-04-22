/**
 * MapPage.jsx — 작업 위치 단건 지도 보기
 * 경로: /map?lat=&lng=&title=&jobId=&driveMin=
 *
 * - VWorld Base 타일 (mapConfig 재사용)
 * - 작업 위치 핀(초록) + 내 위치 핀(파랑) + 파선 연결 + fitBounds
 * - 하단 바: 작업명 · 이동시간 · [📄 상세보기] [🧭 길찾기]
 * - 로그인 게이트 없음 (공유 링크 대비)
 */
import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP_CONFIG } from '../config/mapConfig.js';
import { getKakaoNaviLink } from '../utils/mapLink.js';

// Vite 환경 Leaflet 마커 아이콘 경로 복구
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon   from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl:     markerShadow,
});

// ── 이동시간 포맷 ────────────────────────────────────────────────
function fmtDrive(min) {
  if (!min || min < 1) return null;
  if (min < 2)  return '🚜 1분 이내';
  if (min < 60) return `🚜 ${min}분`;
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `🚜 ${h}시간 ${m}분` : `🚜 ${h}시간`;
}

export default function MapPage() {
  const mapRef = useRef(null);
  const mapObj = useRef(null);

  // ── URL 파라미터 파싱 ────────────────────────────────────────────
  const params   = new URLSearchParams(window.location.search);
  const lat      = parseFloat(params.get('lat'));
  const lng      = parseFloat(params.get('lng'));
  const title    = params.get('title') || '작업 위치';
  const jobId    = params.get('jobId') || null;
  const driveMin = parseInt(params.get('driveMin'), 10) || null;

  const hasCoords  = Number.isFinite(lat) && Number.isFinite(lng);
  const driveLabel = fmtDrive(driveMin);
  const naviLink   = hasCoords
    ? getKakaoNaviLink({ latitude: lat, longitude: lng, category: title })
    : null;

  // ── 진단 로그 ──────────────────────────────────────────────────
  console.log('[MAP PAGE PARAM]', { lat, lng, title, jobId, driveMin, hasCoords });

  // ── Leaflet 초기화 ───────────────────────────────────────────────
  useEffect(() => {
    if (!hasCoords || !mapRef.current || mapObj.current) return;

    const map = L.map(mapRef.current).setView([lat, lng], 15);
    mapObj.current = map;

    // VWorld Base 타일
    L.tileLayer(MAP_CONFIG.TILE_URL, {
      attribution: MAP_CONFIG.ATTRIBUTION,
      maxZoom:     MAP_CONFIG.MAX_ZOOM || 18,
    }).addTo(map);

    // 작업 위치 마커 (초록)
    const jobIcon = L.divIcon({
      html: `<div style="
        background:#16a34a;color:#fff;font-size:18px;
        width:36px;height:36px;border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);
      ">🌾</div>`,
      className: '', iconSize: [36, 36], iconAnchor: [18, 18],
    });
    L.marker([lat, lng], { icon: jobIcon })
      .addTo(map)
      .bindPopup(`<b>${decodeURIComponent(title)}</b>`)
      .openPopup();

    // 내 위치 GPS
    navigator.geolocation?.getCurrentPosition(
      ({ coords }) => {
        const uLat = coords.latitude, uLng = coords.longitude;

        const userIcon = L.divIcon({
          html: `<div style="
            background:#2563eb;color:#fff;font-size:14px;
            width:30px;height:30px;border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);
          ">📍</div>`,
          className: '', iconSize: [30, 30], iconAnchor: [15, 15],
        });
        L.marker([uLat, uLng], { icon: userIcon }).addTo(map).bindPopup('내 위치');

        L.polyline([[uLat, uLng], [lat, lng]], {
          color: '#2563eb', weight: 2, dashArray: '6,4', opacity: 0.7,
        }).addTo(map);

        map.fitBounds([[uLat, uLng], [lat, lng]], { padding: [40, 60] });
      },
      () => {} // GPS 거부 시 무시
    );

    return () => { map.remove(); mapObj.current = null; };
  }, [lat, lng, hasCoords]);

  // ── 렌더 ────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100dvh' }}>

      {/* 상단: 뒤로가기만 (길찾기는 하단으로 이동) */}
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 1000,
      }}>
        <button
          onClick={() => window.history.back()}
          style={{
            background: '#fff', border: 'none', borderRadius: 12,
            padding: '8px 14px', fontWeight: 700, fontSize: 14,
            boxShadow: '0 2px 8px rgba(0,0,0,.18)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          ← 뒤로
        </button>
      </div>

      {/* 좌표 없을 때 안내 */}
      {!hasCoords && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 999,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#f9fafb', gap: 12,
        }}>
          <p style={{ fontSize: 40 }}>📍</p>
          <p style={{ fontWeight: 700, color: '#374151', margin: 0 }}>위치 정보가 없어요</p>
          <button
            onClick={() => window.history.back()}
            style={{
              background: '#16a34a', color: '#fff', border: 'none',
              borderRadius: 12, padding: '10px 20px', fontWeight: 700, cursor: 'pointer',
            }}
          >
            돌아가기
          </button>
        </div>
      )}

      {/* 지도 컨테이너 */}
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* 하단 액션 바 */}
      {hasCoords && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1000,
          background: '#fff', borderTop: '1px solid #e5e7eb',
          padding: '14px 16px 20px', boxShadow: '0 -2px 16px rgba(0,0,0,.10)',
        }}>
          {/* 작업명 + 이동시간 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: '#166534' }}>
              🌾 {decodeURIComponent(title)}
            </p>
            {driveLabel && (
              <span style={{
                background: '#f0fdf4', border: '1px solid #86efac',
                borderRadius: 10, padding: '3px 10px',
                fontSize: 13, fontWeight: 800, color: '#15803d', whiteSpace: 'nowrap',
              }}>
                {driveLabel}
              </span>
            )}
          </div>

          {/* 좌표 */}
          <p style={{ margin: '0 0 12px', fontSize: 11, color: '#9ca3af' }}>
            {lat.toFixed(5)}, {lng.toFixed(5)}
            {driveLabel && <span style={{ marginLeft: 6 }}>· 차량 이동시간 기준</span>}
          </p>

          {/* 액션 버튼 */}
          <div style={{ display: 'flex', gap: 8 }}>
            {/* 📄 상세보기 — jobId 있을 때만 활성 */}
            <button
              onClick={() => {
                if (jobId) window.location.href = `/jobs/${jobId}`;
              }}
              disabled={!jobId}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                background: jobId ? '#16a34a' : '#e5e7eb',
                color: jobId ? '#fff' : '#9ca3af',
                fontWeight: 800, fontSize: 14, cursor: jobId ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              📄 상세보기
            </button>

            {/* 길찾기 버튼 */}
            {naviLink ? (
              <a href={naviLink} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textDecoration: 'none' }}>
                <button style={{
                  width: '100%', padding: '12px 0', borderRadius: 12, border: 'none',
                  background: '#FAE100', color: '#1a1a1a',
                  fontWeight: 800, fontSize: 14, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  🧭 길찾기
                </button>
              </a>
            ) : (
              <button disabled style={{
                flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                background: '#e5e7eb', color: '#9ca3af', fontWeight: 800, fontSize: 14,
              }}>
                🧭 길찾기
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
