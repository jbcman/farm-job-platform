# setup-ngrok.ps1
# ngrok Auth Token 설정
# 실행: powershell -ExecutionPolicy Bypass -File scripts\setup-ngrok.ps1
# 환경변수로 전달도 가능: $env:NGROK_AUTHTOKEN="xxxx"; .\scripts\setup-ngrok.ps1

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "   🌾 농민일손 — ngrok Auth Token 설정     " -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── ngrok 설치 확인 ──────────────────────────────────────────────
$NgrokCmd = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $NgrokCmd) {
    $NgrokExe = "C:\tools\ngrok\ngrok.exe"
    if (Test-Path $NgrokExe) {
        $env:PATH = "$env:PATH;C:\tools\ngrok"
    } else {
        Write-Host "❌ ngrok 가 설치되지 않았습니다." -ForegroundColor Red
        Write-Host "   먼저 실행: powershell -ExecutionPolicy Bypass -File scripts\install-ngrok.ps1" -ForegroundColor Yellow
        exit 1
    }
}

# ── Auth Token 가져오기 ──────────────────────────────────────────
$token = $env:NGROK_AUTHTOKEN

if (-not $token) {
    Write-Host "📋 ngrok Auth Token 을 입력하세요." -ForegroundColor Yellow
    Write-Host "   발급: https://dashboard.ngrok.com/get-started/your-authtoken" -ForegroundColor Gray
    Write-Host ""
    $token = Read-Host "   Token"
}

if (-not $token -or $token.Trim() -eq '') {
    Write-Host "❌ Token 이 비어 있습니다. 취소합니다." -ForegroundColor Red
    exit 1
}

$token = $token.Trim()

# ── Token 적용 ───────────────────────────────────────────────────
Write-Host ""
Write-Host "🔑 Auth Token 등록 중..." -ForegroundColor Yellow
try {
    & ngrok config add-authtoken $token 2>&1 | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }
    Write-Host ""
    Write-Host "✅ Auth Token 등록 완료!" -ForegroundColor Green
} catch {
    Write-Host "❌ Token 등록 실패: $_" -ForegroundColor Red
    exit 1
}

# ── 환경변수에도 저장 (현재 사용자) ─────────────────────────────
[Environment]::SetEnvironmentVariable("NGROK_AUTHTOKEN", $token, "User")
Write-Host "✅ 환경변수 NGROK_AUTHTOKEN 저장 완료" -ForegroundColor Green

Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  다음 단계: 모바일 테스트 시작" -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\start-mobile.ps1" -ForegroundColor White
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
