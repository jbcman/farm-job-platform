'use strict';
/**
 * init_pg.js — PostgreSQL 스키마 초기화
 *
 * 실행 방법:
 *   DATABASE_URL=postgres://... node init_pg.js
 *
 * Render 배포 시 "Build Command" 또는 서버 시작 전 1회 실행:
 *   node init_pg.js && node index.js
 */

const fs   = require('fs');
const path = require('path');

// .env 로드 (로컬 개발 시)
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    console.log(`[INIT_PG] .env 로드: ${envPath}`);
}

const { Pool } = require('pg');

// ── 하드 타임아웃: 30초 내 완료 못 하면 빌드 계속 진행 ──────────────
// PG 서버 일시 불안정 시 buildCommand 전체 hang 방지
const HARD_TIMEOUT = setTimeout(() => {
    console.warn('[INIT_PG] ⚠️ 30초 타임아웃 — PG 응답 없음, 빌드 계속 진행 (서버 시작 시 재시도)');
    process.exit(0);
}, 30_000);
HARD_TIMEOUT.unref(); // Node가 이것만 남아있어도 자연 종료되도록

async function main() {
    if (!process.env.DATABASE_URL) {
        console.log('[INIT_PG] DATABASE_URL 없음 — 스킵 (SQLite 모드 유지)');
        clearTimeout(HARD_TIMEOUT);
        process.exit(0); // graceful skip: 로컬 빌드 깨지지 않게
    }

    const isLocal = process.env.DATABASE_URL.includes('localhost') ||
                    process.env.DATABASE_URL.includes('127.0.0.1');

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        max: 1,
        connectionTimeoutMillis: 15_000, // 15초 연결 타임아웃 (hang 방지)
        idleTimeoutMillis:       10_000,
    });

    // 연결 테스트 — 실패 시 스킵 (빌드 계속)
    try {
        await pool.query('SELECT 1');
    } catch (connErr) {
        console.warn('[INIT_PG] ⚠️ PG 연결 실패 (일시 불안정) — 스킵:', connErr.message.split('\n')[0]);
        console.warn('[INIT_PG]    서버 시작 시 db.js에서 재시도됩니다.');
        await pool.end().catch(() => {});
        clearTimeout(HARD_TIMEOUT);
        process.exit(0); // 빌드 실패 아님 — 서버 기동 후 db.js가 재시도
    }

    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const sql        = fs.readFileSync(schemaPath, 'utf8');

        console.log('[INIT_PG] 스키마 적용 시작...');
        await pool.query(sql);
        console.log('[INIT_PG] ✅ 스키마 적용 완료');
    } catch (e) {
        // 스키마 오류는 경고만 (이미 존재하는 테이블 등 무시)
        console.warn('[INIT_PG] ⚠️ 스키마 적용 경고:', e.message.split('\n')[0].slice(0, 120));
    } finally {
        await pool.end().catch(() => {});
        clearTimeout(HARD_TIMEOUT);
    }
}

main();
