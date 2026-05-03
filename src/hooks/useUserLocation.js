/**
 * useUserLocation — PHASE NEARBY_MATCH + AUTO_MATCH_ALERT
 *
 * 사용자 위치를 { lat, lng } 형식으로 반환.
 * 우선순위:
 *   1. localStorage 캐시 ('userLocation' → { lat, lon })  ← 이미 GPS 허용했으면 즉시 반환
 *   2. navigator.geolocation live 취득
 *
 * AUTO_MATCH_ALERT 추가:
 *   GPS 취득 성공 시 서버(/api/workers/location)로 위치 자동 전송
 *   → 작업자 프로필 있는 경우에만 서버에서 업데이트됨 (없으면 무시)
 *   → fire-and-forget, 실패해도 UX 영향 없음
 *
 * 반환값:
 *   location : { lat: number, lng: number } | null
 *   loading  : boolean
 *   retry    : () => void  — GPS 캐시 초기화 후 재시도
 */
import { useState, useEffect, useCallback } from 'react';

/** 서버에 현재 위치 전송 — fire-and-forget */
function pushLocationToServer(lat, lng) {
    const userId = localStorage.getItem('farm-userId');
    if (!userId) return;
    fetch('/api/workers/location', {
        method:  'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-user-id':    userId,
        },
        body: JSON.stringify({ lat, lng }),
    }).catch(() => {}); // fail-safe: 실패 무시
}

export function useUserLocation() {
    const [location,    setLocation]    = useState(null);
    const [loading,     setLoading]     = useState(true);
    const [retryCount,  setRetryCount]  = useState(0);

    useEffect(() => {
        setLoading(true);
        setLocation(null);

        // ① 첫 번째 시도에서만 캐시 사용 (retry 시 항상 fresh GPS)
        if (retryCount === 0) {
            try {
                const stored = JSON.parse(localStorage.getItem('userLocation'));
                if (stored && Number.isFinite(stored.lat) &&
                    Number.isFinite(stored.lon || stored.lng)) {
                    setLocation({ lat: stored.lat, lng: stored.lon ?? stored.lng });
                    setLoading(false);
                    return;
                }
            } catch (_) {}
        }

        // ② GPS 새로 취득
        if (!navigator.geolocation) {
            setLoading(false);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
                const loc = { lat: coords.latitude, lng: coords.longitude };
                setLocation(loc);
                try {
                    localStorage.setItem('userLocation', JSON.stringify({
                        lat: loc.lat, lon: loc.lng,
                    }));
                } catch (_) {}
                // AUTO_MATCH_ALERT: 서버에 현재 위치 전송 (작업자 실시간 매칭용)
                pushLocationToServer(loc.lat, loc.lng);
                setLoading(false);
            },
            () => {
                // GPS 거부 or 타임아웃 → null 유지
                setLoading(false);
            },
            { timeout: 8000, maximumAge: retryCount > 0 ? 0 : 60000 }
        );
    }, [retryCount]); // eslint-disable-line react-hooks/exhaustive-deps

    /** GPS 캐시 초기화 + 재요청 */
    const retry = useCallback(() => {
        try { localStorage.removeItem('userLocation'); } catch (_) {}
        setRetryCount(c => c + 1);
    }, []);

    return { location, loading, retry };
}
