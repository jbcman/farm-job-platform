-- ================================================================
-- 농민 일손 플랫폼 — 마이그레이션 002
-- 목적: AI 추천 vs 실제 선택 비교 로깅 (모델 튜닝 데이터 수집)
-- 적용: node server/migrate_optimize.js  (002도 자동 포함)
-- ================================================================

-- ── match_logs ────────────────────────────────────────────────
-- 추천 시점에 삽입 (selected=false), 선택 확정 시 UPDATE (selected=true)
-- Top-1 선택률, Top-3 선택률 집계에 사용
--
-- ROLLBACK: DROP TABLE IF EXISTS match_logs;

CREATE TABLE IF NOT EXISTS match_logs (
    id             TEXT        PRIMARY KEY,
    jobid          TEXT        NOT NULL,
    workerid       TEXT        NOT NULL,
    rank           INT         NOT NULL,       -- 1=1위, 2=2위, 3=3위
    predictedscore FLOAT       NOT NULL,       -- successProb 0~1
    recommentscore INT,                        -- recommendScore 0~100
    selected       BOOLEAN     NOT NULL DEFAULT FALSE,
    selectedat     TIMESTAMPTZ,
    createdat      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- jobId 기반 집계 (Top-1/3 선택률 쿼리 최적화)
-- ROLLBACK: DROP INDEX IF EXISTS idx_match_logs_job;
CREATE INDEX IF NOT EXISTS idx_match_logs_job
    ON match_logs(jobid, createdat DESC);

-- 전체 선택률 집계
-- ROLLBACK: DROP INDEX IF EXISTS idx_match_logs_selected;
CREATE INDEX IF NOT EXISTS idx_match_logs_selected
    ON match_logs(selected, createdat DESC);
