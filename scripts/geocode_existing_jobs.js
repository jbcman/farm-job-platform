'use strict';
/**
 * geocode_existing_jobs.js — 기존 공고 중 좌표 없는 데이터 자동 보정
 *
 * 실행:  node scripts/geocode_existing_jobs.js
 *
 * 동작:
 *   1. jobs 테이블에서 latitude OR longitude가 null인 행 조회
 *   2. farmAddress → geocodeAddress() → latitude/longitude 업데이트
 *   3. farmAddress도 없으면 건너뜀 (locationText만 있는 경우 — 지오코딩 불가)
 *   4. 실패해도 나머지 작업 계속 진행
 *
 * 주의:
 *   - Kakao API 키 없으면 Nominatim 폴백 (1.1초 rate limit 자동 적용)
 *   - 중단 후 재실행해도 이미 처리된 행은 건너뜀
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db               = require('../server/db');
const { geocodeAddress } = require('../server/services/geocodeService');

async function run() {
    // 좌표 없는 공고 조회 (farmAddress 있는 것만 처리 가능)
    const jobs = db.prepare(`
        SELECT id, farmAddress, locationText
        FROM   jobs
        WHERE  (latitude IS NULL OR longitude IS NULL)
          AND  farmAddress IS NOT NULL
          AND  farmAddress != ''
        ORDER BY createdAt DESC
    `).all();

    if (jobs.length === 0) {
        console.log('[GEOCODE_BATCH] 보정할 공고 없음 — 모두 좌표 있음 ✅');
        process.exit(0);
    }

    console.log(`[GEOCODE_BATCH] 좌표 없는 공고 ${jobs.length}건 처리 시작...`);

    let updated = 0;
    let skipped = 0;
    let failed  = 0;

    for (const job of jobs) {
        const addr = job.farmAddress.trim();
        console.log(`\n[GEOCODE] id=${job.id} addr="${addr}"`);

        try {
            const coords = await geocodeAddress(addr);

            if (!coords) {
                console.warn(`  → 지오코딩 실패 (주소 불명확) — 건너뜀`);
                failed++;
                continue;
            }

            db.prepare(`
                UPDATE jobs
                SET    latitude = ?, longitude = ?
                WHERE  id = ?
            `).run(coords.lat, coords.lng, job.id);

            console.log(`  → (${coords.lat}, ${coords.lng}) ✅`);
            updated++;
        } catch (e) {
            console.error(`  → 오류: ${e.message}`);
            failed++;
        }
    }

    console.log(`\n[GEOCODE_BATCH] 완료 ✅`);
    console.log(`  업데이트: ${updated}건`);
    console.log(`  실패:     ${failed}건`);
    console.log(`  건너뜀:   ${skipped}건 (farmAddress 없음)`);

    process.exit(0);
}

run().catch(e => {
    console.error('[GEOCODE_BATCH_FATAL]', e.message);
    process.exit(1);
});
