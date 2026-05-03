-- ================================================================
-- 농민 일손 플랫폼 — 마이그레이션 001
-- 목적: 핵심 쿼리 인덱스 + Haversine 거리 계산 함수
-- 적용: node server/migrate_optimize.js
-- 롤백: 각 줄 옆 ROLLBACK 주석 참조
-- ================================================================

-- ── jobs ──────────────────────────────────────────────────────

-- status 단일 필터 (목록 조회, open 건 수 집계)
-- ROLLBACK: DROP INDEX IF EXISTS idx_jobs_status;
CREATE INDEX IF NOT EXISTS idx_jobs_status
    ON jobs(status);

-- status + createdat 복합 (open 공고 최신순)
-- ROLLBACK: DROP INDEX IF EXISTS idx_jobs_status_created;
CREATE INDEX IF NOT EXISTS idx_jobs_status_created
    ON jobs(status, createdat DESC);

-- 위치 기반 nearby 필터 (latitude/longitude 쌍)
-- ROLLBACK: DROP INDEX IF EXISTS idx_jobs_location;
CREATE INDEX IF NOT EXISTS idx_jobs_location
    ON jobs(latitude, longitude);

-- 농민 본인 공고 조회
-- ROLLBACK: DROP INDEX IF EXISTS idx_jobs_requester;
CREATE INDEX IF NOT EXISTS idx_jobs_requester
    ON jobs(requesterid);

-- ── applications ──────────────────────────────────────────────

-- 작업자별 지원 이력 조회 (기존 jobrequestid 인덱스와 쌍)
-- ROLLBACK: DROP INDEX IF EXISTS idx_applications_worker;
CREATE INDEX IF NOT EXISTS idx_applications_worker
    ON applications(workerid);

-- ── reviews ───────────────────────────────────────────────────

-- 수신자(작업자/농민)별 평점 조회 (getRequesterRating 최적화)
-- ROLLBACK: DROP INDEX IF EXISTS idx_reviews_target;
CREATE INDEX IF NOT EXISTS idx_reviews_target
    ON reviews(targetid);

-- ── messages ──────────────────────────────────────────────────

-- 채팅방 메시지 목록 조회
-- ROLLBACK: DROP INDEX IF EXISTS idx_messages_job;
CREATE INDEX IF NOT EXISTS idx_messages_job
    ON messages(jobid, createdat);

-- ── notify_log ────────────────────────────────────────────────

-- jobId별 알림 이력 조회 (중복 방지 체크 최적화)
-- ROLLBACK: DROP INDEX IF EXISTS idx_notify_log_job;
CREATE INDEX IF NOT EXISTS idx_notify_log_job
    ON notify_log(jobid);

-- ================================================================
-- Haversine 거리 계산 함수 (DB-side, km 반환)
--
-- 특성:
--   IMMUTABLE  → 동일 입력 = 동일 출력, 인덱스 표현식에 사용 가능
--   STRICT     → NULL 입력 시 자동으로 NULL 반환 (NULL-safe)
--   atan2 공식 → acos 기반보다 수치 안정적
--
-- 롤백: DROP FUNCTION IF EXISTS distance_km(FLOAT, FLOAT, FLOAT, FLOAT);
-- ================================================================
CREATE OR REPLACE FUNCTION distance_km(
    lat1  FLOAT,
    lon1  FLOAT,
    lat2  FLOAT,
    lon2  FLOAT
)
RETURNS FLOAT AS $$
DECLARE
    R    FLOAT := 6371;
    dlat FLOAT;
    dlon FLOAT;
    a    FLOAT;
BEGIN
    dlat := radians(lat2 - lat1);
    dlon := radians(lon2 - lon1);
    a    := sin(dlat / 2) ^ 2
          + cos(radians(lat1)) * cos(radians(lat2))
          * sin(dlon / 2) ^ 2;
    RETURN R * 2 * atan2(sqrt(a), sqrt(1 - a));
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;
