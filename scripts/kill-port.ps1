# kill-port.ps1
# 특정 포트를 점유 중인 프로세스를 종료
# 사용: powershell -ExecutionPolicy Bypass -File scripts\kill-port.ps1 -Port 3002

param([int]$Port = 3002)

Write-Host "포트 $Port 점유 프로세스 검색 중..." -ForegroundColor Yellow

$pids = netstat -ano 2>$null |
    Select-String ":$Port\s" |
    ForEach-Object { ($_ -split '\s+')[-1] } |
    Where-Object { $_ -match '^\d+$' } |
    Select-Object -Unique

if (-not $pids) {
    Write-Host "✅ 포트 $Port 를 점유 중인 프로세스 없음" -ForegroundColor Green
    exit 0
}

foreach ($p in $pids) {
    try {
        $proc = Get-Process -Id $p -ErrorAction Stop
        Write-Host "  종료: PID=$p  이름=$($proc.Name)" -ForegroundColor Gray
        Stop-Process -Id $p -Force
        Write-Host "  ✅ 종료 완료" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠️  PID $p 종료 실패: $_" -ForegroundColor Yellow
    }
}
