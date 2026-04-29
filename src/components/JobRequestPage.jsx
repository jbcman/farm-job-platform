import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Sparkles, Camera, Loader2, CheckCircle, Zap, MapPin, Navigation, Flame, Search } from 'lucide-react';
import { createJob, smartAssist, getUserId, getUserName, trackClientEvent, sponsorJob, getUrgentPrice, createPayment, confirmPayment } from '../utils/api.js';
import { logTestEvent, logMapRender, logApiFail, logCheckpoint } from '../utils/testLogger.js'; // REAL_USER_TEST
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ── 전체화면 지도 컴포넌트 ────────────────────────────────────────
// 핀 드래그 + 지도 클릭으로 위치 보정 → "이 위치로 확인" 버튼 닫기
function FullScreenMap({ lat, lng, onConfirm, onLocationChange }) {
  const mapRef = useRef(null);
  useEffect(() => {
    if (!mapRef.current) return;
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });
    const map = L.map(mapRef.current, {
      zoomControl: true, scrollWheelZoom: true,
      dragging: true, attributionControl: false,
    }).setView([lat, lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.bindPopup('📍 핀을 드래그하거나<br>지도를 클릭해 위치를 정확히 설정하세요').openPopup();
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      onLocationChange(p.lat, p.lng);
    });
    map.on('click', (e) => {
      marker.setLatLng(e.latlng);
      onLocationChange(e.latlng.lat, e.latlng.lng);
    });
    return () => { try { map.remove(); } catch (_) {} };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-white">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
        <button onClick={onConfirm} className="p-1 text-gray-600 active:scale-95 transition-transform">
          <ArrowLeft size={20} />
        </button>
        <div>
          <p className="font-bold text-gray-800 text-sm">농지 위치 선택</p>
          <p className="text-xs text-gray-500">핀 드래그 또는 지도 클릭으로 정확한 위치를 지정하세요</p>
        </div>
      </div>
      <div ref={mapRef} style={{ flex: 1 }} />
      <div className="px-4 py-3 bg-white border-t border-gray-100 shrink-0">
        <button
          onClick={onConfirm}
          className="w-full py-3.5 bg-farm-green text-white font-black rounded-2xl text-base
                     active:scale-95 transition-transform shadow-lg shadow-green-200"
        >
          ✔ 이 위치로 확인
        </button>
      </div>
    </div>
  );
}

const CATEGORIES = [
  { name: '밭갈이',    emoji: '🚜' },
  { name: '로터리',    emoji: '🔄' },
  { name: '두둑',      emoji: '⛰️' },
  { name: '방제',      emoji: '💊' },
  { name: '수확 일손', emoji: '🌾' },
  { name: '예초',      emoji: '✂️' },
];

const TIME_SLOTS = ['오전 (7시~12시)', '오후 (13시~18시)', '하루 종일', '시간 협의'];
const AREA_UNITS = ['평', '㎡', '마지기', '두락'];

/**
 * JobRequestPage — 일손 구하기 폼
 * simpleMode: 카테고리 + 지역 + 날짜만 (10초 등록)
 * prefillJob: 이전 job 복사하기 (재등록 CTA에서 전달)
 */
export default function JobRequestPage({ onBack, onSuccess, prefillJob }) {
  // 간편 / 상세 모드
  const [simpleMode, setSimpleMode] = useState(true);

  const [category, setCategory]   = useState(prefillJob?.category   || '');
  const [location, setLocation]   = useState(prefillJob?.locationText || '');
  const [date,     setDate]       = useState('');  // 날짜는 재입력 (과거 날짜 방지)
  const [pay,      setPay]        = useState(prefillJob?.pay        || '');
  const [timeSlot, setTimeSlot]   = useState(prefillJob?.timeSlot   || '오전 (7시~12시)');
  const [areaSize, setAreaSize]   = useState(prefillJob?.areaSize ? String(prefillJob.areaSize) : '');
  const [areaUnit, setAreaUnit]   = useState(prefillJob?.areaUnit   || '평');
  const [note,     setNote]       = useState(prefillJob?.note       || '');
  // PHASE 26: 다중 이미지 (최대 3장)
  const [farmImages,  setFarmImages]  = useState([]); // base64 배열
  const [imgPreviews, setImgPreviews] = useState([]); // preview URL 배열

  const [gpsLat,      setGpsLat]      = useState(null);
  const [gpsLng,      setGpsLng]      = useState(null);
  // PHASE 25: GPS 상태 추적
  const [gpsStatus,   setGpsStatus]   = useState('idle'); // idle | acquiring | ok | denied
  // PHASE MAP_FIX: GPS 없을 때 폴백 농지 주소
  const [farmAddress, setFarmAddress] = useState('');
  // DESIGN_V2: 주소 → 좌표 변환 상태
  const [geocodeStatus, setGeocodeStatus] = useState('idle'); // idle | loading | ok | error
  // GEO_PRECISION: 좌표 정확도 — full(읍·면·리 정확) | partial(시·군 추정, 핀 조정 필요)
  const [geocodePrecision, setGeocodePrecision] = useState(null); // null | 'full' | 'partial'
  // GEO_PIN_MOVED: partial 경고 후 사용자가 실제로 핀을 이동했는지 추적
  const [pinMoved, setPinMoved] = useState(false);
  // GEO_PIN_HINT: partial 시 지도 위 안내 오버레이 표시 여부 (2초 fade out)
  const [showPinHint, setShowPinHint] = useState(false);
  // LOCATION_CONFIRM: 지도에서 위치 확인 여부
  const [confirmedLocation, setConfirmedLocation] = useState(false);
  // ADDRESS_LABEL: 좌표 대신 사람이 읽는 주소 (reverse geocode 결과)
  const [addressLabel, setAddressLabel] = useState('');
  // FULLSCREEN_MAP: 전체화면 지도 토글
  const [isMapFull, setIsMapFull] = useState(false);
  const miniMapRef = useRef(null);   // div DOM ref
  const miniMapObj = useRef(null);   // L.Map instance
  const geocodeDebounceRef = useRef(null); // PHASE 2: debounce timer
  const [submitting,    setSubmitting]    = useState(false);
  // GEO_QUALITY: 소프트 차단 — 경고 횟수 카운터 (0=미경고, ≥1=경고중)
  // A/B: geo_warn_count 실험 — A그룹=1회, B그룹=2회 경고 후 통과
  const [geoWarnPending, setGeoWarnPending] = useState(0);
  // A/B 테스트: 서버에서 variant config 수령 (마운트 1회)
  const [abConfig, setAbConfig] = useState(null);
  const [done,          setDone]          = useState(false);
  const [error,         setError]         = useState('');
  // PHASE SCALE: 유료 긴급 공고
  const [isUrgentPaid,  setIsUrgentPaid]  = useState(false);
  const [createdJobId,  setCreatedJobId]  = useState(null);
  // PHASE SCALE+: A/B 가격 정보
  const [priceInfo,     setPriceInfo]     = useState(null); // { group, price, isFree, firstTrialFree, autoConfirm, label }

  const [aiSuggest, setAiSuggest] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const noteTimer = useRef(null);

  // PHASE 26: canvas로 이미지 리사이즈 → base64 (최대 800px, quality 0.75)
  function resizeToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const MAX = 800;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round((h * MAX) / w); w = MAX; }
            else       { w = Math.round((w * MAX) / h); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = reject;
        img.src = ev.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handlePhoto(e) {
    const files = Array.from(e.target.files || []).slice(0, 3 - farmImages.length);
    if (!files.length) return;
    const results = await Promise.all(files.map(resizeToBase64));
    setFarmImages(prev => [...prev, ...results].slice(0, 3));
    setImgPreviews(prev => [...prev, ...results].slice(0, 3));
  }

  function removeImage(idx) {
    setFarmImages(prev => prev.filter((_, i) => i !== idx));
    setImgPreviews(prev => prev.filter((_, i) => i !== idx));
  }

  // REVERSE_GEOCODE: 좌표 → 사람이 읽는 주소 (드래그/클릭 후 호출)
  const reverseGeocode = useCallback(async (lat, lng) => {
    try {
      const r = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
      const d = await r.json();
      if (d.ok) setAddressLabel(d.roadAddress || d.jibunAddress || '');
    } catch (_) {}
  }, []);

  // LOCATION_FIX: 주소 → 좌표 변환 (서버 /api/geocode 경유)
  // 농지 주소 좌표를 userLocation에 저장하지 않음 (작업자 위치 오염 방지)
  const handleGeocodeAddress = useCallback(async () => {
    const trimmed = farmAddress.trim();
    if (!trimmed) return;
    // GEO_QUALITY: 짧은 주소(8자 미만) — 도시 단위, 정확도 낮음 → 차단
    if (trimmed.length < 8) {
      setGeocodeStatus('error');
      try { trackClientEvent('geocode_short_address', { address: trimmed, len: trimmed.length }); } catch (_) {}
      return;
    }
    setGeocodeStatus('loading');
    try {
      const res  = await fetch(`/api/geocode?address=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (!res.ok || !data.lat) throw new Error('주소를 찾을 수 없어요');
      // 농지 좌표 — gpsLat/gpsLng에 저장하되 userLocation(내 위치)에는 저장 안 함
      setGpsLat(data.lat);
      setGpsLng(data.lng);
      setGpsStatus('ok');
      setGeocodeStatus('ok');
      setConfirmedLocation(true); // AUTO_GEOCODE: 버튼 없이 자동 확인
      // ADDRESS_LABEL: 도로명 우선, 지번 폴백, 없으면 입력 주소 그대로
      setAddressLabel(data.roadAddress || data.jibunAddress || trimmed);
      // GEO_PRECISION: 서버 반환 정확도 메타데이터 저장
      const precision = data.precision ?? 'full';
      setGeocodePrecision(precision);
      // GEO_QUALITY: 주소 기반 좌표 품질 추적 (normalized/precision 포함)
      try { trackClientEvent('geocode_success', { address: trimmed, lat: data.lat, lng: data.lng, addrLen: trimmed.length, normalized: data.normalized, precision }); } catch (_) {}
      console.log(`[GEO_QUALITY] 주소="${trimmed}" → (${data.lat.toFixed(4)}, ${data.lng.toFixed(4)}) addrLen=${trimmed.length} normalized=${data.normalized} precision=${precision}`);
      logMapRender(data.lat, data.lng, precision); // REAL_USER_TEST STEP 12
    } catch (e) {
      setGeocodeStatus('error');
      setGeocodePrecision(null);
      // 미리 획득한 GPS 좌표도 지워서 잘못된 위치 사용 방지
      setGpsLat(null);
      setGpsLng(null);
      try { trackClientEvent('geocode_fail', { address: trimmed }); } catch (_) {}
    }
  }, [farmAddress]);

  // PHASE 2: farmAddress 변경 → 500ms debounce → 자동 geocode
  useEffect(() => {
    const trimmed = farmAddress.trim();
    if (!trimmed || trimmed.length < 8) {
      // 짧으면 상태 초기화
      if (trimmed.length > 0 && trimmed.length < 8) setGeocodeStatus('error');
      return;
    }
    clearTimeout(geocodeDebounceRef.current);
    geocodeDebounceRef.current = setTimeout(() => {
      handleGeocodeAddress();
    }, 500);
    return () => clearTimeout(geocodeDebounceRef.current);
  }, [farmAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  // LOCATION_CONFIRM: geocode 성공 시 미니맵 렌더링
  useEffect(() => {
    if (geocodeStatus !== 'ok' || gpsLat == null || gpsLng == null) return;
    if (!miniMapRef.current) return;

    // 기존 맵 인스턴스 제거 (주소 변경 후 재렌더링 시)
    if (miniMapObj.current) {
      miniMapObj.current.remove();
      miniMapObj.current = null;
    }

    // Leaflet 기본 아이콘 경로 수정
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    // GEO_PRECISION: partial → zoom 11 (시·군 전체 보임, "이상함" 즉각 인지)
    //                full   → zoom 16 (지번 수준, 정확 확인)
    const zoomLevel = geocodePrecision === 'partial' ? 11 : 16;

    const map = L.map(miniMapRef.current, {
      zoomControl:        false,   // 미니맵 = 정적 프리뷰, 컨트롤 불필요
      scrollWheelZoom:    false,
      dragging:           false,   // 드래그는 전체화면에서만
      touchZoom:          false,
      doubleClickZoom:    false,
      attributionControl: false,
    }).setView([gpsLat, gpsLng], zoomLevel);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    // 미니맵 마커 — 위치 표시용(비대화형), 드래그는 FullScreenMap에서
    const marker = L.marker([gpsLat, gpsLng], { draggable: false }).addTo(map);
    // partial: 조정 유도 팝업 / full: 확정 메시지
    const popupText = geocodePrecision === 'partial'
      ? '⚠️ 지도를 탭해 실제 농지 위치로 조정하세요'
      : '📍 지도를 탭해 위치를 미세 조정할 수 있어요';
    marker.bindPopup(popupText).openPopup();

    miniMapObj.current = map;

    // GEO_PIN_HINT: partial일 때 — 핀 흔들림(3회) + 안내 오버레이(2.2초)
    let hintTimer = null;
    if (geocodePrecision === 'partial') {
      // 300ms 후 마커 DOM 접근 (Leaflet 렌더 완료 대기)
      setTimeout(() => {
        const el = marker.getElement();
        if (el) el.style.animation = 'pinShake 0.45s ease-in-out 3';
      }, 300);
      // 안내 오버레이 표시 → 2.2초 후 fade out
      setShowPinHint(true);
      hintTimer = setTimeout(() => setShowPinHint(false), 2200);
    }

    return () => {
      if (hintTimer) clearTimeout(hintTimer);
      if (miniMapObj.current) {
        miniMapObj.current.remove();
        miniMapObj.current = null;
      }
    };
  // eslint-disable-line react-hooks/exhaustive-deps
  }, [geocodeStatus, gpsLat, gpsLng]); // gpsLat/gpsLng 추가 — FullScreenMap 드래그 후 미니맵 갱신용 (미니맵 자체 dragend 제거로 루프 없음)

  // alias for geocodeStatus so the rest of the code doesn't break
  // (gpsStatus already exists; we expose geocodeStatus separately)

  // PHASE 25: GPS 획득 — 재사용 가능 함수 (버튼에서도 호출)
  const acquireGps = useCallback(() => {
    if (!navigator.geolocation) { setGpsStatus('denied'); return; }
    setGpsStatus('acquiring');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setGpsLat(coords.latitude);
        setGpsLng(coords.longitude);
        setGpsStatus('ok');
        // localStorage에도 저장 (지도 등 다른 화면 활용)
        try {
          localStorage.setItem('userLocation', JSON.stringify({
            lat: coords.latitude, lon: coords.longitude,
          }));
        } catch (_) {}
        console.log('[GPS_ACQUIRED]', coords.latitude, coords.longitude);
      },
      (err) => {
        setGpsStatus('denied');
        console.warn('[GPS_DENIED]', err.message);
      },
      { timeout: 8000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => { acquireGps(); }, [acquireGps]);

  // A/B CONFIG: 마운트 시 1회 호출 — 서버가 variant 결정, 클라이언트는 수동 반영
  useEffect(() => {
    const uid = getUserId();
    fetch(`/api/ab/config?userId=${encodeURIComponent(uid)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.config) {
          setAbConfig(d.config);
          console.log('[AB_CONFIG]', d.config.group, d.config);
        }
      })
      .catch(() => {}); // fail-safe: 조회 실패 시 기본값(A그룹) 유지
  }, []);

  // PHASE SCALE+: A/B 가격 정보 조회
  useEffect(() => {
    getUrgentPrice()
      .then(d => setPriceInfo(d))
      .catch(() => {}); // fail-safe: 조회 실패해도 UI 유지
  }, []);

  useEffect(() => {
    if (!note.trim() || category) return;
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(async () => {
      setAiLoading(true);
      try {
        const r = await smartAssist({ text: note, date, areaSize: parseInt(areaSize) || null, areaUnit });
        if (r.suggestedCategory) setAiSuggest(r);
      } catch {}
      setAiLoading(false);
    }, 1000);
    return () => clearTimeout(noteTimer.current);
  }, [note]);

  async function handleSubmit() {
    if (!category) return setError('작업 종류를 선택해주세요.');
    if (!location) return setError('지역을 입력해주세요.');
    if (!date)     return setError('날짜를 선택해주세요.');
    // LOCATION_CONFIRM: 위치 검증
    if (farmAddress.trim()) {
      // 농지 주소 입력됐으면 지오코딩 + 지도 확인 필수
      if (geocodeStatus !== 'ok') {
        setError(geocodeStatus === 'error'
          ? '📍 농지 주소를 찾을 수 없어요. "주소를 다시 확인해주세요. (읍·면·리까지 입력)"'
          : '📍 농지 주소 입력 후 "주소를 입력하면 자동으로 위치를 찾아요."');
        return;
      }
      // AUTO_GEOCODE: confirmedLocation은 자동 설정 — 별도 버튼 불필요
    } else if (gpsLat === null) {
      setError('📍 위치를 확인해주세요. "내 위치 사용" 버튼을 누르거나, 농지 주소를 입력해주세요.');
      return;
    } else {
      // GPS 있지만 농지 주소 없음 — A/B 기반 소프트/하드 차단
      const abGroup      = abConfig?.group      ?? 'A';
      const warnThreshold = abConfig?.geo_warn_count ?? 1;   // A=1회, B=2회
      const warnMsg      = abConfig?.geo_message
        ? `📍 ${abConfig.geo_message}\nGPS 좌표로만 등록하면 거리 계산이 부정확할 수 있습니다.\n👉 위쪽 "농지 위치 입력" 칸에 읍·면·리까지 입력해보세요.\n그래도 GPS로 등록하려면 아래 버튼을 한 번 더 누르세요.`
        : '📍 농지 주소를 입력하면 작업자를 더 정확하게 매칭할 수 있어요.\nGPS 좌표로만 등록하면 거리 계산이 부정확할 수 있습니다.\n👉 위쪽 "농지 위치 입력" 칸에 읍·면·리까지 입력해보세요.\n그래도 GPS로 등록하려면 아래 버튼을 한 번 더 누르세요.';

      // 조건부 하드차단: farmAddrRate < 30% 도달 시 서버가 hardBlock=true 반환
      if (abConfig?.hardBlock) {
        setError('📍 현재는 농지 주소 없이 등록할 수 없어요. 읍·면·리까지 입력하면 자동으로 위치를 찾아요.');
        trackClientEvent('geo_hard_block', { hadGps: true, group: abGroup });
        return;
      }

      // 소프트 차단: warnThreshold 횟수 경고 후 통과 허용
      if (geoWarnPending < warnThreshold) {
        setGeoWarnPending(c => c + 1);
        setError(warnMsg);
        trackClientEvent('geo_soft_block', { hadGps: true, farmAddrLen: 0, warnCount: geoWarnPending + 1, group: abGroup });
        return;
      }
      // 경고 횟수 소진 → GPS 진행 허용
      setGeoWarnPending(0);
      trackClientEvent('geo_soft_block_bypass', { hadGps: true, group: abGroup });
    }

    // FIX: lat/lng 강제 숫자 변환 (문자열 방지)
    const resolvedLat = gpsLat != null ? Number(gpsLat) : null;
    const resolvedLng = gpsLng != null ? Number(gpsLng) : null;

    // FIX: 좌표 유효성 최종 방어
    if (farmAddress.trim() && (!resolvedLat || !resolvedLng || isNaN(resolvedLat) || isNaN(resolvedLng))) {
      setError('📍 위치 좌표가 올바르지 않아요. 주소를 다시 입력해주세요.');
      return;
    }

    const payload = {
      requesterId:   getUserId(),
      requesterName: getUserName(),
      category,
      locationText:  location,
      lat: resolvedLat,
      lng: resolvedLng,
      date,
      timeSlot:    simpleMode ? '시간 협의' : timeSlot,
      areaSize:    parseInt(areaSize) || null,
      areaUnit,
      pay:         pay.trim() || null,
      note,
      farmImages:  farmImages.length > 0 ? farmImages : undefined,
      farmAddress: farmAddress.trim() || undefined,
      isUrgentPaid: isUrgentPaid || undefined,
    };

    // STEP 1: 요청 payload 디버그 로그
    console.log('[JOB_SUBMIT]', {
      ...payload,
      farmImages: payload.farmImages ? `[${payload.farmImages.length}장]` : undefined,
    });
    // GEO_QUALITY: 최종 제출 시점 정확도 기록
    if (farmAddress.trim()) {
      console.log(`[GEO_QUALITY] submit precision=${geocodePrecision} normalized=${geocodePrecision !== null} pinMoved=${pinMoved} addr="${farmAddress.trim()}"`);
      try { trackClientEvent('geo_quality_submit', { precision: geocodePrecision, pinMoved, addrLen: farmAddress.trim().length }); } catch (_) {}
    }

    setError('');
    setSubmitting(true);
    try {
      const result = await createJob(payload);

      // STEP 4: API 응답 로그
      console.log('[JOB_RESPONSE]', result);
      // REAL_USER_TEST: 농민 공고 생성 완료
      logTestEvent('farmer_create_job', { jobId: result?.job?.id, category });
      logCheckpoint('create_job_done', { jobId: result?.job?.id });

      if (simpleMode) {
        try { trackClientEvent('quick_job_created', { category }); } catch (_) {}
      }
      // Phase 12: 재등록 퍼널 완료 이벤트
      if (prefillJob) {
        try { trackClientEvent('job_copy_submitted', { jobId: prefillJob.id, prefilled: true }); } catch (_) {}
      }

      // PHASE SCALE+: 긴급 공고 결제 처리
      if (isUrgentPaid && result?.job?.id) {
        const jobId = result.job.id;
        try {
          trackClientEvent('urgent_click', { jobId, category });
          // 결제 주문 생성
          const payOrder = await createPayment(jobId);
          if (payOrder.autoConfirm || payOrder.amount === 0) {
            // 무료 체험 or Group A/C → 자동 승인
            await confirmPayment({ paymentKey: null, orderId: payOrder.orderId, amount: 0 });
            trackClientEvent('payment_success', { jobId, group: payOrder.group });
          } else {
            // Group B → 토스 결제 UI 진입
            const tossClientKey = import.meta.env.VITE_TOSS_CLIENT_KEY;
            if (tossClientKey && window.TossPayments) {
              // 결제 전 jobId 저장 (리다이렉트 후 복귀 시 활용)
              try { sessionStorage.setItem('pay-pending-jobId', jobId); } catch (_) {}
              const toss = window.TossPayments(tossClientKey);
              await toss.requestPayment('카드', {
                amount:     payOrder.amount,
                orderId:    payOrder.orderId,
                orderName:  `긴급 공고 노출 (${category})`,
                successUrl: `${window.location.origin}/pay/success`,
                failUrl:    `${window.location.origin}/pay/fail`,
              });
              // requestPayment는 리다이렉트 → 이 이후 코드는 실행 안 됨
              return;
            } else {
              // 토스 SDK 미설정 → 무료 체험으로 fallback
              console.warn('[PAY] Toss SDK 미설정 → 무료 체험 fallback');
              await confirmPayment({ paymentKey: null, orderId: payOrder.orderId, amount: 0 });
            }
          }
        } catch (payErr) {
          // 결제 실패해도 공고는 등록됨 (fail-safe)
          console.warn('[PAY_ERR]', payErr.message);
          trackClientEvent('payment_fail', { jobId, error: payErr.message });
        }
      }

      setCreatedJobId(result?.job?.id || null);
      setDone(true);
      setTimeout(() => onSuccess?.(), 1600);
    } catch (e) {
      // STEP 4: 에러 상세 로그
      console.error('[JOB_ERROR]', e.message, e);
      logApiFail('/api/jobs', 0, 'create_job'); // REAL_USER_TEST
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  // ── 완료 화면 ─────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-farm-bg flex flex-col items-center justify-center gap-4 px-6">
        <CheckCircle size={64} className="text-farm-green animate-fade-in" />
        <p className="text-2xl font-bold text-gray-800">등록 완료!</p>
        <p className="text-gray-500 text-center">작업자들이 곧 지원할 거예요</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-farm-bg pb-32">
      {/* 헤더 */}
      <header className="bg-white px-4 pt-safe pt-4 pb-4 flex items-center gap-3
                         border-b border-gray-100 sticky top-0 z-30">
        <button onClick={onBack} className="p-1 text-gray-600">
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-lg font-bold text-gray-800">일손 구하기</h1>

        {/* 간편 / 상세 토글 */}
        <div className="ml-auto flex bg-gray-100 rounded-xl p-0.5 gap-0.5">
          <button
            onClick={() => setSimpleMode(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              simpleMode ? 'bg-white text-farm-green shadow-sm' : 'text-gray-500'
            }`}
          >
            <Zap size={11} className="inline mr-0.5" />간편
          </button>
          <button
            onClick={() => setSimpleMode(false)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              !simpleMode ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
            }`}
          >
            상세
          </button>
        </div>
      </header>

      {prefillJob && (
        <div className="px-4 pt-3 pb-1">
          <div className="bg-farm-light border border-farm-green rounded-xl px-4 py-2.5 flex items-center gap-2">
            <span className="text-base">♻️</span>
            <p className="text-sm text-farm-green font-semibold">이전 "{prefillJob.category}" 작업 정보로 미리 채워뒀어요. 날짜만 바꿔서 바로 등록!</p>
          </div>
        </div>
      )}
      {simpleMode && !prefillJob && (
        <div className="px-4 pt-3 pb-1">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <Zap size={14} className="text-amber-500 shrink-0" />
            <p className="text-sm text-amber-700 font-semibold">10초 만에 등록 완료!</p>
          </div>
        </div>
      )}

      <div className="px-4 py-5 space-y-6 animate-fade-in">

        {/* 1. 작업 종류 */}
        <section>
          <p className="section-title">어떤 작업이에요?</p>
          <div className="grid grid-cols-3 gap-2.5">
            {CATEGORIES.map(({ name, emoji }) => (
              <button
                key={name}
                onClick={() => { setCategory(name); setAiSuggest(null); }}
                className={`flex flex-col items-center justify-center gap-1.5
                            rounded-2xl py-4 font-semibold text-sm border-2 transition-all
                            ${category === name
                              ? 'border-farm-green bg-farm-light text-farm-green shadow-sm'
                              : 'border-gray-100 bg-white text-gray-600'}`}
              >
                <span className="text-3xl">{emoji}</span>
                <span>{name}</span>
              </button>
            ))}
          </div>
          {aiSuggest && !category && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <Sparkles size={18} className="text-amber-500 shrink-0" />
              <div className="flex-1 text-sm">
                <span className="font-bold text-amber-700">{aiSuggest.suggestedCategory}</span>
                <span className="text-gray-500"> 작업 같아요. 맞나요?</span>
              </div>
              <button
                onClick={() => { setCategory(aiSuggest.suggestedCategory); setAiSuggest(null); }}
                className="shrink-0 bg-amber-500 text-white rounded-lg px-3 py-1 text-sm font-bold"
              >
                선택
              </button>
            </div>
          )}
          {aiLoading && (
            <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" /> AI 분석 중...
            </p>
          )}
        </section>

        {/* 2. 지역 + PHASE 25: GPS 좌표 잠금 */}
        <section>
          <p className="section-title">어느 지역이에요?</p>

          {/* 주소 텍스트 (표시명) */}
          <input
            className="input"
            placeholder="예: 경기 화성시 서신면"
            value={location}
            onChange={e => setLocation(e.target.value)}
          />

          {/* GPS 상태 표시 + 내 위치 버튼 */}
          <div className="mt-2 flex items-center gap-2">
            {gpsStatus === 'ok' && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-green-700
                              bg-green-50 border border-green-200 rounded-full px-3 py-1.5 flex-1 min-w-0">
                <Navigation size={11} className="text-green-600 shrink-0" />
                <span className="truncate">
                  {addressLabel || '위치 확인됨'}
                </span>
              </div>
            )}
            {gpsStatus === 'acquiring' && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500
                              bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5 flex-1">
                <Loader2 size={11} className="animate-spin" />
                <span>위치 확인 중...</span>
              </div>
            )}
            {(gpsStatus === 'denied' || gpsStatus === 'idle') && (
              <div className="flex items-center gap-1.5 text-xs text-amber-700
                              bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5 flex-1">
                <MapPin size={11} />
                <span>위치 미확인 — 지도 미표시</span>
              </div>
            )}

            {/* 내 위치 사용 버튼 (ok 아닐 때만) */}
            {gpsStatus !== 'ok' && (
              <button
                type="button"
                onClick={acquireGps}
                disabled={gpsStatus === 'acquiring'}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5
                           bg-farm-green text-white text-xs font-bold rounded-full
                           disabled:opacity-60 active:scale-95 transition-transform"
              >
                {gpsStatus === 'acquiring'
                  ? <><Loader2 size={11} className="animate-spin" /> 확인 중</>
                  : <><Navigation size={11} /> 내 위치 사용</>
                }
              </button>
            )}
          </div>

          {/* AUTO_GEOCODE: 농지 주소 입력 — 버튼·설명 없이 입력 즉시 지도 표시 */}
          <div className="mt-3">
            {/* 입력 + 인라인 상태 아이콘 */}
            <div className="relative">
              <input
                className="input text-sm pr-9"
                placeholder="농지 주소 입력 (예: 경기 화성시 서신면)"
                value={farmAddress}
                onChange={e => {
                  setFarmAddress(e.target.value);
                  setGeocodeStatus('idle');
                  setGeocodePrecision(null);
                  setPinMoved(false);
                  setConfirmedLocation(false);
                  setGpsLat(null);
                  setGpsLng(null);
                  setAddressLabel('');
                }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                {geocodeStatus === 'loading' && <Loader2 size={15} className="animate-spin text-amber-400" />}
                {geocodeStatus === 'ok'      && <CheckCircle size={15} className="text-green-500" />}
                {geocodeStatus === 'error'   && <MapPin size={15} className="text-red-400" />}
              </span>
            </div>

            {/* 상태 텍스트 — 3줄 전부 */}
            {geocodeStatus === 'loading' && (
              <p className="text-xs text-gray-400 mt-1.5">위치 확인 중...</p>
            )}
            {geocodeStatus === 'ok' && gpsLat != null && (
              <div className="mt-1.5">
                {pinMoved ? (
                  /* ── 핀 이동 후: "최종 위치 확정됨" 강조 박스 ── */
                  <div style={{
                    background: '#f0fdf4',
                    border: '1.5px solid #86efac',
                    borderRadius: 10,
                    padding: '8px 12px',
                  }}>
                    <p style={{ fontSize: 12, fontWeight: 800, color: '#15803d', display: 'flex', alignItems: 'center', gap: 5, marginBottom: addressLabel ? 4 : 0 }}>
                      <CheckCircle size={13} />
                      ✔ 위치 확정됨
                    </p>
                    {addressLabel && (
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
                        📍 최종 위치: {addressLabel}
                      </p>
                    )}
                  </div>
                ) : (
                  /* ── 자동 지오코드: "위치 확인됨" + 조정 유도 ── */
                  <>
                    <p className="text-xs text-green-600 font-medium flex items-center gap-1">
                      <CheckCircle size={11} />
                      위치 확인됨
                    </p>
                    {addressLabel && (
                      <p className="text-xs text-gray-700 mt-0.5 font-medium">
                        📍 {addressLabel}
                      </p>
                    )}
                    {geocodePrecision === 'partial' ? (
                      <p className="text-xs text-amber-600 mt-0.5">
                        · 지도를 탭해 실제 농지 위치로 정확히 조정해주세요
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5">
                        · 지도를 탭해 위치를 미세 조정할 수 있어요
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
            {geocodeStatus === 'error' && (
              <p className="text-xs text-red-500 mt-1.5">주소를 다시 입력해주세요 (시·군·읍·면·리 형식)</p>
            )}

            {/* 미니맵 — geocode 성공 시만 표시 (탭 = 전체화면 확대) */}
            {geocodeStatus === 'ok' && (
              <div
                className="relative mt-2.5 active:opacity-80 transition-opacity"
                onClick={() => setIsMapFull(true)}
                style={{ cursor: 'pointer' }}
              >
                {/* 지도 타일 (pointerEvents:none → 터치가 부모 onClick으로 전달) */}
                <div
                  ref={miniMapRef}
                  style={{
                    width: '100%',
                    height: geocodePrecision === 'partial' ? 210 : 180,
                    borderRadius: 12,
                    border: pinMoved ? '2.5px solid #22c55e' : '2px solid #d1d5db',
                    overflow: 'hidden',
                    pointerEvents: 'none',  // 정적 프리뷰, 상호작용 차단
                  }}
                />
                {/* "탭하여 위치 조정" 힌트 오버레이 */}
                <div style={{
                  position: 'absolute', bottom: 10, left: 0, right: 0,
                  display: 'flex', justifyContent: 'center',
                  pointerEvents: 'none',
                }}>
                  <span style={{
                    background: pinMoved ? 'rgba(21,128,61,0.80)' : 'rgba(0,0,0,0.52)',
                    color: '#fff',
                    borderRadius: 9999,
                    padding: '4px 14px',
                    fontSize: 11,
                    fontWeight: 800,
                    display: 'flex', alignItems: 'center', gap: 4,
                    letterSpacing: 0.2,
                  }}>
                    <Search size={10} />
                    {pinMoved ? '✔ 위치 확정됨 — 탭하여 재조정' : '📍 탭하여 위치 조정'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 3. 날짜 (간편 모드에서도 항상 표시) */}
        <section>
          <p className="section-title">언제 해야 해요?</p>
          <input
            type="date"
            className="input"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
          {/* 상세 모드: 시간대 선택 */}
          {!simpleMode && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              {TIME_SLOTS.map(slot => (
                <button
                  key={slot}
                  onClick={() => setTimeSlot(slot)}
                  className={`rounded-xl py-2.5 text-sm font-semibold border-2 transition-all
                              ${timeSlot === slot
                                ? 'border-farm-green bg-farm-light text-farm-green'
                                : 'border-gray-100 bg-white text-gray-600'}`}
                >
                  {slot}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 4. 일당 */}
        <section>
          <p className="section-title">
            일당이 얼마예요?
            <span className="font-normal text-sm text-gray-400"> (선택)</span>
          </p>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">₩</span>
            <input
              className="input pl-8"
              placeholder="예: 150,000"
              value={pay}
              onChange={e => setPay(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1.5">협의 가능하면 비워두세요</p>
        </section>

        {/* 5. 면적 (간편 모드: 선택으로 간소화) */}
        <section>
          <p className="section-title">
            얼마나 돼요?
            <span className="font-normal text-sm text-gray-400"> (선택)</span>
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              className="input flex-1"
              placeholder="예: 300"
              value={areaSize}
              onChange={e => setAreaSize(e.target.value)}
            />
            <select
              className="input w-24"
              value={areaUnit}
              onChange={e => setAreaUnit(e.target.value)}
            >
              {AREA_UNITS.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
        </section>

        {/* 5. 사진 + 메모 (상세 모드만) */}
        {!simpleMode && (
          <>
            {/* PHASE 26: 다중 이미지 업로드 (최대 3장) */}
            <section>
              <p className="section-title">
                밭 사진
                <span className="font-normal text-sm text-gray-400"> (최대 3장, 선택)</span>
              </p>
              <div className="flex gap-2 flex-wrap">
                {imgPreviews.map((src, i) => (
                  <div key={i} className="relative w-24 h-24 rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                    <img src={src} alt={`밭 사진 ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 text-white
                                 rounded-full text-xs font-bold flex items-center justify-center
                                 leading-none shadow"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {farmImages.length < 3 && (
                  <label className="w-24 h-24 flex flex-col items-center justify-center gap-1
                                    border-2 border-dashed border-gray-200 rounded-xl
                                    cursor-pointer bg-white hover:bg-gray-50 transition-colors">
                    <Camera size={24} className="text-gray-300" />
                    <span className="text-xs text-gray-400">추가</span>
                    <input
                      type="file" accept="image/*" multiple
                      className="hidden" onChange={handlePhoto}
                    />
                  </label>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1.5">밭 사진을 올려주면 작업자가 빠르게 판단해요</p>
            </section>

            <section>
              <p className="section-title">하고 싶은 말 <span className="font-normal text-sm text-gray-400">(선택)</span></p>
              <textarea
                className="input resize-none"
                rows={3}
                placeholder="예: 트랙터 있으신 분 우대해요. 점심 드세요."
                value={note}
                onChange={e => setNote(e.target.value)}
              />
              {aiSuggest?.priceGuide && (
                <p className="text-xs text-gray-400 mt-1.5">💡 {aiSuggest.priceGuide}</p>
              )}
            </section>
          </>
        )}

        {/* PHASE SCALE+: 긴급 공고 — A/B 가격 동적 표시 */}
        <section>
          {(() => {
            const isFree      = !priceInfo || priceInfo.isFree;
            const price       = priceInfo?.price || 0;
            const label       = priceInfo?.label || '무료 체험';
            const isTrialFree = priceInfo?.firstTrialFree;
            const priceBadge  = isFree
              ? <span className="ml-1.5 text-xs font-black bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full">🎁 무료 체험</span>
              : isTrialFree
                ? <span className="ml-1.5 text-xs font-black bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full">첫 1회 무료</span>
                : <span className="ml-1.5 text-xs font-bold bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full">{price.toLocaleString()}원</span>;
            return (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const next = !isUrgentPaid;
                    setIsUrgentPaid(next);
                    if (next) {
                      try { trackClientEvent('urgent_click', { category, group: priceInfo?.group }); } catch (_) {}
                    }
                  }}
                  className={`w-full flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 transition-all
                              ${isUrgentPaid ? 'border-red-400 bg-red-50' : 'border-gray-100 bg-white'}`}
                >
                  <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border-2 transition-all
                                   ${isUrgentPaid ? 'bg-red-500 border-red-500' : 'border-gray-300'}`}>
                    {isUrgentPaid && <span className="text-white text-xs font-black">✓</span>}
                  </div>
                  <div className="flex-1 text-left">
                    <p className={`font-black text-sm ${isUrgentPaid ? 'text-red-600' : 'text-gray-700'}`}>
                      <Flame size={14} className="inline mr-1 text-red-500" />
                      긴급 공고로 올리기
                      {priceBadge}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      🔥 배지 표시 + 우선 노출 — 더 빠르게 작업자를 찾을 수 있어요
                    </p>
                  </div>
                </button>
                {isUrgentPaid && (
                  <div className="mt-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 text-xs text-green-700 font-medium">
                    {isFree || isTrialFree
                      ? '✅ 무료로 즉시 활성화됩니다. 효과를 먼저 체험해보세요!'
                      : `💳 등록 후 ${price.toLocaleString()}원 결제가 진행됩니다`}
                  </div>
                )}
              </>
            );
          })()}
        </section>

        {error && (
          <div className={`rounded-xl px-4 py-3 text-sm font-semibold whitespace-pre-line
                          ${geoWarnPending > 0
                            ? abConfig?.geo_warn_color === 'red'
                              ? 'bg-red-50 text-red-700 border border-red-300'
                              : 'bg-amber-50 text-amber-800 border border-amber-300'
                            : 'bg-red-50 text-red-600'}`}>
            {error}
          </div>
        )}
      </div>

      {/* 하단 고정 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100
                      px-4 pt-3 pb-safe pb-4 z-30">
        <button
          onClick={handleSubmit}
          onTouchStart={() => {}}
          disabled={submitting}
          className={`btn-full text-lg py-4 font-black rounded-2xl flex items-center justify-center gap-2
                      ${isUrgentPaid
                        ? 'bg-red-500 text-white active:scale-95 transition-transform shadow-lg'
                        : geoWarnPending > 0
                          ? abConfig?.geo_warn_color === 'red'
                            ? 'bg-red-500 text-white active:scale-95 transition-transform shadow-lg'
                            : 'bg-amber-500 text-white active:scale-95 transition-transform shadow-md shadow-amber-200'
                          : 'btn-primary'}`}
        >
          {submitting
            ? <><Loader2 size={18} className="animate-spin" /> 등록 중...</>
            : geoWarnPending > 0
              ? '📍 그래도 GPS로 등록하기'
              : isUrgentPaid
                ? <><Flame size={18} /> 긴급 공고 등록</>
                : simpleMode ? '⚡ 바로 등록' : '요청하기'
          }
        </button>
        {simpleMode && !isUrgentPaid && (
          <p className="text-center text-xs text-gray-400 mt-2">
            카테고리·지역·날짜만 있으면 돼요
          </p>
        )}
        {isUrgentPaid && (
          <p className="text-center text-xs text-red-400 mt-2 font-semibold">
            🔥 긴급 공고 — 작업자에게 우선 노출됩니다
          </p>
        )}
      </div>

      {/* 전체화면 지도 오버레이 */}
      {isMapFull && gpsLat != null && (
        <FullScreenMap
          lat={gpsLat}
          lng={gpsLng}
          onConfirm={() => setIsMapFull(false)}
          onLocationChange={(lat, lng) => {
            setGpsLat(lat);
            setGpsLng(lng);
            setConfirmedLocation(true);
            setPinMoved(true);
            reverseGeocode(lat, lng);
          }}
        />
      )}
    </div>
  );
}
