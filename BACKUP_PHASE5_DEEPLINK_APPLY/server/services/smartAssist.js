'use strict';
/**
 * smartAssist.js
 * AI 보조 기능 — 규칙 기반 (LLM 없이도 동작)
 *
 * 기능:
 *   1. 자연어 → 카테고리 추천
 *   2. 작업 제목 자동 생성
 *   3. 급구 여부 추천
 *   4. 평균가 안내
 */

// ─── 카테고리 키워드 매핑 ─────────────────────────────────────
const CATEGORY_RULES = [
    { category: '밭갈이',   keywords: ['밭', '갈기', '갈아', '경운', '쟁기', '트랙터', '밭갈'] },
    { category: '로터리',   keywords: ['로터리', '흙 부수', '흙부수', '흙을 부'] },
    { category: '두둑',     keywords: ['두둑', '이랑', '고랑', '두둑 만들', '포장'] },
    { category: '방제',     keywords: ['방제', '농약', '살포', '벌레', '병충해', '약 치'] },
    { category: '수확 일손', keywords: ['수확', '따기', '걷기', '일손', '사람 구', '사람 없', '인력'] },
    { category: '예초',     keywords: ['풀', '예초', '잡초', '제초', '풀 베', '풀베', '풀 깎'] },
];

// ─── 평균 단가 DB (평당 원, MVP 참고용) ─────────────────────────
const AVG_PRICE = {
    '밭갈이':    { unit: '평', price: 500, note: '트랙터 보유 시 협의' },
    '로터리':    { unit: '평', price: 400 },
    '두둑':      { unit: '평', price: 300 },
    '방제':      { unit: '평', price: 200, note: '방제기 보유 필수' },
    '수확 일손': { unit: '시간', price: 12000, note: '일당 기준 상이' },
    '예초':      { unit: '평', price: 250 },
};

// ─── 급구 키워드 ─────────────────────────────────────────────
const URGENT_KEYWORDS = ['오늘', '지금', '바로', '급히', '빨리', '당장', '긴급'];

/**
 * 자연어 → 카테고리 추천
 * @param {string} text
 * @returns {{ category: string|null, confidence: number }}
 */
function suggestCategory(text) {
    if (!text) return { category: null, confidence: 0 };

    const norm = text.replace(/\s+/g, ' ').trim();
    for (const rule of CATEGORY_RULES) {
        if (rule.keywords.some(kw => norm.includes(kw))) {
            console.log(`[AI_CATEGORY_SUGGESTED] category=${rule.category} from="${norm.slice(0, 40)}"`);
            return { category: rule.category, confidence: 0.9 };
        }
    }
    return { category: null, confidence: 0 };
}

/**
 * 작업 제목 자동 생성
 * @param {{ category, locationText, date, areaSize, areaUnit }} params
 * @returns {string}
 */
function generateTitle({ category, locationText, date, areaSize, areaUnit }) {
    const loc = locationText?.split(' ').slice(-1)[0] || '';  // 마지막 지역명
    const today = new Date('2026-04-15').toISOString().slice(0, 10);
    const tomorrow = new Date('2026-04-16').toISOString().slice(0, 10);
    const dateLabel = date === today ? '오늘' : date === tomorrow ? '내일' : date || '';
    const areaLabel = areaSize ? ` ${areaSize}${areaUnit}` : '';
    return `${loc} ${dateLabel} ${category}${areaLabel}`.trim();
}

/**
 * 급구 여부 추천
 * @param {{ note: string, date: string }} params
 * @returns {boolean}
 */
function suggestUrgent({ note = '', date = '' }) {
    const today = new Date('2026-04-15').toISOString().slice(0, 10);
    const hasUrgentWord = URGENT_KEYWORDS.some(kw => note.includes(kw));
    const isToday = date === today;
    return hasUrgentWord || isToday;
}

/**
 * 평균가 안내 텍스트
 * @param {string} category
 * @param {number} areaSize
 * @param {string} areaUnit
 * @returns {string}
 */
function getPriceGuide(category, areaSize, areaUnit) {
    const info = AVG_PRICE[category];
    if (!info) return '';
    if (areaSize && info.unit === areaUnit) {
        const total = areaSize * info.price;
        const note = info.note ? ` (${info.note})` : '';
        return `참고 평균가: 약 ${total.toLocaleString()}원${note}`;
    }
    return `참고 단가: ${info.unit}당 ${info.price.toLocaleString()}원`;
}

module.exports = { suggestCategory, generateTitle, suggestUrgent, getPriceGuide };
