import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { createPreviewSession, handlePreviewRequest } from './copy-workbench/fixtures.mjs';

const output = resolve('.local-test/quick-add-built'), root = resolve('dist');
await mkdir(output, { recursive: true });
const result = { checks: [], screenshots: [], errors: [], externalRequests: [], productionWrites: 0, manualWrites: 0 };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://local.invalid').pathname;
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    assert.ok(path.startsWith(root + sep));
    response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-cache'); response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 360, height: 844 }, timezoneId: 'Asia/Tehran' });
const fixture = createPreviewSession('full-owner', 'hub');
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname.startsWith('/api/v1')) {
    const response = handlePreviewRequest(fixture, { path: url.pathname + url.search, method: request.method(), body: request.postDataJSON() });
    return route.fulfill({ status: response.status, contentType: 'application/json', headers: {
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*',
    }, body: response.status === 204 ? undefined : JSON.stringify(response.body) });
  }
  if (url.origin !== origin && ['http:', 'https:'].includes(url.protocol)) {
    result.externalRequests.push(url.origin + url.pathname); return route.abort();
  }
  return route.continue();
});
await context.addInitScript(() => {
  localStorage.setItem('khaneyar.intro.seen', '1'); localStorage.setItem('khaneyar.a2hs.installed', '1');
});
const page = await context.newPage(); page.setDefaultTimeout(20000);
page.on('pageerror', error => result.errors.push(error.message));
const capture = async name => {
  const path = resolve(output, name + '.png'); await page.screenshot({ path, fullPage: true, animations: 'disabled' }); result.screenshots.push(path);
};
const pass = text => { result.checks.push(text); console.log('PASS ' + text); };
try {
  await page.goto(origin);
  const login = page.locator('.auth-track > form').first();
  await login.getByPlaceholder('شماره موبایل', { exact: true }).fill('09121234567');
  await login.getByPlaceholder('رمز عبور', { exact: true }).fill('FixtureOnly123!');
  await login.getByRole('button', { name: 'ورود', exact: true }).click();
  await page.getByRole('button', { name: 'افزودن سریع', exact: true }).click();
  await page.locator('#quick-add-menu').getByRole('button', { name: 'کار خانه', exact: true }).click();
  await page.getByRole('dialog', { name: 'کار جدید', exact: true }).waitFor();
  await expect(page.locator('.modal-sheet')).toHaveClass(/is-mobile-fullscreen/);
  await capture('production-task'); await page.keyboard.press('Escape');
  pass('Production bundle opens the existing fullscreen task form');
  await page.getByRole('button', { name: 'داشبورد', exact: true }).click();
  await page.getByRole('button', { name: 'پروفایل و تنظیمات', exact: true }).click();
  await page.getByRole('button', { name: /درباره/ }).click();
  await page.getByRole('button', { name: 'تاریخچهٔ نسخه‌ها', exact: true }).click();
  await page.locator('[data-release-id="pwa-0.16.0"] small').getByText('نسخهٔ این برنامه', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-release-id^="management-"]').count(), 0);
  await capture('production-history'); await page.keyboard.press('Escape');
  pass('Production local history marks 0.16.0 current and keeps management notes out of the PWA');
  await page.getByRole('button', { name: 'داشبورد', exact: true }).click();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true); await page.reload();
  await page.getByRole('button', { name: 'افزودن سریع', exact: true }).click();
  await page.locator('#quick-add-menu').getByRole('button', { name: 'کار خانه', exact: true }).click();
  await page.getByRole('dialog', { name: 'کار جدید', exact: true }).waitFor();
  await capture('production-offline-task'); await page.keyboard.press('Escape');
  pass('Actual service worker reload retains quick add and the permitted offline task form');
  assert.deepEqual(result.errors, []); assert.deepEqual(result.externalRequests, []);
} catch (error) { result.failure = error.stack; await capture('failure').catch(() => {}); throw error; }
finally {
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  await browser.close(); server.close();
}
