'use strict';
/**
 * upload.js — PHASE VISUAL_JOB_LITE
 *
 * POST /api/upload   multipart/form-data, field: 'file'
 * → 업로드 성공 시 { url: '/uploads/filename' } 반환
 *
 * multer: disk storage, uploads/ 디렉토리
 * 파일 크기 제한: 5MB / 이미지 타입만 허용
 */
const path   = require('path');
const fs     = require('fs');
const router = require('express').Router();
const multer = require('multer');

// uploads/ 디렉토리 없으면 생성
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename:    (_req, file,  cb) => {
        const ext  = path.extname(file.originalname).toLowerCase();
        const name = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
        cb(null, name);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) return cb(null, true);
        cb(new Error('이미지 파일만 업로드 가능합니다'));
    },
});

router.post('/', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '파일 없음' });
    res.json({ url: `/uploads/${req.file.filename}` });
});

// multer 에러 핸들러
router.use((err, _req, res, _next) => {
    res.status(400).json({ error: err.message || '업로드 실패' });
});

module.exports = router;
