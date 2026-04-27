'use strict';
/**
 * ab.js — A/B 테스트 엔진
 *
 * - 서버가 variant를 결정 → 클라이언트가 수동적으로 반영
 * - userId 해시 기반 안정적 배정 (같은 유저 = 항상 같은 그룹)
 * - 조건부 hardBlock: farmAddrRate < 30%이면 소프트→하드 자동 전환
 */

const express = require('express');
const db      = require('../db');
const router  = express.Router();

// ─── 실험 정의 ─────────────────────────────────────────────────────
// 새 실험 추가 시 여기만 수정
const EXPERIMENTS = {
    // 실험 1: 경고 메시지 톤
    geo_message: {
        A: '농지 주소를 입력하면 작업자를 더 정확하게 매칭할 수 있어요.',
        B: '입력하지 않으면 작업자 연결이 느려질 수 있습니다.',
    },
    // 실험 2: 경고 색상
    geo_warn_color: {
        A: 'amber',  // 중립적 경고
        B: 'red',    // 강한 경고
    },
    // 실험 3: 경고 횟수 (소프트 차단 강도)
    geo_warn_count: {
        A: 1,  // 1회 경고 후 통과
        B: 2,  // 2회 경고 후 통과
    },
};

// ─── userId 해시 (결정론적 — 같은 userId = 항상 같은 그룹) ──────────
function hashUserId(userId) {
    let h = 5381;
    for (let i = 0; i < userId.length; i++) {
        h = ((h << 5) + h) ^ userId.charCodeAt(i);
        h |= 0; // 32bit 정수 유지
    }
    return Math.abs(h);
}

// ─── farmAddrRate 조회 (하드차단 임계값 체크) ─────────────────────────
function getFarmAddrRate() {
    try {
        const total    = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE latitude IS NOT NULL").get()?.n || 0;
        const withFarm = db.prepare(
            "SELECT COUNT(*) AS n FROM jobs WHERE farmAddress IS NOT NULL AND farmAddress != ''"
        ).get()?.n || 0;
        if (total < 10) return null; // 데이터 부족 — 판단 보류
        return Math.round(withFarm / total * 1000) / 10;
    } catch (_) { return null; }
}

// ─── GET /api/ab/config?userId=... ────────────────────────────────────
// 클라이언트가 마운트 시 1회 호출 → variant config 수령
router.get('/config', (req, res) => {
    const { userId } = req.query;
    if (!userId) {
        // userId 없으면 기본값 (A 그룹)
        return res.json({
            ok: true,
            config: {
                geo_message:    EXPERIMENTS.geo_message.A,
                geo_warn_color: EXPERIMENTS.geo_warn_color.A,
                geo_warn_count: EXPERIMENTS.geo_warn_count.A,
                hardBlock:      false,
                group:          'A',
            },
        });
    }

    const hash  = hashUserId(userId);
    const group = hash % 2 === 0 ? 'A' : 'B';

    // 각 실험 독립 배정 (다른 hash 비트 사용)
    const geo_message    = EXPERIMENTS.geo_message[hash % 2 === 0 ? 'A' : 'B'];
    const geo_warn_color = EXPERIMENTS.geo_warn_color[hash % 4 < 2  ? 'A' : 'B'];
    const geo_warn_count = EXPERIMENTS.geo_warn_count[hash % 3 === 0 ? 'B' : 'A'];

    // 조건부 하드차단: farmAddrRate < 30% AND 데이터 충분할 때
    const farmAddrRate = getFarmAddrRate();
    const hardBlock    = farmAddrRate !== null && farmAddrRate < 30;

    const config = { geo_message, geo_warn_color, geo_warn_count, hardBlock, group };

    console.log(`[AB_CONFIG] userId=...${userId.slice(-6)} group=${group} warnColor=${geo_warn_color} warnCount=${geo_warn_count} hardBlock=${hardBlock} farmAddrRate=${farmAddrRate ?? 'n/a'}`);
    return res.json({ ok: true, config });
});

// ─── POST /api/ab/event — A/B 실험 이벤트 수집 ─────────────────────
// 프론트에서 geo_soft_block / geo_soft_block_bypass 시 그룹 정보와 함께 기록
router.post('/event', (req, res) => {
    const { userId, event, group, meta } = req.body || {};
    if (!userId || !event) return res.status(400).json({ ok: false, error: 'userId, event 필요' });

    try {
        db.prepare(
            "INSERT INTO analytics (id, event, userId, jobId, meta, createdAt) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(
            'ab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            'ab_' + event,
            userId,
            null,
            JSON.stringify({ group, ...(meta || {}) }),
            new Date().toISOString(),
        );
        console.log(`[AB_EVENT] event=ab_${event} group=${group} userId=...${userId.slice(-6)}`);
        return res.json({ ok: true });
    } catch (e) {
        console.error('[AB_EVENT_ERROR]', e.message);
        return res.json({ ok: true }); // fail-safe
    }
});

module.exports = router;
