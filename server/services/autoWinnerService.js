'use strict';
/**
 * autoWinnerService.js — PHASE AUTO_WINNER
 *
 * 10분마다 호출 → 활성 실험 분석 → 조건 충족 시 승자 자동 승격 + 실험 비활성화
 *
 * 안전 규칙:
 *   - 이미 결정된 실험: 재처리 없음 (중복 방지)
 *   - 데이터 부족 (< MIN_IMPRESSIONS): 승격 금지
 *   - lift < 5%: 승격 금지 (실질 차이 없음)
 *   - 오류 발생: 로그만 출력, 서버 중단 없음
 */
const db = require('../db');
const { analyzeExperiment } = require('./abAnalyzer');

const stmtActiveExp     = db.prepare('SELECT * FROM experiments WHERE isActive = 1 LIMIT 1');
const stmtCheckResult   = db.prepare('SELECT 1 FROM experiment_results WHERE experimentId = ?');
const stmtInsertResult  = db.prepare(
    'INSERT INTO experiment_results (experimentId, winnerVariant, decidedAt) VALUES (?, ?, ?)'
);
const stmtDeactivateExp = db.prepare('UPDATE experiments SET isActive = 0 WHERE id = ?');

function runAutoWinner() {
    try {
        const exp = stmtActiveExp.get();
        if (!exp) return; // 활성 실험 없음

        // 이미 결정된 실험 → 건너뜀
        if (stmtCheckResult.get(exp.id)) return;

        // 분석
        const result = analyzeExperiment(exp.id);
        if (!result) return; // 표본 부족 or lift 미달

        // 승자 기록 + 실험 비활성화 (트랜잭션)
        db.transaction(() => {
            stmtInsertResult.run(exp.id, result.winner, Date.now());
            stmtDeactivateExp.run(exp.id);
        })();

        console.log(
            `[AUTO_WINNER] ✓ 실험=${exp.id} 승자=${result.winner}` +
            ` lift=${(result.lift * 100).toFixed(1)}%` +
            ` applyRate=${(result.applyRate * 100).toFixed(2)}%`
        );

    } catch (e) {
        console.error('[AUTO_WINNER] 오류 (무시):', e.message);
    }
}

module.exports = { runAutoWinner };
