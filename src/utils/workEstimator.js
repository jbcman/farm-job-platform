/**
 * workEstimator — 평수 → 작업 시간/난이도 자동 변환
 *
 * 핵심 UX 원칙:
 *   사용자는 "평수"가 아니라 "얼마나 걸리는지"로 판단한다
 *   → 평수는 보조, 시간 추정은 메인으로 표시
 *
 * 계수 기준 (현실 농작업 경험 기반):
 *   기계 작업(밭갈이/로터리/두둑): 평당 0.002h ≈ 1000평/2시간
 *   드론 방제:                     평당 0.0015h ≈ 1000평/1.5시간
 *   손 수확:                       평당 0.004h  ≈ 500평/2시간
 *   예초/일반 노동:                 평당 0.003h  ≈ 500평/1.5시간
 */

const CATEGORY_FACTOR = {
  '밭갈이':    0.002,
  '로터리':    0.002,
  '두둑':      0.002,
  '방제':      0.0015,
  '수확 일손': 0.004,
  '예초':      0.003,
};

const DEFAULT_FACTOR = 0.003;

/**
 * @param {number|null} areaPyeong  — 평수
 * @param {string}      category    — 작업 카테고리 (job.category)
 * @returns {{ label: string, sublabel: string, level: 'easy'|'medium'|'hard'|'' }}
 */
export function estimateWork(areaPyeong, category) {
  if (!areaPyeong || !Number.isFinite(areaPyeong) || areaPyeong <= 0) {
    return { label: '', sublabel: '', level: '' };
  }

  const factor = CATEGORY_FACTOR[category] ?? DEFAULT_FACTOR;
  const hours  = areaPyeong * factor;

  if (hours <= 2) {
    return {
      label:    '⚡ 2시간 내 작업',
      sublabel: `약 ${Math.round(hours * 60)}분 예상`,
      level:    'easy',
    };
  }
  if (hours <= 5) {
    return {
      label:    '⏱ 반나절 작업',
      sublabel: `약 ${hours.toFixed(1)}시간 예상`,
      level:    'medium',
    };
  }
  return {
    label:    '💪 하루 작업',
    sublabel: `약 ${Math.round(hours)}시간 예상`,
    level:    'hard',
  };
}
