import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('.local-test/wallet-compact-release');
const requested = new Set(process.argv.slice(2));
const selected = name => !requested.size || requested.has(name);
await mkdir(output, { recursive: true });
async function run(name, command, args, env = {}) {
  const log = createWriteStream(resolve(output, name + '.log'));
  const started = new Date().toISOString();
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const exitCode = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
  await new Promise(done => log.end(done));
  await writeFile(resolve(output, name + '-result.json'), JSON.stringify({ exit_code: exitCode, started, completed: new Date().toISOString() }));
  console.log(JSON.stringify({ name, exitCode }));
  if (exitCode !== 0) throw new Error(name + ' failed; inspect ' + name + '.log');
}

const checks = await Promise.allSettled([
  selected('frontend') && run('frontend', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'scripts/vitest-release.config.ts', '--reporter=json', '--outputFile=' + resolve(output, 'frontend-tests.json')]),
  selected('copy') && run('copy', 'cmd.exe', ['/d', '/s', '/c', 'npm run copy:studio:test']),
  selected('installer') && run('installer', process.env.KHANEYAR_RELEASE_PYTHON ?? 'python', ['scripts/test-wallet-compact-release.py']),
  selected('browser') && (async () => {
    await run('build', 'cmd.exe', ['/d', '/s', '/c', 'npm run build'], { VITE_API_URL: 'https://api.khaanehyar.ir' });
    await run('wallet', process.execPath, ['scripts/check-wallet-access.mjs']);
    await run('history', process.execPath, ['scripts/check-release-history.mjs']);
  })(),
]);
for (const check of checks) if (check.status === 'rejected') console.error(check.reason.message);
if (checks.some(check => check.status === 'rejected')) process.exitCode = 1;
