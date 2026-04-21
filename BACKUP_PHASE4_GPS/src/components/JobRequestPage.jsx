import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Sparkles, Camera, Loader2, CheckCircle, Zap } from 'lucide-react';
import { createJob, smartAssist, getUserId, getUserName, trackClientEvent } from '../utils/api.js';

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
 */
export default function JobRequestPage({ onBack, onSuccess }) {
  // 간편 / 상세 모드
  const [simpleMode, setSimpleMode] = useState(true);

  const [category, setCategory]   = useState('');
  const [location, setLocation]   = useState('');
  const [date,     setDate]       = useState('');
  const [pay,      setPay]        = useState('');
  const [timeSlot, setTimeSlot]   = useState('오전 (7시~12시)');
  const [areaSize, setAreaSize]   = useState('');
  const [areaUnit, setAreaUnit]   = useState('평');
  const [note,     setNote]       = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [preview,   setPreview]   = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [done,       setDone]       = useState(false);
  const [error,      setError]      = useState('');

  const [aiSuggest, setAiSuggest] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const noteTimer = useRef(null);

  function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setPreview(URL.createObjectURL(file));
  }

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

    setError('');
    setSubmitting(true);
    try {
      await createJob({
        requesterId:   getUserId(),
        requesterName: getUserName(),
        category,
        locationText:  location,
        latitude:  37.5,
        longitude: 127.0,
        date,
        timeSlot:  simpleMode ? '시간 협의' : timeSlot,
        areaSize:  parseInt(areaSize) || null,
        areaUnit,
        pay:       pay.trim() || null,
        note,
      });
      if (simpleMode) {
        trackClientEvent('quick_job_created', { category });
      }
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

      {simpleMode && (
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

        {/* 2. 지역 */}
        <section>
          <p className="section-title">어느 지역이에요?</p>
          <input
            className="input"
            placeholder="예: 경기 화성시 서신면"
            value={location}
            onChange={e => setLocation(e.target.value)}
          />
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
            <section>
              <p className="section-title">사진 <span className="font-normal text-sm text-gray-400">(선택)</span></p>
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed
                                border-gray-200 rounded-2xl py-6 cursor-pointer bg-white hover:bg-gray-50 transition-colors">
                {preview
                  ? <img src={preview} alt="첨부 사진" className="max-h-40 rounded-xl object-cover" />
                  : (
                    <>
                      <Camera size={32} className="text-gray-300" />
                      <span className="text-sm text-gray-400">밭 사진을 올려주면 빠르게 매칭돼요</span>
                    </>
                  )}
                <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
              </label>
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
          className="btn-primary btn-full text-lg py-4"
        >
          {submitting
            ? <><Loader2 size={18} className="animate-spin" /> 등록 중...</>
            : simpleMode ? '⚡ 바로 등록' : '요청하기'
          }
        </button>
        {simpleMode && (
          <p className="text-center text-xs text-gray-400 mt-2">
            카테고리·지역·날짜만 있으면 돼요
          </p>
        )}
      </div>
    </div>
  );
}
