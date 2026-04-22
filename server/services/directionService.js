'use strict';
/**
 * directionService.js — 카카오 모빌리티 경로 기반 실제 이동시간 조회
 *
 * KAKAO_REST_API_KEY 설정 시 실제 경로 API 사용
 * 미설정 / 실패 시 → null 반환 (프론트에서 단순 추정으로 폴백)
 *
 * 반환값: 분(number) | null
 */

const https = require('https');

const KAKAO_KEY = process.env.KAKAO_REST_API_KEY || '';
const HAS_KAKAO = !!KAKAO_KEY;

console.log(`[DIRECTION] mode=${HAS_KAKAO ? 'REAL_KAKAO' : 'DIST_FALLBACK'}`);

/**
 * getDriveTime
 * @param {{ lat: number, lng: number }} from  출발지 (사용자 위치)
 * @param {{ lat: number, lng: number }} to    목적지 (작업 위치)
 * @returns {Promise<number|null>}  이동시간(분) 또는 null
 */
async function getDriveTime(from, to) {
    // 좌표 완전성 검사 — 하나라도 없으면 계산 불가
    if (
        !KAKAO_KEY ||
        !Number.isFinite(from?.lat) || !Number.isFinite(from?.lng) ||
        !Number.isFinite(to?.lat)   || !Number.isFinite(to?.lng)
    ) {
        return null;
    }

    try {
        const seconds = await _fetchKakaoRoute(from, to);
        if (seconds == null) return null;
        const minutes = Math.round(seconds / 60);
        return minutes > 0 ? minutes : 1; // 최소 1분
    } catch (e) {
        console.error('[DRIVE_TIME_FAIL]', e.message);
        return null;
    }
}

/**
 * _fetchKakaoRoute — 카카오 모빌리티 길찾기 API 호출
 * @returns {Promise<number|null>}  duration(초) 또는 null
 */
function _fetchKakaoRoute(from, to) {
    return new Promise((resolve) => {
        // Kakao Mobility: origin/destination은 "경도,위도" 순서
        const params = new URLSearchParams({
            origin:      `${from.lng},${from.lat}`,
            destination: `${to.lng},${to.lat}`,
            priority:    'RECOMMEND',
        });

        const options = {
            hostname: 'apis-navi.kakaomobility.com',
            path:     `/v1/directions?${params}`,
            headers:  { Authorization: `KakaoAK ${KAKAO_KEY}` },
        };

        const req = https.get(options, (resp) => {
            let data = '';
            resp.on('data',  chunk => { data += chunk; });
            resp.on('end',   () => {
                try {
                    const json  = JSON.parse(data);
                    const route = json.routes?.[0];
                    if (!route || route.result_code !== 0) {
                        console.warn('[DRIVE_TIME_NO_ROUTE]', route?.result_msg || 'no route');
                        return resolve(null);
                    }
                    const duration = route.summary?.duration;
                    if (!Number.isFinite(duration)) return resolve(null);
                    console.log(`[DRIVE_TIME_OK] from(${from.lat},${from.lng}) → to(${to.lat},${to.lng}) = ${Math.round(duration/60)}분`);
                    resolve(duration);
                } catch (e) {
                    console.error('[DRIVE_TIME_PARSE]', e.message);
                    resolve(null);
                }
            });
            resp.on('error', e => { console.error('[DRIVE_TIME_RESP]', e.message); resolve(null); });
        });

        req.on('error', e => { console.error('[DRIVE_TIME_REQ]', e.message); resolve(null); });
        req.setTimeout(5000, () => {
            req.destroy();
            console.warn('[DRIVE_TIME_TIMEOUT]');
            resolve(null);
        });
    });
}

module.exports = { getDriveTime };
