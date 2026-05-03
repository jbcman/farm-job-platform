'use strict';
/**
 * import_pg.js — JSON 덤프 → PostgreSQL 일괄 import
 *
 * 실행 순서:
 *   1. node server/scripts/export_sqlite.js          (dump 생성)
 *   2. DATABASE_URL=postgres://... node init_pg.js   (스키마 초기화)
 *   3. DATABASE_URL=postgres://... node server/migrate_optimize.js  (마이그레이션)
 *   4. DATABASE_URL=postgres://... node server/scripts/import_pg.js (데이터 이관)
 *   5. DATABASE_URL=postgres://... node server/scripts/verify_migration.js (검증)
 *
 * 옵션:
 *   DUMP_FILE=./dump_2025-05-01.json  (기본: 최신 dump_*.json)
 *   BATCH_SIZE=200                    (기본: 100)
 */

const path = require('path');
const fs   = require('fs');
const { Pool } = require('pg');

// ─── 환경변수 ────────────────────────────────────────────────────
const envPath = path.join(__dirname, '../../.env');
if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath });

if (!process.env.DATABASE_URL) {
    console.error('[IMPORT] ❌ DATABASE_URL 환경변수가 없습니다.');
    process.exit(1);
}

// ─── 덤프 파일 선택 ──────────────────────────────────────────────
let dumpFile = process.env.DUMP_FILE;
if (!dumpFile) {
    const files = fs.readdirSync(path.join(__dirname))
        .filter(f => f.startsWith('dump_') && f.endsWith('.json'))
        .sort()
        .reverse();
    if (!files.length) {
        console.error('[IMPORT] ❌ dump_*.json 파일 없음. export_sqlite.js 먼저 실행하세요.');
        process.exit(1);
    }
    dumpFile = path.join(__dirname, files[0]);
}

console.log(`[IMPORT] 덤프 파일: ${dumpFile}`);
const dump = JSON.parse(fs.readFileSync(dumpFile, 'utf8'));
console.log(`[IMPORT] 원본 내보내기 시각: ${dump.exportedAt}`);

// ─── PG 연결 ─────────────────────────────────────────────────────
const isLocal = process.env.DATABASE_URL.includes('localhost') ||
                process.env.DATABASE_URL.includes('127.0.0.1');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 5,
});

// ─── 테이블 임포트 순서 (외래키 의존성 고려) ──────────────────────
const TABLE_ORDER = [
    'users', 'workers', 'jobs', 'applications', 'contacts',
    'messages', 'reviews', 'reports', 'analytics', 'notify_log',
    'status_logs', 'user_behavior', 'sponsored_jobs', 'subscriptions',
    'rl_qtable', 'bandit_arms', 'bandit_context_arms', 'experiment_results',
    'experiments', 'experiment_assignments', 'experiment_events',
    'job_feedback', 'rec_logs', 'system_flags', 'anomaly_snapshots',
    'payments', 'match_logs',
];

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100', 10);

// ─── match_logs BOOLEAN 컬럼 (SQLite 0/1 → PG true/false) ────────
const BOOL_COLS_BY_TABLE = {
    match_logs: new Set(['selected', 'viewed', 'clicked']),
};

// ─── 배치 INSERT ─────────────────────────────────────────────────
async function importTable(client, table, rows) {
    if (!rows || rows.length === 0) {
        console.log(`  ⏭  ${table.padEnd(30)} 0 rows (skip)`);
        return { inserted: 0, skipped: 0, errors: 0 };
    }

    const boolCols = BOOL_COLS_BY_TABLE[table] || new Set();

    let inserted = 0;
    let skipped  = 0;
    let errors   = 0;

    // 배치 처리
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);

        for (const row of batch) {
            const rawKeys = Object.keys(row);
            // PG는 대소문자 무관 (unquoted identifier → lowercase)
            const keys    = rawKeys.map(k => k.toLowerCase());
            const values  = rawKeys.map(k => {
                const v = row[k];
                // BOOLEAN 컬럼 변환 (0→false, 1→true, null→null)
                if (boolCols.has(k.toLowerCase())) {
                    if (v === null || v === undefined) return null;
                    return v !== 0 && v !== false;
                }
                return v;
            });

            const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
            const sql = `INSERT INTO ${table} (${keys.join(', ')})
                         VALUES (${placeholders})
                         ON CONFLICT DO NOTHING`;
            try {
                const r = await client.query(sql, values);
                if (r.rowCount > 0) inserted++;
                else                skipped++;
            } catch (e) {
                errors++;
                if (errors <= 3) {
                    console.warn(`  ⚠️  ${table} INSERT 오류 (행 ${i}): ${e.message.slice(0, 120)}`);
                }
            }
        }
    }

    const symbol = errors === 0 ? '✅' : '⚠️ ';
    console.log(`  ${symbol} ${table.padEnd(30)} +${inserted} inserted, ${skipped} skipped, ${errors} errors`);
    return { inserted, skipped, errors };
}

// ─── 메인 ────────────────────────────────────────────────────────
async function run() {
    const client = await pool.connect();
    const stats  = { tables: 0, inserted: 0, skipped: 0, errors: 0 };

    try {
        console.log('\n[IMPORT] === PostgreSQL import 시작 ===\n');

        // 순서 지정된 테이블 먼저
        const ordered = TABLE_ORDER.filter(t => dump.tables[t]);
        // 덤프에 있지만 순서 목록에 없는 테이블 추가 (예: 추후 신규 테이블)
        const extra = Object.keys(dump.tables).filter(t => !TABLE_ORDER.includes(t));
        const allTables = [...ordered, ...extra];

        for (const table of allTables) {
            const rows = dump.tables[table];
            if (rows === undefined) continue;

            const result = await importTable(client, table, rows);
            stats.tables++;
            stats.inserted += result.inserted;
            stats.skipped  += result.skipped;
            stats.errors   += result.errors;
        }

        console.log(`
[IMPORT DONE]
  테이블: ${stats.tables}개
  삽입:   ${stats.inserted.toLocaleString()}행
  스킵:   ${stats.skipped.toLocaleString()}행 (ON CONFLICT)
  오류:   ${stats.errors}건
  상태:   ${stats.errors === 0 ? '✅ 완전 성공' : '⚠️  일부 오류 (verify_migration.js 실행 권장)'}
`);

    } catch (e) {
        console.error('[IMPORT] ❌ 치명적 오류:', e.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

run();
