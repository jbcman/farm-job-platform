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
    const job = db.prepare('SELECT status, requesterId, selectedWorkerId FROM jobs WHERE id = ?').get(jobId);
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

    // PHASE 31: 참여자 확인 — 농민 또는 선택된 작업자만 후기 가능
    const isFarmer = job.requesterId === reviewerId;
    const selectedWorkerUser = job.selectedWorkerId
        ? db.prepare('SELECT userId FROM workers WHERE id = ?').get(job.selectedWorkerId)
        : null;
    const isWorker = selectedWorkerUser?.userId === reviewerId;

    if (!isFarmer && !isWorker) {
        return res.status(403).json({ ok: false, error: '이 작업에 참여한 사람만 후기를 남길 수 있어요.' });
    }

    // PHASE 31: 자기 자신 평가 방지
    const targetWorkerUser = db.prepare('SELECT userId FROM workers WHERE id = ?').get(targetId);
    if (targetWorkerUser?.userId === reviewerId) {
        return res.status(400).json({ ok: false, error: '자기 자신에게는 후기를 남길 수 없어요.' });
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

    // PHASE REVIEW_SYSTEM: workers + users 평점 동기화
    const avg = db.prepare(
        'SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews WHERE targetId = ?'
    ).get(targetId);
    if (avg?.avg != null) {
        const newRating = Math.round(avg.avg * 10) / 10;
        const newCount  = avg.cnt || 0;
        // workers.rating 업데이트
        db.prepare('UPDATE workers SET rating = ? WHERE id = ?').run(newRating, targetId);
        // users.rating / reviewCount 동기화 (workerId → userId 경유)
        const workerRow = db.prepare('SELECT userId FROM workers WHERE id = ?').get(targetId);
        if (workerRow?.userId) {
            db.prepare(
                'UPDATE users SET rating = ?, reviewCount = ? WHERE id = ?'
            ).run(newRating, newCount, workerRow.userId);
        }
        console.log(`[RATING_UPDATED] workerId=${targetId} newRating=${newRating} cnt=${newCount}`);
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
