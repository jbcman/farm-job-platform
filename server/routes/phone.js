'use strict';
/**
 * /api/phone — 토큰 기반 전화번호 안전 연결
 *
 * POST /api/phone/request  { jobId } → { token }  (2분 유효, 1회용)
 * GET  /api/phone/resolve/:token     → { phone }
 *
 * IP 기준 분당 10회 제한 (스팸 방지)
 */
const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ── 인메모리 토큰 저장소 (MVP) ──────────────────────────────────
const tokens  = new Map();  // token → { phone, expire }
const ipCalls = new Map();  // ip    → timestamp[]

// 만료 토큰 5분마다 정리
setInterval(() => {
  const now = Date.now();
  for (const [t, d] of tokens) { if (d.expire < now) tokens.delete(t); }
  for (const [ip, ts] of ipCalls) {
    const fresh = ts.filter(t => now - t < 60000);
    if (fresh.length === 0) ipCalls.delete(ip); else ipCalls.set(ip, fresh);
  }
}, 5 * 60 * 1000);

// ── POST /api/phone/request ─────────────────────────────────────
router.post('/request', async (req, res) => {
  const ip  = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();

  // IP 기준 분당 10회 제한
  const recent = (ipCalls.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 10) {
    return res.status(429).json({ error: '잠시 후 다시 시도해주세요' });
  }
  ipCalls.set(ip, [...recent, now]);

  const { jobId } = req.body;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  // DB에서 phone 조회
  let phone = null;
  try {
    const job = await db.prepare('SELECT requesterId FROM jobs WHERE id = ?').get(String(jobId));
    if (job?.requesterId) {
      const user = await db.prepare('SELECT phone FROM users WHERE id = ?').get(job.requesterId);
      phone = user?.phone || null;
    }
  } catch (e) {
    console.error('[PHONE_REQUEST] db error', e.message);
    return res.status(500).json({ error: 'server error' });
  }

  if (!phone) {
    return res.status(404).json({ error: '연락처가 등록되지 않았습니다' });
  }

  const token = 't_' + now + '_' + Math.random().toString(36).slice(2, 9);
  tokens.set(token, { phone, expire: now + 2 * 60 * 1000 });

  console.log(`[PHONE_TOKEN] jobId=${jobId} ip=${ip}`);
  return res.json({ token });
});

// ── GET /api/phone/resolve/:token ───────────────────────────────
router.get('/resolve/:token', (req, res) => {
  const data = tokens.get(req.params.token);
  if (!data || data.expire < Date.now()) {
    return res.status(400).json({ error: '만료된 연결입니다. 다시 시도해주세요' });
  }
  tokens.delete(req.params.token); // 1회용
  return res.json({ phone: data.phone });
});

module.exports = router;
