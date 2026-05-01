'use strict';
/**
 * 농민 일손 플랫폼 — API 서버
 * 포트: process.env.PORT || 3002
 * 바인드: 0.0.0.0 (external access)
 */

// ─── 프로세스 전역 에러 핸들러 (최우선 등록) ─────────────────────
process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException:', err.message);
    console.error(err.stack);
    // 치명적 오류: 프로세스 종료 (Render가 자동 재시작)
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error('[PROMISE_ERROR] unhandledRejection:', msg);
    // 비치명적: 로그만 남기고 서비스 유지
});

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
const adminRoutes          = require('./routes/admin');
const behaviorRoutes       = require('./routes/behavior');
const adminMonetizationRoutes = require('./routes/adminMonetization');
const uploadRoutes            = require('./routes/upload');
const feedbackRoutes          = require('./routes/feedback');
const referralRoutes          = require('./routes/referral');
const payRoutes               = require('./routes/pay');
const adminLogsRoutes         = require('./routes/adminLogs');
const adminStreamRoutes       = require('./routes/adminStream');
const adminSystemRoutes       = require('./routes/adminSystem');
const phoneRoutes             = require('./routes/phone');
const abRoutes                = require('./routes/ab');
const testLogRoutes           = require('./routes/testLog');
const { seed }                      = require('./seed');
const { initWS }                    = require('./ws');
const { recoverDepartureReminders } = require('./services/reminderRecovery');
const { scheduleBehaviorCleanup }   = require('./services/behaviorCleanup');
const { runAutoWinner }             = require('./services/autoWinnerService');
const { detect }                    = require('./services/anomalyDetector');
const { tryRecover }                = require('./services/safeModeRecovery');
const { tuneWeights }               = require('./services/weightTuner');
const monitor                       = require('./middleware/monitor');

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
app.use(express.urlencoded({ extended: true })); // MAP_CORE: form-encoded body 방어

// ─── 요청 모니터링 (슬로우 API / 5xx 감지) ──────────────────────
app.use(monitor);

// ─── 업로드 파일 정적 서빙 (VISUAL_JOB_LITE) ─────────────────────
const uploadsPath = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true });
app.use('/uploads', express.static(uploadsPath, { maxAge: '7d' }));

// ─── 정적 파일 (production build) ─────────────────────────────────
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath, { maxAge: '1h', etag: true }));
    console.log(`[STATIC] Serving frontend from ${distPath}`);
}

// ─── 헬스체크 (DB 상태 포함) ─────────────────────────────────────
const db = require('./db');
app.get('/api/health', async (_req, res) => {
    const t0 = Date.now();
    let dbStatus = 'unknown';
    let dbMode   = db.mode;
    try {
        if (dbMode === 'POSTGRES') {
            await db.q('SELECT 1');
        } else {
            await db.prepare('SELECT 1').get();
        }
        dbStatus = 'up';
    } catch (e) {
        dbStatus = 'down';
        console.error('[HEALTH] DB 응답 없음:', e.message);
    }
    const httpStatus = dbStatus === 'down' ? 503 : 200;
    res.status(httpStatus).json({
        server:    'ok',
        db:        dbStatus,
        dbMode:    dbMode,
        timestamp: new Date().toISOString(),
        uptimeSec: Math.floor(process.uptime()),
        responseMs: Date.now() - t0,
        kakao:     process.env.USE_KAKAO === 'true' ? 'real' : 'mock',
    });
});

// ─── GET /api/geocode — 주소 → 좌표 변환 (JobRequestPage 농지 주소 입력용) ──
// farmAddress 입력 후 "위치 찾기" 버튼이 이 엔드포인트를 호출함
const { geocodeAddress, reverseGeocodeAddress } = require('./services/geocodeService');
app.get('/api/geocode', async (req, res) => {
    const { address } = req.query;
    if (!address || !address.trim()) {
        return res.status(400).json({ ok: false, error: '주소가 필요해요.' });
    }
    // GEO_QUALITY: 8자 미만 = 도시/군 단위 → 정확도 낮음 → 차단
    if (address.trim().length < 8) {
        return res.status(400).json({
            ok: false,
            error: `"${address.trim()}" 주소가 너무 짧아요. 읍·면·리·동까지 입력해주세요. 예) 경기 화성시 서신면 홍법리`,
        });
    }
    try {
        const result = await geocodeAddress(address.trim());
        if (!result) {
            console.warn(`[GEOCODE_API_MISS] "${address}"`);
            return res.status(404).json({ ok: false, error: `"${address.trim()}" 위치를 찾을 수 없어요. 시·군·읍·면·리 형식으로 더 구체적으로 입력해주세요.` });
        }
        console.log(`[GEOCODE_API_OK] "${address}" → (${result.lat}, ${result.lng}) normalized=${result.normalized} precision=${result.precision}`);
        return res.json({
            ok:           true,
            lat:          result.lat,
            lng:          result.lng,
            normalized:   result.normalized   ?? false,
            precision:    result.precision    ?? 'full',
            roadAddress:  result.roadAddress  || null,
            jibunAddress: result.jibunAddress || null,
        });
    } catch (e) {
        console.error('[GEOCODE_API_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '위치 검색 중 오류가 발생했어요.' });
    }
});

// ─── GET /api/reverse-geocode — 좌표 → 주소 변환 ────────────────
app.get('/api/reverse-geocode', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ ok: false, error: 'lat, lng 숫자 필요' });
    }
    try {
        const result = await reverseGeocodeAddress(lat, lng);
        if (!result) return res.json({ ok: true, roadAddress: null, jibunAddress: null });
        console.log(`[REVERSE_GEOCODE_API] (${lat.toFixed(4)},${lng.toFixed(4)}) → road=${result.roadAddress}`);
        return res.json({ ok: true, roadAddress: result.roadAddress, jibunAddress: result.jibunAddress });
    } catch (e) {
        console.error('[REVERSE_GEOCODE_API_ERROR]', e.message);
        return res.status(500).json({ ok: false, error: '주소 변환 중 오류가 발생했어요.' });
    }
});

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
app.use('/api/behavior',                behaviorRoutes);
app.use('/api/admin/monetization',      adminMonetizationRoutes);
app.use('/api/upload',                  uploadRoutes);
app.use('/api/feedback',                feedbackRoutes);
app.use('/api/referral',                referralRoutes);
app.use('/api/pay',                     payRoutes);
app.use('/api/admin/logs',              adminLogsRoutes);
app.use('/api/admin/stream',            adminStreamRoutes);
app.use('/api/admin/system',            adminSystemRoutes);
app.use('/api/phone',                   phoneRoutes);
app.use('/api/ab',                      abRoutes);
app.use('/api/test-log',               testLogRoutes);

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
    seed().catch(e => console.error('[SEED_FAIL]', e.message));
}

// ─── PHASE 32: 재시작 후 출발 독촉 타이머 복구 ──────────────────────
// 서버가 꺼져 있는 동안 in_progress였던 작업들의 10분 타이머를 복구
setImmediate(() => recoverDepartureReminders().catch(e => console.error('[REMINDER_RECOVERY_FAIL]', e.message)));

// ─── PERSONALIZATION: 행동 로그 자동 정리 (30일/사용자당 100개 캡) ──
scheduleBehaviorCleanup();

// ─── AUTO_WINNER: 10분마다 승자 자동 판정 ───────────────────────
setInterval(async () => {
    try { await runAutoWinner(); } catch (e) { console.error('[AUTO_WINNER_FAIL]', e.message); }
}, 10 * 60 * 1000);

// ─── SAFE_MODE: 이상 감지 (10분) + 자동 복구 시도 (1분) ─────────
setInterval(async () => { try { await detect();     } catch (_) {} }, 10 * 60 * 1000);
setInterval(async () => { try { await tryRecover(); } catch (_) {} },      60 * 1000);

// ─── AI 가중치 자동 튜닝 (24시간마다) ────────────────────────────
// match_logs Top-1 선택률 기반으로 거리/평점 가중치 자동 조정
// 최소 20건 미달 시 스킵, 결과는 server/model_weights.json 에 저장
setInterval(async () => {
    try {
        const result = await tuneWeights();
        if (result.action !== 'no_change' && result.action !== 'insufficient_data') {
            console.log(`[WEIGHT_TUNER] 자동 튜닝 완료: top1=${result.top1Rate}% action=${result.action}`);
        }
    } catch (e) { console.error('[WEIGHT_TUNER_FAIL]', e.message); }
}, 24 * 60 * 60 * 1000); // 24시간

// ─── 서버 시작 (WebSocket 공유) ──────────────────────────────────
const http   = require('http');
const server = http.createServer(app);
initWS(server);   // global.broadcast 등록

server.listen(PORT, HOST, () => {
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
