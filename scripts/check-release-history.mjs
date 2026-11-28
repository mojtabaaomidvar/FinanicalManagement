import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createWorkbench } from './copy-workbench/server.mjs';
import { createPreviewSession, handlePreviewRequest } from './copy-workbench/fixtures.mjs';

const output = resolve('.local-test/history-browser');
await mkdir(output, { recursive: true });
const results = { checks: [], errors: [], externalRequests: [], screenshots: [], productionWrites: 0, manualWrites: 0 };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://local.invalid').pathname;
    const isManagement = path.startsWith('/management/');
    const root = resolve(isManagement ? '.local-test/management-web' : 'dist');
    const relative = isManagement ? path.slice('/management'.length) : path;
    const file = resolve(root, '.' + (relative === '/' ? (isManagement ? '/management.html' : '/index.html') : relative));
    assert.ok(file.startsWith(root + '\\') || file.startsWith(root + '/'));
    response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let workbench;
const record = text => { results.checks.push(text); console.log('PASS ' + text); };
const capture = async (page, name) => {
  const path = resolve(output, name + '.png');
  await page.screenshot({ path, fullPage: true }); results.screenshots.push(path);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
};
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 840 } });
  const fixture = createPreviewSession('full-owner', 'hub');
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1')) {
      const result = handlePreviewRequest(fixture, { path: url.pathname + url.search, method: request.method(), body: request.postDataJSON() });
      return route.fulfill({ status: result.status, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*' }, body: result.status === 204 ? undefined : JSON.stringify(result.body) });
    }
    if (url.origin !== origin && ['http:', 'https:'].includes(url.protocol)) {
      results.externalRequests.push(url.origin + url.pathname); return route.abort();
    }
    return route.continue();
  });
  await context.addInitScript(() => {
    localStorage.setItem('khaneyar.intro.seen', '1');
    localStorage.setItem('khaneyar.a2hs.installed', '1');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => results.errors.push(error.message));
  await page.goto(origin);
  const login = page.locator('.auth-track > form').first();
  await login.getByPlaceholder('شماره موبایل', { exact: true }).fill('09121234567');
  await login.getByPlaceholder('رمز عبور', { exact: true }).fill('FixtureOnly123!');
  await login.getByRole('button', { name: 'ورود', exact: true }).click();
  await page.locator('.floating-navigation').waitFor();
  await page.getByRole('button', { name: 'پروفایل و تنظیمات', exact: true }).click();
  await page.getByRole('button', { name: /درباره/ }).click();
  await page.getByRole('button', { name: 'تاریخچهٔ نسخه‌ها', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'تاریخچهٔ نسخه‌ها', exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.locator('[data-release-id="pwa-0.15.0"] small').innerText(), 'نسخهٔ این برنامه');
  assert.equal(await dialog.locator('[data-release-id^="management-"]').count(), 0);
  assert.equal(await dialog.getByText('یادداشت فنی', { exact: true }).count(), 0);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 840 }); await capture(page, 'pwa-' + width);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await capture(page, 'pwa-dark');
  await dialog.getByRole('button', { name: 'بستن تاریخچه', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.ok(await dialog.evaluate(node => node.contains(document.activeElement)));
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  record('About opens public history with current version, keyboard close and mobile/desktop layouts');
  assert.equal(await page.getByRole('button', { name: 'دیدن تغییرات نسخه', exact: true }).count(), 0);
  await page.evaluate(() => localStorage.setItem('khaneyar:release-history:pending-update', '0.13.0'));
  await page.reload();
  await page.getByRole('button', { name: 'دیدن تغییرات نسخه', exact: true }).click();
  await dialog.waitFor(); await page.keyboard.press('Escape');
  await page.reload(); await page.locator('.floating-navigation').waitFor();
  assert.equal(await page.getByRole('button', { name: 'دیدن تغییرات نسخه', exact: true }).count(), 0);
  record('Update marker shows one notice; ordinary reload and first install do not');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'تاریخچهٔ نسخه‌ها', exact: true }).last().click();
  await dialog.waitFor();
  await dialog.locator('[data-release-id="pwa-0.15.0"]').waitFor();
  await capture(page, 'offline-reload');
  record('Actual service worker serves history after offline reload');
  await context.close();

  const managementContext = await browser.newContext({ viewport: { width: 360, height: 900 }, serviceWorkers: 'block' });
  let status = 'waiting';
  const held = [];
  await managementContext.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin && ['http:', 'https:'].includes(url.protocol)) {
      results.externalRequests.push(url.origin + url.pathname); return route.abort();
    }
    if (!url.pathname.startsWith('/management/api/')) return route.continue();
    if (url.pathname.endsWith('/session')) return route.fulfill({ json: {
      authenticated: true, mode: 'production', username: 'fixture-viewer', role: 'viewer', csrf: 'fixture', mfa: false, expires_at: null,
    } });
    if (url.pathname.endsWith('/state/overview')) {
      if (status === 'waiting') await new Promise(done => held.push(done));
      if (status === 'missing') return route.fulfill({ json: { software_version: '9.0.0', management_version: '0.4.0', api_version: '0.1.0' } });
    }
    return route.fulfill({ status: 503, json: { message: 'Fixture status unavailable' } }).catch(() => {});
  });
  const managementPage = await managementContext.newPage();
  managementPage.on('pageerror', error => results.errors.push(error.message));
  await managementPage.goto(origin + '/management/');
  await managementPage.getByRole('navigation').getByRole('button', { name: 'نسخه‌ها', exact: true }).click();
  await managementPage.getByText('در حال بررسی نسخهٔ فعال؛ تاریخچه قابل‌مشاهده است.', { exact: true }).waitFor();
  assert.ok(await managementPage.locator('[data-release-id]').count() > 0);
  status = 'failed'; held.forEach(done => done());
  await managementPage.getByText('نسخهٔ فعال دریافت نشد؛ یادداشت‌های محلی همچنان در دسترس‌اند.', { exact: true }).waitFor();
  await capture(managementPage, 'management-status-error');
  status = 'missing';
  await managementPage.getByRole('button', { name: 'بررسی دوباره', exact: true }).click();
  await managementPage.getByText('یادداشت این نسخه در این ساخت موجود نیست.', { exact: true }).waitFor();
  await managementPage.getByLabel('بخش نرم‌افزار', { exact: true }).selectOption('api');
  await managementPage.getByText('نامشخص', { exact: true }).waitFor();
  assert.equal(await managementPage.locator('[data-release-id^="api-"] small').count(), 0);
  await managementPage.getByLabel('بخش نرم‌افزار', { exact: true }).selectOption('management');
  await managementPage.locator('[data-release-id="management-0.4.0"] small').waitFor();
  await capture(managementPage, 'management-current-version');
  record('Local management history survives loading/error, flags missing notes and never infers API release from health');
  await managementContext.close();

  workbench = await createWorkbench({ port: 0 });
  await workbench.initialized;
  assert.ok(workbench.status().ready, workbench.status().message);
  const copyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await copyContext.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== workbench.origin && ['http:', 'https:'].includes(url.protocol)) {
      results.externalRequests.push(url.origin + url.pathname); return route.abort();
    }
    return route.continue();
  });
  await copyContext.route('**/preview-bridge.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("location.port !== '5701'", `location.port !== '${new URL(workbench.origin).port}'`) });
  });
  const editor = await copyContext.newPage(); editor.setDefaultTimeout(25000);
  editor.on('pageerror', error => results.errors.push(error.message));
  await editor.goto(workbench.origin);
  await editor.locator('#preview-route').selectOption('settings/about');
  await editor.locator('#copy-preview').scrollIntoViewIfNeeded();
  const frame = editor.frameLocator('#copy-preview');
  await frame.getByRole('button', { name: 'تاریخچهٔ نسخه‌ها', exact: true }).click();
  await frame.locator('[data-release-id="pwa-0.12.0"] summary').click();
  const id = 'release-history.pwa-0.12.0.notes.wallet-cards';
  const note = frame.locator('span[data-copy-sources]').filter({ hasText: 'لمس کارت حساب، عملیات آن را باز می‌کند.' });
  await note.waitFor();
  await editor.locator('#pick-text').click();
  await note.click();
  await editor.locator('#catalog-list [data-copy-id="' + id + '"]').click();
  await editor.locator('#pick-text').click();
  await editor.locator('#copy-edit').fill('English release note');
  const picked = frame.locator('span[data-copy-sources*="' + id + '"]');
  await picked.getByText('English release note', { exact: true }).waitFor();
  await editor.locator('#copy-edit').fill('');
  await editor.waitForFunction(id => document.querySelector('#copy-preview')?.contentDocument
    ?.querySelector(`span[data-copy-sources*="${id}"]`)?.textContent === '', id);
  assert.ok(await picked.boundingBox());
  await editor.locator('#copy-edit').fill('Restored note');
  await picked.getByText('Restored note', { exact: true }).waitFor();
  await capture(editor, 'copy-english-empty-restored');
  record('JSON source picker preserves the exact note through English, empty and restored drafts');
  await copyContext.close();
  assert.deepEqual(results.errors, []);
  assert.deepEqual(results.externalRequests, []);
} catch (error) {
  results.errors.push(error.stack); process.exitCode = 1;
  for (const context of browser.contexts()) for (const page of context.pages()) {
    await capture(page, 'failure-' + results.screenshots.length).catch(() => {});
  }
} finally {
  await browser.close();
  if (workbench) await workbench.close();
  await new Promise(done => server.close(done));
  await writeFile(resolve(output, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
