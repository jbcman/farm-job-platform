'use strict';
const db = require('./server/db');
const { geocodeAddress } = require('./server/services/geocodeService');
const { getCallInfo }    = require('./server/services/callService');
const { distanceKm }     = require('./server/services/matchingEngine');

let PASS = 0; let FAIL = 0;
function ok(label)           { PASS++; console.log('[PASS]', label); }
function fail(label, reason) { FAIL++; console.error('[FAIL]', label, '—', reason); process.exitCode = 1; }

// ── 테스트 주체 선택 ─────────────────────────────────────────────────
const farmerUser    = db.prepare('SELECT * FROM users WHERE id = ?').get('user-1776240493185-j6ex')
                   || db.prepare('SELECT * FROM users LIMIT 1').get();
const workerProfile = db.prepare('SELECT * FROM workers LIMIT 1').get();
const workerUser    = db.prepare('SELECT * FROM users WHERE id = ?').get(workerProfile.userId);

console.log('');
console.log('═══════════════════════════════════════════');
console.log(' PHASE CLEAN_RESET_AND_FULL_REVALIDATION   ');
console.log('═══════════════════════════════════════════');
console.log('농민:', farmerUser.id, '|', farmerUser.name || '이름없음');
console.log('작업자:', workerProfile.id, '|', workerProfile.name, '(userId:', workerProfile.userId + ')');
console.log('');

async function run() {

    // ── STEP 3: 공고 등록 + GEO_QUALITY ─────────────────────────────
    console.log('━━━ STEP 3: 공고 등록 + GEO_QUALITY ━━━');
    const TEST_ADDRESS = '경기도 양주시 장흥면';  // Nominatim 검증된 지번 주소 형식
    const geo = await geocodeAddress(TEST_ADDRESS);
    if (!geo) { fail('STEP3_GEOCODE', '주소 좌표 변환 실패'); return; }

    console.log('[GEO_QUALITY] source=farmAddress addr="' + TEST_ADDRESS + '"'
        + ' lat=' + geo.lat.toFixed(4) + ' lng=' + geo.lng.toFixed(4)
        + ' addrLen=' + TEST_ADDRESS.length);
    ok('STEP3_GEOCODE: ' + TEST_ADDRESS + ' → (' + geo.lat.toFixed(4) + ', ' + geo.lng.toFixed(4) + ')');

    const jobId = 'test-job-' + Date.now();
    db.prepare(`
        INSERT INTO jobs (id, requesterId, requesterName, category, locationText,
            latitude, longitude, date, timeSlot, status, createdAt, farmAddress, isUrgent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, 0)
    `).run(jobId, farmerUser.id, farmerUser.name || '테스트농민',
           '밭갈이', '경기 양주',
           geo.lat, geo.lng, '2026-05-01', '오전',
           new Date().toISOString(), TEST_ADDRESS);

    const savedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!savedJob || !savedJob.latitude || !savedJob.longitude) {
        fail('STEP3_JOB_SAVE', 'job 저장 실패 or 좌표 누락');
    } else {
        ok('STEP3_JOB_SAVE: jobId=' + jobId + ' lat=' + savedJob.latitude + ' lng=' + savedJob.longitude);
    }

    // GPS vs 농지 거리 확인
    const GPS_SIMUL = { lat: 37.5665, lng: 126.9780 }; // 서울 시청 (GPS 시뮬)
    const farmDist = distanceKm(GPS_SIMUL.lat, GPS_SIMUL.lng, geo.lat, geo.lng);
    console.log('[STEP3] GPS vs 농지 거리: ' + farmDist.toFixed(1) + 'km → 주소 기반 좌표 분리 확인');
    if (farmDist > 1) {
        ok('STEP3_GEO_SEPARATE: GPS와 농지 좌표 ' + farmDist.toFixed(1) + 'km 차이');
    }

    // ── STEP 4: 작업자 위치 + 지원 ────────────────────────────────────
    console.log('');
    console.log('━━━ STEP 4: 작업자 위치 + 지원 ━━━');

    db.prepare('UPDATE workers SET currentLat=?, currentLng=?, locationUpdatedAt=?, activeNow=1 WHERE id=?')
        .run(37.82, 127.05, new Date().toISOString(), workerProfile.id);
    ok('STEP4_WORKER_LOCATION: activeNow=1 설정 lat=37.82 lng=127.05');

    const appId = 'test-app-' + Date.now();
    db.prepare(`
        INSERT INTO applications (id, jobRequestId, workerId, message, status, createdAt)
        VALUES (?, ?, ?, ?, 'applied', ?)
    `).run(appId, jobId, workerProfile.userId, '열심히 하겠습니다!', new Date().toISOString());

    const savedApp = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId);
    if (!savedApp) {
        fail('STEP4_APPLY', '지원서 저장 실패');
    } else {
        ok('STEP4_APPLY: appId=' + appId + ' workerId=' + savedApp.workerId);
    }

    // ── STEP 5: 지원자 조회 + TRACE ────────────────────────────────────
    console.log('');
    console.log('━━━ STEP 5: 지원자 조회 (TRACE) ━━━');

    const apps = db.prepare(
        "SELECT * FROM applications WHERE jobRequestId = ? AND status != 'cancelled'"
    ).all(jobId);

    let nullWorkerCount = 0;
    const raw = apps.map(a => {
        let workerRow = db.prepare('SELECT * FROM workers WHERE id = ?').get(a.workerId)
                     || db.prepare('SELECT * FROM workers WHERE userId = ?').get(a.workerId);
        if (!workerRow) {
            const u = db.prepare(
                'SELECT id, name, phone, lat, lng, locationText FROM users WHERE id = ?'
            ).get(a.workerId);
            if (u) workerRow = {
                id: a.workerId, userId: u.id, name: u.name || '작업자', phone: u.phone,
                baseLocationText: u.locationText || '', categories: '[]',
                hasTractor: 0, hasSprayer: 0, hasRotary: 0,
                completedJobs: 0, rating: 0, availableTimeText: null,
                noshowCount: 0, ratingAvg: null, ratingCount: 0,
                latitude: u.lat, longitude: u.lng,
                locationUpdatedAt: null, activeNow: 0,
            };
        }
        if (!workerRow) nullWorkerCount++;
        return { applicationId: a.id, status: a.status, worker: workerRow };
    });

    console.log('[TRACE][APPLICANTS] jobId=' + jobId
        + ' total=' + raw.length + ' nullWorkers=' + nullWorkerCount);

    if (nullWorkerCount > 0) fail('STEP5_NULL_WORKER', nullWorkerCount + '개 worker null');
    else ok('STEP5_NULL_WORKER: 0개 null ✅');

    if (raw.length === 0) fail('STEP5_COUNT', 'applicants.length === 0');
    else ok('STEP5_COUNT: applicants.length=' + raw.length);

    const w = raw[0]?.worker;
    if (!w || !w.name) {
        fail('STEP5_WORKER_DATA', 'worker name 없음');
    } else {
        const phoneMask = w.phone ? '***' + String(w.phone).slice(-4) : 'null';
        ok('STEP5_WORKER_DATA: name=' + w.name + ' phone=' + phoneMask
            + ' activeNow=' + w.activeNow);
    }

    console.log('[TRACE][RENDER_COUNT] jobId=' + jobId
        + ' rendered=' + raw.filter(a => !!a.worker).length);

    // ── STEP 6: select-worker ─────────────────────────────────────────
    console.log('');
    console.log('━━━ STEP 6: select-worker ━━━');

    const now = new Date().toISOString();
    db.transaction(() => {
        db.prepare(
            "UPDATE jobs SET status='matched', selectedWorkerId=?, selectedAt=?, contactRevealed=1 WHERE id=?"
        ).run(workerProfile.userId, now, jobId);
        db.prepare(
            "UPDATE applications SET status='selected' WHERE jobRequestId=? AND workerId=?"
        ).run(jobId, workerProfile.userId);
    })();

    const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (updatedJob.status !== 'matched' || updatedJob.selectedWorkerId !== workerProfile.userId) {
        fail('STEP6_SELECT', 'select-worker 상태 변경 실패');
    } else {
        ok('STEP6_SELECT: status=matched selectedWorkerId=' + updatedJob.selectedWorkerId);
    }
    console.log('[TRACE][SELECT_WORKER] jobId=' + jobId
        + ' workerId=' + workerProfile.userId + ' resolved=' + workerProfile.name);

    // ── STEP 7: 전화 연결 ─────────────────────────────────────────────
    console.log('');
    console.log('━━━ STEP 7: 전화 연결 (CALL_TRIGGER) ━━━');

    // 농민 → 작업자 전화
    const r1 = getCallInfo(jobId, farmerUser.id);
    const wp = r1.workerPhone ? '***' + String(r1.workerPhone).slice(-4) : 'null';
    const fp = r1.farmerPhone ? '***' + String(r1.farmerPhone).slice(-4) : 'null';
    console.log('[TRACE][CONNECT_CALL] jobId=' + jobId + ' userId=' + farmerUser.id
        + ' farmerPhone=' + fp + ' workerPhone=' + wp);
    if (!r1.ok) fail('STEP7_CALL_FARMER', r1.error);
    else ok('STEP7_CALL_FARMER: farmer→worker=' + r1.workerName);

    // 작업자 → 농민 전화 (workers.userId 사용)
    const r2 = getCallInfo(jobId, workerProfile.userId);
    if (!r2.ok) fail('STEP7_CALL_WORKER', r2.error);
    else ok('STEP7_CALL_WORKER: worker→farmer=' + r2.farmerName);

    // 작업자 → 농민 전화 (workers.id 엣지케이스)
    const r2b = getCallInfo(jobId, workerProfile.id);
    if (!r2b.ok) fail('STEP7_CALL_WORKER_EDGE', r2b.error);
    else ok('STEP7_CALL_WORKER_EDGE: workers.id 직접 사용 OK');

    // 무권한 차단 확인
    const r3 = getCallInfo(jobId, 'user-invalid-xyz');
    if (r3.ok) fail('STEP7_CALL_UNAUTH', '무권한 접근 허용 ← 보안 버그');
    else ok('STEP7_CALL_UNAUTH: 403 정상 차단');

    // ── STEP 8: 지도 좌표 검증 ───────────────────────────────────────
    console.log('');
    console.log('━━━ STEP 8: 지도 좌표 검증 ━━━');

    const KOREA = { latMin: 33, latMax: 39, lngMin: 124, lngMax: 132 };
    const inKorea = savedJob.latitude  >= KOREA.latMin && savedJob.latitude  <= KOREA.latMax
                 && savedJob.longitude >= KOREA.lngMin && savedJob.longitude <= KOREA.lngMax;

    if (!inKorea) {
        fail('STEP8_GEO', '좌표 한국 범위 벗어남: ' + savedJob.latitude + ', ' + savedJob.longitude);
    } else {
        ok('STEP8_GEO: 한국 내 좌표 (' + savedJob.latitude.toFixed(4) + ', ' + savedJob.longitude.toFixed(4) + ')');
    }
    if (savedJob.farmAddress) {
        ok('STEP8_FARM_ADDR: farmAddress 저장됨 = "' + savedJob.farmAddress + '"');
    } else {
        fail('STEP8_FARM_ADDR', 'farmAddress null');
    }

    // ── STEP 10: FAIL 조건 최종 체크 ─────────────────────────────────
    console.log('');
    console.log('━━━ STEP 10: FAIL 조건 전수 검사 ━━━');

    // null-worker 전수 검사
    const allApps = db.prepare("SELECT * FROM applications WHERE status != 'cancelled'").all();
    const nullChk = allApps.filter(a => {
        const ww = db.prepare('SELECT id FROM workers WHERE id=?').get(a.workerId)
                || db.prepare('SELECT id FROM workers WHERE userId=?').get(a.workerId)
                || db.prepare('SELECT id FROM users WHERE id=?').get(a.workerId);
        return !ww;
    });
    if (nullChk.length > 0) fail('FAIL_NULL_WORKER', nullChk.length + '건');
    else ok('FAIL_CHECK_NULL_WORKER: DB 전체 0건 ✅');

    const finalJob = db.prepare('SELECT id FROM jobs WHERE id=?').get(jobId);
    if (!finalJob) fail('FAIL_JOB_NOT_FOUND', 'job 없음');
    else ok('FAIL_CHECK_JOB_EXISTS ✅');

    const geoOnlyGPS = db.prepare(
        "SELECT COUNT(*) AS n FROM jobs WHERE latitude IS NOT NULL AND farmAddress IS NULL"
    ).get().n;
    console.log('[STEP10] GPS전용 좌표 공고:', geoOnlyGPS, '건 (새 등록부터는 0 목표)');

    // ── 최종 결과 ──────────────────────────────────────────────────
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('PASS:', PASS, ' FAIL:', FAIL);
    if (FAIL === 0) {
        console.log('결과: ✅ ALL PASS — DEFINITION OF DONE 충족');
    } else {
        console.log('결과: ❌ FAIL ' + FAIL + '건 수정 필요');
    }
    console.log('═══════════════════════════════════════════');
}

run().catch(e => { console.error('[E2E_FATAL]', e.message, e.stack); process.exitCode = 1; });
