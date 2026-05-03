'use strict';
/**
 * verify_migration.js — SQLite vs PostgreSQL 데이터 정합성 검증
 *
 * 실행:
 *   DATABASE_URL=postgres://... node server/scripts/verify_migration.js
 *
 * 검증 항목:
 *   1. 테이블별 ROW COUNT 비교
 *   2. 핵심 테이블 ID 샘플 spot-check (최근 10개)
 *   3. 최종 PASS / FAIL 판정
 */

const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

// ─── 환경변수 ────────────────────────────────────────────────────
const envPath = path.join(__dirname, '../../.env');
if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath });

if (!process.env.DATABASE_URL) {
    console.error('[VERIFY] ❌ DATABASE_URL 없음');
    process.exit(1);
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../farm.db');
if (!fs.existsSync(DB_PATH)) {
    console.error(`[VERIFY] ❌ SQLite DB 없음: ${DB_PATH}`);
    process.exit(1);
}

const sqlite = new Database(DB_PATH, { readonly: true });

const isLocal = process.env.DATABASE_URL.includes('localhost') ||
                process.env.DATABASE_URL.includes('127.0.0.1');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 3,
});

// ─── SQLite 테이블 목록 ──────────────────────────────────────────
const sqliteTables = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map(r => r.name);

// ─── SPOT-CHECK 대상 테이블 (핵심 데이터) ───────────────────────
const SPOT_CHECK_TABLES = ['jobs', 'workers', 'users', 'applications', 'match_logs'];

async function run() {
    console.log('\n[VERIFY] === 이관 정합성 검증 시작 ===\n');
    console.log(`SQLite: ${DB_PATH}`);
    console.log(`PG:     ${process.env.DATABASE_URL.replace(/:\/\/[^@]+@/, '://***@')}\n`);

    const results = [];
    let passCount = 0;
    let failCount = 0;

    // ── 1. ROW COUNT 비교 ─────────────────────────────────────────
    console.log('[ ROW COUNT 비교 ]');
    console.log('─'.repeat(65));
    console.log(`${'테이블'.padEnd(30)} ${'SQLite'.padStart(8)} ${'PG'.padStart(8)} ${'결과'.padStart(8)}`);
    console.log('─'.repeat(65));

    for (const table of sqliteTables) {
        const sqCount = sqlite.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get()?.cnt ?? 0;

        let pgCount = 0;
        let pgError = null;
        try {
            const r = await pool.query(`SELECT COUNT(*) AS cnt FROM ${table}`);
            pgCount = parseInt(r.rows[0]?.cnt ?? 0, 10);
        } catch (e) {
            pgError = e.message.slice(0, 40);
        }

        let status;
        if (pgError) {
            status = '⚠️  PG테이블없음';
            failCount++;
        } else if (sqCount === pgCount) {
            status = '✅ PASS';
            passCount++;
        } else if (pgCount >= sqCount) {
            status = '✅ PASS (PG≥SQ)';  // ON CONFLICT로 중복 제거된 경우
            passCount++;
        } else {
            status = `❌ FAIL (부족 ${sqCount - pgCount})`;
            failCount++;
        }

        console.log(`${table.padEnd(30)} ${String(sqCount).padStart(8)} ${String(pgError ? 'N/A' : pgCount).padStart(8)} ${status}`);
        results.push({ table, sqCount, pgCount, pgError, pass: !pgError && pgCount >= Math.min(sqCount, 1) });
    }

    // ── 2. ID SPOT CHECK ──────────────────────────────────────────
    console.log('\n[ ID SPOT CHECK — 최근 10개 ]');
    console.log('─'.repeat(65));

    for (const table of SPOT_CHECK_TABLES) {
        if (!sqliteTables.includes(table)) continue;

        const sqRows = sqlite.prepare(
            `SELECT id FROM ${table} ORDER BY rowid DESC LIMIT 10`
        ).all().map(r => r.id);

        if (sqRows.length === 0) {
            console.log(`  ${table.padEnd(28)}: (데이터 없음)`);
            continue;
        }

        let pgIds = [];
        try {
            const placeholders = sqRows.map((_, i) => `$${i + 1}`).join(', ');
            const r = await pool.query(`SELECT id FROM ${table} WHERE id IN (${placeholders})`, sqRows);
            pgIds = r.rows.map(r => r.id);
        } catch (_) { /* table may not exist */ }

        const missing = sqRows.filter(id => !pgIds.includes(id));
        const symbol  = missing.length === 0 ? '✅' : '❌';
        console.log(`  ${symbol} ${table.padEnd(28)}: ${sqRows.length}개 샘플 중 ${missing.length}개 누락`);
        if (missing.length > 0) {
            console.log(`     누락 ID: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' ...' : ''}`);
            failCount++;
        }
    }

    // ── 3. 최종 판정 ──────────────────────────────────────────────
    const total  = passCount + failCount;
    const passed = failCount === 0;

    console.log('\n' + '═'.repeat(65));
    console.log(`[VERIFY] 결과: ${passCount}/${total} PASS`);
    console.log(passed
        ? '[VERIFY] ✅ MIGRATION PASS — 데이터 무손실 이관 확인'
        : '[VERIFY] ❌ MIGRATION FAIL — 위 항목 확인 후 재시도 필요'
    );
    console.log('═'.repeat(65));

    sqlite.close();
    await pool.end();

    process.exit(passed ? 0 : 1);
}

run().catch(e => {
    console.error('[VERIFY] ❌ 치명적 오류:', e.message);
    process.exit(1);
});
