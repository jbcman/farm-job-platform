/**
 * kakao.js — 카카오 공유 유틸
 * Kakao JS SDK가 로드된 경우에만 동작, 없으면 null 반환 (fail-safe)
 * JS SDK 키: import.meta.env.VITE_KAKAO_JS_KEY
 */

let _initialized = false;

function tryInit() {
  if (_initialized) return true;
  try {
    const key = import.meta.env.VITE_KAKAO_JS_KEY;
    if (!key || !window.Kakao) return false;
    if (!window.Kakao.isInitialized()) window.Kakao.init(key);
    _initialized = true;
    return true;
  } catch (_) { return false; }
}

/**
 * 카카오로 일자리 공유
 * @param {object} job  — { id, category, pay, locationText, thumbUrl, imageUrl }
 * @param {string} pageUrl — 현재 앱 URL (딥링크 포함)
 * @returns {boolean} — 성공 여부
 */
export function shareJobKakao(job, pageUrl) {
  if (!tryInit()) return false;
  try {
    const emoji = { '밭갈이': '🚜', '방제': '💊', '수확 일손': '🌾', '예초': '✂️', '로터리': '🔄', '두둑': '⛰️' }[job.category] || '🌱';
    const title = `${emoji} ${job.category} 구인 — ${job.locationText}`;
    const desc  = job.pay ? `💰 일당 ${job.pay}  |  지금 지원 가능` : '지금 바로 지원하세요';
    const imgUrl = job.thumbUrl || job.imageUrl || null;

    const feedObj = {
      objectType: 'feed',
      content: {
        title,
        description: desc,
        ...(imgUrl ? { imageUrl: imgUrl } : {}),
        link: {
          mobileWebUrl: pageUrl,
          webUrl:       pageUrl,
        },
      },
      buttons: [{ title: '👉 지금 지원하기', link: { mobileWebUrl: pageUrl, webUrl: pageUrl } }],
    };

    window.Kakao.Share.sendDefault(feedObj);
    return true;
  } catch (_) { return false; }
}

/** SDK 사용 가능 여부 */
export function isKakaoAvailable() {
  return tryInit();
}
