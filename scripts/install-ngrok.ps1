# install-ngrok.ps1
# ngrok Windows 바이너리 자동 다운로드 + PATH 등록
# 실행: powershell -ExecutionPolicy Bypass -File scripts\install-ngrok.ps1

$ErrorActionPreference = 'Stop'
$NgrokDir  = "C:\tools\ngrok"
$NgrokExe  = "$NgrokDir\ngrok.exe"
$NgrokZip  = "$env:TEMP\ngrok.zip"
$NgrokUrl  = "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip"

Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "   🌾 농민일손 — ngrok 설치 스크립트       " -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── 1. 이미 설치됐는지 확인 ─────────────────────────────────────
if (Test-Path $NgrokExe) {
    $ver = & $NgrokExe version 2>&1
    Write-Host "✅ ngrok 이미 설치됨: $ver" -ForegroundColor Green
} else {
    # ── 2. 설치 폴더 생성 ──────────────────────────────────────
    if (-not (Test-Path $NgrokDir)) {
        New-Item -ItemType Directory -Path $NgrokDir -Force | Out-Null
        Write-Host "📁 폴더 생성: $NgrokDir" -ForegroundColor Gray
    }

    # ── 3. 다운로드 ────────────────────────────────────────────
    Write-Host "⬇️  ngrok 다운로드 중..." -ForegroundColor Yellow
    Write-Host "    URL: $NgrokUrl" -ForegroundColor Gray
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $NgrokUrl -OutFile $NgrokZip -UseBasicParsing
        Write-Host "✅ 다운로드 완료" -ForegroundColor Green
    } catch {
        Write-Host "❌ 다운로드 실패: $_" -ForegroundColor Red
        Write-Host "   수동 다운로드: https://ngrok.com/download" -ForegroundColor Yellow
        exit 1
    }

    # ── 4. 압축 해제 ───────────────────────────────────────────
    Write-Host "📦 압축 해제 중..." -ForegroundColor Yellow
    try {
        Expand-Archive -Path $NgrokZip -DestinationPath $NgrokDir -Force
        Remove-Item $NgrokZip -Force
        Write-Host "✅ 압축 해제 완료 → $NgrokExe" -ForegroundColor Green
    } catch {
        Write-Host "❌ 압축 해제 실패: $_" -ForegroundColor Red
        exit 1
    }

    if (-not (Test-Path $NgrokExe)) {
        Write-Host "❌ ngrok.exe 가 없습니다. 압축 내용을 확인하세요." -ForegroundColor Red
        Get-ChildItem $NgrokDir
        exit 1
    }
}

# ── 5. PATH 등록 (현재 사용자) ──────────────────────────────────
$UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($UserPath -notlike "*$NgrokDir*") {
    [Environment]::SetEnvironmentVariable("PATH", "$UserPath;$NgrokDir", "User")
    Write-Host "✅ PATH 등록 완료: $NgrokDir" -ForegroundColor Green
    Write-Host "   ⚠️  새 터미널에서 적용됩니다" -ForegroundColor Yellow
} else {
    Write-Host "✅ PATH 이미 등록됨" -ForegroundColor Green
}

# 현재 세션에도 즉시 적용
$env:PATH = "$env:PATH;$NgrokDir"

# ── 6. 설치 확인 ───────────────────────────────────────────────
Write-Host ""
try {
    $version = & "$NgrokExe" version 2>&1
    Write-Host "🎉 ngrok 설치 성공!" -ForegroundColor Green
    Write-Host "   버전: $version" -ForegroundColor Gray
} catch {
    Write-Host "❌ ngrok 실행 실패: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  다음 단계: Auth Token 설정" -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\setup-ngrok.ps1" -ForegroundColor White
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
