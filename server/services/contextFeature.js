'use strict';
/**
 * contextFeature.js — 작업 시간·지역 컨텍스트 특징 추출
 *
 * getContextFeatures(job) → {
 *   isMorning   {bool}    06:00~11:59 KST
 *   isAfternoon {bool}    12:00~17:59 KST
 *   isEvening   {bool}    18:00~21:59 KST
 *   isWeekend   {bool}    토·일
 *   regionCode  {string}  '경기'|'충청'|... (위도 기반 대략 분류) or 'unknown'
 * }
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // UTC+9

/**
 * @param {object} job  — latitude, longitude, workDate(YYYY-MM-DD) 포함 가능
 * @returns {{ isMorning: boolean, isAfternoon: boolean, isEvening: boolean, isWeekend: boolean, regionCode: string }}
 */
function getContextFeatures(job) {
    // ─── 날짜·시간 판단 ───────────────────────────────────────────
    // workDate 있으면 그 날의 KST 낮 12시 기준, 없으면 현재 KST 시각
    let refDate;
    if (job && job.workDate) {
        // workDate='2025-07-15' → 그날 12:00 KST
        refDate = new Date(`${job.workDate}T12:00:00+09:00`);
    } else {
        refDate = new Date(Date.now() + KST_OFFSET_MS);
    }

    // 현재 요청 시각 (KST 시간 기준)
    const nowKST  = new Date(Date.now() + KST_OFFSET_MS);
    const hourNow = nowKST.getUTCHours();       // KST 시 (0~23)
    const dayNow  = nowKST.getUTCDay();         // 0=일, 6=토

    const isMorning   = hourNow >= 6  && hourNow < 12;
    const isAfternoon = hourNow >= 12 && hourNow < 18;
    const isEvening   = hourNow >= 18 && hourNow < 22;
    const isWeekend   = dayNow === 0 || dayNow === 6;

    // ─── 지역 코드 (위도 기반 대략 분류) ─────────────────────────
    const lat = job && job.latitude != null ? Number(job.latitude) : null;
    const regionCode = _latToRegion(lat);

    return { isMorning, isAfternoon, isEvening, isWeekend, regionCode };
}

/**
 * 위도 → 한국 광역권 대략 분류 (±0.5° 정밀도로 충분)
 * 참고: 서울 37.5, 강원 37.5~38.6, 경기 37.0~38.0,
 *       충청 36.0~37.0, 경북·전북 35.5~36.5, 경남·전남 34.5~35.5, 제주 33~34
 */
function _latToRegion(lat) {
    if (lat == null || !Number.isFinite(lat)) return 'unknown';
    if (lat >= 38.0)  return '강원';
    if (lat >= 37.0)  return '경기';
    if (lat >= 36.0)  return '충청';
    if (lat >= 35.5)  return '경북전북';
    if (lat >= 34.5)  return '경남전남';
    if (lat >= 33.0)  return '제주';
    return 'unknown';
}

module.exports = { getContextFeatures };
