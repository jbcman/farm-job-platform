@echo off
REM add-ngrok-path.bat — ngrok 을 현재 세션 PATH에 추가
REM scripts\add-ngrok-path.bat 또는 start-mobile.bat 내부에서 호출

setx PATH "%PATH%;C:\tools\ngrok" /M 2>nul || setx PATH "%PATH%;C:\tools\ngrok" 2>nul
echo [OK] C:\tools\ngrok 이 PATH에 추가되었습니다.
echo      새 터미널을 열면 ngrok 명령을 바로 사용할 수 있습니다.
