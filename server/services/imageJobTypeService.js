'use strict';
/**
 * imageJobTypeService.js — PHASE IMAGE_JOBTYPE_AI
 *
 * 이미지 URL → 작업유형(Korean category) + 태그 자동 분류
 *
 * 전략:
 *   1) VISION_API_URL 미설정  → heuristic (URL 패턴)
 *   2) VISION_API_URL 설정    → HTTPS POST 시도, 실패 시 heuristic
 *   3) heuristic 결과 null    → { type: null, tags: [] } (원값 유지)
 *
 * autoJobType은 기존 category와 동일한 Korean 값 사용.
 * (worker.jobType 직접 비교 가능하도록 정규화)
 *
 * ENV:
 *   VISION_API_URL  - 분류 API 엔드포인트 (선택)
 */
const https = require('https');
const { URL } = require('url');

// ─── English → Korean 정규화 ─────────────────────────────────────
const ENGLISH_TO_KO = {
    'plowing':  '밭갈이',
    'rotary':   '로터리',
    'ridge':    '두둑',
    'spraying': '방제',
    'harvest':  '수확 일손',
    'weeding':  '예초',
};

// ─── URL 패턴 휴리스틱 ────────────────────────────────────────────
function heuristic(url = '') {
    const u = url.toLowerCase();

    if (u.includes('tractor') || u.includes('plow') || u.includes('plowing'))
        return { type: '밭갈이',    tags: ['tractor', 'soil'] };

    if (u.includes('rotary'))
        return { type: '로터리',    tags: ['rotary', 'tractor'] };

    if (u.includes('harvest') || u.includes('crop'))
        return { type: '수확 일손', tags: ['crop', 'harvest'] };

    if (u.includes('weed') || u.includes('mow'))
        return { type: '예초',      tags: ['manual', 'weed'] };

    if (u.includes('spray') || u.includes('drone') || u.includes('pest'))
        return { type: '방제',      tags: ['spray', 'drone'] };

    if (u.includes('ridge') || u.includes('bed'))
        return { type: '두둑',      tags: ['ridge', 'soil'] };

    return { type: null, tags: [] };
}

/**
 * HTTPS POST (Node built-in — axios 미사용)
 */
function httpsPost(endpoint, payload) {
    return new Promise((resolve, reject) => {
        const parsed  = new URL(endpoint);
        const body    = JSON.stringify(payload);
        const options = {
            hostname: parsed.hostname,
            port:     parsed.port || 443,
            path:     parsed.pathname + (parsed.search || ''),
            method:   'POST',
            headers: {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
            timeout: 5000,
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
 * 이미지 URL → { type: Korean|null, tags: string[] }
 *
 * type = null → 분류 불가 (원래 category 유지)
 *
 * @param {string|null} imageUrl
 * @returns {Promise<{ type: string|null, tags: string[] }>}
 */
async function classifyImage(imageUrl) {
    if (!imageUrl || imageUrl.trim() === '') return { type: null, tags: [] };

    // Vision API 미구성 → heuristic
    if (!process.env.VISION_API_URL) return heuristic(imageUrl);

    try {
        const res = await httpsPost(process.env.VISION_API_URL, {
            image: imageUrl,
            task:  'classify_job',
        });

        const rawType = res?.jobType;
        const tags    = Array.isArray(res?.tags) ? res.tags : [];

        // Korean 그대로 반환 or English → Korean 변환
        const koType = ENGLISH_TO_KO[rawType] || (Object.values(ENGLISH_TO_KO).includes(rawType) ? rawType : null);
        if (!koType) return heuristic(imageUrl);  // 알 수 없는 타입 → heuristic

        return { type: koType, tags };
    } catch (e) {
        console.warn('[JOBTYPE_API_FAIL]', e.message, '→ heuristic 폴백');
        return heuristic(imageUrl);
    }
}

module.exports = { classifyImage, heuristic };
