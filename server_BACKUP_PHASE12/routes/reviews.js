'use strict';
const express = require('express');
const db      = require('../db');

const router = express.Router();

function newId() {
    return 'rev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

// ─── POST /api/reviews ────────────────────────────────────────
router.post('/', (req, res) => {
    const { jobId, rating, comment = '' } = req.body;
    const reviewerId = req.headers['x-user-id'] || req.body.reviewerId;

    if (!jobId || !reviewerId || !rating) {
        return res.status(400).json({ ok: false, error: 'jobId, rating이 필요해요.' });
    }
    if (rating < 1 || rating > 5) {
        return res.status(400).json({ ok: false, error: '별점은 1~5 사이여야 해요.' });
    }

    // 작업 상태 확인
    const job = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId);
    if (!job) return res.status(404).json({ ok: false, error: '작업을 찾을 수 없어요.' });
    if (job.status !== 'done') {
        return res.status(400).json({ ok: false, error: '완료된 작업에만 후기를 남길 수 있어요.' });
    }

    // targetId: contacts에서 workerId 자동 조회
    const contact = db.prepare('SELECT workerId FROM contacts WHERE jobId = ?').get(jobId);
    const targetId = req.body.targetId || contact?.workerId;
    if (!targetId) {
        return res.status(400).json({ ok: false, error: '대상 작업자를 찾을 수 없어요.' });
    }

    // 중복 후기 확인
    const already = db.prepare(
        'SELECT id FROM reviews WHERE jobId = ? AND reviewerId = ?'
    ).get(jobId, reviewerId);
    if (already) return res.status(409).json({ ok: false, error: '이미 후기를 남겼어요.' });

    const id = newId();
    const review = {
        id, jobId, reviewerId, targetId,
        rating: parseInt(rating),
        comment: comment.trim(),
        createdAt: new Date().toISOString(),
    };

    db.prepare(`
        INSERT INTO reviews (id, jobId, reviewerId, targetId, rating, comment, createdAt)
        VALUES (@id, @jobId, @reviewerId, @targetId, @rating, @comment, @createdAt)
    `).run(review);

    // 작업자 평균 별점 업데이트
    const avg = db.prepare(
        'SELECT AVG(rating) as avg FROM reviews WHERE targetId = ?'
    ).get(targetId);
    if (avg?.avg !== null) {
        const newRating = Math.round(avg.avg * 10) / 10;
        db.prepare('UPDATE workers SET rating = ? WHERE id = ?').run(newRating, targetId);
        console.log(`[RATING_UPDATED] workerId=${targetId} newRating=${newRating}`);
    }

    console.log(`[REVIEW_CREATED] jobId=${jobId} rating=${rating} by=${reviewerId}`);
    return res.status(201).json({ ok: true, review });
});

// ─── GET /api/reviews?userId=xx ───────────────────────────────
router.get('/', (req, res) => {
    const { userId, jobId } = req.query;

    let reviews;
    if (jobId) {
        reviews = db.prepare('SELECT * FROM reviews WHERE jobId = ? ORDER BY createdAt DESC').all(jobId);
    } else if (userId) {
        reviews = db.prepare(
            'SELECT * FROM reviews WHERE reviewerId = ? OR targetId = ? ORDER BY createdAt DESC'
        ).all(userId, userId);
    } else {
        return res.status(400).json({ ok: false, error: 'userId 또는 jobId가 필요해요.' });
    }

    return res.json({ ok: true, reviews });
});

module.exports = router;
