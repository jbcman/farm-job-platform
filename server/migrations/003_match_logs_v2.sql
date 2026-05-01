-- ================================================================
-- 농민 일손 플랫폼 — 마이그레이션 003
-- 목적: match_logs 노출→클릭→선택 퍼널 컬럼 추가
--       + top10 저장 지원 (rank <= 10)
-- 적용: node server/migrate_optimize.js
-- ================================================================

-- viewed  : TOP3 패널이 화면에 노출됐을 때 TRUE
-- clicked : "바로 선택" 버튼을 눌렀을 때 TRUE (선택 확정 전)
-- ROLLBACK: ALTER TABLE match_logs DROP COLUMN IF EXISTS viewed;
--           ALTER TABLE match_logs DROP COLUMN IF EXISTS clicked;

ALTER TABLE match_logs
    ADD COLUMN IF NOT EXISTS viewed  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS clicked BOOLEAN NOT NULL DEFAULT FALSE;

-- rank ≤ 10 범위 전체를 빠르게 읽기 위한 보조 인덱스
-- ROLLBACK: DROP INDEX IF EXISTS idx_match_logs_rank;
CREATE INDEX IF NOT EXISTS idx_match_logs_rank
    ON match_logs(rank, createdat DESC);
