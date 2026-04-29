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
 * _normalizeAddress(address) — 주소 정규화
 * Nominatim은 도로명 주소(길/로)와 지번 번호를 잘 처리 못함
 * 전략: 읍·면·리·동 단위까지만 추출하여 재시도
 *
 * "경기 화성시 서신면 홍법리 123-4"  → "경기 화성시 서신면 홍법리"
 * "경기도 양주시 엄상동길 30-22"     → "경기도 양주시"  (도로명은 시/군까지만)
 * "경기 양주시 장흥면 산북리"         → 그대로
 */
function _normalizeAddress(address) {
    const trimmed = address.trim();

    // 1단계: 도로명 주소 감지 (길, 로, 대로, 가 뒤에 번호) → 도시/군 단위로 축약
    // 예: "경기도 양주시 엄상동길 30-22" → "경기도 양주시"
    const roadMatch = trimmed.match(/^(.+?(?:시|군|구))\s+\S+(?:길|로|대로|가)\s+\d/);
    if (roadMatch) {
        const normalized = roadMatch[1].trim();
        console.log(`[GEOCODE_NORMALIZE] 도로명 감지 "${trimmed}" → "${normalized}"`);
        return normalized;
    }

    // 2단계: 지번 번호 제거 (리/동/가 뒤 숫자)
    // 예: "경기 화성시 서신면 홍법리 123-4" → "경기 화성시 서신면 홍법리"
    const lotMatch = trimmed.match(/^(.+?(?:리|동|가|읍|면|로))\s+\d[\d\-]*$/);
    if (lotMatch) {
        const normalized = lotMatch[1].trim();
        console.log(`[GEOCODE_NORMALIZE] 지번 제거 "${trimmed}" → "${normalized}"`);
        return normalized;
    }

    return null; // 정규화 불필요
}

/**
 * geocodeAddress(address)
 * @param {string} address  한국어 주소 (예: "경기 화성시 서신면 홍법리")
 * @returns {Promise<{lat: number, lng: number}|null>}
 */
async function geocodeAddress(address) {
    if (!address || !address.trim()) return null;

    const key = address.trim().toLowerCase();

    // ① 캐시 히트 (precision 메타데이터 포함해서 반환)
    if (_geoCache.has(key)) {
        const cached = _geoCache.get(key);
        console.log(`[GEOCODE_CACHE] "${key}" → ${cached ? `(${cached.lat}, ${cached.lng}) precision=${cached.precision}` : 'null'}`);
        return cached;
    }

    // ② Kakao API (키 있을 때 우선 — 도로명 포함 모든 주소 처리 가능)
    if (KAKAO_KEY) {
        const raw = await _fetchKakao(address.trim());
        if (raw) {
            // Kakao는 항상 정확한 주소 처리 → full precision
            const result = { ...raw, normalized: false, precision: 'full' };
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

    const rawResult = await _fetchNominatim(address.trim());

    if (rawResult) {
        // 원본 주소로 성공 → full precision
        const result = { ...rawResult, normalized: false, precision: 'full' };
        _geoCache.set(key, result);
        return result;
    }

    // ④ Nominatim 실패 → 주소 정규화 후 1회 재시도 (precision: partial)
    const normalizedAddr = _normalizeAddress(address.trim());
    if (normalizedAddr && normalizedAddr !== address.trim()) {
        const normKey = normalizedAddr.toLowerCase();
        if (_geoCache.has(normKey)) {
            // 정규화 캐시 히트 — partial precision으로 마킹
            const cached = _geoCache.get(normKey);
            const result = cached ? { ...cached, normalized: true, precision: 'partial' } : null;
            _geoCache.set(key, result);
            console.log(`[GEOCODE_NORM_CACHE_HIT] "${normalizedAddr}" precision=partial`);
            return result;
        }
        // rate limit 준수
        const elapsed2 = Date.now() - _nominatimLastCallTs;
        if (elapsed2 < NOMINATIM_RATE_MS) {
            await new Promise(r => setTimeout(r, NOMINATIM_RATE_MS - elapsed2));
        }
        _nominatimLastCallTs = Date.now();
        const normRaw = await _fetchNominatim(normalizedAddr);
        if (normRaw) {
            // 정규화 성공 → partial precision (시/군 중심 좌표)
            const result = { ...normRaw, normalized: true, precision: 'partial' };
            _geoCache.set(normKey, result);
            _geoCache.set(key, result);
            console.log(`[GEOCODE_NORM_OK] "${address}" → 정규화 성공 "${normalizedAddr}" precision=partial`);
            return result;
        }
        _geoCache.set(normKey, null);
    }

    _geoCache.set(key, null); // 실패도 캐싱 (재시도 트래픽 차단)
    return null;
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
                    // 도로명 + 지번 주소 추출
                    const roadAddress  = doc.road_address?.address_name  || null;
                    const jibunAddress = doc.address?.address_name        || null;
                    console.log(`[GEOCODE_KAKAO_OK] "${address}" → (${lat}, ${lng}) road=${roadAddress} jibun=${jibunAddress}`);
                    resolve({ lat, lng, roadAddress, jibunAddress });
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

// ─── Kakao 역지오코딩 (좌표 → 주소) ──────────────────────────
function _reverseKakao(lat, lng) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'dapi.kakao.com',
            path:     `/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`,
            headers:  { Authorization: `KakaoAK ${KAKAO_KEY}` },
        };
        const req = https.get(options, (resp) => {
            let data = '';
            resp.on('data', c => { data += c; });
            resp.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const doc  = json.documents?.[0];
                    if (!doc) return resolve(null);
                    resolve({
                        roadAddress:  doc.road_address?.address_name || null,
                        jibunAddress: doc.address?.address_name      || null,
                    });
                } catch { resolve(null); }
            });
            resp.on('error', () => resolve(null));
        });
        req.on('error', () => resolve(null));
        req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    });
}

// ─── Nominatim 역지오코딩 (Kakao 없을 때 폴백) ───────────────
function _reverseNominatim(lat, lng) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'nominatim.openstreetmap.org',
            path:     `/reverse?lat=${lat}&lon=${lng}&format=json`,
            headers:  { 'User-Agent': 'FarmHands-Platform/1.0 (jbcman01@gmail.com)' },
        };
        const req = https.get(options, (resp) => {
            let data = '';
            resp.on('data', c => { data += c; });
            resp.on('end', () => {
                try {
                    const json  = JSON.parse(data);
                    const parts = json.address || {};
                    // 한국 행정 구조로 재조합
                    const label = [
                        parts.state,
                        parts.city || parts.county || parts.town,
                        parts.city_district || parts.suburb,
                        parts.village || parts.hamlet || parts.road,
                    ].filter(Boolean).join(' ') || json.display_name || null;
                    resolve({ roadAddress: label, jibunAddress: label });
                } catch { resolve(null); }
            });
            resp.on('error', () => resolve(null));
        });
        req.on('error', () => resolve(null));
        req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    });
}

/**
 * reverseGeocodeAddress(lat, lng)
 * 좌표 → 사람이 읽는 주소 (도로명 우선, 지번 폴백)
 * @returns {Promise<{roadAddress: string|null, jibunAddress: string|null}|null>}
 */
async function reverseGeocodeAddress(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    try {
        if (KAKAO_KEY) {
            const result = await _reverseKakao(lat, lng);
            if (result) {
                console.log(`[REVERSE_GEOCODE_KAKAO] (${lat.toFixed(4)},${lng.toFixed(4)}) → road=${result.roadAddress} jibun=${result.jibunAddress}`);
                return result;
            }
        }
        const result = await _reverseNominatim(lat, lng);
        if (result) console.log(`[REVERSE_GEOCODE_NOMINATIM] (${lat.toFixed(4)},${lng.toFixed(4)}) → ${result.roadAddress}`);
        return result;
    } catch (e) {
        console.error('[REVERSE_GEOCODE_ERROR]', e.message);
        return null;
    }
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

module.exports = { geocodeAddress, reverseGeocodeAddress };
