# 📱 농민일손 — 모바일 외부 테스트 가이드

---

## ⚡ 빠른 시작 (3단계)

```
1단계: ngrok 설치 (최초 1회)
2단계: Auth Token 설정 (최초 1회)
3단계: 원클릭 시작
```

---

## 1단계 — ngrok 설치

### 방법 A: 자동 설치 스크립트 (권장)

PowerShell을 **관리자 권한**으로 열고:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-ngrok.ps1
```

설치 위치: `C:\tools\ngrok\ngrok.exe`

### 방법 B: 이미 설치되어 있음 (설치 확인)

```powershell
ngrok version
# 출력 예: ngrok version 3.37.6
```

### 방법 C: 수동 설치

1. https://ngrok.com/download 접속
2. Windows 64-bit ZIP 다운로드
3. `C:\tools\ngrok\` 에 압축 해제
4. 시스템 PATH에 `C:\tools\ngrok` 추가

---

## 2단계 — Auth Token 설정 (최초 1회)

### Token 발급

1. https://ngrok.com 회원가입 (무료)
2. https://dashboard.ngrok.com/get-started/your-authtoken 접속
3. Token 복사

### Token 등록

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-ngrok.ps1
```

또는 환경변수로 전달:

```powershell
$env:NGROK_AUTHTOKEN = "your_token_here"
powershell -ExecutionPolicy Bypass -File scripts\setup-ngrok.ps1
```

---

## 3단계 — 모바일 테스트 시작

### 방법 A: PowerShell 스크립트 (자동화, 권장)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-mobile.ps1
```

**자동으로 수행:**
1. 포트 3002 기존 프로세스 종료
2. React 빌드 (`npm run build`)
3. Express 서버 시작 (`node server/index.js`)
4. 포트 3002 준비 대기
5. ngrok 터널 시작
6. 공개 URL 출력 + 브라우저 자동 열기

**출력 예:**
```
╔══════════════════════════════════════════════════════════╗
║   📱 Mobile URL: https://abcd1234.ngrok-free.app         ║
║   🔍 ngrok 대시보드: http://localhost:4040               ║
║   💻 로컬 URL:      http://localhost:3002                 ║
╚══════════════════════════════════════════════════════════╝
```

### 방법 B: BAT 파일 (더블클릭 실행)

`scripts\start-mobile.bat` 파일을 더블클릭

### 방법 C: 수동 실행

```powershell
# 터미널 1 — 서버
npm run start:mobile

# 터미널 2 — 터널
ngrok http 3002
```

---

## 같은 Wi-Fi 내 접속 (ngrok 없이)

서버 시작 시 터미널에 출력되는 네트워크 IP 사용:

```
로컬:     http://localhost:3002
네트워크:  http://192.168.x.x:3002   ← 이 주소를 폰에 입력
```

---

## 헬스체크 + 진단 URL

| 엔드포인트 | 설명 |
|-----------|------|
| `GET /api/health` | 서버 상태 확인 |
| `GET /api/diagnostics` | DB·시드·분석 현황 전체 |
| `GET /api/analytics/summary` | 실사용 이벤트 통계 |
| `http://localhost:4040` | ngrok 대시보드 (로컬) |

예시:

```bash
curl http://localhost:3002/api/diagnostics
```

응답:

```json
{
  "ok": true,
  "server": "healthy",
  "db": "connected",
  "mode": "development",
  "seedEnabled": true,
  "analyticsActive": true,
  "counts": { "jobs": 12, "workers": 4, "analytics": 20 }
}
```

---

## 모바일 테스트 체크리스트

- [ ] 외부 URL로 폰 브라우저에서 앱 열림
- [ ] 로그인 (이름 + 전화번호) 동작
- [ ] 홈 화면 정상 렌더링 (농민/일손 모드 토글)
- [ ] 온보딩 3단계 안내 (최초 1회)
- [ ] 일손 구하기 → ⚡ 간편 모드 (10초 등록)
- [ ] 지원하기 → "이 일 할게요" 버튼
- [ ] 지원자 보기 → "누가 할 수 있나" → 선택
- [ ] 연락처 공개 → "📞 바로 전화하기" (전화 앱 연동)
- [ ] 내 연결 → 상태 배지 + 메시지 + 후기 버튼
- [ ] 위치 권한 허용 / 거부 흐름
- [ ] `GET /api/analytics/summary` 에서 이벤트 누적 확인

---

## 환경변수

`.env.example` 을 `.env` 로 복사 후 편집:

```powershell
copy .env.example .env
```

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3002` | 서버 포트 |
| `HOST` | `0.0.0.0` | 바인드 주소 |
| `CORS_ORIGIN` | `*` | 허용 오리진 |
| `USE_SEED_DATA` | `true` | 데모 데이터 삽입 |
| `NGROK_AUTHTOKEN` | — | ngrok 인증 토큰 |

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| `ngrok: command not found` | PATH 미등록 | `scripts\install-ngrok.ps1` 실행 후 새 터미널 |
| `ERR_NGROK_105` | Auth Token 미설정 | `scripts\setup-ngrok.ps1` 실행 |
| 서버 시작 실패 (포트 충돌) | 3002 이미 사용 중 | `scripts\kill-port.ps1` 실행 |
| 폰에서 접속 안 됨 | 방화벽 차단 | Windows 방화벽 3002 포트 허용 |
| API 요청 실패 (CORS) | CORS 설정 문제 | `.env`에 `CORS_ORIGIN=*` 확인 |
| 화면이 안 뜸 (빈 화면) | 빌드 안 됨 | `npm run build` 먼저 실행 |
| 데이터 없음 | 시드 미삽입 | `USE_SEED_DATA=true` 확인 |
| ngrok 무료 경고 페이지 | ngrok 무료 플랜 | URL에서 "Visit Site" 클릭 (1회) |

---

## 스크립트 목록

| 파일 | 용도 |
|------|------|
| `scripts\install-ngrok.ps1` | ngrok 자동 다운로드 + PATH 등록 |
| `scripts\setup-ngrok.ps1` | Auth Token 설정 |
| `scripts\start-mobile.ps1` | 원클릭 빌드 + 서버 + ngrok |
| `scripts\start-mobile.bat` | 더블클릭 실행 버전 |
| `scripts\kill-port.ps1` | 특정 포트 프로세스 종료 |

---

## 개발 모드 (Vite dev server)

```powershell
# 터미널 1: 백엔드
cd server; node index.js

# 터미널 2: 프론트엔드 (자동 핫리로드)
npm run dev
# → http://localhost:5175 (API는 자동으로 3002 프록시)
```
