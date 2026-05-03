'use strict';
/**
 * autoWinnerService.js — 승자 자동 승격 (PostgreSQL 비동기)
 */
const db = require('../db');
const { analyzeExperiment } = require('./abAnalyzer');

const stmtActiveExp     = db.prepare('SELECT * FROM experiments WHERE isActive = 1 LIMIT 1');
const stmtCheckResult   = db.prepare('SELECT 1 FROM experiment_results WHERE experimentId = ?');
const stmtInsertResult  = db.prepare(
    'INSERT INTO experiment_results (experimentId, winnerVariant, decidedAt) VALUES (?, ?, ?)'
);
const stmtDeactivateExp = db.prepare('UPDATE experiments SET isActive = 0 WHERE id = ?');

async function runAutoWinner() {
    try {
        const exp = await stmtActiveExp.get();
        if (!exp) return;

        if (await stmtCheckResult.get(exp.id)) return;

        const result = await analyzeExperiment(exp.id);
        if (!result) return;

        await db.transaction(async () => {
            await stmtInsertResult.run(exp.id, result.winner, Date.now());
            await stmtDeactivateExp.run(exp.id);
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
