import React, { useEffect, useState } from 'react';
import { ArrowLeft, Star, MapPin, Wrench, CheckCircle, Loader2, Phone, Trophy } from 'lucide-react';
import { getApplicants, selectWorker, connectCall, startJob } from '../utils/api.js';

// PHASE 28: 추천 배지 — rank 1/2/3 각각 다른 스타일
const RANK_BADGE = {
  1: { label: '🥇 1순위 추천', cls: 'bg-amber-100 text-amber-800 border border-amber-300' },
  2: { label: '🥈 2순위',      cls: 'bg-gray-100  text-gray-600  border border-gray-200'  },
  3: { label: '🥉 3순위',      cls: 'bg-orange-50 text-orange-700 border border-orange-200' },
};

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

  // Phase 8: 상태별 읽기 전용 모드
  const isReadOnly = job.status === 'closed' || job.status === 'matched';
  // PHASE 29: 역할 판별 — 농민이면 작업자에게, 작업자면 농민에게 전화
  const isFarmer = job.requesterId === userId;

  useEffect(() => {
    setLoading(true);
    getApplicants(job.id, userId)
      .then(d => setApplicants(d.applicants || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [job.id, userId]);

  // FAST_SELECT: 선택 API → 즉시 전화 다이얼 (한 번 탭으로 끝)
  async function handleSelectAndCall(applicant) {
    if (!applicant.worker) return;
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

      {/* PHASE 29: AI 자동 연결 배지 */}
      {job.autoSelected && (
        <div className="mx-4 mt-3 flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-2xl px-4 py-2.5">
          <span className="text-xl">🤖</span>
          <div>
            <p className="text-sm font-bold text-indigo-700">AI 추천으로 자동 연결됐어요</p>
            <p className="text-xs text-indigo-500">거리·평점·속도를 종합해 최적 작업자를 선택했어요</p>
          </div>
        </div>
      )}

      {/* FAST_SELECT: 행동 유도 배너 — 선택 가능한 상태에서만 표시 */}
      {!loading && applicants.length > 0 && !isReadOnly && (
        <div className="mx-4 mt-3 flex items-center gap-3 bg-amber-50 border border-amber-200
                        rounded-2xl px-4 py-3">
          <span className="text-2xl">🔥</span>
          <div>
            <p className="font-bold text-amber-800">지원자 {applicants.length}명 도착!</p>
            <p className="text-xs text-amber-600">👇 한 명 선택하면 바로 전화 연결돼요</p>
          </div>
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

        {applicants.map((applicant) => {
          const w    = applicant.worker;
          if (!w) return null;
          const rank = applicant.rank;           // PHASE 28: 1-based rank
          const isTop3 = rank <= 3;
          const badge  = RANK_BADGE[rank];

          return (
            <div
              key={applicant.applicationId}
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

              {/* TRUST_SYSTEM: 가능 시간대 */}
              {w.availableTimeText && w.availableTimeText !== '협의' && (
                <p className="text-xs text-blue-600 font-semibold mb-1.5">
                  🕐 {w.availableTimeText}
                </p>
              )}

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
          );
        })}
      </div>
    </div>
  );
}
