'use strict';
/**
 * store.js — 인메모리 데이터 저장소 (MVP)
 * 실 서비스 전환 시 DB로 교체
 */

// ─── 날짜 유틸 ───────────────────────────────────────────────
function dateStr(offsetDays = 0) {
    const d = new Date('2026-04-15');
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

// ─── 데모 데이터 ──────────────────────────────────────────────

const jobs = new Map([
    ['job-001', {
        id: 'job-001',
        requesterId: 'demo-farmer-1',
        requesterName: '김순자',
        category: '수확 일손',
        locationText: '경기 화성시 서신면',
        latitude: 37.19, longitude: 126.83,
        date: dateStr(0), timeSlot: '오전 (7시~12시)',
        areaSize: 300, areaUnit: '평',
        note: '고추 수확입니다. 장갑 챙겨오세요.',
        imageUrl: null,
        isUrgent: true,
        status: 'open',
        createdAt: new Date().toISOString(),
    }],
    ['job-002', {
        id: 'job-002',
        requesterId: 'demo-farmer-2',
        requesterName: '박길동',
        category: '밭갈이',
        locationText: '충남 홍성군 광천읍',
        latitude: 36.60, longitude: 126.67,
        date: dateStr(1), timeSlot: '오전 (7시~12시)',
        areaSize: 500, areaUnit: '평',
        note: '트랙터 있으신 분 부탁드려요.',
        imageUrl: null,
        isUrgent: false,
        status: 'open',
        createdAt: new Date(Date.now() - 3600000).toISOString(),
    }],
    ['job-003', {
        id: 'job-003',
        requesterId: 'demo-farmer-3',
        requesterName: '이춘자',
        category: '방제',
        locationText: '전남 나주시 동수동',
        latitude: 35.02, longitude: 126.71,
        date: dateStr(0), timeSlot: '오후 (13시~18시)',
        areaSize: 1000, areaUnit: '평',
        note: '방제기 있으시면 우대합니다.',
        imageUrl: null,
        isUrgent: true,
        status: 'open',
        createdAt: new Date(Date.now() - 7200000).toISOString(),
    }],
    ['job-004', {
        id: 'job-004',
        requesterId: 'demo-farmer-4',
        requesterName: '최남순',
        category: '로터리',
        locationText: '경기 안성시 보개면',
        latitude: 37.01, longitude: 127.28,
        date: dateStr(2), timeSlot: '오전 (7시~12시)',
        areaSize: 400, areaUnit: '평',
        note: '로터리 작업 부탁드립니다.',
        imageUrl: null,
        isUrgent: false,
        status: 'open',
        createdAt: new Date(Date.now() - 10800000).toISOString(),
    }],
    ['job-005', {
        id: 'job-005',
        requesterId: 'demo-farmer-1',
        requesterName: '김순자',
        category: '예초',
        locationText: '경기 화성시 서신면',
        latitude: 37.20, longitude: 126.84,
        date: dateStr(0), timeSlot: '오후 (13시~18시)',
        areaSize: 200, areaUnit: '평',
        note: '논두렁 풀 베기 작업입니다.',
        imageUrl: null,
        isUrgent: false,
        status: 'open',
        createdAt: new Date(Date.now() - 1800000).toISOString(),
    }],
]);

const workers = new Map([
    ['worker-001', {
        id: 'worker-001',
        userId: 'demo-worker-1',
        name: '이경철',
        phone: '010-1234-5678',
        baseLocationText: '경기 화성시',
        latitude: 37.18, longitude: 126.82,
        serviceRadiusKm: 30,
        categories: ['밭갈이', '로터리', '두둑'],
        hasTractor: true, hasSprayer: false, hasRotary: true,
        completedJobs: 47, rating: 4.8,
        availableTimeText: '평일 오전',
    }],
    ['worker-002', {
        id: 'worker-002',
        userId: 'demo-worker-2',
        name: '박수현',
        phone: '010-2345-6789',
        baseLocationText: '충남 홍성군',
        latitude: 36.58, longitude: 126.65,
        serviceRadiusKm: 20,
        categories: ['수확 일손', '예초', '방제'],
        hasTractor: false, hasSprayer: true, hasRotary: false,
        completedJobs: 23, rating: 4.6,
        availableTimeText: '주말 가능',
    }],
    ['worker-003', {
        id: 'worker-003',
        userId: 'demo-worker-3',
        name: '김농기',
        phone: '010-3456-7890',
        baseLocationText: '전남 나주시',
        latitude: 35.00, longitude: 126.70,
        serviceRadiusKm: 50,
        categories: ['방제', '밭갈이', '로터리'],
        hasTractor: true, hasSprayer: true, hasRotary: true,
        completedJobs: 91, rating: 4.9,
        availableTimeText: '상시 가능',
    }],
    ['worker-004', {
        id: 'worker-004',
        userId: 'demo-worker-4',
        name: '정일손',
        phone: '010-4567-8901',
        baseLocationText: '경기 안성시',
        latitude: 37.00, longitude: 127.27,
        serviceRadiusKm: 25,
        categories: ['수확 일손', '예초', '두둑'],
        hasTractor: false, hasSprayer: false, hasRotary: false,
        completedJobs: 15, rating: 4.5,
        availableTimeText: '오전 선호',
    }],
]);

// 지원 현황 — job-001에 2명 이미 지원 (데모)
const applications = new Map([
    ['app-001', {
        id: 'app-001',
        jobRequestId: 'job-001',
        workerId: 'worker-001',
        message: '오전에 가능합니다. 장갑도 있어요.',
        status: 'applied',
        createdAt: new Date(Date.now() - 1800000).toISOString(),
    }],
    ['app-002', {
        id: 'app-002',
        jobRequestId: 'job-001',
        workerId: 'worker-004',
        message: '바로 가능합니다!',
        status: 'applied',
        createdAt: new Date(Date.now() - 900000).toISOString(),
    }],
]);

module.exports = { jobs, workers, applications };
