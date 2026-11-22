import { spawn } from 'node:child_process';
const child = spawn(process.env.KHANEYAR_FIREFOX_PYTHON || 'python', ['scripts/check-inventory-refresh-firefox.py'], {
  cwd: process.cwd(), stdio: 'inherit', windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
