# start-mobile.ps1
# Run: .\scripts\start-mobile.ps1

param(
    [int]$Port = 3002,
    [switch]$NoBrowser
)

$NgrokExe   = "C:\tools\ngrok\ngrok.exe"
$ProjectDir = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "========================================"
Write-Host " Mobile Test Start"
Write-Host "========================================"
Write-Host ""

# --- Step 1: Kill existing node on port ---
Write-Host "[1/5] Cleaning up port $Port..."
$pids = @()
try {
    $lines = netstat -ano 2>$null | Select-String ":$Port\s"
    foreach ($line in $lines) {
        $parts = ($line.ToString().Trim() -split '\s+')
        $p = $parts[-1]
        if ($p -match '^\d+$' -and $p -ne '0') { $pids += $p }
    }
    $pids = $pids | Select-Object -Unique
    foreach ($p in $pids) {
        Stop-Process -Id ([int]$p) -Force -ErrorAction SilentlyContinue
        Write-Host "    Killed PID $p"
    }
} catch {
    Write-Host "    No process to kill"
}
Start-Sleep -Seconds 1
Write-Host "    Done"

# --- Step 2: Start server ---
Write-Host ""
Write-Host "[2/5] Starting server (npm run start:mobile)..."
$serverProc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c cd /d `"$ProjectDir`" && npm run start:mobile" `
    -PassThru -WindowStyle Normal
Write-Host "    Server PID: $($serverProc.Id)"

# --- Step 3: Wait for port ---
Write-Host ""
Write-Host "[3/5] Waiting for port $Port..."
$ready   = $false
$elapsed = 0
$maxWait = 90

while (-not $ready -and $elapsed -lt $maxWait) {
    Start-Sleep -Seconds 2
    $elapsed += 2
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", $Port)
        $tcp.Close()
        $ready = $true
    } catch {
        Write-Host "    Waiting... ($elapsed s)"
    }
}

if (-not $ready) {
    Write-Host ""
    Write-Host "ERROR: Server did not start within $maxWait seconds."
    Write-Host "Check the server window for errors."
    exit 1
}
Write-Host "    Server is ready at http://localhost:$Port"

# --- Step 4: Start ngrok ---
Write-Host ""
Write-Host "[4/5] Starting ngrok..."

$ngrokCmd = Get-Command ngrok -ErrorAction SilentlyContinue
if ($ngrokCmd) {
    $ngrokBin = "ngrok"
} elseif (Test-Path $NgrokExe) {
    $ngrokBin = $NgrokExe
} else {
    Write-Host "ERROR: ngrok not found."
    Write-Host "Install: .\scripts\install-ngrok.ps1"
    exit 1
}

Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

Start-Process -FilePath $ngrokBin `
    -ArgumentList "http $Port" `
    -WindowStyle Minimized

# --- Step 5: Get public URL ---
Write-Host ""
Write-Host "[5/5] Getting ngrok public URL..."
$publicUrl = $null
$urlTry    = 0

while (-not $publicUrl -and $urlTry -lt 15) {
    Start-Sleep -Seconds 2
    $urlTry++
    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction Stop
        $tunnel = $resp.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1
        if ($tunnel) { $publicUrl = $tunnel.public_url }
    } catch {
        Write-Host "    Checking... ($urlTry)"
    }
}

Write-Host ""
Write-Host "========================================"
if ($publicUrl) {
    Write-Host " Mobile URL:"
    Write-Host " $publicUrl"
    Write-Host ""
    Write-Host " ngrok dashboard: http://localhost:4040"
    Write-Host " Local:           http://localhost:$Port"
} else {
    Write-Host " Could not get ngrok URL."
    Write-Host " Open http://localhost:4040 in browser."
}
Write-Host "========================================"
Write-Host ""

# --- Open browser ---
if (-not $NoBrowser) {
    if ($publicUrl) {
        Start-Process $publicUrl
    }
    Start-Process "http://localhost:4040"
}

# --- Keep alive ---
Write-Host "Press Ctrl+C to stop."
try {
    while ($true) { Start-Sleep -Seconds 60 }
} finally {
    Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped."
}
