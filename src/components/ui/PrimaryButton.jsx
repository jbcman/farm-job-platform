import React from 'react';

/**
 * PrimaryButton — PHASE UI_INTEGRATION
 * 재사용 가능한 그린 CTA 버튼 (full width, rounded)
 */
export default function PrimaryButton({ children, onClick, disabled, className = '', ...rest }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`btn-primary btn-full flex items-center justify-center gap-2
                  active:scale-95 transition-transform disabled:opacity-50
                  disabled:cursor-not-allowed ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
