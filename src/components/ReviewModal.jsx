import React, { useState } from 'react';
import { Star, Loader2, X } from 'lucide-react';
import { submitReview } from '../utils/api.js';

const CATEGORY_EMOJI = {
  '밭갈이': '🚜', '로터리': '🔄', '두둑': '⛰️',
  '방제': '💊', '수확 일손': '🌾', '예초': '✂️',
};

/**
 * ReviewModal — 작업 완료 후 후기 작성 팝업
 * @param {object}   job             - 완료된 작업 정보
 * @param {function} onClose         - 닫기
 * @param {function} onSubmit        - 제출 성공 콜백
 * @param {boolean}  showIncentive   - 완료 직후 자동 오픈 시 인센티브 배너 표시
 * @param {function} onReRegister    - PHASE RETENTION: 재등록 콜백 (농민 전용)
 * @param {function} onRematch       - PHASE RETENTION: 재매칭 콜백 (농민 전용)
 */
export default function ReviewModal({ job, onClose, onSubmit, showIncentive = false, onReRegister, onRematch }) {
  const [rating,   setRating]  = useState(0);
  const [hovered,  setHovered] = useState(0);
  const [comment,  setComment] = useState('');
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState('');

  async function handleSubmit() {
    if (rating === 0) { setError('별점을 선택해주세요.'); return; }
    setLoading(true);
    setError('');
    try {
      await submitReview({ jobId: job.id, rating, comment });
      onSubmit?.();
      onClose();
    } catch (e) {
      setError(e.message || '후기 제출 중 오류가 발생했어요.');
    } finally {
      setLoading(false);
    }
  }

  const emoji = CATEGORY_EMOJI[job?.category] || '🌿';
  const displayRating = hovered || rating;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
      <div className="bg-white w-full rounded-t-3xl px-5 pt-6 pb-10 space-y-5 animate-slide-up">

        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">작업 후기</h2>
          <button onClick={onClose} className="text-gray-400 p-1">
            <X size={22} />
          </button>
        </div>

        {/* PHASE 31: 인센티브 배너 — 완료 직후 자동 오픈 시만 표시 */}
        {showIncentive && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2.5">
            <span className="text-lg">⭐</span>
            <p className="text-sm font-bold text-amber-700">
              후기 남기면 다음 일에서 우선 추천됩니다!
            </p>
          </div>
        )}

        {/* 작업 정보 */}
        <div className="bg-farm-light rounded-2xl px-4 py-3">
          <p className="font-semibold text-gray-800">
            {emoji} {job?.category}
          </p>
          <p className="text-sm text-gray-500 mt-0.5">{job?.locationText} · {job?.date}</p>
        </div>

        {/* 별점 선택 */}
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-600 mb-3">작업은 어떠셨나요?</p>
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onMouseEnter={() => setHovered(n)}
                onMouseLeave={() => setHovered(0)}
                onClick={() => setRating(n)}
                className="transition-transform hover:scale-110"
              >
                <Star
                  size={36}
                  className={displayRating >= n ? 'text-amber-400' : 'text-gray-200'}
                  fill={displayRating >= n ? 'currentColor' : 'none'}
                />
              </button>
            ))}
          </div>
          {displayRating > 0 && (
            <p className="text-sm text-gray-500 mt-2">
              {['', '아쉬웠어요', '그저 그랬어요', '보통이에요', '좋았어요', '최고예요!'][displayRating]}
            </p>
          )}
        </div>

        {/* 코멘트 */}
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">
            한 줄 후기 <span className="text-gray-400 font-normal">(선택)</span>
          </label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="작업자에 대한 솔직한 후기를 남겨주세요..."
            maxLength={200}
            rows={3}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none
                       focus:outline-none focus:border-farm-green"
          />
          <p className="text-xs text-gray-400 text-right mt-1">{comment.length}/200</p>
        </div>

        {/* 에러 */}
        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-2.5">{error}</p>
        )}

        {/* 제출 버튼 */}
        <button
          onClick={handleSubmit}
          disabled={loading || rating === 0}
          className="w-full py-4 bg-farm-green text-white font-bold text-base rounded-2xl
                     disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading
            ? <><Loader2 size={18} className="animate-spin" /> 제출 중...</>
            : '후기 남기기'
          }
        </button>

        {/* PHASE RETENTION: 농민 전용 행동 유도 버튼 */}
        {(onReRegister || onRematch) && (
          <div className="flex gap-2 mt-2">
            {onReRegister && (
              <button
                onClick={() => { onClose(); onReRegister(job); }}
                className="flex-1 py-3 bg-farm-light text-farm-green font-bold text-sm rounded-2xl
                           border border-farm-green active:scale-95 transition-transform"
              >
                🔁 비슷한 작업 다시 등록
              </button>
            )}
            {onRematch && (
              <button
                onClick={() => { onRematch(job); onClose(); }}
                className="flex-1 py-3 bg-blue-50 text-blue-600 font-bold text-sm rounded-2xl
                           border border-blue-200 active:scale-95 transition-transform"
              >
                👥 이전 지원자 재호출
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
