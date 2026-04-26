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

// PHASE 28: applications 인덱스 — jobRequestId+createdAt 복합 인덱스 (정렬 성능)
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_applications_job_created ON applications(jobRequestId, createdAt)');
} catch (_) {}

// PHASE 29: 자동 선택 여부 플래그 (0=수동, 1=AI 자동 매칭)
try { db.exec("ALTER TABLE jobs ADD COLUMN autoSelected INTEGER DEFAULT 0"); } catch (_) {}

// PHASE 30: 작업 시작 시각 (완료 악용 방지용 최소 10분 체크)
try { db.exec("ALTER TABLE jobs ADD COLUMN startedAt TEXT DEFAULT NULL"); } catch (_) {}

// PHASE 32: 출발 독촉 알림 발송 여부 (중복 발송 방지)
try { db.exec("ALTER TABLE jobs ADD COLUMN departureReminderSent INTEGER DEFAULT 0"); } catch (_) {}

// PHASE MAP_FIX: 농지 주소 (GPS 없을 때 지오코딩 소스)
try { db.exec("ALTER TABLE jobs ADD COLUMN farmAddress TEXT DEFAULT NULL"); } catch (_) {}

// PHASE IMAGE_DIFFICULTY_AI: 이미지 기반 난이도 점수 (0.0~1.0)
try { db.exec("ALTER TABLE jobs ADD COLUMN difficulty REAL DEFAULT 0"); } catch (_) {}

// PHASE SCALE: 유료 긴급 공고 플래그 (결제 완료 시 1)
try { db.exec("ALTER TABLE jobs ADD COLUMN isUrgentPaid INTEGER DEFAULT 0"); } catch (_) {}

// PHASE SCALE+: A/B 그룹 + 무료 체험 사용 여부
try { db.exec("ALTER TABLE users ADD COLUMN abGroup TEXT DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN urgentTrialUsed INTEGER DEFAULT 0"); } catch (_) {}

// PHASE FARMER_PAY_UX: 공고별 결제 상태 ('none'|'pending'|'paid')
try { db.exec("ALTER TABLE jobs ADD COLUMN payStatus TEXT DEFAULT 'none'"); } catch (_) {}
try { db.exec("ALTER TABLE jobs ADD COLUMN payMethod TEXT DEFAULT NULL"); } catch (_) {}

// PHASE SCALE+: 결제 이력 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    userId    TEXT    NOT NULL,
    jobId     TEXT    NOT NULL,
    amount    INTEGER NOT NULL,
    status    TEXT    NOT NULL DEFAULT 'ready',
    provider  TEXT    NOT NULL DEFAULT 'toss',
    orderId   TEXT    NOT NULL UNIQUE,
    paymentKey TEXT,
    createdAt TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(orderId);
  CREATE INDEX IF NOT EXISTS idx_payments_user  ON payments(userId);
`);

// PHASE DIFFICULTY_PERSONAL: 개인 난이도 선호 (0.0=쉬움 선호 ~ 1.0=어려움 선호, 기본 0.5)
try { db.exec("ALTER TABLE users   ADD COLUMN preferredDifficulty REAL DEFAULT 0.5"); } catch (_) {}
try { db.exec("ALTER TABLE workers ADD COLUMN preferredDifficulty REAL DEFAULT 0.5"); } catch (_) {}

// PHASE IMAGE_JOBTYPE_AI: 이미지 기반 자동 작업유형 분류 + 태그
try { db.exec("ALTER TABLE jobs ADD COLUMN autoJobType TEXT DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE jobs ADD COLUMN tags        TEXT DEFAULT NULL"); } catch (_) {}  // JSON array

// PHASE AUTO_MATCH_ALERT: 작업자 실시간 위치 (기기 GPS 기반, 수시 갱신)
try { db.exec("ALTER TABLE workers ADD COLUMN currentLat  REAL DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE workers ADD COLUMN currentLng  REAL DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE workers ADD COLUMN locationUpdatedAt TEXT DEFAULT NULL"); } catch (_) {}

// PHASE MATCH_ENGINE_UNIFY: job_notifications 폐기 → notify_log 단일 사용
// 기존 DB에 테이블 있어도 무해 (DROP TABLE은 SQLite에서 지원 안 됨)

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

// PHASE PERSONALIZATION_SCORE: 사용자 행동 로그 (view / apply)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_behavior (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    userId    TEXT    NOT NULL,
    jobId     TEXT    NOT NULL,
    action    TEXT    NOT NULL,
    jobType   TEXT,
    lat       REAL,
    lng       REAL,
    createdAt INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_behavior_user_time
    ON user_behavior(userId, createdAt DESC);
`);

// PHASE MONETIZATION: 스폰서 게시물 + 구독
db.exec(`
  CREATE TABLE IF NOT EXISTS sponsored_jobs (
    jobId     TEXT    NOT NULL PRIMARY KEY,
    boost     INTEGER NOT NULL DEFAULT 20,
    expiresAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    userId        TEXT    NOT NULL PRIMARY KEY,
    tier          TEXT    NOT NULL DEFAULT 'free',
    priorityBoost INTEGER NOT NULL DEFAULT 10,
    expiresAt     INTEGER NOT NULL
  );
`);

// PHASE RL_RECOMMENDER: Q-table (state × action)
db.exec(`
  CREATE TABLE IF NOT EXISTS rl_qtable (
    state     TEXT NOT NULL,
    action    TEXT NOT NULL,
    q         REAL NOT NULL DEFAULT 0,
    updatedAt INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (state, action)
  );
`);

// PHASE CONTEXTUAL_BANDIT: 시간대/지역별 arm 통계
db.exec(`
  CREATE TABLE IF NOT EXISTS bandit_context_arms (
    experimentId TEXT    NOT NULL,
    variantKey   TEXT    NOT NULL,
    timeBucket   INTEGER NOT NULL,
    regionBucket TEXT    NOT NULL,
    impressions  INTEGER NOT NULL DEFAULT 0,
    applies      INTEGER NOT NULL DEFAULT 0,
    updatedAt    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (experimentId, variantKey, timeBucket, regionBucket)
  );
`);

// PHASE MULTI_ARM_BANDIT: arm별 실시간 통계
db.exec(`
  CREATE TABLE IF NOT EXISTS bandit_arms (
    experimentId TEXT    NOT NULL,
    variantKey   TEXT    NOT NULL,
    impressions  INTEGER NOT NULL DEFAULT 0,
    applies      INTEGER NOT NULL DEFAULT 0,
    updatedAt    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (experimentId, variantKey)
  );
`);

// PHASE_ADMIN_DASHBOARD_AI_V2: worker 완료 통계 확장
try { db.exec("ALTER TABLE workers ADD COLUMN successRate   REAL    DEFAULT 0"); } catch (_) {}
// users 테이블에도 동일 필드 (플랫폼 사용자 기반 장기 통계)
try { db.exec("ALTER TABLE users ADD COLUMN completedJobs INTEGER DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN successRate   REAL    DEFAULT 0"); } catch (_) {}

// PHASE AUTO_WINNER: 실험 승자 결과 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS experiment_results (
    experimentId  TEXT    NOT NULL,
    winnerVariant TEXT    NOT NULL,
    decidedAt     INTEGER NOT NULL,
    PRIMARY KEY (experimentId)
  );
`);

// PHASE AB_TEST_AUTOMATION: 실험/할당/이벤트 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS experiments (
    id        TEXT    PRIMARY KEY,
    variants  TEXT    NOT NULL,
    isActive  INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS experiment_assignments (
    userId       TEXT    NOT NULL,
    experimentId TEXT    NOT NULL,
    variantKey   TEXT    NOT NULL,
    assignedAt   INTEGER NOT NULL,
    PRIMARY KEY (userId, experimentId)
  );

  CREATE TABLE IF NOT EXISTS experiment_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    userId       TEXT    NOT NULL,
    experimentId TEXT    NOT NULL,
    variantKey   TEXT    NOT NULL,
    eventType    TEXT    NOT NULL,
    jobId        TEXT,
    createdAt    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_exp_events
    ON experiment_events(experimentId, variantKey, eventType);
`);

// PHASE FEEDBACK_LOOP_AI: 작업 완료 후 평점/실제 난이도/소요시간 수집
db.exec(`
  CREATE TABLE IF NOT EXISTS job_feedback (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    jobId            TEXT    NOT NULL,
    workerId         TEXT    NOT NULL,
    rating           INTEGER,          -- 1~5
    actualDifficulty REAL,             -- 0~1
    durationMin      INTEGER,
    createdAt        INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_feedback_job    ON job_feedback(jobId);
  CREATE INDEX IF NOT EXISTS idx_feedback_worker ON job_feedback(workerId);
`);

// PHASE ADMIN_REALTIME_LOG: 추천 로그 (버퍼 플러시 방식)
db.exec(`
  CREATE TABLE IF NOT EXISTS rec_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    jobId       TEXT,
    workerId    TEXT,
    variantKey  TEXT,
    score       REAL,
    distKm      REAL,
    difficulty  REAL,
    jobType     TEXT,
    autoJobType TEXT,
    createdAt   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rec_logs_time ON rec_logs(createdAt DESC);
`);

// PHASE SAFE_MODE_KILLSWITCH: 시스템 상태 플래그
db.exec(`
  CREATE TABLE IF NOT EXISTS system_flags (
    key       TEXT PRIMARY KEY,
    value     TEXT NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  INSERT OR IGNORE INTO system_flags (key, value, updatedAt)
  VALUES ('SAFE_MODE', '0', ${Date.now()});
`);

// PHASE SAFE_MODE_KILLSWITCH: 이상 감지 스냅샷 (복구 판단용)
db.exec(`
  CREATE TABLE IF NOT EXISTS anomaly_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ctr         REAL,
    applyRate   REAL,
    ts          INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_anomaly_ts ON anomaly_snapshots(ts DESC);
`);

// PHASE REVIEW_SYSTEM: 사용자 신뢰 점수 (누적 평균)
try { db.exec("ALTER TABLE users ADD COLUMN rating REAL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN reviewCount INTEGER DEFAULT 0"); } catch (_) {}

// PHASE GROWTH: 추천인 시스템
try { db.exec("ALTER TABLE users ADD COLUMN referralCode TEXT DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN referredBy TEXT DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN referralCount INTEGER DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN referralRewarded INTEGER DEFAULT 0"); } catch (_) {}
// referralCode 유니크 인덱스 (중복 방지)
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral ON users(referralCode) WHERE referralCode IS NOT NULL"); } catch (_) {}

// PHASE_PAYMENT_ESCROW_V1: 에스크로 결제 상태 필드
try { db.exec("ALTER TABLE jobs ADD COLUMN paymentStatus TEXT DEFAULT 'pending'"); } catch (_) {}
try { db.exec("ALTER TABLE jobs ADD COLUMN paymentId     TEXT DEFAULT NULL");       } catch (_) {}
try { db.exec("ALTER TABLE jobs ADD COLUMN fee           INTEGER DEFAULT 0");       } catch (_) {}
try { db.exec("ALTER TABLE jobs ADD COLUMN netAmount     INTEGER DEFAULT 0");       } catch (_) {}

// TRUST_SYSTEM: 리뷰 태그 + 블라인드 공개 + 노쇼 추적
try { db.exec("ALTER TABLE reviews ADD COLUMN tags     TEXT    DEFAULT NULL");  } catch (_) {}
try { db.exec("ALTER TABLE reviews ADD COLUMN isPublic INTEGER DEFAULT 0");     } catch (_) {}
try { db.exec("ALTER TABLE workers ADD COLUMN noshowCount INTEGER DEFAULT 0"); } catch (_) {}

// REVIEW_UX: reviewerRole 추적 + 작업자/농민 누적 평점
try { db.exec("ALTER TABLE reviews ADD COLUMN reviewerRole TEXT DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE workers ADD COLUMN ratingAvg   REAL    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE workers ADD COLUMN ratingCount INTEGER DEFAULT 0");   } catch (_) {}

console.log(`[DB] SQLite 연결 완료 → ${DB_PATH}`);
module.exports = db;
