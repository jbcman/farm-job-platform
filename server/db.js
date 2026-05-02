'use strict';
/**
 * db.js — 완전 자동 이중 안전 모드 (Full Auto Dual-Safe)
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │  DATABASE_URL 없음  →  SQLite (즉시)                      │
 * │  DATABASE_URL 있음  →  PG 연결 테스트                     │
 * │    ├─ 성공  → PostgreSQL 전환                             │
 * │    └─ 실패  → SQLite fallback (서비스 무중단 유지)         │
 * └──────────────────────────────────────────────────────────┘
 *
 * 핵심:
 *   · 모듈 로딩은 즉시(동기) — 서버 시작에 영향 없음
 *   · PG 연결 테스트는 백그라운드 비동기 (5초 timeout)
 *   · 연결 전까지 모든 요청은 SQLite로 안전하게 처리
 *   · PG 연결 성공 시 자동 전환 + [DB MODE] 로그 출력
 *
 * 인터페이스 (모드 무관 동일):
 *   db.prepare(sql).get/all/run(...args)  → Promise
 *   db.transaction(fn)()                  → Promise
 *   db.exec(sql)                          → Promise
 *   db.mode                               → 'SQLITE' | 'POSTGRES'
 */

const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

// ══════════════════════════════════════════════════════════════════
//  공통 상수
// ══════════════════════════════════════════════════════════════════
const RE_INSERT_OR_IGNORE = /INSERT\s+OR\s+IGNORE\s+INTO/gi;
const RE_DATETIME_NOW     = /datetime\s*\(\s*['"]now['"]\s*(?:,\s*[^)]+)?\)/gi;
const RE_AUTOINCREMENT    = /INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi;

// ══════════════════════════════════════════════════════════════════
//  SQLite 어댑터 (항상 초기화 — safe default)
// ══════════════════════════════════════════════════════════════════
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'farm.db');
const Database = require('better-sqlite3');
const sqlite   = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// ── SQLite 스키마 초기화 ─────────────────────────────────────────
sqlite.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, requesterId TEXT NOT NULL,
        requesterName TEXT NOT NULL DEFAULT '농민', category TEXT NOT NULL,
        locationText TEXT NOT NULL, latitude REAL DEFAULT 37.5,
        longitude REAL DEFAULT 127.0, date TEXT NOT NULL,
        timeSlot TEXT DEFAULT '협의', areaSize INTEGER,
        areaUnit TEXT DEFAULT '평', pay TEXT, note TEXT DEFAULT '',
        imageUrl TEXT, isUrgent INTEGER DEFAULT 0,
        status TEXT DEFAULT 'open', createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL,
        phone TEXT NOT NULL, baseLocationText TEXT NOT NULL,
        latitude REAL, longitude REAL, serviceRadiusKm INTEGER DEFAULT 30,
        categories TEXT NOT NULL DEFAULT '[]', hasTractor INTEGER DEFAULT 0,
        hasSprayer INTEGER DEFAULT 0, hasRotary INTEGER DEFAULT 0,
        completedJobs INTEGER DEFAULT 0, rating REAL DEFAULT 4.5,
        availableTimeText TEXT DEFAULT '협의'
    );
    CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY, jobRequestId TEXT NOT NULL,
        workerId TEXT NOT NULL, message TEXT DEFAULT '',
        status TEXT DEFAULT 'applied', createdAt TEXT NOT NULL,
        UNIQUE(jobRequestId, workerId)
    );
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'farmer', createdAt TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY, jobId TEXT NOT NULL, farmerId TEXT NOT NULL,
        workerId TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(jobId, workerId)
    );
    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, jobId TEXT NOT NULL, senderId TEXT NOT NULL,
        text TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY, jobId TEXT NOT NULL, reviewerId TEXT NOT NULL,
        targetId TEXT NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
        comment TEXT DEFAULT '', createdAt TEXT NOT NULL, UNIQUE(jobId, reviewerId)
    );
    CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY, jobId TEXT NOT NULL, reporterId TEXT NOT NULL,
        reason TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analytics (
        id TEXT PRIMARY KEY, event TEXT NOT NULL, jobId TEXT, userId TEXT,
        meta TEXT DEFAULT '{}', createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics(event);
    CREATE TABLE IF NOT EXISTS notify_log (
        id TEXT PRIMARY KEY, jobId TEXT NOT NULL, phone TEXT NOT NULL,
        type TEXT NOT NULL, sentAt TEXT NOT NULL, UNIQUE(jobId, phone, type)
    );
    CREATE TABLE IF NOT EXISTS status_logs (
        id TEXT PRIMARY KEY, jobId TEXT NOT NULL, fromStatus TEXT NOT NULL,
        toStatus TEXT NOT NULL, byUserId TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_status_logs_job ON status_logs(jobId, createdAt DESC);
    CREATE TABLE IF NOT EXISTS user_behavior (
        id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL,
        jobId TEXT NOT NULL, action TEXT NOT NULL, jobType TEXT,
        lat REAL, lng REAL, createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_behavior_user_time ON user_behavior(userId, createdAt DESC);
    CREATE TABLE IF NOT EXISTS sponsored_jobs (
        jobId TEXT NOT NULL PRIMARY KEY, boost INTEGER NOT NULL DEFAULT 20, expiresAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
        userId TEXT NOT NULL PRIMARY KEY, tier TEXT NOT NULL DEFAULT 'free',
        priorityBoost INTEGER NOT NULL DEFAULT 10, expiresAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rl_qtable (
        state TEXT NOT NULL, action TEXT NOT NULL, q REAL NOT NULL DEFAULT 0,
        updatedAt INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (state, action)
    );
    CREATE TABLE IF NOT EXISTS bandit_arms (
        experimentId TEXT NOT NULL, variantKey TEXT NOT NULL,
        impressions INTEGER NOT NULL DEFAULT 0, applies INTEGER NOT NULL DEFAULT 0,
        updatedAt INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (experimentId, variantKey)
    );
    CREATE TABLE IF NOT EXISTS bandit_context_arms (
        experimentId TEXT NOT NULL, variantKey TEXT NOT NULL,
        timeBucket INTEGER NOT NULL, regionBucket TEXT NOT NULL,
        impressions INTEGER NOT NULL DEFAULT 0, applies INTEGER NOT NULL DEFAULT 0,
        updatedAt INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (experimentId, variantKey, timeBucket, regionBucket)
    );
    CREATE TABLE IF NOT EXISTS experiment_results (
        experimentId TEXT NOT NULL, winnerVariant TEXT NOT NULL,
        decidedAt INTEGER NOT NULL, PRIMARY KEY (experimentId)
    );
    CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY, variants TEXT NOT NULL,
        isActive INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS experiment_assignments (
        userId TEXT NOT NULL, experimentId TEXT NOT NULL, variantKey TEXT NOT NULL,
        assignedAt INTEGER NOT NULL, PRIMARY KEY (userId, experimentId)
    );
    CREATE TABLE IF NOT EXISTS experiment_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL,
        experimentId TEXT NOT NULL, variantKey TEXT NOT NULL,
        eventType TEXT NOT NULL, jobId TEXT, createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_exp_events
        ON experiment_events(experimentId, variantKey, eventType);
    CREATE TABLE IF NOT EXISTS job_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT, jobId TEXT NOT NULL,
        workerId TEXT NOT NULL, rating INTEGER, actualDifficulty REAL,
        durationMin INTEGER, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rec_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, jobId TEXT, workerId TEXT,
        variantKey TEXT, score REAL, distKm REAL, difficulty REAL,
        jobType TEXT, autoJobType TEXT, createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rec_logs_time ON rec_logs(createdAt DESC);
    CREATE TABLE IF NOT EXISTS system_flags (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS anomaly_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ctr REAL, applyRate REAL, ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_anomaly_ts ON anomaly_snapshots(ts DESC);
    CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL,
        jobId TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ready',
        provider TEXT NOT NULL DEFAULT 'toss', orderId TEXT NOT NULL UNIQUE,
        paymentKey TEXT, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS match_logs (
        id TEXT PRIMARY KEY, jobId TEXT NOT NULL, workerId TEXT NOT NULL,
        rank INTEGER NOT NULL, predictedScore REAL NOT NULL,
        recommentScore INTEGER, selected INTEGER NOT NULL DEFAULT 0,
        viewed INTEGER NOT NULL DEFAULT 0, clicked INTEGER NOT NULL DEFAULT 0,
        selectedAt TEXT, createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_match_logs_job ON match_logs(jobId, createdAt DESC);
`);

const _ac = sql => { try { sqlite.exec(sql); } catch (_) {} };
[
    "ALTER TABLE jobs ADD COLUMN pay TEXT",
    "ALTER TABLE users ADD COLUMN jobType TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN locationText TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN notifyEnabled INTEGER DEFAULT 1",
    "ALTER TABLE users ADD COLUMN lat REAL DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN lng REAL DEFAULT NULL",
    "ALTER TABLE jobs ADD COLUMN contactRevealed INTEGER DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN selectedWorkerId TEXT DEFAULT NULL",
    "ALTER TABLE jobs ADD COLUMN selectedAt TEXT DEFAULT NULL",
    "ALTER TABLE jobs ADD COLUMN closedAt TEXT DEFAULT NULL",
    "ALTER TABLE workers ADD COLUMN notifyEnabled INTEGER DEFAULT 1",
    "ALTER TABLE applications ADD COLUMN completedAt TEXT DEFAULT NULL",
    "ALTER TABLE jobs ADD COLUMN areaPyeong INTEGER DEFAULT NULL",
    "ALTER TABLE jobs ADD COLUMN farmImages TEXT DEFAULT NULL",
    "ALTER TABLE jobs ADD COLUMN autoSelected INTEGER DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN startedAt TEXT DEFAULT NULL",
    "ALTER TABLE jobs ADD COLUMN departureReminderSent INTEGER DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN farmAddress TEXT DEFAULT NULL",
    "ALTER TABLE jobs ADD COLUMN difficulty REAL DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN isUrgentPaid INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN abGroup TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN urgentTrialUsed INTEGER DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN payStatus TEXT DEFAULT 'none'",
    "ALTER TABLE jobs ADD COLUMN payMethod TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN preferredDifficulty REAL DEFAULT 0.5",
    "ALTER TABLE workers ADD COLUMN preferredDifficulty REAL DEFAULT 0.5",
    "ALTER TABLE jobs ADD COLUMN autoJobType TEXT DEFAULT NULL",
    "ALTER TABLE jobs ADD COLUMN tags TEXT DEFAULT NULL",
    "ALTER TABLE workers ADD COLUMN currentLat REAL DEFAULT NULL",
    "ALTER TABLE workers ADD COLUMN currentLng REAL DEFAULT NULL",
    "ALTER TABLE workers ADD COLUMN locationUpdatedAt TEXT DEFAULT NULL",
    "ALTER TABLE workers ADD COLUMN successRate REAL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN completedJobs INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN successRate REAL DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN paymentStatus TEXT DEFAULT 'pending'",
    "ALTER TABLE jobs ADD COLUMN paymentId TEXT DEFAULT NULL",
    "ALTER TABLE jobs ADD COLUMN fee INTEGER DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN netAmount INTEGER DEFAULT 0",
    "ALTER TABLE reviews ADD COLUMN tags TEXT DEFAULT NULL",
    "ALTER TABLE reviews ADD COLUMN isPublic INTEGER DEFAULT 0",
    "ALTER TABLE workers ADD COLUMN noshowCount INTEGER DEFAULT 0",
    "ALTER TABLE reviews ADD COLUMN reviewerRole TEXT DEFAULT NULL",
    "ALTER TABLE workers ADD COLUMN ratingAvg REAL DEFAULT NULL",
    "ALTER TABLE workers ADD COLUMN ratingCount INTEGER DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN cropType TEXT DEFAULT NULL",
    "ALTER TABLE jobs ADD COLUMN autoAssign INTEGER DEFAULT 0",
    "ALTER TABLE workers ADD COLUMN skillTags TEXT DEFAULT NULL",
    "ALTER TABLE workers ADD COLUMN preferredTime TEXT DEFAULT NULL",
    "ALTER TABLE workers ADD COLUMN activeNow INTEGER DEFAULT 0",
    "ALTER TABLE notify_log ADD COLUMN userId TEXT DEFAULT NULL",
    "ALTER TABLE notify_log ADD COLUMN message TEXT DEFAULT ''",
    "ALTER TABLE notify_log ADD COLUMN createdAt TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN rating REAL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN reviewCount INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN referralCode TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN referredBy TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN referralCount INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN referralRewarded INTEGER DEFAULT 0",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral ON users(referralCode) WHERE referralCode IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_applications_job_created ON applications(jobRequestId, createdAt)",
    "CREATE INDEX IF NOT EXISTS idx_notify_log_user ON notify_log(userId, createdAt DESC)",
    "INSERT OR IGNORE INTO system_flags (key,value,updatedAt) VALUES ('SAFE_MODE','0'," + Date.now() + ")",
].forEach(_ac);
try { sqlite.prepare("UPDATE jobs SET latitude=NULL,longitude=NULL WHERE latitude=37.5 AND longitude=127.0").run(); } catch(_){}

// ── SQLite SQL 변환 ───────────────────────────────────────────────
function toSQLite(sql) {
    return sql
        .replace(/\$\d+/g, '?')
        .replace(/::numeric|::text|::int|::float|::boolean|::bigint/gi, '')
        .replace(/BIGSERIAL\s+PRIMARY\s+KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
}
function prepareArgsSQLite(rawSql, args) {
    let sql = rawSql
        .replace(RE_DATETIME_NOW, "datetime('now')")
        .replace(RE_AUTOINCREMENT, 'INTEGER PRIMARY KEY AUTOINCREMENT');
    sql = toSQLite(sql);
    let values;
    if (rawSql.includes('@')) {
        const obj = (args.length === 1 && args[0] && typeof args[0] === 'object') ? args[0] : {};
        const keys = [];
        sql    = sql.replace(/@(\w+)/g, (_, k) => { keys.push(k); return '?'; });
        values = keys.map(k => obj[k] !== undefined ? obj[k] : null);
    } else {
        values = args.flat();
    }
    return { sql, values };
}

// ── SQLite 어댑터 객체 ────────────────────────────────────────────
const sqliteAdapter = {
    mode: 'SQLITE',
    prepare(rawSql) {
        return {
            get:  (...a) => { try { const {sql,values}=prepareArgsSQLite(rawSql,a); return Promise.resolve(sqlite.prepare(sql).get(...values)??null); } catch(e){return Promise.reject(e);} },
            all:  (...a) => { try { const {sql,values}=prepareArgsSQLite(rawSql,a); return Promise.resolve(sqlite.prepare(sql).all(...values)??[]); }  catch(e){return Promise.reject(e);} },
            run:  (...a) => { try { const {sql,values}=prepareArgsSQLite(rawSql,a); const r=sqlite.prepare(sql).run(...values); return Promise.resolve({changes:r.changes,lastInsertRowid:r.lastInsertRowid}); } catch(e){return Promise.reject(e);} },
        };
    },
    transaction(fn) {
        return async (...args) => {
            sqlite.prepare('BEGIN').run();
            try   { const r = await fn(...args); sqlite.prepare('COMMIT').run();   return r; }
            catch (e) { try { sqlite.prepare('ROLLBACK').run(); } catch(_){} throw e; }
        };
    },
    exec(sql)         { try { sqlite.exec(toSQLite(sql)); return Promise.resolve(); } catch(e) { return Promise.reject(e); } },
    q(sql, params=[]) { try { const rows=sqlite.prepare(toSQLite(sql)).all(...params); return Promise.resolve({rows,rowCount:rows.length}); } catch(e){ return Promise.reject(e); } },
};

// ══════════════════════════════════════════════════════════════════
//  PostgreSQL 어댑터 팩토리
// ══════════════════════════════════════════════════════════════════
function buildPgAdapter(pool) {
    const txStorage = new AsyncLocalStorage();
    const getExec   = () => txStorage.getStore() || pool;

    const COL_MAP = {
        requesterid:'requesterId', requestername:'requesterName',
        locationtext:'locationText', timeslot:'timeSlot',
        areasize:'areaSize', areaunit:'areaUnit', imageurl:'imageUrl',
        isurgent:'isUrgent', createdat:'createdAt',
        contactrevealed:'contactRevealed', selectedworkerid:'selectedWorkerId',
        selectedat:'selectedAt', closedat:'closedAt',
        autoselected:'autoSelected', startedat:'startedAt',
        departureremindersent:'departureReminderSent', farmaddress:'farmAddress',
        isurgentpaid:'isUrgentPaid', areapyeong:'areaPyeong',
        farmimages:'farmImages', autojobtype:'autoJobType',
        croptype:'cropType', autoassign:'autoAssign',
        paystatus:'payStatus', paymethod:'payMethod',
        paymentstatus:'paymentStatus', paymentid:'paymentId', netamount:'netAmount',
        userid:'userId', baselocationtext:'baseLocationText',
        serviceradiuskm:'serviceRadiusKm', hastractor:'hasTractor',
        hassprayer:'hasSprayer', hasrotary:'hasRotary',
        completedjobs:'completedJobs', availabletimetext:'availableTimeText',
        notifyenabled:'notifyEnabled', currentlat:'currentLat',
        currentlng:'currentLng', locationupdatedat:'locationUpdatedAt',
        successrate:'successRate', noshowcount:'noshowCount',
        ratingavg:'ratingAvg', ratingcount:'ratingCount',
        skilltags:'skillTags', preferredtime:'preferredTime',
        activenow:'activeNow', preferreddifficulty:'preferredDifficulty',
        jobtype:'jobType', abgroup:'abGroup',
        urgenttrialused:'urgentTrialUsed', referralcode:'referralCode',
        referredby:'referredBy', referralcount:'referralCount',
        referralrewarded:'referralRewarded', reviewcount:'reviewCount',
        jobrequestid:'jobRequestId', completedat:'completedAt',
        farmerid:'farmerId', workerid:'workerId', senderid:'senderId',
        reviewerid:'reviewerId', targetid:'targetId',
        ispublic:'isPublic', reviewerrole:'reviewerRole',
        reporterid:'reporterId', orderid:'orderId', paymentkey:'paymentKey',
        sentat:'sentAt', updatedat:'updatedAt', experimentid:'experimentId',
        variantkey:'variantKey', timebucket:'timeBucket',
        regionbucket:'regionBucket', isactive:'isActive',
        assignedat:'assignedAt', eventtype:'eventType',
        winnervariant:'winnerVariant', decidedat:'decidedAt',
        actualdifficulty:'actualDifficulty', durationmin:'durationMin',
        distkm:'distKm', fromstatus:'fromStatus', tostatus:'toStatus',
        byuserid:'byUserId', jobid:'jobId', expiresat:'expiresAt',
        priorityboost:'priorityBoost', applyrate:'applyRate',
        predictedscore:'predictedScore', recommentscore:'recommentScore',
    };
    const norm = row => {
        if (!row || typeof row !== 'object') return row;
        const o = {};
        for (const [k,v] of Object.entries(row)) o[COL_MAP[k]??k] = v;
        return o;
    };

    // ── 슬로우 쿼리 감지 ─────────────────────────────────────────────
    const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_MS || '200', 10);
    async function timedQuery(executor, sql, values) {
        const t0 = Date.now();
        const result = await executor.query(sql, values);
        const ms = Date.now() - t0;
        if (ms > SLOW_QUERY_MS) {
            const preview = sql.replace(/\s+/g, ' ').trim().slice(0, 120);
            console.warn(`[SLOW_QUERY] ${ms}ms: ${preview}`);
        }
        return result;
    }

    function prepareArgsPG(rawSql, args) {
        const wasIgnore = RE_INSERT_OR_IGNORE.test(rawSql);
        RE_INSERT_OR_IGNORE.lastIndex = 0;
        let sql = rawSql
            .replace(RE_INSERT_OR_IGNORE, 'INSERT INTO')
            .replace(RE_DATETIME_NOW, 'CURRENT_TIMESTAMP');
        let values;
        if (rawSql.includes('@')) {
            const obj = (args.length===1 && args[0] && typeof args[0]==='object') ? args[0] : {};
            const keys = [];
            sql    = sql.replace(/@(\w+)/g, (_,k) => { keys.push(k); return `$${keys.length}`; });
            values = keys.map(k => obj[k]!==undefined ? obj[k] : null);
        } else {
            let i = 0;
            sql    = sql.replace(/\?/g, () => `$${++i}`);
            values = args.flat();
        }
        if (wasIgnore && !sql.toUpperCase().includes('ON CONFLICT'))
            sql = sql.trimEnd() + ' ON CONFLICT DO NOTHING';
        return { sql, values };
    }

    return {
        mode: 'POSTGRES',
        prepare(rawSql) {
            return {
                async get(...a)  { const {sql,values}=prepareArgsPG(rawSql,a); const {rows}=await timedQuery(getExec(),sql,values); return rows.length ? norm(rows[0]) : null; },
                async all(...a)  { const {sql,values}=prepareArgsPG(rawSql,a); const {rows}=await timedQuery(getExec(),sql,values); return rows.map(norm); },
                async run(...a)  { const {sql,values}=prepareArgsPG(rawSql,a); const r=await timedQuery(getExec(),sql,values); return {changes:r.rowCount??0, lastInsertRowid:r.rows?.[0]?.id??null}; },
            };
        },
        transaction(fn) {
            return async (...args) => {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    const result = await txStorage.run(client, () => Promise.resolve(fn(...args)));
                    await client.query('COMMIT');
                    return result;
                } catch(e) { await client.query('ROLLBACK'); throw e; }
                finally   { client.release(); }
            };
        },
        exec(sql)         { return pool.query(sql.replace(RE_DATETIME_NOW,'CURRENT_TIMESTAMP').replace(RE_AUTOINCREMENT,'BIGSERIAL PRIMARY KEY')); },
        q(sql, params=[]) { return timedQuery(getExec(), sql, params ?? []); },
    };
}

// ══════════════════════════════════════════════════════════════════
//  프록시 (항상 activeAdapter에 위임)
// ══════════════════════════════════════════════════════════════════
let activeAdapter = sqliteAdapter; // 기본값: SQLite (안전)

// ── Readiness 플래그 ─────────────────────────────────────────────
// DATABASE_URL 없음(SQLite 전용): 즉시 ready
// DATABASE_URL 있음(PG): PG 연결 + schema/migration 완료 시 ready
// GET /ready 엔드포인트가 이 값으로 503 → 200 전환을 결정
let _dbReady = !process.env.DATABASE_URL; // SQLite = true, PG = false until connected

const proxy = {
    get mode()          { return activeAdapter.mode; },
    prepare(sql)        { return activeAdapter.prepare(sql); },
    transaction(fn)     { return activeAdapter.transaction(fn); },
    exec(sql)           { return activeAdapter.exec(sql); },
    q(sql, params)      { return activeAdapter.q(sql, params); },
    isReady()           { return _dbReady; },
};

// ══════════════════════════════════════════════════════════════════
//  PG 연결 테스트 (비동기 백그라운드, 5초 timeout)
//  성공 → PostgreSQL 전환
//  실패 → SQLite 유지 (서비스 무중단)
// ══════════════════════════════════════════════════════════════════
if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');

    const isLocal = process.env.DATABASE_URL.includes('localhost') ||
                    process.env.DATABASE_URL.includes('127.0.0.1');

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis:       30_000,
        connectionTimeoutMillis:  5_000, // 5초 연결 타임아웃
    });
    pool.on('error', err => console.error('[PG_POOL_ERROR]', err.message));

    // 비동기 연결 테스트 — 서버 시작을 블로킹하지 않음
    pool.query('SELECT 1')
        .then(async () => {
            // ── 스키마 자동 초기화 (IF NOT EXISTS — 멱등) ─────────────
            // init_pg.js가 build command에서 실행되지 않았을 때 안전망
            try {
                const fs         = require('fs');
                const schemaPath = path.join(__dirname, 'schema.sql');
                const schemaSql  = fs.readFileSync(schemaPath, 'utf8');
                await pool.query(schemaSql);
                console.log('[DB MODE] ✅ POSTGRES schema 자동 초기화 완료 (IF NOT EXISTS)');
            } catch (schemaErr) {
                // 이미 존재하거나 부분 오류 — 서비스 중단 없이 계속
                console.warn('[DB MODE]    schema init warn:', schemaErr.message.split('\n')[0].slice(0, 120));
            }
            // ── 마이그레이션 파일 자동 적용 (migrations/*.sql) ─────────
            try {
                const fs      = require('fs');
                const migrDir = path.join(__dirname, 'migrations');
                const files   = fs.readdirSync(migrDir)
                    .filter(f => f.endsWith('.sql'))
                    .sort();
                for (const file of files) {
                    const sql   = fs.readFileSync(path.join(migrDir, file), 'utf8');
                    const stmts = sql.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
                    for (const stmt of stmts) {
                        try { await pool.query(stmt); } catch (_) {} // IF NOT EXISTS — 실패 무시
                    }
                }
                console.log(`[DB MODE] ✅ POSTGRES migrations 자동 적용 완료 (${files.length}개)`);
            } catch (migrErr) {
                console.warn('[DB MODE]    migration warn:', migrErr.message.split('\n')[0].slice(0, 80));
            }
            // ── 컬럼 패치 (기존 테이블 누락 컬럼 안전 추가) ─────────────
            // ALTER TABLE IF EXISTS + ADD COLUMN IF NOT EXISTS (PG 9.6+)
            const colPatches = [
                // jobs: contactCount / lastContactAt
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contactcount INTEGER DEFAULT 0",
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lastcontactat TEXT DEFAULT NULL",
                // test_logs: 기존 잘못된 스키마(event 컬럼) → 누락 컬럼 추가 + NOT NULL 해제
                "ALTER TABLE test_logs ADD COLUMN IF NOT EXISTS type TEXT",
                "ALTER TABLE test_logs ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 3",
                "ALTER TABLE test_logs ADD COLUMN IF NOT EXISTS sessionid TEXT DEFAULT ''",
                // event 컬럼이 NOT NULL로 남아있으면 INSERT 실패 → DROP NOT NULL
                "ALTER TABLE test_logs ALTER COLUMN event DROP NOT NULL",
            ];
            for (const patch of colPatches) {
                try { await pool.query(patch); } catch (_) {} // 이미 있으면 무시
            }
            console.log('[DB MODE] ✅ POSTGRES column patches 완료');
            activeAdapter = buildPgAdapter(pool);
            _dbReady = true; // 이 시점부터 /ready → 200, requireReady → next()
            console.log('[READY] ✅ DB ready: POSTGRES (schema+migration 완료)');
            console.log('[DB MODE] ✅ POSTGRES — PostgreSQL 연결 성공, 전환 완료');
        })
        .catch(err => {
            console.error('[DB MODE] ⚠️  POSTGRES 연결 실패 → SQLite fallback 유지');
            console.error('[DB MODE]    원인:', err.message);
            console.error('[DB MODE]    DATABASE_URL 및 PostgreSQL 인스턴스 상태를 확인하세요');
            pool.end().catch(() => {}); // 실패한 pool 정리
            // activeAdapter는 이미 sqliteAdapter — 별도 조치 불필요
        });

    console.log('[DB MODE] ⏳ POSTGRES 연결 테스트 중... (SQLite로 임시 서비스 중)');
} else {
    console.log(`[DB MODE] ✅ SQLITE — ${DB_PATH}`);
    console.log('[READY] ✅ DB ready: SQLITE (즉시 사용 가능)');
    console.log('[DB MODE]    PostgreSQL로 전환하려면 DATABASE_URL 환경변수를 설정하세요');
}

module.exports = proxy;
