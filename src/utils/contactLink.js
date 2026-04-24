/**
 * contactLink.js — SMS / 전화 / 카카오톡 연락 링크 생성
 *
 * getSMSLink(job, skillLevel)  → sms: URI (body 자동 삽입)
 * getCallLink(job)             → tel: URI
 * getKakaoLink(job)            → 카카오 오픈채팅 URL or null
 * copyPhoneToClipboard(phone)  → Promise<boolean>
 *
 * 전화번호 탐색 우선순위:
 *   job.phone → job.contact → job.phoneFull → job.farmerPhone → null
 */
import { buildContactMessage } from './messageTemplate.js';

// ── 전화번호 추출 ─────────────────────────────────────────────
function extractPhone(job) {
  if (!job) return '';
  const raw = job.phone || job.contact || job.phoneFull || job.farmerPhone || '';
  return raw.replace(/[^0-9+]/g, '');
}

// ── SMS 링크 ──────────────────────────────────────────────────
/**
 * @param {object} job
 * @param {'beginner'|'experienced'|'expert'} [skillLevel]
 * @returns {string|null}
 */
export function getSMSLink(job, skillLevel = 'experienced') {
  const phone = extractPhone(job);
  if (!phone) return null;
  const msg = buildContactMessage(job, skillLevel);
  return `sms:${phone}?body=${encodeURIComponent(msg)}`;
}

// ── 전화 링크 ─────────────────────────────────────────────────
/**
 * @param {object} job
 * @returns {string|null}
 */
export function getCallLink(job) {
  const phone = extractPhone(job);
  return phone ? `tel:${phone}` : null;
}

// ── 전화번호 클립보드 복사 ─────────────────────────────────────
/**
 * @param {object} job
 * @returns {Promise<boolean>}  true = 복사 성공
 */
export async function copyPhoneToClipboard(job) {
  const raw = job?.phone || job?.contact || job?.phoneFull || job?.farmerPhone || '';
  if (!raw) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(raw);
      return true;
    }
    // 구형 브라우저 폴백
    const el = document.createElement('input');
    el.value = raw;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    return true;
  } catch (_) {
    return false;
  }
}

// ── 카카오톡 오픈채팅 링크 ─────────────────────────────────────
/**
 * job.kakaoLink 필드가 있으면 그대로 사용
 * 없으면 null (버튼 비노출)
 *
 * @param {object} job
 * @returns {string|null}
 */
export function getKakaoLink(job) {
  if (!job) return null;
  const link = job.kakaoLink || job.kakaoOpenLink || null;
  if (!link) return null;
  // https://open.kakao.com/... 형식 검증
  if (link.startsWith('https://open.kakao.com/') || link.startsWith('https://kakao.me/')) {
    return link;
  }
  return null;
}
