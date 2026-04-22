'use strict';
/**
 * geocodeService.js — 지오코딩 (Kakao 우선 → Nominatim 폴백)
 *
 * 우선순위:
 *   ① Kakao Local API  — KAKAO_REST_API_KEY 환경변수 설정 시 사용
 *   ② Nominatim (OSM) — Kakao 미설정 또는 실패 시 폴백 (API key 불필요)
 *
 * 안정성 장치:
 *   - In-memory cache      (서버 재시작까지 유효, 동일 주소 재호출 차단)
 *   - Rate limit guard     (Nominatim: 1.1초 간격 강제)
 *   - 5초 타임아웃         (외부 API 실패가 job 등록 막지 않음)
 *   - NaN/null 방어        (반환값 항상 { lat, lng } | null)
 *
 * 반환값: { lat: number, lng: number } | null
 */

const https = require('https');

const KAKAO_KEY  = process.env.KAKAO_REST_API_KEY || '';
const HAS_KAKAO  = !!KAKAO_KEY;

console.log(`[GEOCODE] mode=${HAS_KAKAO ? 'KAKAO+NOMINATIM' : 'NOMINATIM_ONLY'}`);

// ─── In-memory cache ──────────────────────────────────────────
const _geoCache = new Map();

// ─── Nominatim rate limit guard (1 req/sec) ───────────────────
let _nominatimLastCallTs = 0;
const NOMINATIM_RATE_MS  = 1100;

/**
 * geocodeAddress(address)
 * @param {string} address  한국어 주소 (예: "경기 화성시 서신면 홍법리")
 * @returns {Promise<{lat: number, lng: number}|null>}
 */
async function geocodeAddress(address) {
    if (!address || !address.trim()) return null;

    const key = address.trim().toLowerCase();

    // ① 캐시 히트
    if (_geoCache.has(key)) {
        const cached = _geoCache.get(key);
        console.log(`[GEOCODE_CACHE] "${key}" → ${cached ? `(${cached.lat}, ${cached.lng})` : 'null'}`);
        return cached;
    }

    // ② Kakao API (키 있을 때 우선)
    if (KAKAO_KEY) {
        const result = await _fetchKakao(address.trim());
        if (result) {
            _geoCache.set(key, result);
            return result;
        }
        console.warn(`[GEOCODE_KAKAO_MISS] "${address}" → Nominatim 폴백`);
    }

    // ③ Nominatim 폴백 (rate limit 적용)
    const now     = Date.now();
    const elapsed = now - _nominatimLastCallTs;
    if (elapsed < NOMINATIM_RATE_MS) {
        await new Promise(r => setTimeout(r, NOMINATIM_RATE_MS - elapsed));
    }
    _nominatimLastCallTs = Date.now();

    const result = await _fetchNominatim(address.trim());
    _geoCache.set(key, result); // 실패(null)도 캐싱하여 재시도 방지
    return result;
}

// ─── Kakao Local API ──────────────────────────────────────────
function _fetchKakao(address) {
    return new Promise((resolve) => {
        const query   = encodeURIComponent(address);
        const options = {
            hostname: 'dapi.kakao.com',
            path:     `/v2/local/search/address.json?query=${query}`,
            headers:  { Authorization: `KakaoAK ${KAKAO_KEY}` },
        };

        const req = https.get(options, (resp) => {
            let data = '';
            resp.on('data',  chunk => { data += chunk; });
            resp.on('end',   () => {
                try {
                    const json = JSON.parse(data);
                    const doc  = json.documents?.[0];
                    if (!doc) { console.log(`[GEOCODE_KAKAO_EMPTY] "${address}"`); return resolve(null); }
                    const lat = parseFloat(doc.y);
                    const lng = parseFloat(doc.x);
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return resolve(null);
                    console.log(`[GEOCODE_KAKAO_OK] "${address}" → (${lat}, ${lng})`);
                    resolve({ lat, lng });
                } catch (e) {
                    console.error('[GEOCODE_KAKAO_PARSE]', e.message);
                    resolve(null);
                }
            });
            resp.on('error', e => { console.error('[GEOCODE_KAKAO_RESP]', e.message); resolve(null); });
        });

        req.on('error', e => { console.error('[GEOCODE_KAKAO_REQ]', e.message); resolve(null); });
        req.setTimeout(5000, () => { req.destroy(); console.warn('[GEOCODE_KAKAO_TIMEOUT]', address); resolve(null); });
    });
}

// ─── Nominatim (OpenStreetMap) ────────────────────────────────
function _fetchNominatim(address) {
    return new Promise((resolve) => {
        const query   = encodeURIComponent(address);
        const options = {
            hostname: 'nominatim.openstreetmap.org',
            path:     `/search?q=${query}&format=json&limit=1&countrycodes=kr`,
            headers:  { 'User-Agent': 'FarmHands-Platform/1.0 (jbcman01@gmail.com)' },
        };

        const req = https.get(options, (resp) => {
            let data = '';
            resp.on('data',  chunk => { data += chunk; });
            resp.on('end',   () => {
                try {
                    const results = JSON.parse(data);
                    if (!Array.isArray(results) || results.length === 0) {
                        console.log(`[GEOCODE_NOMINATIM_EMPTY] "${address}"`);
                        return resolve(null);
                    }
                    const lat = parseFloat(results[0].lat);
                    const lng = parseFloat(results[0].lon);
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return resolve(null);
                    console.log(`[GEOCODE_NOMINATIM_OK] "${address}" → (${lat}, ${lng})`);
                    resolve({ lat, lng });
                } catch (e) {
                    console.error('[GEOCODE_NOMINATIM_PARSE]', e.message);
                    resolve(null);
                }
            });
            resp.on('error', e => { console.error('[GEOCODE_NOMINATIM_RESP]', e.message); resolve(null); });
        });

        req.on('error', e => { console.error('[GEOCODE_NOMINATIM_REQ]', e.message); resolve(null); });
        req.setTimeout(5000, () => { req.destroy(); console.warn('[GEOCODE_NOMINATIM_TIMEOUT]', address); resolve(null); });
    });
}

module.exports = { geocodeAddress };
