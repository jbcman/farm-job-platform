'use strict';
/**
 * 농민 일손 플랫폼 — API 서버
 * 포트: process.env.PORT || 3002
 * 바인드: 0.0.0.0 (external access)
 */

// ─── 환경변수 로드 (최우선) ───────────────────────────────────────
const path = require('path');
const fs   = require('fs');
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    console.log(`[ENV] .env 로드 완료: ${envPath}`);
} else {
    console.log('[ENV] .env 없음 → 시스템 환경변수 사용');
}

const express         = require('express');
const cors            = require('cors');
const jobRoutes       = require('./routes/jobs');
const workerRoutes    = require('./routes/workers');
const authRoutes      = require('./routes/auth');
const contactRoutes   = require('./routes/contacts');
const messageRoutes   = require('./routes/messages');
const reviewRoutes    = require('./routes/reviews');
const reportRoutes    = require('./routes/reports');
const analyticsRoutes = require('./routes/analytics');
const diagnosticsRoute = require('./routes/diagnostics');
const testRoute       = require('./routes/test');
const adminRoutes     = require('./routes/admin');
const { seed }        = require('./seed');

const app  = express();
const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || '0.0.0.0';

// ─── CORS ─────────────────────────────────────────────────────────
const corsOriginEnv = process.env.CORS_ORIGIN || '*';
app.use(cors({
    origin: (origin, cb) => {
        if (corsOriginEnv === '*' || !origin) return cb(null, true);
        const allowed = corsOriginEnv.split(',').map(s => s.trim());
        return cb(null, allowed.includes(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'x-user-id', 'Authorization'],
    credentials: false,
}));

app.use(express.json({ limit: '5mb' }));

// ─── 요청 로그 ────────────────────────────────────────────────────
app.use((req, _res, next) => {
    if (req.path !== '/api/health') {
        console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${req.method} ${req.path}`);
    }
    next();
});

// ─── 정적 파일 (production build) ─────────────────────────────────
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath, { maxAge: '1h', etag: true }));
    console.log(`[STATIC] Serving frontend from ${distPath}`);
}

// ─── 헬스체크 ─────────────────────────────────────────────────────
app.get('/api/health', (_req, res) =>
    res.json({
        server:    'ok',
        timestamp: new Date().toISOString(),
        port:      PORT,
        kakao:     process.env.USE_KAKAO === 'true' ? 'real' : 'mock',
    })
);

// ─── API 라우트 ──────────────────────────────────────────────────
app.use('/api/jobs',        jobRoutes);
app.use('/api/workers',     workerRoutes);
app.use('/api/auth',        authRoutes);
app.use('/api/contacts',    contactRoutes);
app.use('/api/messages',    messageRoutes);
app.use('/api/reviews',     reviewRoutes);
app.use('/api/reports',     reportRoutes);
app.use('/api/analytics',   analyticsRoutes);
app.use('/api/diagnostics', diagnosticsRoute);
app.use('/api/test',        testRoute);
app.use('/api/admin',       adminRoutes);

// ─── SPA 폴백 ────────────────────────────────────────────────────
const indexHtml = path.join(distPath, 'index.html');
if (fs.existsSync(indexHtml)) {
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(indexHtml));
}

// ─── API 404 ──────────────────────────────────────────────────────
app.use((req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ ok: false, error: '없는 경로예요.' });
    }
    res.status(404).send('Frontend not built. Run: npm run build');
});

// ─── 에러 핸들러 ──────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error('[SERVER_ERROR]', err.message);
    res.status(500).json({ ok: false, error: '서버 오류가 생겼어요.' });
});

// ─── 시드 데이터 ──────────────────────────────────────────────────
if (process.env.USE_SEED_DATA !== 'false') {
    seed();
}

// ─── 서버 시작 ────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
    const localIp = getLocalIp();
    const kakaoMode = process.env.USE_KAKAO === 'true' ? 'REAL 🔴' : 'MOCK 🟡';
    const testMode  = process.env.KAKAO_TEST_MODE === 'true' ? 'ON' : 'OFF';
    console.log(`
┌──────────────────────────────────────────────────┐
│  🌾 농민 일손 플랫폼 서버 시작                    │
│                                                  │
│  로컬:     http://localhost:${PORT}                  │
│  네트워크:  http://${localIp}:${PORT}             │
│                                                  │
│  📱 모바일:  같은 Wi-Fi 접속 후 네트워크 URL 사용  │
│  🌐 외부:   ngrok http ${PORT}                      │
└──────────────────────────────────────────────────┘
──────────────────────────────────────────
📨 Kakao AlimTalk Status
   Mode      : ${kakaoMode}
   Test Mode : ${testMode}
   Test URL  : GET /api/test/alarm
──────────────────────────────────────────
    `.trim());
});

function getLocalIp() {
    try {
        const { networkInterfaces } = require('os');
        const nets = networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                if (net.family === 'IPv4' && !net.internal) return net.address;
            }
        }
    } catch (_) {}
    return '0.0.0.0';
}
