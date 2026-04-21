'use strict';
/**
 * geocodeService.js — Nominatim (OpenStreetMap) 기반 무료 지오코딩
 * API key 불필요. 한국 주소 특화 (countrycodes=kr)
 *
 * Nominatim 이용 약관:
 *   - User-Agent 헤더 필수
 *   - 1초 이상 요청 간격 유지 (rate limit 초과 시 403/차단)
 *
 * 구현된 안정성 장치:
 *   ① Rate limit guard  — 최소 1초 간격 강제 (Promise 대기)
 *   ② In-memory cache   — 동일 주소 재요청 차단 (서버 재시작까지 유효)
 *   ③ 5초 타임아웃      — 외부 API 실패가 job 등록을 막지 않도록 fail-safe
 *
 * 반환값: { lat, lng } | null
 */

const https = require('https');

// ─── Rate limit guard (Nominatim: 1 req/sec) ──────────────────
let _lastCallTs = 0;
const RATE_LIMIT_MS = 1100; // 1.1초 — 약간의 여유

// ─── In-memory cache ──────────────────────────────────────────
// key: normalized address string, value: { lat, lng } | null
const _geoCache = new Map();

/**
 * geocodeAddress(address)
 * @param {string} address  한국어 주소 (예: "경기 화성시 서신면 홍법리")
 * @returns {Promise<{lat: number, lng: number}|null>}
 */
async function geocodeAddress(address) {
    if (!address || !address.trim()) return null;

    const key = address.trim().toLowerCase();

    // ① 캐시 히트 — API 호출 없이 즉시 반환
    if (_geoCache.has(key)) {
        const cached = _geoCache.get(key);
        console.log(`[GEOCODE_CACHE_HIT] "${key}" → ${cached ? `(${cached.lat}, ${cached.lng})` : 'null'}`);
        return cached;
    }

    // ② Rate limit — 마지막 호출로부터 1.1초 미만이면 대기
    const now = Date.now();
    const elapsed = now - _lastCallTs;
    if (elapsed < RATE_LIMIT_MS) {
        const waitMs = RATE_LIMIT_MS - elapsed;
        console.log(`[GEOCODE_RATE_WAIT] ${waitMs}ms 대기 중...`);
        await new Promise(res => setTimeout(res, waitMs));
    }
    _lastCallTs = Date.now();

    // ③ 실제 Nominatim 요청
    const result = await _fetchNominatim(address.trim());

    // ④ 결과 캐싱 (성공/실패 모두 — null도 캐싱해서 동일 주소 재시도 방지)
    _geoCache.set(key, result);

    return result;
}

/**
 * _fetchNominatim — 실제 HTTP 요청 (내부 전용)
 */
function _fetchNominatim(address) {
    return new Promise((resolve) => {
        const query   = encodeURIComponent(address);
        const url     = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=kr`;
        const options = {
            headers: {
                // Nominatim 필수 요구사항: 연락 가능한 User-Agent
                'User-Agent': 'FarmHands-Platform/1.0 (jbcman01@gmail.com)',
            },
        };

        const httpReq = https.get(url, options, (resp) => {
            let data = '';
            resp.on('data',  (chunk) => { data += chunk; });
            resp.on('end',   () => {
                try {
                    const results = JSON.parse(data);
                    if (!Array.isArray(results) || results.length === 0) {
                        console.log(`[GEOCODE_NO_RESULT] "${address}"`);
                        return resolve(null);
                    }
                    const { lat, lon } = results[0];
                    const parsedLat = parseFloat(lat);
                    const parsedLng = parseFloat(lon);
                    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
                        return resolve(null);
                    }
                    console.log(`[GEOCODE_OK] "${address}" → (${parsedLat}, ${parsedLng})`);
                    resolve({ lat: parsedLat, lng: parsedLng });
                } catch (e) {
                    console.error('[GEOCODE_PARSE_ERROR]', e.message);
                    resolve(null);
                }
            });
            resp.on('error', (e) => {
                console.error('[GEOCODE_RESP_ERROR]', e.message);
                resolve(null);
            });
        });

        httpReq.on('error', (e) => {
            console.error('[GEOCODE_REQUEST_ERROR]', e.message);
            resolve(null);
        });

        // 5초 타임아웃 — 외부 API 실패가 job 등록을 막으면 안 됨
        httpReq.setTimeout(5000, () => {
            httpReq.destroy();
            console.warn('[GEOCODE_TIMEOUT]', address);
            resolve(null);
        });
    });
}

module.exports = { geocodeAddress };
