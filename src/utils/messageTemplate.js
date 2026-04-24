/**
 * messageTemplate.js — AI 개인화 연락 메시지 생성
 *
 * buildContactMessage(job, skillLevel?)
 *   skillLevel: 'beginner' | 'experienced' | 'expert'
 *   → 숙련도에 따라 마지막 멘트가 달라짐
 *
 * 빈 필드(위치/날짜/일당)는 줄 자체를 생략
 */

// ── 숙련도별 마무리 문구 ────────────────────────────────────────
const SKILL_CLOSING = {
  beginner:    '처음이지만 성실하게 하겠습니다. 가능 여부 확인 부탁드립니다. 감사합니다.',
  experienced: '가능 여부 확인 부탁드립니다. 감사합니다.',
  expert:      '해당 작업 경험이 있습니다. 빠른 확인 부탁드립니다. 감사합니다.',
};

/**
 * @param {object} job         — { category?, title?, locationText?, date?, workDate?, pay? }
 * @param {string} [skillLevel] — 'beginner' | 'experienced' | 'expert' (default: 'experienced')
 * @returns {string}
 */
export function buildContactMessage(job, skillLevel = 'experienced') {
  if (!job) return '';

  const title    = job.title    || job.category || '작업';
  const location = job.locationText             || '';
  const date     = job.date     || job.workDate  || '';
  const pay      = job.pay                       || '';
  const closing  = SKILL_CLOSING[skillLevel] ?? SKILL_CLOSING.experienced;

  const lines = [
    `[농촌일손]`,
    `${title} 의뢰건 보고 연락드립니다.`,
    ``,
  ];
  if (location) lines.push(`📍 위치: ${location}`);
  if (date)     lines.push(`📅 일정: ${date}`);
  if (pay)      lines.push(`💰 일당: ${pay}`);
  lines.push(``);
  lines.push(closing);

  return lines.join('\n');
}
