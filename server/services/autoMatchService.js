'use strict';
/**
 * autoMatchService.js — DEPRECATED (PHASE MATCH_ENGINE_UNIFY)
 *
 * 기능이 matchingService.js의 findMatchingWorkers(job, options) 로 통합됨.
 * 이 파일은 하위 호환성을 위해 유지되며 실제 로직은 없습니다.
 *
 * 대체:
 *   const { findMatchingWorkers } = require('./matchingService');
 *   findMatchingWorkers(job, { useCategory: false, useDistance: true, radiusKm: 5 });
 */
module.exports = {};
