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

async function main() {
    if (!process.env.DATABASE_URL) {
        console.log('[INIT_PG] DATABASE_URL 없음 — 스킵 (SQLite 모드 유지)');
        process.exit(0); // graceful skip: 로컬 빌드 깨지지 않게
    }

    const isLocal = process.env.DATABASE_URL.includes('localhost') ||
                    process.env.DATABASE_URL.includes('127.0.0.1');

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isLocal ? false : { rejectUnauthorized: false },
    });

    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const sql        = fs.readFileSync(schemaPath, 'utf8');

        console.log('[INIT_PG] 스키마 적용 시작...');
        await pool.query(sql);
        console.log('[INIT_PG] ✅ 스키마 적용 완료');
    } catch (e) {
        console.error('[INIT_PG] ❌ 스키마 적용 실패:', e.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
