'use strict';
/**
 * weatherService.js — 날씨 정보 조회 (OpenWeatherMap)
 *
 * WEATHER_API_KEY 환경변수 미설정 또는 API 실패 시 fallback 반환
 *   fallback: { rain: 0, temp: 20, wind: 1, source: 'fallback' }
 *
 * 응답 필드:
 *   rain  {number}  강수량 mm/h  (0이면 맑음)
 *   temp  {number}  기온 °C
 *   wind  {number}  풍속 m/s
 *   source {string} 'api' | 'fallback'
 */
const https = require('https');

const FALLBACK = { rain: 0, temp: 20, wind: 1, source: 'fallback' };

// 인메모리 캐시 (위경도 소수점 1자리 기준, TTL 10분)
const _cache    = new Map();
const CACHE_MS  = 10 * 60 * 1000; // 10분

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{ rain: number, temp: number, wind: number, source: string }>}
 */
async function getWeather(lat, lon) {
    const apiKey = process.env.WEATHER_API_KEY;
    if (!apiKey || !lat || !lon) return FALLBACK;

    const key = `${lat.toFixed(1)}:${lon.toFixed(1)}`;
    const cached = _cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

    try {
        const data = await _fetchJson(
            `https://api.openweathermap.org/data/2.5/weather` +
            `?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=kr`
        );

        const result = {
            rain:   (data.rain && (data.rain['1h'] || data.rain['3h'])) || 0,
            temp:   Math.round((data.main?.temp ?? 20) * 10) / 10,
            wind:   Math.round((data.wind?.speed ?? 1) * 10) / 10,
            source: 'api',
        };

        _cache.set(key, { data: result, ts: Date.now() });
        return result;
    } catch (_) {
        return FALLBACK;
    }
}

function _fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            let buf = '';
            res.setEncoding('utf8');
            res.on('data', c => { buf += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(buf)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

module.exports = { getWeather };
