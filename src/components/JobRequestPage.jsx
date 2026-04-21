import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Sparkles, Camera, Loader2, CheckCircle, Zap, MapPin, Navigation, Flame } from 'lucide-react';
import { createJob, smartAssist, getUserId, getUserName, trackClientEvent, sponsorJob, getUrgentPrice, createPayment, confirmPayment } from '../utils/api.js';

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
  const [submitting,    setSubmitting]    = useState(false);
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
    // PHASE MAP_FIX: GPS 없으면 농지 주소라도 필요
    if (gpsLat === null && !farmAddress.trim()) {
      setError('📍 위치를 확인해주세요. "내 위치 사용" 버튼을 누르거나, 아래 농지 주소를 입력해주세요.');
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      const result = await createJob({
        requesterId:   getUserId(),
        requesterName: getUserName(),
        category,
        locationText:  location,
        // GPS 실좌표 (있을 때만)
        lat: gpsLat,
        lng: gpsLng,
        date,
        timeSlot:  simpleMode ? '시간 협의' : timeSlot,
        areaSize:  parseInt(areaSize) || null,
        areaUnit,
        pay:       pay.trim() || null,
        note,
        // PHASE 26: 다중 이미지 (base64 배열)
        farmImages: farmImages.length > 0 ? farmImages : undefined,
        // PHASE MAP_FIX: GPS 없을 때 서버 측 지오코딩 소스
        farmAddress: farmAddress.trim() || undefined,
        // PHASE SCALE: 유료 긴급 공고
        isUrgentPaid: isUrgentPaid || undefined,
      });

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
                              bg-green-50 border border-green-200 rounded-full px-3 py-1.5 flex-1">
                <Navigation size={11} className="text-green-600" />
                <span>위치 확인됨 ({gpsLat?.toFixed(4)}, {gpsLng?.toFixed(4)})</span>
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
          <p className="text-xs text-gray-400 mt-1.5">
            📍 위치 좌표가 있어야 지도에 정확히 표시돼요
          </p>

          {/* PHASE MAP_FIX: GPS 미확인 시 농지 주소 직접 입력 */}
          {gpsStatus !== 'ok' && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-gray-600 mb-1.5 flex items-center gap-1">
                <MapPin size={11} className="text-farm-green" />
                농지 주소 입력 <span className="font-normal text-gray-400">(GPS 대신 사용)</span>
              </p>
              <input
                className="input text-sm"
                placeholder="예: 경기 화성시 서신면 홍법리 123"
                value={farmAddress}
                onChange={e => setFarmAddress(e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">
                주소로 지도에 자동 표시해드려요
              </p>
            </div>
          )}
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
          <div className="bg-red-50 text-red-600 rounded-xl px-4 py-3 text-sm font-semibold">
            {error}
          </div>
        )}
      </div>

      {/* 하단 고정 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100
                      px-4 pt-3 pb-safe pb-4 z-30">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className={`btn-full text-lg py-4 font-black rounded-2xl flex items-center justify-center gap-2
                      ${isUrgentPaid
                        ? 'bg-red-500 text-white active:scale-95 transition-transform shadow-lg'
                        : 'btn-primary'}`}
        >
          {submitting
            ? <><Loader2 size={18} className="animate-spin" /> 등록 중...</>
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
    </div>
  );
}
