'use strict';
/**
 * db.js — SQLite 데이터베이스 초기화
 * better-sqlite3 기반, WAL 모드
 */
const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, 'farm.db');
const db      = new Database(DB_PATH);

// WAL 모드: 동시 읽기 성능 향상
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id            TEXT PRIMARY KEY,
    requesterId   TEXT NOT NULL,
    requesterName TEXT NOT NULL DEFAULT '농민',
    category      TEXT NOT NULL,
    locationText  TEXT NOT NULL,
    latitude      REAL DEFAULT 37.5,
    longitude     REAL DEFAULT 127.0,
    date          TEXT NOT NULL,
    timeSlot      TEXT DEFAULT '협의',
    areaSize      INTEGER,
    areaUnit      TEXT DEFAULT '평',
    pay           TEXT,
    note          TEXT DEFAULT '',
    imageUrl      TEXT,
    isUrgent      INTEGER DEFAULT 0,
    status        TEXT DEFAULT 'open',
    createdAt     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workers (
    id                TEXT PRIMARY KEY,
    userId            TEXT NOT NULL,
    name              TEXT NOT NULL,
    phone             TEXT NOT NULL,
    baseLocationText  TEXT NOT NULL,
    latitude          REAL,
    longitude         REAL,
    serviceRadiusKm   INTEGER DEFAULT 30,
    categories        TEXT NOT NULL DEFAULT '[]',
    hasTractor        INTEGER DEFAULT 0,
    hasSprayer        INTEGER DEFAULT 0,
    hasRotary         INTEGER DEFAULT 0,
    completedJobs     INTEGER DEFAULT 0,
    rating            REAL DEFAULT 4.5,
    availableTimeText TEXT DEFAULT '협의'
  );

  CREATE TABLE IF NOT EXISTS applications (
    id           TEXT PRIMARY KEY,
    jobRequestId TEXT NOT NULL,
    workerId     TEXT NOT NULL,
    message      TEXT DEFAULT '',
    status       TEXT DEFAULT 'applied',
    createdAt    TEXT NOT NULL,
    UNIQUE(jobRequestId, workerId)
  );

  CREATE TABLE IF NOT EXISTS users (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    phone     TEXT NOT NULL,
    role      TEXT NOT NULL DEFAULT 'farmer',
    createdAt TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

  CREATE TABLE IF NOT EXISTS contacts (
    id        TEXT PRIMARY KEY,
    jobId     TEXT NOT NULL,
    farmerId  TEXT NOT NULL,
    workerId  TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    UNIQUE(jobId, workerId)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id        TEXT PRIMARY KEY,
    jobId     TEXT NOT NULL,
    senderId  TEXT NOT NULL,
    text      TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id         TEXT PRIMARY KEY,
    jobId      TEXT NOT NULL,
    reviewerId TEXT NOT NULL,
    targetId   TEXT NOT NULL,
    rating     INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment    TEXT DEFAULT '',
    createdAt  TEXT NOT NULL,
    UNIQUE(jobId, reviewerId)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id         TEXT PRIMARY KEY,
    jobId      TEXT NOT NULL,
    reporterId TEXT NOT NULL,
    reason     TEXT NOT NULL,
    createdAt  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics (
    id        TEXT PRIMARY KEY,
    event     TEXT NOT NULL,
    jobId     TEXT,
    userId    TEXT,
    meta      TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics(event);
`);

// ─── 마이그레이션: 기존 DB에 컬럼 추가 ──────────────────────────
try { db.exec('ALTER TABLE jobs ADD COLUMN pay TEXT'); } catch (_) {}

// Phase 2: users 테이블 — 관심 분야 / 지역 / 알림 수신
try { db.exec("ALTER TABLE users ADD COLUMN jobType       TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN locationText  TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN notifyEnabled INTEGER DEFAULT 1");    } catch (_) {}

// Phase 4: users 테이블 — GPS 좌표
try { db.exec("ALTER TABLE users ADD COLUMN lat REAL DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN lng REAL DEFAULT NULL"); } catch (_) {}

// Phase 7: jobs 테이블 — 연락처 공개 상태 + 선택된 작업자
try { db.exec("ALTER TABLE jobs ADD COLUMN contactRevealed INTEGER DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE jobs ADD COLUMN selectedWorkerId TEXT DEFAULT NULL"); } catch (_) {}

// Phase 8: jobs 테이블 — 선택 시각 + 마감 시각
try { db.exec("ALTER TABLE jobs ADD COLUMN selectedAt TEXT DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE jobs ADD COLUMN closedAt  TEXT DEFAULT NULL"); } catch (_) {}

// Phase 2: workers 테이블 — 알림 수신 플래그
try { db.exec("ALTER TABLE workers ADD COLUMN notifyEnabled INTEGER DEFAULT 1"); } catch (_) {}

// PHASE 22: applications 테이블 — 완료 시각
try { db.exec("ALTER TABLE applications ADD COLUMN completedAt TEXT DEFAULT NULL"); } catch (_) {}

// PHASE 26: 밭 정보 확장 — 평수(areaPyeong) + 농지 이미지 배열(farmImages JSON)
try { db.exec("ALTER TABLE jobs ADD COLUMN areaPyeong INTEGER DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE jobs ADD COLUMN farmImages TEXT    DEFAULT NULL"); } catch (_) {}

// PHASE 24: 기존 fallback 좌표(37.5, 127.0) → NULL 정리 (지도 오염 방지)
// 실제 GPS 데이터가 우연히 37.5/127.0일 확률 무시 (한국 중앙 사막 한가운데)
try {
  const cleaned = db.prepare(
    "UPDATE jobs SET latitude = NULL, longitude = NULL WHERE latitude = 37.5 AND longitude = 127.0"
  ).run();
  if (cleaned.changes > 0) {
    console.log(`[PHASE24_COORD_CLEAN] fallback 좌표 제거: ${cleaned.changes}건 → lat/lng=null`);
  }
} catch (_) {}

// Phase 2: 알림 발송 이력 (중복 방지)
db.exec(`
  CREATE TABLE IF NOT EXISTS notify_log (
    id        TEXT PRIMARY KEY,
    jobId     TEXT NOT NULL,
    phone     TEXT NOT NULL,
    type      TEXT NOT NULL,
    sentAt    TEXT NOT NULL,
    UNIQUE(jobId, phone, type)
  );
`);

console.log(`[DB] SQLite 연결 완료 → ${DB_PATH}`);
module.exports = db;
