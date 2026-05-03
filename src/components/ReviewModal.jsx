import React, { useState } from 'react';
import { Star, Loader2, X } from 'lucide-react';
import { submitJobReview } from '../utils/api.js';

const CATEGORY_EMOJI = {
  '밭갈이': '🚜', '로터리': '🔄', '두둑': '⛰️',
  '방제': '💊', '수확 일손': '🌾', '예초': '✂️',
};

// 역할별 태그 옵션
const TAGS_BY_ROLE = {
  farmer: ['⏰ 시간 정확', '🔧 꼼꼼한 작업', '😊 친절함', '🔁 재고용 의사', '🚜 장비 깔끔', '📞 소통 잘됨'],
  worker: ['💬 친절한 설명', '🌾 깔끔한 밭', '✅ 정확한 정보', '🔄 재방문 의사', '📲 빠른 연락', '💰 좋은 페이'],
};

const RATING_LABEL = ['', '아쉬웠어요', '그저 그랬어요', '보통이에요', '좋았어요', '최고예요!'];

/**
 * ReviewModal — 작업 완료 후 후기 작성 팝업 (REVIEW_UX)
 *
 * @param {object}   job           - 완료된 작업 정보 (id, category, locationText, date, requesterId)
 * @param {string}   reviewerRole  - 'farmer' | 'worker'  (기본: 'worker')
 * @param {string}   reviewerId    - 후기 작성자 userId
 * @param {string}   targetId      - 평가 대상 userId (생략 시 서버가 추론)
 * @param {function} onClose       - 닫기 콜백
 * @param {function} onSubmit      - 제출 성공 콜백 ({ revealed, waitingForOther })
 * @param {boolean}  showIncentive - 완료 직후 자동 오픈 시 인센티브 배너 표시
 * @param {function} onReRegister  - PHASE RETENTION: 재등록 콜백 (농민 전용)
 * @param {function} onRematch     - PHASE RETENTION: 재매칭 콜백 (농민 전용)
 */
export default function ReviewModal({
  job,
  reviewerRole = 'worker',
  reviewerId,
  targetId,
  onClose,
  onSubmit,
  showIncentive = false,
  onReRegister,
  onRematch,
}) {
  const [rating,    setRating]    = useState(0);
  const [hovered,   setHovered]   = useState(0);
  const [comment,   setComment]   = useState('');
  const [tags,      setTags]      = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [submitted, setSubmitted] = useState(null); // { revealed, waitingForOther }

  const tagOptions   = TAGS_BY_ROLE[reviewerRole] ?? TAGS_BY_ROLE.worker;
  const isFarmer     = reviewerRole === 'farmer';
  const displayRating = hovered || rating;

  function toggleTag(tag) {
    setTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  }

  async function handleSubmit() {
    if (rating === 0) { setError('별점을 먼저 선택해주세요.'); return; }
    setLoading(true);
    setError('');
    try {
      const result = await submitJobReview(job.id, {
        reviewerId,
        targetId,
        reviewerRole,
        rating,
        comment,
        tags: tags.length > 0 ? tags : undefined,
      });
      setSubmitted(result);
      onSubmit?.(result);
    } catch (e) {
      setError(e.message || '후기 제출 중 오류가 발생했어요.');
    } finally {
      setLoading(false);
    }
  }

  const emoji = CATEGORY_EMOJI[job?.category] || '🌿';

  // ── 제출 완료 화면 ─────────────────────────────────────────
  if (submitted) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
        <div className="bg-white w-full rounded-t-3xl px-5 pt-6 pb-10 space-y-5 animate-slide-up">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800">후기 등록 완료</h2>
            <button onClick={onClose} className="text-gray-400 p-1"><X size={22} /></button>
          </div>

          {submitted.revealed ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="text-5xl">🎉</span>
              <p className="text-base font-bold text-gray-800">후기가 공개됐어요!</p>
              <p className="text-sm text-gray-500">상대방도 평가를 완료했어요.<br />서로의 후기를 확인해보세요.</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="text-5xl">⏳</span>
              <p className="text-base font-bold text-gray-800">후기가 등록됐어요</p>
              <p className="text-sm text-gray-500">
                상대방도 평가를 완료하면<br />
                <span className="font-semibold text-farm-green">서로의 후기가 동시에 공개</span>돼요.<br />
                (보복 방지 블라인드 시스템)
              </p>
            </div>
          )}

          {/* PHASE RETENTION: 농민 전용 행동 유도 */}
          {(onReRegister || onRematch) && (
            <div className="flex gap-2">
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

          <button
            onClick={onClose}
            className="w-full py-3.5 bg-farm-green text-white font-bold text-sm rounded-2xl
                       active:scale-95 transition-transform"
          >
            확인
          </button>
        </div>
      </div>
    );
  }

  // ── 입력 화면 ───────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
      <div className="bg-white w-full rounded-t-3xl px-5 pt-6 pb-10 space-y-4 animate-slide-up
                      max-h-[92vh] overflow-y-auto">

        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">
            {isFarmer ? '작업자 후기' : '농민 후기'}
          </h2>
          <button onClick={onClose} className="text-gray-400 p-1">
            <X size={22} />
          </button>
        </div>

        {/* 인센티브 배너 */}
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
          <p className="text-sm font-semibold text-gray-600 mb-3">
            {isFarmer ? '작업자는 어떠셨나요?' : '농민분은 어떠셨나요?'}
          </p>
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onMouseEnter={() => setHovered(n)}
                onMouseLeave={() => setHovered(0)}
                onClick={() => setRating(n)}
                className="transition-transform hover:scale-110 active:scale-95"
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
            <p className="text-sm text-gray-500 mt-2">{RATING_LABEL[displayRating]}</p>
          )}
        </div>

        {/* 태그 선택 */}
        <div>
          <p className="text-sm font-semibold text-gray-600 mb-2">
            어떤 점이 좋았나요? <span className="text-gray-400 font-normal">(복수 선택)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {tagOptions.map(tag => {
              const active = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-all
                    ${active
                      ? 'bg-farm-green text-white border-farm-green'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-farm-green'
                    }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        {/* 코멘트 */}
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">
            한 줄 후기 <span className="text-gray-400 font-normal">(선택)</span>
          </label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={isFarmer
              ? '작업자에 대한 솔직한 후기를 남겨주세요...'
              : '농민분에 대한 솔직한 후기를 남겨주세요...'
            }
            maxLength={200}
            rows={2}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none
                       focus:outline-none focus:border-farm-green"
          />
          <p className="text-xs text-gray-400 text-right mt-0.5">{comment.length}/200</p>
        </div>

        {/* 블라인드 안내 */}
        <div className="flex items-start gap-2 bg-blue-50 rounded-xl px-3 py-2.5">
          <span className="text-base leading-none mt-0.5">🔒</span>
          <p className="text-xs text-blue-700">
            상대방도 후기를 작성해야 동시에 공개돼요. 보복 방지를 위한 블라인드 시스템이에요.
          </p>
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
                     disabled:opacity-50 flex items-center justify-center gap-2
                     active:scale-95 transition-transform"
        >
          {loading
            ? <><Loader2 size={18} className="animate-spin" /> 제출 중...</>
            : '후기 남기기'
          }
        </button>
      </div>
    </div>
  );
}
