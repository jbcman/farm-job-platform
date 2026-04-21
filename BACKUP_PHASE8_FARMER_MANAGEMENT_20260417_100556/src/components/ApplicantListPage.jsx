import React, { useEffect, useState } from 'react';
import { ArrowLeft, Star, MapPin, Wrench, CheckCircle, Loader2 } from 'lucide-react';
import { getApplicants, selectWorker } from '../utils/api.js';

/**
 * ApplicantListPage
 * 농민이 내 요청에 지원한 작업자 목록 확인 + 선택
 */
export default function ApplicantListPage({ job, userId, onBack, onSelectContact }) {
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selecting, setSelecting]   = useState(null);
  const [error, setError]           = useState('');

  useEffect(() => {
    setLoading(true);
    getApplicants(job.id, userId)
      .then(d => setApplicants(d.applicants || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [job.id, userId]);

  async function handleSelect(applicant) {
    if (!applicant.worker) return;
    setSelecting(applicant.worker.id);
    try {
      const data = await selectWorker(job.id, {
        requesterId: userId,
        workerId:    applicant.worker.id,
      });
      onSelectContact?.(data.contact);
    } catch (e) {
      setError(e.message);
    } finally {
      setSelecting(null);
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
      </header>

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
          const w = applicant.worker;
          if (!w) return null;
          return (
            <div key={applicant.applicationId} className="card">
              {/* 작업자 기본 정보 */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-gray-800">{w.name}</span>
                    <div className="flex items-center gap-0.5 text-amber-400">
                      <Star size={14} fill="currentColor" />
                      <span className="text-sm font-bold text-gray-700">{w.rating}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-sm text-gray-500 mt-0.5">
                    <MapPin size={13} />
                    <span>{w.baseLocationText}</span>
                    {w.distLabel && <span className="text-gray-400">({w.distLabel})</span>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-farm-green">{w.completedJobs}회 완료</p>
                  <p className="text-xs text-gray-400">{w.availableTimeText}</p>
                </div>
              </div>

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

              {/* 선택 버튼 */}
              {applicant.status === 'selected' ? (
                <div className="flex items-center justify-center gap-2 py-3 text-blue-600 font-bold">
                  <CheckCircle size={18} />
                  <span>선택된 작업자</span>
                </div>
              ) : applicant.status === 'applied' ? (
                <button
                  onClick={() => handleSelect(applicant)}
                  disabled={!!selecting}
                  className="btn-primary btn-full"
                >
                  {selecting === w.id
                    ? <><Loader2 size={16} className="animate-spin" /> 처리 중...</>
                    : '이 분으로 결정할게요'}
                </button>
              ) : (
                <p className="text-center text-sm text-gray-400 py-2">
                  {applicant.status === 'rejected' ? '다른 분이 선택됐어요' : applicant.status}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
