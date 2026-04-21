@echo off
REM start-mobile.bat
REM 농민일손 모바일 테스트 원클릭 시작 (Windows CMD 버전)
REM 더블클릭 또는 cmd에서 실행 가능
REM
REM 전제:
REM   - Node.js 설치됨
REM   - ngrok 설치됨 (C:\tools\ngrok\ngrok.exe)
REM   - ngrok auth token 설정됨

title 농민일손 — 모바일 테스트

echo.
echo  ╔══════════════════════════════════════╗
echo  ║  🌾 농민일손 - 모바일 테스트 시작    ║
echo  ╚══════════════════════════════════════╝
echo.

REM ngrok PATH 추가
set PATH=%PATH%;C:\tools\ngrok

REM ngrok 존재 확인
ngrok version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] ngrok 가 없습니다.
    echo  설치: powershell -ExecutionPolicy Bypass -File scripts\install-ngrok.ps1
    pause
    exit /b 1
)

REM 기존 포트 3002 종료
echo  [1/3] 기존 서버 확인 중...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3002 "') do (
    echo         PID %%a 종료 중...
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

REM 서버 시작 (새 창)
echo  [2/3] 서버 빌드 및 시작 중...
cd /d "%~dp0.."
start "농민일손 서버" cmd /k "npm run start:mobile"

REM 포트 3002 대기
echo  [3/3] 서버 준비 대기 중...
:WAIT
timeout /t 2 /nobreak >nul
netstat -ano | findstr ":3002 " >nul 2>&1
if errorlevel 1 goto WAIT
echo  [OK] 서버 준비 완료!

REM ngrok 시작 (새 창)
echo.
echo  ngrok 터널 시작 중...
start "ngrok 터널" cmd /k "ngrok http 3002"

timeout /t 3 /nobreak >nul

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║  ngrok 대시보드에서 공개 URL을 확인하세요        ║
echo  ║  http://localhost:4040                           ║
echo  ╚══════════════════════════════════════════════════╝
echo.
echo  브라우저에서 http://localhost:4040 를 열어 URL을 확인하세요.
start http://localhost:4040
echo.
pause
