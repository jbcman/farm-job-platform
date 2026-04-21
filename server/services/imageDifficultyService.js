'use strict';
/**
 * imageDifficultyService.js — PHASE IMAGE_DIFFICULTY_AI
 *
 * 이미지 URL → 난이도 점수 (0.0 ~ 1.0) 추정
 *
 * 전략:
 *   1) 이미지 없음        → 카테고리 휴리스틱 (하드코딩 기본값)
 *   2) 이미지 있음        → 휴리스틱 (URL 패턴 + 카테고리 기본값)
 *      - Vision API 미구성 → 휴리스틱 폴백
 *      - Vision API 구성   → HTTPS 요청 시도, 실패 시 폴백
 *
 * ENV:
 *   OPENAI_API_KEY  - 설정 시 GPT-4o vision 사용
 *   OPENAI_API_URL  - 기본값 api.openai.com (사설 프록시 지원)
 *
 * DB 갱신은 호출자 책임 (setImmediate 패턴).
 */
const https = require('https');

// ─── 카테고리 기본 난이도 ────────────────────────────────────────
const CATEGORY_DEFAULT_DIFFICULTY = {
    '밭갈이':    0.7,
    '로터리':    0.5,
    '두둑':      0.6,
    '방제':      0.4,
    '수확 일손': 0.5,
    '예초':      0.3,
};
const FALLBACK_DIFFICULTY = 0.5;

/**
 * 카테고리 기반 휴리스틱 난이도 반환
 * @param {string} category
 * @returns {number} 0.0~1.0
 */
function heuristicDifficulty(category) {
    return CATEGORY_DEFAULT_DIFFICULTY[category] ?? FALLBACK_DIFFICULTY;
}

/**
 * HTTPS POST — Node built-in (axios 미사용)
 * @param {string} host
 * @param {string} path
 * @param {object} payload
 * @param {string} apiKey
 * @returns {Promise<object>}
 */
function httpsPost(host, path, payload, apiKey) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const options = {
            hostname: host,
            path,
            method:   'POST',
            headers: {
                'Content-Type':  'application/json',
                'Content-Length': Buffer.byteLength(body),
                'Authorization':  `Bearer ${apiKey}`,
            },
            timeout: 8000,
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end',  ()    => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('JSON parse fail')); }
            });
        });
        req.on('error',   reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.write(body);
        req.end();
    });
}

/**
 * GPT-4o vision으로 난이도 추정
 * @param {string} imageUrl
 * @param {string} category
 * @returns {Promise<number>} 0.0~1.0
 */
async function analyzeWithVision(imageUrl, category) {
    const apiKey  = process.env.OPENAI_API_KEY;
    const apiHost = (process.env.OPENAI_API_URL || 'api.openai.com')
        .replace(/^https?:\/\//, '');

    const prompt = `이 농지 이미지를 보고 "${category}" 작업의 난이도를 0.0(쉬움)~1.0(매우 어려움) 사이의 숫자 하나만 반환하세요. 숫자만 출력하세요.`;

    const payload = {
        model: 'gpt-4o-mini',
        max_tokens: 10,
        messages: [{
            role: 'user',
            content: [
                { type: 'text',      text: prompt },
                { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
            ],
        }],
    };

    const result = await httpsPost(apiHost, '/v1/chat/completions', payload, apiKey);
    const raw    = result?.choices?.[0]?.message?.content?.trim();
    const val    = parseFloat(raw);
    if (!Number.isFinite(val)) throw new Error(`invalid response: ${raw}`);
    return Math.min(1, Math.max(0, val));
}

/**
 * 이미지 URL → 난이도 점수 (0.0~1.0)
 *
 * 이미지 없거나 API 키 없으면 카테고리 휴리스틱 반환.
 * 네트워크 에러 / API 실패 시 휴리스틱 폴백.
 *
 * @param {string|null} imageUrl
 * @param {string}      category
 * @returns {Promise<number>}
 */
async function estimateDifficulty(imageUrl, category) {
    // 이미지 없음 또는 기본 이미지 → 휴리스틱
    const noImage = !imageUrl
        || imageUrl.startsWith('/images/default_')
        || imageUrl.trim() === '';

    if (noImage) return heuristicDifficulty(category);

    // Vision API 키 없음 → 휴리스틱
    if (!process.env.OPENAI_API_KEY) return heuristicDifficulty(category);

    try {
        return await analyzeWithVision(imageUrl, category);
    } catch (e) {
        console.warn(`[DIFFICULTY_WARN] vision 실패 → 휴리스틱 폴백: ${e.message}`);
        return heuristicDifficulty(category);
    }
}

module.exports = { estimateDifficulty, heuristicDifficulty };
