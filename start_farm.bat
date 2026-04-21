@echo off
title FARM ONE-CLICK START

echo ===================================
echo 🚀 FARM PLATFORM START
echo ===================================

:: 1. 프로젝트 이동
cd /d F:\플라윙스_작업\농민일손_플랫폼

echo.
echo [1/3] 📦 BUILD...
call npm run build

echo.
echo [2/3] 🔄 SERVER...
cd server

:: 서버 실행 (없으면 start, 있으면 restart)
pm2 describe farm-server >nul 2>&1
if %errorlevel%==0 (
    pm2 restart farm-server
) else (
    pm2 start index.js --name farm-server
)

echo.
echo [3/3] 🌐 NGROK...
cd /d C:\tools\ngrok

start "" cmd /k "ngrok http 3002"

echo.
echo ===================================
echo ✅ 완료!
echo 👉 ngrok 주소 복사해서 휴대폰 접속
echo ===================================

pause