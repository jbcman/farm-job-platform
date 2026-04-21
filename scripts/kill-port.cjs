/**
 * kill-port.cjs — 포트 점유 프로세스 강제 종료 (Windows / macOS / Linux)
 * Usage: node scripts/kill-port.cjs 3002
 */
const { execSync } = require('child_process');
const port = process.argv[2] || '3002';

try {
  if (process.platform === 'win32') {
    // Windows: netstat → PID 추출 → taskkill
    execSync(
      `for /f "tokens=5" %a in ('netstat -aon ^| findstr ":${port} " ^| findstr "LISTENING"') do @taskkill /F /PID %a`,
      { shell: 'cmd.exe', stdio: 'ignore' }
    );
  } else {
    // macOS / Linux: lsof → kill
    execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' });
  }
  console.log(`[KILL_PORT] :${port} 정리 완료`);
} catch (_) {
  // 점유 프로세스 없음 — 정상
  console.log(`[KILL_PORT] :${port} 이미 비어 있음`);
}
