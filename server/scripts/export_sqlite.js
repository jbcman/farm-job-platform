'use strict';
/**
 * export_sqlite.js — SQLite → JSON 전체 덤프
 *
 * 실행:
 *   node server/scripts/export_sqlite.js
 *   DB_PATH=/data/farm.db node server/scripts/export_sqlite.js
 *
 * 출력: server/scripts/dump_YYYY-MM-DD.json
 */

const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');

// ─── 경로 설정 ───────────────────────────────────────────────────
const envPath = path.join(__dirname, '../../.env');
if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath });

const DB_PATH   = process.env.DB_PATH || path.join(__dirname, '../farm.db');
const TODAY     = new Date().toISOString().slice(0, 10);
const DUMP_FILE = path.join(__dirname, `dump_${TODAY}.json`);

// ─── 연결 ────────────────────────────────────────────────────────
if (!fs.existsSync(DB_PATH)) {
    console.error(`[EXPORT] ❌ DB 파일 없음: ${DB_PATH}`);
    process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });
console.log(`[EXPORT] DB: ${DB_PATH}`);

// ─── 테이블 목록 자동 탐색 ───────────────────────────────────────
const allTables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map(r => r.name);

console.log(`[EXPORT] 테이블 수: ${allTables.length}`);
console.log(`[EXPORT] 테이블 목록: ${allTables.join(', ')}`);

// ─── 덤프 생성 ────────────────────────────────────────────────────
const dump = {
    exportedAt: new Date().toISOString(),
    dbPath:     DB_PATH,
    tables:     {},
    rowCounts:  {},
};

let totalRows = 0;

for (const table of allTables) {
    try {
        const rows = db.prepare(`SELECT * FROM ${table}`).all();
        dump.tables[table]    = rows;
        dump.rowCounts[table] = rows.length;
        totalRows += rows.length;
        console.log(`  ✅ ${table.padEnd(30)} ${rows.length} rows`);
    } catch (e) {
        console.warn(`  ⚠️  ${table}: ${e.message}`);
        dump.tables[table]    = [];
        dump.rowCounts[table] = 0;
    }
}

db.close();

// ─── 저장 ────────────────────────────────────────────────────────
fs.writeFileSync(DUMP_FILE, JSON.stringify(dump, null, 2), 'utf8');

const fileSizeKB = Math.round(fs.statSync(DUMP_FILE).size / 1024);
console.log(`
[EXPORT DONE]
  파일:   ${DUMP_FILE}
  크기:   ${fileSizeKB} KB
  테이블: ${allTables.length}개
  총 행:  ${totalRows.toLocaleString()}개
`);
