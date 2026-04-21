import React from 'react';
import { Phone, X, CheckCircle } from 'lucide-react';
import { trackClientEvent } from '../utils/api.js';

/**
 * ContactRevealModal
 * 농민이 작업자를 선택하면 양쪽 연락처를 공개
 */
export default function ContactRevealModal({ contact, onClose }) {
  if (!contact) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-t-3xl p-6 animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2 text-farm-green">
            <CheckCircle size={22} />
            <span className="text-lg font-bold">연결 완료!</span>
          </div>
          <button onClick={onClose} className="text-gray-400 p-1">
            <X size={22} />
          </button>
        </div>

        <p className="text-gray-600 text-sm mb-5">{contact.message}</p>

        {/* 작업자 연락처 — 강조 */}
        <div className="bg-farm-light border-2 border-farm-green rounded-2xl p-4 mb-3">
          <p className="text-xs text-farm-green font-bold mb-1">작업자 연락처</p>
          <p className="text-xl font-bold text-gray-800 mb-2">{contact.workerName}</p>
          <a
            href={`tel:${contact.workerPhone}`}
            onClick={() => trackClientEvent('call_clicked', { source: 'reveal_modal' })}
            className="flex items-center gap-2 font-black text-2xl text-farm-green tracking-wide"
          >
            <Phone size={22} fill="currentColor" />
            {contact.workerPhone}
          </a>
        </div>

        {/* 내 연락처 */}
        <div className="bg-gray-50 rounded-2xl p-4 mb-5">
          <p className="text-xs text-gray-500 font-bold mb-1">내 연락처 (작업자에게 공유됨)</p>
          <p className="text-base font-bold text-gray-800 mb-0.5">{contact.farmerName}</p>
          <p className="text-gray-600 text-sm">{contact.farmerPhone}</p>
        </div>

        {/* 📞 바로 전화하기 — 메인 CTA */}
        <a
          href={`tel:${contact.workerPhone}`}
          onClick={() => trackClientEvent('call_clicked', { source: 'cta_button' })}
          className="flex items-center justify-center gap-2 w-full py-4
                     bg-farm-green text-white font-bold text-lg rounded-2xl
                     shadow-lg active:scale-95 transition-transform"
        >
          <Phone size={22} fill="white" />
          📞 바로 전화하기
        </a>

        <button
          onClick={onClose}
          className="w-full mt-3 py-2 text-gray-400 text-sm"
        >
          나중에 연락할게요
        </button>
      </div>
    </div>
  );
}
