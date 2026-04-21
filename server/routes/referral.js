'use strict';
const express = require('express');
const db      = require('../db');

const router = express.Router();

/** 랜덤 6자리 추천 코드 생성 */
function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ─── GET /api/referral/my ─────────────────────────────────
// 내 추천 코드 조회 (없으면 생성)
router.get('/my', (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ ok: false, error: '로그인이 필요해요.' });

  let user = db.prepare('SELECT id, referralCode, referralCount FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ ok: false, error: '사용자를 찾을 수 없어요.' });

  if (!user.referralCode) {
    let code;
    let attempts = 0;
    do {
      code = genCode();
      attempts++;
    } while (db.prepare('SELECT id FROM users WHERE referralCode = ?').get(code) && attempts < 20);

    db.prepare('UPDATE users SET referralCode = ? WHERE id = ?').run(code, userId);
    user = { ...user, referralCode: code };
  }

  return res.json({ ok: true, referralCode: user.referralCode, referralCount: user.referralCount || 0 });
});

// ─── POST /api/referral/use ──────────────────────────────
// 추천 코드 입력 → referredBy 저장
router.post('/use', (req, res) => {
  const { code } = req.body;
  const userId   = req.headers['x-user-id'];

  if (!userId) return res.status(401).json({ ok: false, error: '로그인이 필요해요.' });
  if (!code)   return res.status(400).json({ ok: false, error: '추천 코드를 입력해주세요.' });

  const me = db.prepare('SELECT id, referredBy FROM users WHERE id = ?').get(userId);
  if (!me) return res.status(404).json({ ok: false, error: '사용자를 찾을 수 없어요.' });
  if (me.referredBy) return res.status(409).json({ ok: false, error: '이미 추천 코드를 입력했어요.' });

  const referrer = db.prepare('SELECT id FROM users WHERE referralCode = ?').get(code.toUpperCase());
  if (!referrer) return res.status(404).json({ ok: false, error: '유효하지 않은 추천 코드예요.' });
  if (referrer.id === userId) return res.status(400).json({ ok: false, error: '자기 자신 추천은 불가해요.' });

  db.prepare('UPDATE users SET referredBy = ? WHERE id = ?').run(referrer.id, userId);
  console.log(`[REFERRAL_USED] userId=${userId} referrerId=${referrer.id} code=${code}`);

  return res.json({ ok: true, message: '추천 코드가 등록되었어요!' });
});

// ─── POST /api/referral/reward ───────────────────────────
// 추천인 보상 (첫 작업 완료 시 jobs.js에서 fire-and-forget 호출용)
router.post('/reward', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ ok: false });

  try {
    const user = db.prepare('SELECT referredBy FROM users WHERE id = ?').get(userId);
    if (!user?.referredBy) return res.json({ ok: true, rewarded: false });

    // 이미 보상 받은 경우 (첫 완료 외 중복 방지) → referralRewarded 플래그 체크
    const alreadyRewarded = db.prepare('SELECT referralRewarded FROM users WHERE id = ?').get(userId);
    if (alreadyRewarded?.referralRewarded) return res.json({ ok: true, rewarded: false });

    db.prepare('UPDATE users SET referralCount = COALESCE(referralCount, 0) + 1 WHERE id = ?').run(user.referredBy);
    db.prepare('UPDATE users SET referralRewarded = 1 WHERE id = ?').run(userId);
    console.log(`[REFERRAL_REWARD] referrerId=${user.referredBy} newUserId=${userId}`);

    return res.json({ ok: true, rewarded: true });
  } catch (e) {
    return res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
