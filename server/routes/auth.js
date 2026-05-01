'use strict';
const express = require('express');
const db      = require('../db');
const { findMatchingFarmers } = require('../services/matchingService');
const { sendWorkerMatchAlert } = require('../services/kakaoAlertService');

const router = express.Router();

function newUserId() {
    return 'user-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

/** PHASE GROWTH: 중복 없는 추천 코드 생성 */
async function genReferralCode() {
    let code, attempts = 0;
    do {
        code = Math.random().toString(36).slice(2, 8).toUpperCase();
        attempts++;
        const existing = await db.prepare('SELECT id FROM users WHERE referralCode = ?').get(code);
        if (!existing) break;
    } while (attempts < 20);
    return code;
}

/**
 * PHASE SCALE+: A/B 그룹 1회 배정 (이미 있으면 유지)
 * A = 완전 무료 체험 (효과 검증 그룹)
 * B = 3,000원 결제 그룹 (Toss 연동)
 * C = 효과 후 결제 (관리자 후속 수금)
 */
async function assignABGroup(userId) {
    const r = Math.random();
    const group = r < 0.334 ? 'A' : r < 0.667 ? 'B' : 'C';
    await db.prepare('UPDATE users SET abGroup = ? WHERE id = ?').run(group, userId);
    return group;
}

// ─── POST /api/auth/login ─────────────────────────────────────
router.post('/login', async (req, res) => {
    const { name, phone, role, jobType, locationText, notifyEnabled, lat, lng } = req.body;
    if (!name || !phone || !role) {
        return res.status(400).json({ ok: false, error: '이름, 전화번호, 역할은 필수예요.' });
    }
    if (!['farmer', 'worker'].includes(role)) {
        return res.status(400).json({ ok: false, error: "role은 'farmer' 또는 'worker'여야 해요." });
    }

    const notify  = notifyEnabled === false ? 0 : 1;
    const jt      = jobType      || null;
    const loc     = locationText || null;
    const userLat = (lat != null && !isNaN(parseFloat(lat))) ? parseFloat(lat) : null;
    const userLng = (lng != null && !isNaN(parseFloat(lng))) ? parseFloat(lng) : null;

    // 전화번호로 기존 사용자 조회
    let user = await db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);

    if (!user) {
        // 신규 생성
        const id = newUserId();
        await db.prepare(`
            INSERT INTO users (id, name, phone, role, jobType, locationText, notifyEnabled, lat, lng, createdAt)
            VALUES (@id, @name, @phone, @role, @jobType, @locationText, @notifyEnabled, @lat, @lng, @createdAt)
        `).run({ id, name, phone, role, jobType: jt, locationText: loc, notifyEnabled: notify, lat: userLat, lng: userLng, createdAt: new Date().toISOString() });
        user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        // PHASE GROWTH: 신규 가입 시 추천 코드 자동 발급
        try {
            const code = await genReferralCode();
            await db.prepare('UPDATE users SET referralCode = ? WHERE id = ?').run(code, id);
            user = { ...user, referralCode: code };
        } catch (_) {}
        // PHASE SCALE+: A/B 그룹 자동 배정 (신규 가입 시)
        try {
            const abGroup = await assignABGroup(id);
            user = { ...user, abGroup };
            console.log(`[AB_GROUP] userId=${id} group=${abGroup}`);
        } catch (_) {}
        console.log(`[AUTH] 신규: ${name}(${role}) jobType=${jt} loc=${loc} gps=${userLat ? userLat+','+userLng : 'none'} id=${id}`);
    } else {
        // 기존 사용자: 명시적으로 넘어온 값만 갱신
        const updates = [];
        const vals    = [];
        if (jt       !== null) { updates.push('jobType = ?');      vals.push(jt); }
        if (loc      !== null) { updates.push('locationText = ?');  vals.push(loc); }
        if (userLat  !== null) { updates.push('lat = ?');           vals.push(userLat); }
        if (userLng  !== null) { updates.push('lng = ?');           vals.push(userLng); }
        if (req.body.notifyEnabled !== undefined) {
            updates.push('notifyEnabled = ?'); vals.push(notify);
        }
        if (updates.length > 0) {
            vals.push(user.id);
            await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
            user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
        }
        console.log(`[AUTH] 로그인: ${user.name}(${user.role}) gps=${userLat ? userLat+','+userLng : 'none'} id=${user.id}`);

        // PHASE SCALE+: 기존 유저 중 abGroup 없는 경우 배정
        if (!user.abGroup) {
            try {
                const abGroup = await assignABGroup(user.id);
                user = { ...user, abGroup };
                console.log(`[AB_GROUP_ASSIGN_EXISTING] userId=${user.id} group=${abGroup}`);
            } catch (_) {}
        }
    }

    // Phase 2: 작업자가 관심 분야 등록 → 매칭 일 목록 알림 (fire-and-forget)
    if (role === 'worker' && jt && loc && notify) {
        setImmediate(async () => {
            try {
                const jobs = await findMatchingFarmers({ jobType: jt, locationText: loc });
                console.log(`[WORKER_MATCH] ${name} jobType=${jt} loc=${loc} => ${jobs.length}건 매칭`);
                for (const j of jobs.slice(0, 3)) { // 최대 3건만 알림
                    await sendWorkerMatchAlert({
                        jobId:        j.id,
                        phone:        phone,
                        name,
                        jobType:      j.category,
                        locationText: j.locationText,
                    });
                }
            } catch (e) {
                console.error('[WORKER_MATCH_ERROR]', e.message);
            }
        });
    }

    return res.json({ ok: true, user });
});

// ─── GET /api/auth/me ─────────────────────────────────────────
router.get('/me', async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ ok: false, error: '로그인이 필요해요.' });

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ ok: false, error: '사용자를 찾을 수 없어요.' });

    return res.json({ ok: true, user });
});

module.exports = router;
