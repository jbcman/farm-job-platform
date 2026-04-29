/**
 * useToast — 공유 Toast 훅
 * const { toast, showToast } = useToast();
 * showToast('메시지', 3000);  // ms 기본 2500
 */
import { useState, useRef, useCallback } from 'react';

export function useToast(defaultMs = 2500) {
  const [toast, setToast] = useState('');
  const timerRef = useRef(null);

  const showToast = useCallback((msg, ms = defaultMs) => {
    setToast(msg);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(''), ms);
  }, [defaultMs]);

  return { toast, showToast };
}

/** Toast 렌더 컴포넌트 — JSX 반환 (fragment에 포함) */
export function ToastBanner({ toast }) {
  if (!toast) return null;
  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[9999]
                    bg-gray-800 text-white rounded-full px-5 py-2.5
                    text-sm font-bold shadow-lg
                    animate-fade-in pointer-events-none whitespace-nowrap">
      {toast}
    </div>
  );
}
