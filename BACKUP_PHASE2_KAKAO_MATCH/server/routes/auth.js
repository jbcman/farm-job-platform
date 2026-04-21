'use strict';
const express = require('express');
const db      = require('../db');

const router = express.Router();

function newUserId() {
    return 'user-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

// ─── POST /api/auth/login ─────────────────────────────────────
router.post('/login', (req, res) => {
    const { name, phone, role } = req.body;
    if (!name || !phone || !role) {
        return res.status(400).json({ ok: false, error: '이름, 전화번호, 역할은 필수예요.' });
    }
    if (!['farmer', 'worker'].includes(role)) {
        return res.status(400).json({ ok: false, error: "role은 'farmer' 또는 'worker'여야 해요." });
    }

    // 전화번호로 기존 사용자 조회
    let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);

    if (!user) {
        // 신규 생성
        const id = newUserId();
        db.prepare(`
            INSERT INTO users (id, name, phone, role, createdAt)
            VALUES (@id, @name, @phone, @role, @createdAt)
        `).run({ id, name, phone, role, createdAt: new Date().toISOString() });
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        console.log(`[AUTH] 신규: ${name}(${role}) id=${id}`);
    } else {
        console.log(`[AUTH] 로그인: ${user.name}(${user.role}) id=${user.id}`);
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
