'use strict';
/**
 * matchingService.js — 통합 매칭 엔진 (PostgreSQL 비동기)
 */
const db = require('../db');
const { getDistanceKm, isWithinRadius, hasGps, DEFAULT_RADIUS_KM } = require('./distanceService');
const { calcMatchScore }   = require('./matchScore');
const { getActiveExperiment, assignVariant, getVariantWeights, getWinnerWeights } = require('./abTestService');
const { getJobBoost }      = require('./monetizationService');
const { pushLog }          = require('./recLogService');
const { getFlag }          = require('./systemFlagService');

const MAX_RADIUS_KM = DEFAULT_RADIUS_KM;

function normalizeLocation(text) {
    if (!text || typeof text !== 'string') return [];
    return text
        .replace(/도$/, '').replace(/특별시$/, '').replace(/광역시$/, '')
        .split(/\s+/).map(s => s.trim()).filter(Boolean);
}

function isSameOrNearbyLocation(a, b) {
    const tokA = normalizeLocation(a);
    const tokB = normalizeLocation(b);
    if (tokA.length === 0 || tokB.length === 0) return false;
    if (tokA[0] === tokB[0]) return true;
    const setB = new Set(tokB);
    return tokA.slice(1).some(t => t.length >= 2 && setB.has(t));
}

function isSameLocation(a, b) {
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a) || isSameOrNearbyLocation(a, b);
}

function isNearby(user, job, radiusKm = MAX_RADIUS_KM) {
    const jobLat = job.lat ?? job.latitude ?? null;
    const jobLng = job.lng ?? job.longitude ?? null;
    if (hasGps(user) && jobLat != null && jobLng != null) {
        const dist = getDistanceKm(user.lat, user.lng, jobLat, jobLng);
        return dist <= radiusKm;
    }
    const userLoc = user.locationText || '';
    const jobLoc  = job.locationText  || '';
    if (userLoc && jobLoc) return isSameOrNearbyLocation(userLoc, jobLoc);
    return false;
}

async function findMatchingWorkers(job, options = {}) {
    const {
        radiusKm    = MAX_RADIUS_KM,
        nearFieldKm = 3,
        topN        = 20,
    } = options;

    const jobLat    = job.lat ?? job.latitude  ?? null;
    const jobLng    = job.lng ?? job.longitude ?? null;
    const hasJobGps = jobLat != null && jobLng != null;

    const candidates = await db.prepare(`
        SELECT u.id, u.name, u.phone, u.jobType, u.locationText,
               COALESCE(w.currentLat, u.lat) AS lat,
               COALESCE(w.currentLng, u.lng) AS lng
        FROM users u
        LEFT JOIN workers w ON w.userId = u.id
        WHERE u.role = 'worker'
          AND u.notifyEnabled = 1
          AND u.phone IS NOT NULL
          AND u.phone != ''
    `).all();

    const jobBoost    = await getJobBoost(job.id);
    const safeMode    = await getFlag('SAFE_MODE');
    const experiment  = await getActiveExperiment();
    const winnerWeights = experiment ? await getWinnerWeights(experiment.id) : null;

    const scored = [];

    for (const u of candidates) {
        const jobTypeFinal  = job.autoJobType || job.category;
        const categoryMatch = u.jobType === jobTypeFinal;
        const workerHasGps  = Number.isFinite(u.lat) && Number.isFinite(u.lng);

        const variantKey = safeMode || winnerWeights
            ? (safeMode ? 'A' : null)
            : (await assignVariant(u.id, experiment, { lat: u.lat, lng: u.lng }) || 'A');
        const weights = safeMode ? {} : (winnerWeights || getVariantWeights(experiment, variantKey) || {});

        if (hasJobGps && workerHasGps) {
            const distKm = getDistanceKm(jobLat, jobLng, u.lat, u.lng);
            if (distKm > radiusKm) continue;
            if (!categoryMatch && distKm > nearFieldKm) continue;
            const score = calcMatchScore(job, u, distKm, nearFieldKm, weights);
            scored.push({ user: u, score, variantKey, _jobBoost: jobBoost });
            pushLog({ jobId: job.id, workerId: u.id, variantKey, score, distKm,
                      difficulty: job.difficulty ?? null, jobType: job.category, autoJobType: job.autoJobType ?? null });
        } else {
            if (!categoryMatch) continue;
            const userLoc = u.locationText || '';
            const jobLoc  = job.locationText || '';
            if (userLoc && jobLoc && isSameOrNearbyLocation(userLoc, jobLoc)) {
                const score = calcMatchScore(job, u, null, nearFieldKm, weights);
                scored.push({ user: u, score, variantKey, _jobBoost: jobBoost });
                pushLog({ jobId: job.id, workerId: u.id, variantKey, score, distKm: null,
                          difficulty: job.difficulty ?? null, jobType: job.category, autoJobType: job.autoJobType ?? null });
            }
        }
    }

    scored.sort((a, b) => b.score - a.score);
    if (jobBoost > 0) {
        scored.sort((a, b) => (b._jobBoost || 0) - (a._jobBoost || 0));
    }
    const topScored = scored.slice(0, topN);
    const matched   = topScored.map(({ user, score, variantKey }) => ({
        ...user,
        _score:   score,
        _variant: variantKey || null,
    }));

    const gpsMode  = hasJobGps ? 'GPS' : 'TEXT';
    const topScore = topScored.length > 0 ? topScored[0].score.toFixed(1) : 'N/A';
    const expLabel = experiment ? `exp=${experiment.id}` : 'exp=none';
    console.log(`[MATCH_SCORE] r=${radiusKm}km nf=${nearFieldKm}km mode=${gpsMode} topN=${topN} ${expLabel} => ${matched.length}/${candidates.length}명 topScore=${topScore}`);
    return matched;
}

async function findMatchingFarmers(workerProfile) {
    if (!workerProfile.jobType) return [];
    const openJobs = await db.prepare(
        "SELECT * FROM jobs WHERE status = 'open' AND category = ?"
    ).all(workerProfile.jobType);
    return openJobs.filter(j => isNearby(workerProfile, j));
}

module.exports = {
    normalizeLocation,
    isSameOrNearbyLocation,
    isSameLocation,
    isNearby,
    findMatchingWorkers,
    findMatchingFarmers,
    MAX_RADIUS_KM,
};
