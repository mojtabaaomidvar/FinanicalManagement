import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';

const context = JSON.parse(process.env.WALLET_BROWSER_CONTEXT), backend = new URL(context.backend);
assert.equal(backend.hostname, '127.0.0.1');
const root = resolve('dist'), output = resolve('.local-test/wallet-access-live');
await mkdir(output, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer(async (request, response) => {
  if (request.url.startsWith('/api/')) {
    const upstream = http.request(new URL(request.url, backend), { method: request.method, headers: { ...request.headers, host: backend.host } }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    response.on('close', () => upstream.destroy()); request.pipe(upstream); return;
  }
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const path = resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
    assert.ok(path.startsWith(root + sep)); let bytes = await readFile(path);
    if (extname(path) === '.js') bytes = Buffer.from(bytes.toString().replaceAll('https://api.khaanehyar.ir', ''));
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--explicitly-allowed-ports=' + server.address().port] });
const results = { checks: [], errors: [], externalRequests: [], isolated: true, productionWrites: 0, manualWrites: 0 };
let lastPage;
async function open(actor) {
  const browserContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await browserContext.newPage(); lastPage = page; page.setDefaultTimeout(20000);
  page.on('pageerror', error => results.errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    results.externalRequests.push(url.origin + url.pathname); return route.abort();
  });
  await page.addInitScript(() => { localStorage.setItem('khaneyar.intro.seen', '1'); localStorage.setItem('khaneyar.a2hs.installed', '1'); });
  await page.goto(base); const form = page.locator('.auth-track form').first();
  await form.locator('input[type=tel]').fill(actor.phone); await form.locator('input[type=password]').fill(context.password);
  await form.evaluate(form => form.requestSubmit()); await page.locator('.application-shell').waitFor();
  await page.getByRole('button', { name: 'بخش‌های خانه', exact: true }).click();
  await page.locator('[data-open-module="accounts"]').click(); await page.locator('.accounts-page').waitFor();
  await page.locator('.wealth-total bdi').waitFor(); return page;
}
async function api(actor, path) {
  const response = await fetch(new URL('/api/v1' + path, backend), { headers: { Authorization: `Bearer ${actor.token}`, 'X-Khaneyar-Money-Contract': 'decimal-v1' } });
  assert.equal(response.status, 200); return response.json();
}
try {
  const owner = await open(context.owner);
  await expect(owner.locator('.wallet-owner-filter')).toHaveCount(1); await expect(owner.locator('.wallet-card')).toHaveCount(2);
  await owner.getByRole('button', { name: 'خودم', exact: true }).click(); await expect(owner.locator('.wallet-card')).toHaveCount(1);
  await owner.locator('.wealth-total bdi').waitFor(); await owner.screenshot({ path: resolve(output, 'owner-self-390.png') });
  results.checks.push('Production build logs in and filters manager wallets with real isolated API balances.');
  const member = await open(context.member);
  await expect(member.locator('.wallet-owner-filter')).toHaveCount(0); await expect(member.locator('.wallet-card')).toHaveCount(1);
  await expect(member.locator('.wallet-card')).toContainText('Personal cash');
  assert.deepEqual((await api(context.member, '/accounts')).map(row => row.id), [context.source]);
  const targets = await api(context.member, '/accounts?view=transfer-targets');
  assert.ok(targets.some(row => row.id === context.destination));
  assert.ok(targets.every(row => !('initial_balance' in row) && !('title' in row) && !('card_number' in row)));
  results.checks.push('Member sees only personal wallets; peer target response contains routing identifiers only.');
  await member.getByRole('button', { name: 'بخش‌های خانه', exact: true }).click();
  await member.locator('[data-open-module="transactions"]').click();
  await member.getByRole('button', { name: 'افزودن تراکنش', exact: true }).click(); const form = member.locator('.tx-simple');
  await form.getByRole('tab', { name: 'انتقال', exact: true }).click();
  const source = form.getByRole('combobox', { name: 'حساب مبدأ', exact: true }), target = form.getByRole('combobox', { name: 'حساب مقصد', exact: true });
  await target.locator(`option[value="${context.destination}"]`).waitFor({ state: 'attached' });
  await form.locator('.tx-amount').fill('100');
  await form.getByRole('button', { name: 'نمایش همهٔ حساب‌های من', exact: true }).click();
  await source.selectOption(context.source); await target.selectOption(context.destination);
  await form.getByRole('button', { name: 'ثبت انتقال', exact: true }).click(); await form.waitFor({ state: 'hidden' });
  const rows = await api(context.member, '/transactions');
  assert.equal(rows.length, 1); assert.equal(rows[0].amount, '100'); assert.equal(rows[0].to_account_id, context.destination);
  assert.equal((await api(context.member, `/accounts/${context.source}/balance`)).current_balance, '900');
  assert.equal((await api(context.owner, `/accounts/${context.destination}/balance`)).current_balance, '100');
  results.checks.push('Real transfer saves once and produces exact source 900 / destination 100 balances.');
  assert.deepEqual(results.errors, []); assert.deepEqual(results.externalRequests, []);
} catch (error) {
  results.errors.push(error.stack); console.error(error);
  if (lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: resolve(output, 'failure.png') });
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
