import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  // 프로덕션 빌드 → dist/ (Express가 ../dist로 서빙)
  build: {
    outDir:   'dist',
    emptyOutDir: true,
    // 소스맵: 모바일 테스트 시 디버깅 용이
    sourcemap: process.env.NODE_ENV !== 'production',
  },

  server: {
    port: 5175,
    open: true,
    // host: true → 로컬 네트워크에서 Vite dev 서버에도 접근 가능 (개발 전용)
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
});
