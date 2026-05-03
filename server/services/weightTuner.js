'use strict';
/**
 * weightTuner.js — AI 추천 가중치 자동 튜닝
 *
 * 원리:
 *   match_logs에서 최근 N건의 Top-1 선택률을 계산하고
 *   결과에 따라 calcRecommendScore의 거리/평점 가중치를 조정한다.
 *
 *   Top-1 선택률이 낮다 = 1위 추천이 잘 안 선택됨
 *     → 거리 가중치 ↓, 평점 가중치 ↑
 *   Top-1 선택률이 높다 = 모델 안정
 *     → 조정 없음
 *
 * 가중치는 server/model_weights.json 에 저장/로드
 * (파일 없으면 기본값 사용)
 *
 * 호출: tuneWeights() — index.js에서 24시간마다 실행
 */

const fs   = require('fs');
const path = require('path');
const db   = require('../db');

const WEIGHTS_PATH    = path.join(__dirname, '../model_weights.json');
const MIN_SAMPLE_SIZE = 20;   // 최소 20건 이상일 때만 튜닝

// 기본 가중치 (calcRecommendScore 기준)
const DEFAULT_WEIGHTS = {
    distance:     0.50,
    rating:       0.30,
    experience:   0.15,
    activeNow:    0.05,
    // 조정 스텝
    _step:        0.02,
    // 각 가중치 하한/상한
    _distMin:     0.25, _distMax:  0.65,
    _ratingMin:   0.15, _ratingMax: 0.50,
};

/** 현재 가중치 로드 (파일 없으면 기본값) */
function loadWeights() {
    try {
        if (fs.existsSync(WEIGHTS_PATH)) {
            const raw = JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf8'));
            return { ...DEFAULT_WEIGHTS, ...raw };
        }
    } catch (_) {}
    return { ...DEFAULT_WEIGHTS };
}

/** 가중치 저장 */
function saveWeights(w) {
    try {
        const toSave = {
            distance:   w.distance,
            rating:     w.rating,
            experience: w.experience,
            activeNow:  w.activeNow,
        };
        fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(toSave, null, 2), 'utf8');
    } catch (_) {}
}

/** 외부에서 현재 가중치를 읽는 함수 (calcRecommendScore에서 호출) */
function getWeights() {
    return loadWeights();
}

/**
 * 자동 튜닝 실행
 * @returns {Promise<{ top1Rate: number|null, action: string, weights: object }>}
 */
async function tuneWeights() {
    let stats;
    try {
        stats = await db.prepare(`
            SELECT
                COUNT(*) FILTER (WHERE rank = 1)                AS top1_shown,
                COUNT(*) FILTER (WHERE rank = 1 AND selected)   AS top1_selected,
                COUNT(*) FILTER (WHERE rank <= 3)               AS top3_shown,
                COUNT(*) FILTER (WHERE rank <= 3 AND selected)  AS top3_selected,
                COUNT(*)                                         AS total
            FROM match_logs
            WHERE createdat > NOW() - INTERVAL '7 days'
        `).get();
    } catch (_) {
        return { top1Rate: null, action: 'db_error', weights: loadWeights() };
    }

    const total      = Number(stats?.total || 0);
    const top1Shown  = Number(stats?.top1_shown || 0);
    const top1Sel    = Number(stats?.top1_selected || 0);

    if (total < MIN_SAMPLE_SIZE || top1Shown === 0) {
        return { top1Rate: null, action: 'insufficient_data', weights: loadWeights() };
    }

    const top1Rate = top1Sel / top1Shown; // 0~1
    const w        = loadWeights();
    let action     = 'no_change';

    // ── 조정 로직 ─────────────────────────────────────────────
    // Top-1 < 40%: 거리 너무 강조됨 → 거리 ↓ 평점 ↑
    if (top1Rate < 0.40) {
        w.distance = Math.max(w._distMin,   w.distance - w._step);
        w.rating   = Math.min(w._ratingMax, w.rating   + w._step);
        action     = 'distance_down_rating_up';
    }
    // Top-1 > 75%: 거리 가중치가 너무 낮아졌을 수 있음 → 원점 복귀 방향
    else if (top1Rate > 0.75 && w.distance < DEFAULT_WEIGHTS.distance) {
        w.distance = Math.min(w._distMax,   w.distance + w._step / 2);
        w.rating   = Math.max(w._ratingMin, w.rating   - w._step / 2);
        action     = 'rebalance';
    }

    // 합이 1이 되도록 normalise (experience, activeNow 고정)
    const fixed = w.experience + w.activeNow; // 0.20
    const sum   = w.distance + w.rating;
    if (sum > 0) {
        const scale  = (1 - fixed) / sum;
        w.distance   = Math.round(w.distance * scale * 1000) / 1000;
        w.rating     = Math.round(w.rating   * scale * 1000) / 1000;
    }

    saveWeights(w);

    console.log(`[WEIGHT_TUNER] top1Rate=${(top1Rate * 100).toFixed(1)}% total=${total} action=${action}`);
    console.log(`[WEIGHT_TUNER] weights → distance=${w.distance} rating=${w.rating} exp=${w.experience} active=${w.activeNow}`);

    return { top1Rate: Math.round(top1Rate * 100), action, weights: w };
}

module.exports = { tuneWeights, getWeights, DEFAULT_WEIGHTS };
