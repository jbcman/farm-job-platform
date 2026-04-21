'use strict';
const express = require('express');
const db      = require('../db');
const { findMatchingFarmers } = require('../services/matchingService');
const { sendWorkerMatchAlert } = require('../services/kakaoAlertService');

const router = express.Router();

function newUserId() {
    return 'user-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

// ─── POST /api/auth/login ─────────────────────────────────────
router.post('/login', (req, res) => {
    const { name, phone, role, jobType, locationText, notifyEnabled } = req.body;
    if (!name || !phone || !role) {
        return res.status(400).json({ ok: false, error: '이름, 전화번호, 역할은 필수예요.' });
    }
    if (!['farmer', 'worker'].includes(role)) {
        return res.status(400).json({ ok: false, error: "role은 'farmer' 또는 'worker'여야 해요." });
    }

    const notify = notifyEnabled === false ? 0 : 1; // 기본값 true
    const jt     = jobType     || null;
    const loc    = locationText || null;

    // 전화번호로 기존 사용자 조회
    let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);

    if (!user) {
        // 신규 생성
        const id = newUserId();
        db.prepare(`
            INSERT INTO users (id, name, phone, role, jobType, locationText, notifyEnabled, createdAt)
            VALUES (@id, @name, @phone, @role, @jobType, @locationText, @notifyEnabled, @createdAt)
        `).run({ id, name, phone, role, jobType: jt, locationText: loc, notifyEnabled: notify, createdAt: new Date().toISOString() });
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        console.log(`[AUTH] 신규: ${name}(${role}) jobType=${jt} loc=${loc} notify=${notify} id=${id}`);
    } else {
        // 기존 사용자: 관심 분야 정보 갱신 (명시적으로 넘어온 경우만)
        const updates = [];
        const vals    = [];
        if (jt  !== null) { updates.push('jobType = ?');       vals.push(jt); }
        if (loc !== null) { updates.push('locationText = ?');   vals.push(loc); }
        if (req.body.notifyEnabled !== undefined) {
            updates.push('notifyEnabled = ?'); vals.push(notify);
        }
        if (updates.length > 0) {
            vals.push(user.id);
            db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
            user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
        }
        console.log(`[AUTH] 로그인: ${user.name}(${user.role}) id=${user.id}`);
    }

    // Phase 2: 작업자가 관심 분야 등록 → 매칭 일 목록 알림 (fire-and-forget)
    if (role === 'worker' && jt && loc && notify) {
        setImmediate(async () => {
            try {
                const jobs = findMatchingFarmers({ jobType: jt, locationText: loc });
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
router.get('/me', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ ok: false, error: '로그인이 필요해요.' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ ok: false, error: '사용자를 찾을 수 없어요.' });

    return res.json({ ok: true, user });
});

module.exports = router;
