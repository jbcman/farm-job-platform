'use strict';
/**
 * migrate_optimize.js — DB 성능 최적화 마이그레이션
 *
 * 적용 방법 (init_pg.js 실행 후):
 *   node server/migrate_optimize.js
 *
 * Render 배포 시 Build Command:
 *   node server/init_pg.js && node server/migrate_optimize.js
 *
 * 특징:
 *   - 완전 멱등 (IF NOT EXISTS / CREATE OR REPLACE)
 *   - 다운타임 없이 온라인 적용 가능
 *   - 롤백: server/migrations/001_optimize_indexes.sql 내 주석 참조
 */

const fs   = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
}

const { Pool } = require('pg');

async function main() {
    if (!process.env.DATABASE_URL) {
        console.log('[MIGRATE_OPT] DATABASE_URL 없음 — 스킵 (SQLite 모드 유지)');
        process.exit(0); // graceful skip: 로컬 빌드 깨지지 않게
    }

    const isLocal = process.env.DATABASE_URL.includes('localhost') ||
                    process.env.DATABASE_URL.includes('127.0.0.1');

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isLocal ? false : { rejectUnauthorized: false },
    });

    try {
        const migrDir = path.join(__dirname, 'migrations');
        const files   = fs.readdirSync(migrDir)
            .filter(f => f.endsWith('.sql'))
            .sort(); // 001_, 002_, ... 정렬 순 실행

        console.log(`[MIGRATE_OPT] migrations/ 내 파일 ${files.length}개 적용 시작...`);

        let ok = 0, skipped = 0;
        for (const file of files) {
            const sql   = fs.readFileSync(path.join(migrDir, file), 'utf8');
            const stmts = sql
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0 && !s.startsWith('--'));

            console.log(`[MIGRATE_OPT] ▶ ${file} (${stmts.length}개 구문)`);
            for (const stmt of stmts) {
                try {
                    await pool.query(stmt);
                    ok++;
                } catch (e) {
                    console.warn(`[MIGRATE_OPT] WARN (${file}): ${e.message.split('\n')[0]}`);
                    skipped++;
                }
            }
        }

        console.log(`[MIGRATE_OPT] ✅ 완료: ${ok}건 성공, ${skipped}건 스킵`);

        // 적용된 인덱스 확인
        const { rows } = await pool.query(`
            SELECT indexname, tablename
            FROM   pg_indexes
            WHERE  schemaname = 'public'
              AND  indexname LIKE 'idx_%'
            ORDER  BY tablename, indexname
        `);
        console.log('[MIGRATE_OPT] 현재 인덱스 목록:');
        rows.forEach(r => console.log(`  ${r.tablename}.${r.indexname}`));

        // distance_km 함수 확인
        const fnCheck = await pool.query(`
            SELECT proname FROM pg_proc
            WHERE  proname = 'distance_km'
        `);
        if (fnCheck.rows.length > 0) {
            console.log('[MIGRATE_OPT] ✅ distance_km() 함수 등록 확인');
        }

    } catch (e) {
        console.error('[MIGRATE_OPT] ❌ 마이그레이션 실패:', e.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
