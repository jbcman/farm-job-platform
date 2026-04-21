/**
 * userProfile.js — PHASE 19+21: 사용자 행동 기반 프로필 관리
 *
 * localStorage 키:
 *   farm-region   : 마지막 지원/클릭 일자리의 지역 (시/군 단위)
 *   farm-category : 마지막 지원/클릭 일자리의 카테고리
 *   farm-userRole : 역할 (기존 키 활용)
 *
 * 개인정보 최소 사용 원칙 — 전화번호·이름 저장 없음
 */

/**
 * PHASE 21 — userId 영구 고정
 * localStorage에 ID가 있으면 재사용, 없을 때만 새로 생성
 * App.jsx / LoginPage 양쪽에서 공유
 *
 * @returns {{ id: string, name: string, role: string }}
 */
export function getOrCreateUser() {
  let storedId   = null;
  let storedName = null;
  let storedRole = null;

  try {
    storedId   = localStorage.getItem('farm-userId');
    storedName = localStorage.getItem('farm-userName');
    storedRole = localStorage.getItem('farm-userRole');
  } catch (_) {}

  if (!storedId) {
    storedId   = 'worker_' + Date.now();
    storedName = storedName || '게스트';
    storedRole = storedRole || 'worker';
    try {
      localStorage.setItem('farm-userId',   storedId);
      localStorage.setItem('farm-userName', storedName);
      localStorage.setItem('farm-userRole', storedRole);
    } catch (_) {}
  }

  return {
    id:   storedId,
    name: storedName || '게스트',
    role: storedRole || 'worker',
  };
}

/**
 * 현재 사용자 추천 프로필 읽기
 * @returns {{ region: string|null, category: string|null }}
 */
export function getUserProfile() {
  let region   = null;
  let category = null;

  try {
    region   = localStorage.getItem('farm-region')   || null;
    category = localStorage.getItem('farm-category') || null;
  } catch (_) { /* localStorage 접근 불가 환경 대비 */ }

  return { region, category };
}

/**
 * 사용자 행동(지원/클릭) 시 프로필 업데이트
 * 지역: locationText의 첫 번째 토큰 (시/군 단위) 저장
 *   예: "경기도 화성시 석포동" → "경기도"
 *       "충남 예산군"          → "충남"
 *
 * @param {{ category: string, locationText: string }} job
 */
export function saveUserInteraction(job) {
  try {
    if (job.category) {
      localStorage.setItem('farm-category', job.category);
    }
    if (job.locationText) {
      // 첫 번째 공백 토큰 = 시/도 단위
      const region = job.locationText.trim().split(/\s+/)[0] || '';
      if (region) localStorage.setItem('farm-region', region);
    }
  } catch (_) {}
}

/**
 * 로그인 시 작업자 관심 분야로 초기 프로필 설정
 * LoginPage의 jobType, locationText를 활용
 *
 * @param {{ jobType?: string, locationText?: string }} workerInfo
 */
export function initProfileFromLogin(workerInfo = {}) {
  try {
    if (workerInfo.jobType && !localStorage.getItem('farm-category')) {
      localStorage.setItem('farm-category', workerInfo.jobType);
    }
    if (workerInfo.locationText && !localStorage.getItem('farm-region')) {
      const region = workerInfo.locationText.trim().split(/\s+/)[0] || '';
      if (region) localStorage.setItem('farm-region', region);
    }
  } catch (_) {}
}
