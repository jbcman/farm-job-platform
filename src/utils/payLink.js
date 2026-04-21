/**
 * payLink.js — PHASE FARMER_PAY_UX
 * 카카오/문자/계좌/전화 결제 링크 생성 유틸
 */

const OPERATOR_PHONE = import.meta.env.VITE_OPERATOR_PHONE || '01012345678';

export const BANK_INFO = {
    bank:    import.meta.env.VITE_BANK_NAME    || '농협',
    account: import.meta.env.VITE_BANK_ACCOUNT || '302-0000-0000-00',
    holder:  import.meta.env.VITE_BANK_HOLDER  || '농촌일손플랫폼',
    amount:  3000,
};

export function getOperatorPhone() {
    return OPERATOR_PHONE;
}

/**
 * SMS/카카오 결제 문의 링크
 * sms:로 시작 → 카카오톡 미설치 시 문자로 fallback
 */
export function getPaySmsLink(job) {
    const body = [
        `🌾 긴급 공고 결제 문의`,
        `공고: ${job.category || ''} (${job.locationText || ''})`,
        `금액: ${BANK_INFO.amount.toLocaleString()}원`,
        `결제 부탁드립니다.`,
    ].join('\n');
    return `sms:${OPERATOR_PHONE}?body=${encodeURIComponent(body)}`;
}

/**
 * 전화 연결 링크
 */
export function getPhoneLink() {
    return `tel:${OPERATOR_PHONE}`;
}

/**
 * 계좌 정보 복사 문자열
 */
export function getBankCopyText() {
    return `${BANK_INFO.bank} ${BANK_INFO.account} (${BANK_INFO.holder}) ${BANK_INFO.amount.toLocaleString()}원`;
}
