import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Star, MapPin, Wrench, CheckCircle, Loader2, Phone, Trophy, Zap } from 'lucide-react';
import { getApplicants, selectWorker, connectCall, startJob, setJobUrgent, autoAssignWorker, setAutoAssign, trackClientEvent } from '../utils/api.js';

// PHASE 28: 추천 배지 — rank 1/2/3 각각 다른 스타일
const RANK_BADGE = {
  1: { label: '🥇 1순위 추천', cls: 'bg-amber-100 text-amber-800 border border-amber-300' },
  2: { label: '🥈 2순위',      cls: 'bg-gray-100  text-gray-600  border border-gray-200'  },
  3: { label: '🥉 3순위',      cls: 'bg-orange-50 text-orange-700 border border-orange-200' },
};

// 작업자 최근 활동 시간 표시 (ACTIVE_NOW_RELIABILITY)
// 초록 = 즉시 연결 가능 표시, 노랑 = 활동 정보만 표시
function activeLabel(locationUpdatedAt, activeNow) {
  if (!locationUpdatedAt && !activeNow) return null;
  if (locationUpdatedAt) {
    const mins = Math.round((Date.now() - new Date(locationUpdatedAt).getTime()) / 60000);
    if (mins < 2)  return { text: '🟢 방금 접속 · 바로 연결 가능',       cls: 'text-green-600' };
    if (mins < 10) return { text: `🟢 ${mins}분 전 활동 · 바로 연결 가능`, cls: 'text-green-600' };
    if (mins < 60) return { text: `🟡 ${mins}분 전 활동`,                  cls: 'text-yellow-600' };
  }
  if (activeNow)   return { text: '🟢 지금 가능 · 바로 연결 가능',         cls: 'text-green-600' };
  return null;
}

// 속도 표시 문자열
function speedLabel(mins) {
  if (mins < 5)   return '⚡ 5분 내 지원';
  if (mins < 30)  return `⚡ ${mins}분 내 지원`;
  if (mins < 60)  return `${mins}분 내 지원`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}시간 내 지원`;
}

/**
 * ApplicantListPage
 * 농민이 내 요청에 지원한 작업자 목록 확인 + 선택
 */
export default function ApplicantListPage({ job, userId, onBack, onSelectContact }) {
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selecting, setSelecting]   = useState(null);
  const [calling, setCalling]       = useState(null);   // PHASE 29: 전화 연결 중
  const [callHint, setCallHint]     = useState(null);   // PHASE 32: 미수신 힌트 workerId
  const [error, setError]           = useState('');
  const [urgenting,    setUrgenting]    = useState(false);   // AUTO_MATCH: 긴급 전환 중
  const [isUrgent,     setIsUrgent]     = useState(job.isUrgent || false); // 낙관적 업데이트용
  const [autoAssigning,  setAutoAssigning]  = useState(false);              // AI_MATCH_V2: 자동 배정 중
  const [autoResult,     setAutoResult]     = useState(null);               // { workerName, workerPhone, matchScore }
  const [autoAssignOn,   setAutoAssignOn]   = useState(!!job.autoAssign);   // SAFETY: opt-in 상태
  const [togglingAuto,   setTogglingAuto]   = useState(false);              // 토글 처리 중
  const [autoMatched,    setAutoMatched]    = useState(null);               // 폴링 중 자동 매칭 감지 → 알림 { worker, matchScore, matchedAt }
  const [matchedElapsed, setMatchedElapsed] = useState('');                 // "N초 전" 라이브 업데이트
  const hadSelectedRef      = useRef(false);     // 페이지 로드 시 이미 선택됨 여부 (false 알림 방지)
  const viewApplicantsAtRef = useRef(null);      // view_applicants ts = firstSeenAt 기준
  const firstActionAtRef    = useRef(null);      // 첫 의미있는 액션 ts (decision_time 기준)
  const anyActionTakenRef   = useRef(false);     // 페이지 이탈 분석 — 아무 행동도 안 한 경우
  const impressedRef        = useRef(new Set()); // 카드별 impression 1회 보장
  const abandonTimerRef     = useRef(null);      // auto_match_abandon 15초 타이머
  const didCallRef          = useRef(false);     // 배너에서 전화 클릭 여부 (abandon 차단용)

  // Phase 8: 상태별 읽기 전용 모드
  const isReadOnly = job.status === 'closed' || job.status === 'matched';
  // PHASE 29: 역할 판별 — 농민이면 작업자에게, 작업자면 농민에게 전화
  const isFarmer = job.requesterId === userId;

  useEffect(() => {
    setLoading(true);
    getApplicants(job.id, userId)
      .then(d => {
        const list = d.applicants || [];
        setApplicants(list);
        // 페이지 열 때 이미 선택된 지원자가 있으면 ref 표시 → 폴링 시 false 알림 차단
        hadSelectedRef.current = list.some(a => a.status === 'selected');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [job.id, userId]);

  // KPI_EVENTS: view_applicants — job 단위 + 세션 단위 1회 보장
  // StrictMode 이중 실행 / 뒤로가기 재진입 / 새로고침 모두 차단
  useEffect(() => {
    const key = `view_applicants_sent_${job.id}`;
    const existing = sessionStorage.getItem(key);
    if (existing) {
      // 이미 발송됨 → ts만 복원해서 time_to_call 계산에 사용
      viewApplicantsAtRef.current = parseInt(existing, 10);
      return;
    }
    const ts = Date.now();
    sessionStorage.setItem(key, String(ts));
    viewApplicantsAtRef.current = ts;
    trackClientEvent('view_applicants', { jobId: job.id, userId, ts });
  }, [job.id, userId]);

  // KPI_EVENTS: applicant_card_impression — IntersectionObserver (뷰포트 진입 시 1회)
  useEffect(() => {
    if (applicants.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const id   = entry.target.dataset.applicantId;
        const rank = entry.target.dataset.rank ? parseInt(entry.target.dataset.rank, 10) : null;
        if (id && !impressedRef.current.has(id)) {
          impressedRef.current.add(id);
          trackClientEvent('applicant_card_impression', { jobId: job.id, applicantId: id, rank });
          observer.unobserve(entry.target); // 1회 후 관찰 중단
        }
      });
    }, { threshold: 0.5 }); // 카드 절반 이상 보여야 impression

    // 렌더링 후 DOM에 붙은 카드들 관찰 시작
    const cards = document.querySelectorAll('[data-applicant-id]');
    cards.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [applicants, job.id]);

  // KPI_EVENTS: 첫 액션 시각 기록 + anyAction 마킹
  // decision_time = firstActionAt - viewApplicantsAt  (고민 시간)
  // call_delay    = callAt - firstActionAt             (행동 망설임)
  function markFirstAction() {
    if (!firstActionAtRef.current) firstActionAtRef.current = Date.now();
    anyActionTakenRef.current = true;
  }

  // KPI_EVENTS: 페이지 이탈 — 아무 행동 없이 나간 경우 (보이지 않는 이탈 포착)
  useEffect(() => {
    const seenAt  = viewApplicantsAtRef; // ref — cleanup 시점에 최신값 읽힘
    const jobId   = job.id;
    return () => {
      if (!anyActionTakenRef.current && seenAt.current) {
        const elapsed = Date.now() - seenAt.current;
        trackClientEvent('view_applicants_exit', { jobId, elapsed, didNothing: true });
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — 마운트/언마운트 1회만

  // ACTIVE_NOW / AUTO_ASSIGN_ON: 자동 배정 켜진 상태에서 15초마다 폴링
  // → 배정 발생 즉시 "AI 자동 연결됐어요" 배너 + 전화 버튼 노출
  useEffect(() => {
    if (!autoAssignOn || isReadOnly) return;
    const timer = setInterval(async () => {
      try {
        const d = await getApplicants(job.id, userId);
        const fresh = d.applicants || [];
        setApplicants(fresh);
        const selected = fresh.find(a => a.status === 'selected');
        if (selected) {
          // 이전에 없었는데 지금 생김 → 페이지 열어두는 동안 자동 매칭 발생
          if (!hadSelectedRef.current) {
            // matchedAt: 서버 selectedAt 우선 → 디바이스 시간 오차 제거
            const serverTs = selected.worker?.matchedAt
              ? new Date(selected.worker.matchedAt).getTime()
              : Date.now();
            didCallRef.current = false;
            setAutoMatched({ worker: selected.worker, matchScore: selected.matchScore, matchedAt: serverTs });
            trackClientEvent('auto_match_detected', { jobId: job.id, workerId: selected.worker?.id });
          }
          hadSelectedRef.current = true;
          clearInterval(timer); // 배정 완료 → 폴링 중단
        }
      } catch (_) { /* 폴링 실패 무시 */ }
    }, 15000);
    return () => clearInterval(timer);
  }, [autoAssignOn, isReadOnly, job.id, userId]);

  // AUTO_MATCH_NOTIFY: 행동 유도형 elapsed 레이블 (1초 갱신) + abandon 15초 타이머
  useEffect(() => {
    if (!autoMatched?.matchedAt) return;

    function elapsedLabel(secs) {
      if (secs < 10)  return '⚡ 지금 바로 연결 추천';
      if (secs < 30)  return '⏳ 빠르게 연락하세요';
      if (secs < 120) return '🔥 아직 연결 가능';
      return '📞 서둘러야 합니다';
    }

    function tick() {
      const secs = Math.round((Date.now() - autoMatched.matchedAt) / 1000);
      setMatchedElapsed(elapsedLabel(secs));
    }
    tick();
    const t = setInterval(tick, 1000);

    // 15초 내 전화 없으면 abandon 이벤트
    abandonTimerRef.current = setTimeout(() => {
      if (!didCallRef.current) {
        const secs = Math.round((Date.now() - autoMatched.matchedAt) / 1000);
        trackClientEvent('auto_match_abandon', { jobId: job.id, elapsedSecs: secs });
      }
    }, 15000);

    return () => {
      clearInterval(t);
      clearTimeout(abandonTimerRef.current);
    };
  }, [autoMatched, job.id]);

  // FAST_SELECT: 선택 API → 즉시 전화 다이얼 (한 번 탭으로 끝)
  async function handleSelectAndCall(applicant) {
    if (!applicant.worker) return;
    markFirstAction();
    const now           = Date.now();
    const decision_time = viewApplicantsAtRef.current && firstActionAtRef.current
      ? firstActionAtRef.current - viewApplicantsAtRef.current : null;
    const call_delay    = firstActionAtRef.current ? now - firstActionAtRef.current : null;
    trackClientEvent('select_click', {
      jobId: job.id, workerId: applicant.worker.id, rank: applicant.rank,
      time_to_call: viewApplicantsAtRef.current ? now - viewApplicantsAtRef.current : null,
      decision_time,
      call_delay,
    });
    setSelecting(applicant.worker.id);
    try {
      const data = await selectWorker(job.id, {
        requesterId: userId,
        workerId:    applicant.worker.id,
      });
      onSelectContact?.(data.contact);
      // 선택 완료 즉시 전화 연결 — contact.workerPhone 사용
      const phone = data.contact?.workerPhone;
      if (phone) {
        window.location.href = `tel:${phone.replace(/[^0-9]/g, '')}`;
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSelecting(null);
    }
  }

  // PHASE 31: 역할 기반 전화 연결
  // matched 상태면 startJob 자동 호출 → 사용자 행동 = 시스템 상태 일치
  async function handleCall(wId) {
    markFirstAction();
    const now           = Date.now();
    const decision_time = viewApplicantsAtRef.current && firstActionAtRef.current
      ? firstActionAtRef.current - viewApplicantsAtRef.current : null;
    const call_delay    = firstActionAtRef.current ? now - firstActionAtRef.current : null;
    trackClientEvent('call_click', {
      jobId: job.id, workerId: wId,
      time_to_call: viewApplicantsAtRef.current ? now - viewApplicantsAtRef.current : null,
      decision_time,
      call_delay,
    });
    setCalling(wId);
    try {
      // 농민이고 아직 matched 상태 → 전화 누르면 작업 시작 자동 처리
      if (isFarmer && job.status === 'matched') {
        try {
          await startJob(job.id, userId);
          console.log(`[CALL_AUTO_START] jobId=${job.id} — 전화 연결 시 자동 시작`);
        } catch (startErr) {
          // 이미 in_progress거나 실패해도 전화 연결은 진행
          console.warn('[CALL_AUTO_START_SKIP]', startErr.message);
        }
      }

      const data  = await connectCall(job.id, userId);
      const phone = isFarmer ? data.workerPhone : data.farmerPhone;
      const name  = isFarmer ? data.workerName  : data.farmerName;
      if (!phone) { setError('전화번호를 가져올 수 없어요.'); return; }
      window.location.href = `tel:${phone.replace(/[^0-9]/g, '')}`;
      console.log(`[CALL_CONNECT] to=${name} phone=***${phone.slice(-4)}`);

      // PHASE 32: 5초 후 "안 받으면?" 힌트 표시 (전화 다이얼 후 브라우저 복귀 대비)
      setTimeout(() => setCallHint(wId), 5000);
    } catch (e) {
      setError(e.message);
    } finally {
      setCalling(null);
    }
  }

  // AUTO_MATCH: 긴급 전환 — isUrgent=1 → 매칭 +100 boost + 지원자 재알림
  async function handleUrgent() {
    if (urgenting) return;
    markFirstAction();
    trackClientEvent('urgent_click', { jobId: job.id });
    setUrgenting(true);
    try {
      await setJobUrgent(job.id, userId);
      setIsUrgent(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setUrgenting(false);
    }
  }

  // SAFETY: 자동 배정 opt-in/off 토글
  async function handleToggleAutoAssign(enable) {
    if (togglingAuto) return;
    setTogglingAuto(true);
    try {
      await setAutoAssign(job.id, userId, enable);
      setAutoAssignOn(enable);
    } catch (e) {
      setError(e.message);
    } finally {
      setTogglingAuto(false);
    }
  }

  // AI_MATCH_V2: 농민이 "AI가 지금 바로 배정해줘" 명시적 트리거
  async function handleAutoAssign() {
    if (autoAssigning) return;
    markFirstAction();
    trackClientEvent('auto_assign_click', { jobId: job.id });
    setAutoAssigning(true);
    setError('');
    try {
      const data = await autoAssignWorker(job.id, userId);
      setAutoResult(data);
      // 배정 완료 즉시 전화 연결
      const phone = data.contact?.workerPhone;
      if (phone) {
        window.location.href = `tel:${phone.replace(/[^0-9]/g, '')}`;
      }
      // applicants 목록 갱신
      const fresh = await getApplicants(job.id, userId).catch(() => null);
      if (fresh) setApplicants(fresh.applicants || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setAutoAssigning(false);
    }
  }

  return (
    <div className="min-h-screen bg-farm-bg pb-8">
      {/* 헤더 */}
      <header className="bg-white px-4 pt-safe pt-4 pb-4 flex items-center gap-3 border-b border-gray-100 sticky top-0 z-30">
        <button onClick={onBack} className="p-1 text-gray-600">
          <ArrowLeft size={24} />
        </button>
        <div>
          <p className="font-bold text-gray-800">{job.category} 지원자</p>
          <p className="text-sm text-gray-500">{job.locationText} · {job.date}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          {/* PHASE 28: 정렬 기준 안내 */}
          {!loading && applicants.length > 0 && (
            <span className="text-xs text-gray-400 flex items-center gap-0.5">
              <Trophy size={11} className="text-amber-500" />거리·평점·속도순
            </span>
          )}
          {job.status === 'closed'  && <span className="text-xs bg-red-50 text-red-600 font-bold px-2 py-1 rounded-full">마감</span>}
          {job.status === 'matched' && <span className="text-xs bg-blue-50 text-blue-600 font-bold px-2 py-1 rounded-full">연결완료</span>}
        </div>
      </header>

      {/* PHASE 29: AI 자동 연결 배지 (초기 로드 시 이미 매칭된 경우) */}
      {job.autoSelected && !autoMatched && (
        <div className="mx-4 mt-3 flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-2xl px-4 py-2.5">
          <span className="text-xl">🤖</span>
          <div>
            <p className="text-sm font-bold text-indigo-700">AI 추천으로 자동 연결됐어요</p>
            <p className="text-xs text-indigo-500">거리·평점·속도를 종합해 최적 작업자를 선택했어요</p>
          </div>
        </div>
      )}

      {/* AUTO_MATCH_NOTIFY: 폴링으로 감지된 실시간 자동 매칭 알림 */}
      {autoMatched && (
        <div className="mx-4 mt-3 animate-fade-in">
          <div className="bg-green-50 border-2 border-green-400 rounded-2xl px-4 py-4 shadow-md">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                {/* 경과 시간 + 타이틀 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-base font-black text-green-800">
                    🎯 AI가 작업자를 연결했습니다
                  </p>
                  {matchedElapsed && (
                    <span className="text-xs text-green-500 font-semibold bg-green-100 px-2 py-0.5 rounded-full">
                      {matchedElapsed}
                    </span>
                  )}
                </div>
                {autoMatched.worker?.name && (
                  <p className="text-sm text-green-700 mt-0.5 font-semibold">
                    {autoMatched.worker.name}님
                    {autoMatched.matchScore != null && (
                      <span className="font-normal text-green-600 ml-1">· 매칭 점수 {autoMatched.matchScore}점</span>
                    )}
                  </p>
                )}
                <p className="text-xs text-green-600 mt-1">
                  👉 지금 바로 전화 연결됩니다
                </p>
              </div>
              <button
                onClick={() => {
                  clearTimeout(abandonTimerRef.current);
                  if (!didCallRef.current) {
                    const secs = autoMatched.matchedAt
                      ? Math.round((Date.now() - autoMatched.matchedAt) / 1000)
                      : null;
                    trackClientEvent('auto_match_abandon', { jobId: job.id, elapsedSecs: secs });
                  }
                  setAutoMatched(null);
                }}
                className="text-green-400 text-xl leading-none flex-shrink-0 mt-0.5"
              >✕</button>
            </div>

            {/* 전화 버튼 — auto_match_call_click 별도 추적 */}
            {autoMatched.worker?.id && (
              <button
                onClick={() => {
                  didCallRef.current = true;
                  clearTimeout(abandonTimerRef.current);
                  const secs = autoMatched.matchedAt
                    ? Math.round((Date.now() - autoMatched.matchedAt) / 1000)
                    : null;
                  trackClientEvent('auto_match_call_click', {
                    jobId:      job.id,
                    workerId:   autoMatched.worker.id,
                    elapsedSecs: secs,
                    label:      matchedElapsed,
                  });
                  handleCall(autoMatched.worker.id);
                }}
                disabled={calling === autoMatched.worker.id}
                className="mt-3 w-full flex items-center justify-center gap-2
                           bg-green-500 text-white font-bold text-sm rounded-xl py-3
                           active:scale-95 transition-transform disabled:opacity-60"
              >
                {calling === autoMatched.worker.id
                  ? <><Loader2 size={15} className="animate-spin" /> 연결 중...</>
                  : <><Phone size={15} /> {autoMatched.worker.name}님께 전화하기</>}
              </button>
            )}

            {/* 전화 미수신 힌트 — 다시 전화 / 다른 지원자 보기 */}
            {callHint === autoMatched.worker?.id && (
              <div className="mt-2 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 animate-fade-in">
                <p className="text-xs text-orange-700 font-semibold mb-2">📵 안 받으셨나요?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      didCallRef.current = true;
                      clearTimeout(abandonTimerRef.current);
                      trackClientEvent('auto_match_call_click', {
                        jobId: job.id, workerId: autoMatched.worker.id, retry: true,
                      });
                      handleCall(autoMatched.worker.id);
                    }}
                    className="flex-1 text-xs font-bold text-white bg-orange-400
                               rounded-lg py-2 active:scale-95 transition-transform"
                  >
                    📞 다시 전화
                  </button>
                  <button
                    onClick={() => {
                      clearTimeout(abandonTimerRef.current);
                      if (!didCallRef.current) {
                        trackClientEvent('auto_match_abandon', {
                          jobId: job.id, reason: 'no_answer_switch',
                        });
                      }
                      setAutoMatched(null);
                    }}
                    className="flex-1 text-xs font-bold text-orange-700 bg-orange-100
                               border border-orange-300 rounded-lg py-2 active:scale-95 transition-transform"
                  >
                    다른 지원자 보기
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AUTO_MATCH: 상태별 상단 배너 */}
      {!loading && !isReadOnly && isFarmer && (
        <div className="mx-4 mt-3 space-y-2">

          {/* ① 지원자 있음 → 선택 유도 */}
          {applicants.length > 0 && (
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
              <span className="text-2xl">🔥</span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-amber-800">지원자 {applicants.length}명 도착!</p>
                <p className="text-xs text-amber-600">👇 한 명 선택하면 바로 전화 연결돼요</p>
              </div>
            </div>
          )}

          {/* ② AI 자동매칭 진행 상태 (3명 미만 → 카운터 표시) */}
          {applicants.filter(a => a.status === 'applied').length < 3 && (
            <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-4 py-2.5">
              <Loader2 size={18} className="text-blue-500 animate-spin shrink-0" />
              <p className="text-xs text-blue-700">
                지원자 <strong>{Math.max(0, 3 - applicants.filter(a => a.status === 'applied').length)}명</strong> 더 오면
                {' '}<strong>AI 자동 매칭</strong>이 시작돼요
              </p>
            </div>
          )}

          {/* ③ AI 자동 배정 — 지원자 있을 때만 */}
          {applicants.filter(a => a.status === 'applied').length > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl px-4 py-3 space-y-2">

              {/* opt-in 토글 */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-indigo-800">🤖 AI 자동 배정</p>
                  <p className="text-xs text-indigo-500 mt-0.5">
                    {autoAssignOn
                      ? '✅ 켜짐 — 조건 충족 시 자동 작동합니다'
                      : '꺼짐 — 직접 선택하거나 아래 버튼으로 즉시 배정'}
                  </p>
                </div>
                <button
                  onClick={() => handleToggleAutoAssign(!autoAssignOn)}
                  disabled={togglingAuto}
                  className={`relative w-12 h-6 rounded-full transition-colors duration-200 flex-shrink-0
                    ${autoAssignOn ? 'bg-indigo-500' : 'bg-gray-300'}
                    ${togglingAuto ? 'opacity-60' : ''}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow
                    transition-transform duration-200
                    ${autoAssignOn ? 'translate-x-6' : 'translate-x-0'}`}
                  />
                </button>
              </div>

              {/* 자동 배정 ON — 강한 경고 (명확한 행동 예고) */}
              {autoAssignOn && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5">
                  <p className="text-xs font-bold text-amber-800 mb-1">⚠️ 자동 배정 ON 상태입니다</p>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    지원자 3명 + AI 점수 기준 충족 시<br />
                    <strong>작업자가 자동으로 선택되고 바로 전화 연결됩니다.</strong>
                  </p>
                  <p className="text-xs text-amber-600 mt-1.5">
                    📲 연결 즉시 카카오 알림으로 안내드려요
                  </p>
                </div>
              )}

              {/* 즉시 배정 버튼 (토글 상관없이 항상 가능) */}
              {!autoResult && (
                <button
                  onClick={handleAutoAssign}
                  disabled={autoAssigning}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-500 text-white
                             font-bold text-sm rounded-xl py-2.5
                             active:scale-95 transition-transform disabled:opacity-60"
                >
                  {autoAssigning
                    ? <><Loader2 size={14} className="animate-spin" /> AI 분석 중...</>
                    : <>
                        지금 바로 최적 작업자 배정하기
                        <span className="block text-xs font-normal opacity-80 mt-0.5">
                          📞 누르면 바로 전화 연결됩니다
                        </span>
                      </>
                  }
                </button>
              )}
              {autoResult && (
                <div className="flex items-center gap-2 py-1">
                  <span className="text-base">✅</span>
                  <p className="text-xs font-bold text-indigo-700">
                    {autoResult.contact?.workerName}님이 배정됐어요
                    <span className="font-normal text-indigo-500 ml-1">(점수 {autoResult.matchScore}점)</span>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ④ 긴급 전환 CTA — 아직 긴급 아닐 때만 */}
          {!isUrgent && (
            <button
              onClick={handleUrgent}
              disabled={urgenting}
              className="w-full flex items-center justify-center gap-2 bg-red-50 border border-red-200
                         text-red-700 font-bold text-sm rounded-2xl px-4 py-2.5
                         active:scale-95 transition-transform disabled:opacity-60"
            >
              {urgenting
                ? <><Loader2 size={14} className="animate-spin" /> 처리 중...</>
                : <><Zap size={14} /> 긴급 전환 — 더 많은 작업자에게 알림 발송</>
              }
            </button>
          )}
          {isUrgent && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-2xl px-4 py-2 text-xs font-bold text-red-600">
              <Zap size={13} fill="currentColor" /> 긴급 공고로 등록됐어요 — 작업자 알림 재발송 완료
            </div>
          )}
        </div>
      )}

      <div className="px-4 py-4 space-y-3 animate-fade-in">
        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={28} className="animate-spin mr-2" />
            <span>불러오는 중...</span>
          </div>
        )}

        {!loading && applicants.length === 0 && (
          <div className="card text-center py-12 text-gray-400">
            <p className="text-4xl mb-3">🤔</p>
            <p className="font-semibold text-gray-500">아직 지원자가 없습니다</p>
            <p className="text-sm mt-1 mb-5 text-gray-400">지원자가 오는 데 시간이 걸릴 수 있어요</p>
            <button
              onClick={onBack}
              className="btn-primary px-6 py-3 text-base"
            >
              🔥 급구로 올려보세요
            </button>
            <p className="text-xs text-gray-400 mt-2">급구 표시 시 상단 노출 + 빠른 매칭</p>
          </div>
        )}

        {error && (
          <div className="card bg-red-50 text-red-600 text-sm py-3 text-center">{error}</div>
        )}

        {/* AUTO_MATCH: rank 1 전용 섹션 헤더 */}
        {applicants.length > 0 && applicants[0]?.rank === 1 && !isReadOnly && isFarmer && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-base">🎯</span>
            <p className="text-sm font-bold text-amber-700">AI 추천 1순위</p>
            <span className="flex-1 h-px bg-amber-200" />
          </div>
        )}

        {applicants.map((applicant, idx) => {
          const w    = applicant.worker;
          if (!w) return null;
          const rank = applicant.rank;           // PHASE 28: 1-based rank
          const isTop3 = rank <= 3;
          const badge  = RANK_BADGE[rank];

          // rank 2 시작 지점에 구분선 삽입
          const showDivider = rank === 2 && applicants.length > 1;

          return (
            <React.Fragment key={applicant.applicationId}>
              {/* rank 2 시작 — "다른 지원자" 구분선 */}
              {showDivider && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="flex-1 h-px bg-gray-200" />
                  <p className="text-xs text-gray-400 font-medium">다른 지원자</p>
                  <span className="flex-1 h-px bg-gray-200" />
                </div>
              )}
            <div
              data-applicant-id={applicant.applicationId}
              data-rank={rank}
              className={`card transition-all ${
                rank === 1
                  ? 'border-2 border-amber-300 bg-amber-50/30 shadow-md'
                  : rank === 2
                    ? 'border border-gray-200'
                    : rank === 3
                      ? 'border border-orange-100'
                      : ''
              }`}
            >
              {/* PHASE 28: 순위 + 매칭 점수 배너 (상위 3명) */}
              {isTop3 && badge && (
                <div className={`flex items-center justify-between text-xs font-bold
                                 rounded-lg px-2.5 py-1.5 mb-3 ${badge.cls}`}>
                  <span>{badge.label}</span>
                  {applicant.matchScore != null && (
                    <span className="font-black">{applicant.matchScore}점</span>
                  )}
                </div>
              )}

              {/* 작업자 기본 정보 */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-bold text-gray-800">{w.name}</span>
                    {/* REVIEW_UX: ratingAvg 우선, 없으면 기본 rating */}
                    <div className="flex items-center gap-0.5 text-amber-400">
                      <Star size={14} fill="currentColor" />
                      <span className="text-sm font-bold text-gray-700">
                        {w.ratingAvg != null
                          ? `${w.ratingAvg} (${w.ratingCount}건)`
                          : w.rating}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-sm text-gray-500 mt-0.5">
                    <MapPin size={13} />
                    <span>{w.baseLocationText}</span>
                    {w.distKm != null && (
                      <span className="text-gray-400 ml-0.5">
                        ({w.distKm}km ·{' '}
                        <span className="text-blue-500 font-semibold">
                          약 {Math.round((w.distKm / 40) * 60)}분
                        </span>)
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-farm-green">{w.completedJobs}회 완료</p>
                  {/* PHASE 28: 지원 속도 표시 */}
                  {applicant.speedMins != null && (
                    <p className={`text-xs font-semibold mt-0.5 ${
                      applicant.speedMins < 30 ? 'text-blue-600' : 'text-gray-400'
                    }`}>
                      {speedLabel(applicant.speedMins)}
                    </p>
                  )}
                  {/* TRUST_SYSTEM: 노쇼 경고 */}
                  {w.noshowCount > 0 && (
                    <p className="text-xs font-bold text-red-500 mt-0.5">
                      ⚠️ 노쇼 {w.noshowCount}회
                    </p>
                  )}
                </div>
              </div>

              {/* TRUST_SYSTEM: 가능 시간대 + 최근 활동 시간 */}
              <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                {w.availableTimeText && w.availableTimeText !== '협의' && (
                  <p className="text-xs text-blue-600 font-semibold">
                    🕐 {w.availableTimeText}
                  </p>
                )}
                {(() => {
                  const al = activeLabel(w.locationUpdatedAt, w.activeNow);
                  return al ? (
                    <p className={`text-xs font-semibold ${al.cls}`}>{al.text}</p>
                  ) : null;
                })()}
              </div>

              {/* REVIEW_UX: topTags (실제 후기 기반 태그) */}
              {w.topTags && w.topTags.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mb-2">
                  {w.topTags.map(tag => (
                    <span
                      key={tag}
                      className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700
                                 border border-green-200 font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* 장비 배지 */}
              <div className="flex gap-1.5 flex-wrap mb-3">
                {w.hasTractor && (
                  <span className="badge bg-amber-50 text-amber-700 text-xs">
                    <Wrench size={11} /> 트랙터
                  </span>
                )}
                {w.hasRotary && (
                  <span className="badge bg-amber-50 text-amber-700 text-xs">
                    <Wrench size={11} /> 로터리
                  </span>
                )}
                {w.hasSprayer && (
                  <span className="badge bg-amber-50 text-amber-700 text-xs">
                    <Wrench size={11} /> 방제기
                  </span>
                )}
                {w.categories.map(c => (
                  <span key={c} className="badge-category text-xs">{c}</span>
                ))}
              </div>

              {/* 메시지 */}
              {applicant.message && (
                <p className="text-sm text-gray-600 bg-gray-50 rounded-xl px-3 py-2 mb-4">
                  "{applicant.message}"
                </p>
              )}

              {/* 선택 버튼 / 상태 표시 */}
              {applicant.status === 'selected' ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-2 py-2 text-blue-600 font-bold">
                    <CheckCircle size={18} />
                    <span>{job.status === 'closed' ? '연결 완료' : '선택된 작업자'}</span>
                  </div>
                  {/* PHASE 29: 역할 기반 전화 버튼 */}
                  <button
                    onClick={() => handleCall(w.id)}
                    disabled={calling === w.id}
                    className="btn-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-2xl"
                  >
                    {calling === w.id
                      ? <><Loader2 size={16} className="animate-spin" /> 연결 중...</>
                      : <><Phone size={16} />
                          {isFarmer ? `📞 ${w.name}님께 전화하기` : '📞 농민에게 전화하기'}
                        </>}
                  </button>

                  {/* PHASE 32: 전화 미수신 힌트 — 5초 후 자동 표시 */}
                  {callHint === w.id && (
                    <div className="mt-1 bg-orange-50 border border-orange-200 rounded-2xl px-3 py-2.5
                                    flex items-start justify-between gap-2 animate-fade-in">
                      <div>
                        <p className="text-xs font-bold text-orange-700">📵 연결이 안 됐나요?</p>
                        <p className="text-xs text-orange-600 mt-0.5">
                          잠시 후 다시 시도하거나 다른 작업자에게 연락해보세요
                        </p>
                      </div>
                      <button
                        onClick={() => setCallHint(null)}
                        className="text-orange-400 text-lg leading-none flex-shrink-0"
                      >✕</button>
                    </div>
                  )}
                </div>
              ) : applicant.status === 'applied' && !isReadOnly ? (
                <button
                  onClick={() => handleSelectAndCall(applicant)}
                  disabled={!!selecting}
                  className={`btn-full flex items-center justify-center gap-2 ${
                    rank === 1
                      ? 'btn-primary text-base py-3.5'
                      : 'btn-outline py-3'
                  }`}
                >
                  {selecting === w.id
                    ? <><Loader2 size={16} className="animate-spin" /> 처리 중...</>
                    : rank === 1
                      ? <><Phone size={16} /> 선택 · 바로 전화연결</>
                      : '이 분으로 결정 · 전화연결'}
                </button>
              ) : (
                <p className="text-center text-sm text-gray-400 py-2">
                  {applicant.status === 'rejected'
                    ? (job.status === 'closed' ? '마감 처리됨' : '다른 분이 선택됐어요')
                    : applicant.status === 'applied' && isReadOnly
                      ? (job.status === 'closed' ? '마감됨' : '미선택')
                      : applicant.status}
                </p>
              )}
            </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
