import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createWorkbench } from './copy-workbench/server.mjs';

// Actual React/RestClient; fictional in-memory API only. No real financial writes.
const output = resolve('.local-test/financial-contract');
await mkdir(output, { recursive: true });
const workbench = await createWorkbench({ port: 0 }); await workbench.initialized;
const base = workbench.origin;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const results = { checks: [], errors: [], externalRequests: [], financialRequests: [], productionWrites: 0, manualWrites: 0 };
const message = 'برای استفاده از بخش مالی، ابتدا برنامه را از تنظیمات به‌روزرسانی کنید.';
try {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
      results.externalRequests.push(url.origin + url.pathname); await route.abort();
    } else await route.continue();
  });
  await context.route('**/__copy/ui/preview-bridge.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({ response, body: source.replace("location.port !== '5701'", `location.port !== '${new URL(base).port}'`)
      .replaceAll("document.querySelector('.hub-page')", "document.querySelector('.page-visit:not([hidden])')") });
  });
  const editor = await context.newPage(); await editor.goto(base);
  const token = await editor.evaluate(() => window.__COPY_WORKBENCH__.csrfToken); await editor.close();
  const response = await context.request.post(base + '/__copy/preview', {
    headers: { Origin: base, 'X-Copy-Workbench-Token': token }, data: { route: 'accounts', scenarioId: 'full-owner' },
  }); assert.equal(response.status(), 200);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => results.errors.push(error.message));
  page.on('request', request => {
    if (/\/api\/v1\/(accounts|transactions|bills|shopping|sms)(\/|\?|$)/.test(request.url())) {
      results.financialRequests.push({ path: new URL(request.url()).pathname, method: request.method(),
        contract: request.headers()['x-khaneyar-money-contract'] });
    }
  });
  await page.goto(base + (await response.json()).url);
  await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
  const card = page.locator('.page-visit:not([hidden]) .account-card.flat:visible').first();
  await card.waitFor();
  assert.ok(results.financialRequests.length > 0);
  assert.ok(results.financialRequests.every(request => request.contract === 'decimal-v1'));
  results.checks.push('financial reads send the exact-money capability through the actual browser transport');

  let writes = 0;
  await page.route('**/api/v1/accounts/*/corrections', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    writes++;
    assert.equal(route.request().headers()['x-khaneyar-money-contract'], 'decimal-v1');
    assert.equal(route.request().postDataJSON().target_balance, '1499.9');
    await route.fulfill({ status: 409, contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'CLIENT_UPDATE_REQUIRED', message }) });
  });
  await card.click();
  await page.locator('.modal-sheet:visible').getByRole('button', { name: 'اصلاح موجودی', exact: true }).click();
  const sheet = page.locator('.modal-sheet:visible');
  await sheet.getByLabel('موجودی موردنظر', { exact: true }).fill('۱۴۹۹.۹');
  await sheet.getByLabel('توضیحات اصلاح موجودی').fill('User-authored draft — keep me');
  await sheet.getByRole('radio', { name: 'مغایرت‌گیری', exact: true }).check();
  await sheet.getByRole('button', { name: 'بررسی و ادامه' }).click();
  await sheet.getByRole('button', { name: 'تأیید و ثبت اصلاح' }).click();
  await sheet.getByText(message, { exact: true }).waitFor();
  assert.equal(writes, 1);
  results.checks.push('update-required rejection remains visible and does not retry the financial write');
  // A rejected write must not force a reload or clear the entered note.
  await sheet.getByRole('button', { name: 'دریافت دوبارهٔ اطلاعات' }).click();
  await sheet.getByLabel('توضیحات اصلاح موجودی').waitFor();
  assert.equal(await sheet.getByLabel('توضیحات اصلاح موجودی').inputValue(), 'User-authored draft — keep me');
  assert.equal(writes, 1);
  results.checks.push('update-required rejection preserves the user draft without a forced reload');
  assert.deepEqual(results.externalRequests, []);
  assert.deepEqual(results.errors, []);
} catch (error) {
  results.errors.push(error.stack); console.error(error);
} finally {
  await browser.close(); await workbench.close();
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
}
for (const check of results.checks) console.log('PASS ' + check);
if (results.errors.length || results.externalRequests.length) process.exitCode = 1;
