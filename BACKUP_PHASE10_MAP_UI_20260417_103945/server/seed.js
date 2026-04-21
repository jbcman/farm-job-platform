'use strict';
/**
 * seed.js — 초기 데모 데이터 삽입
 * 이미 데이터가 있으면 스킵 (idempotent)
 *
 * 사용: node server/seed.js  (단독 실행 가능)
 *       require('./seed').seed()  (서버에서 호출)
 */
const db = require('./db');

function dateStr(offsetDays = 0) {
    const d = new Date('2026-04-15');
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

function seed() {
    const count = db.prepare('SELECT COUNT(*) as n FROM jobs').get().n;
    if (count > 0) {
        console.log(`[SEED] 기존 데이터 ${count}건 있음 → 스킵`);
        return;
    }

    const insertJob = db.prepare(`
        INSERT OR IGNORE INTO jobs
        (id, requesterId, requesterName, category, locationText,
         latitude, longitude, date, timeSlot, areaSize, areaUnit,
         note, imageUrl, isUrgent, status, createdAt)
        VALUES
        (@id, @requesterId, @requesterName, @category, @locationText,
         @latitude, @longitude, @date, @timeSlot, @areaSize, @areaUnit,
         @note, @imageUrl, @isUrgent, @status, @createdAt)
    `);

    const insertWorker = db.prepare(`
        INSERT OR IGNORE INTO workers
        (id, userId, name, phone, baseLocationText, latitude, longitude,
         serviceRadiusKm, categories, hasTractor, hasSprayer, hasRotary,
         completedJobs, rating, availableTimeText)
        VALUES
        (@id, @userId, @name, @phone, @baseLocationText, @latitude, @longitude,
         @serviceRadiusKm, @categories, @hasTractor, @hasSprayer, @hasRotary,
         @completedJobs, @rating, @availableTimeText)
    `);

    const insertApp = db.prepare(`
        INSERT OR IGNORE INTO applications
        (id, jobRequestId, workerId, message, status, createdAt)
        VALUES (@id, @jobRequestId, @workerId, @message, @status, @createdAt)
    `);

    const now = new Date().toISOString();

    // ─── 데모 작업 5건 ───────────────────────────────────────────
    const jobs = [
        {
            id: 'job-001', requesterId: 'demo-farmer-1', requesterName: '김순자',
            category: '수확 일손', locationText: '경기 화성시 서신면',
            latitude: 37.19, longitude: 126.83,
            date: dateStr(0), timeSlot: '오전 (7시~12시)', areaSize: 300, areaUnit: '평',
            note: '고추 수확입니다. 장갑 챙겨오세요.', imageUrl: null,
            isUrgent: 1, status: 'open', createdAt: now,
        },
        {
            id: 'job-002', requesterId: 'demo-farmer-2', requesterName: '박길동',
            category: '밭갈이', locationText: '충남 홍성군 광천읍',
            latitude: 36.60, longitude: 126.67,
            date: dateStr(1), timeSlot: '오전 (7시~12시)', areaSize: 500, areaUnit: '평',
            note: '트랙터 있으신 분 부탁드려요.', imageUrl: null,
            isUrgent: 0, status: 'open', createdAt: new Date(Date.now() - 3600000).toISOString(),
        },
        {
            id: 'job-003', requesterId: 'demo-farmer-3', requesterName: '이춘자',
            category: '방제', locationText: '전남 나주시 동수동',
            latitude: 35.02, longitude: 126.71,
            date: dateStr(0), timeSlot: '오후 (13시~18시)', areaSize: 1000, areaUnit: '평',
            note: '방제기 있으시면 우대합니다.', imageUrl: null,
            isUrgent: 1, status: 'open', createdAt: new Date(Date.now() - 7200000).toISOString(),
        },
        {
            id: 'job-004', requesterId: 'demo-farmer-4', requesterName: '최남순',
            category: '로터리', locationText: '경기 안성시 보개면',
            latitude: 37.01, longitude: 127.28,
            date: dateStr(2), timeSlot: '오전 (7시~12시)', areaSize: 400, areaUnit: '평',
            note: '로터리 작업 부탁드립니다.', imageUrl: null,
            isUrgent: 0, status: 'open', createdAt: new Date(Date.now() - 10800000).toISOString(),
        },
        {
            id: 'job-005', requesterId: 'demo-farmer-1', requesterName: '김순자',
            category: '예초', locationText: '경기 화성시 서신면',
            latitude: 37.20, longitude: 126.84,
            date: dateStr(0), timeSlot: '오후 (13시~18시)', areaSize: 200, areaUnit: '평',
            note: '논두렁 풀 베기 작업입니다.', imageUrl: null,
            isUrgent: 0, status: 'open', createdAt: new Date(Date.now() - 1800000).toISOString(),
        },
    ];

    // ─── 데모 작업자 4명 ──────────────────────────────────────────
    const workers = [
        {
            id: 'worker-001', userId: 'demo-worker-1', name: '이경철',
            phone: '010-1234-5678', baseLocationText: '경기 화성시',
            latitude: 37.18, longitude: 126.82, serviceRadiusKm: 30,
            categories: JSON.stringify(['밭갈이', '로터리', '두둑']),
            hasTractor: 1, hasSprayer: 0, hasRotary: 1,
            completedJobs: 47, rating: 4.8, availableTimeText: '평일 오전',
        },
        {
            id: 'worker-002', userId: 'demo-worker-2', name: '박수현',
            phone: '010-2345-6789', baseLocationText: '충남 홍성군',
            latitude: 36.58, longitude: 126.65, serviceRadiusKm: 20,
            categories: JSON.stringify(['수확 일손', '예초', '방제']),
            hasTractor: 0, hasSprayer: 1, hasRotary: 0,
            completedJobs: 23, rating: 4.6, availableTimeText: '주말 가능',
        },
        {
            id: 'worker-003', userId: 'demo-worker-3', name: '김농기',
            phone: '010-3456-7890', baseLocationText: '전남 나주시',
            latitude: 35.00, longitude: 126.70, serviceRadiusKm: 50,
            categories: JSON.stringify(['방제', '밭갈이', '로터리']),
            hasTractor: 1, hasSprayer: 1, hasRotary: 1,
            completedJobs: 91, rating: 4.9, availableTimeText: '상시 가능',
        },
        {
            id: 'worker-004', userId: 'demo-worker-4', name: '정일손',
            phone: '010-4567-8901', baseLocationText: '경기 안성시',
            latitude: 37.00, longitude: 127.27, serviceRadiusKm: 25,
            categories: JSON.stringify(['수확 일손', '예초', '두둑']),
            hasTractor: 0, hasSprayer: 0, hasRotary: 0,
            completedJobs: 15, rating: 4.5, availableTimeText: '오전 선호',
        },
    ];

    // ─── 데모 지원 현황 ───────────────────────────────────────────
    const apps = [
        {
            id: 'app-001', jobRequestId: 'job-001', workerId: 'worker-001',
            message: '오전에 가능합니다. 장갑도 있어요.', status: 'applied',
            createdAt: new Date(Date.now() - 1800000).toISOString(),
        },
        {
            id: 'app-002', jobRequestId: 'job-001', workerId: 'worker-004',
            message: '바로 가능합니다!', status: 'applied',
            createdAt: new Date(Date.now() - 900000).toISOString(),
        },
    ];

    db.transaction(() => {
        jobs.forEach(j => insertJob.run(j));
        workers.forEach(w => insertWorker.run(w));
        apps.forEach(a => insertApp.run(a));
    })();

    console.log(`[SEED] jobs=${jobs.length} workers=${workers.length} apps=${apps.length} 삽입 완료`);
}

module.exports = { seed };

// 단독 실행 지원: node server/seed.js
if (require.main === module) {
    seed();
    process.exit(0);
}
