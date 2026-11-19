import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:5701', artifacts = resolve('.local-test/support-copy-check');
const browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, serviceWorkers: 'block' });
const page = await context.newPage(), errors = [], checks = [];
page.setDefaultTimeout(60000);
page.on('pageerror', error => errors.push(error.message));
await page.route('**/__copy/apply', route => route.abort());
const frame = () => page.frameLocator('#copy-preview');
async function open(scenario = 'full-owner', route = 'support') {
  const previous = await page.locator('#copy-preview').getAttribute('src');
  await page.locator('#preview-scenario').selectOption(scenario); await page.locator('#preview-route').selectOption(route);
  await page.locator('#reload-preview').click();
  await page.waitForFunction(previous => document.querySelector('#copy-preview').getAttribute('src') !== previous, previous);
  await page.waitForFunction(() => document.querySelector('#preview-state').textContent === 'آماده');
}
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
try {
  await mkdir(artifacts, { recursive: true });
  const catalog = await (await context.request.get(base + '/__copy/catalog', { timeout: 60000 })).json();
  await page.route(base + '/__copy/catalog', route => route.fulfill({ json: catalog }));
  await page.goto(base);
  await page.locator('#catalog-list [data-copy-id]').first().waitFor();
  const entry = catalog.entries.find(value => value.file.endsWith('/SupportPanel.tsx') && value.text === 'حساب‌های ایجادشده');
  assert.ok(entry); const original = await readFile(resolve(entry.file), 'utf8');
  await check('new support display states and own-code copy are discoverable', async () => {
    const panelEntries = catalog.entries.filter(value => value.file.endsWith('/SupportPanel.tsx'));
    for (const text of ['ورود پشتیبانی', 'در حال دریافت وضعیت…', 'موردی با این کد یا فیلترها پیدا نشد.', 'نشست پشتیبانی پایان یافته است. دوباره وارد شوید.', 'تلاش دوباره']) {
      assert.ok(panelEntries.some(value => value.text === text), text);
    }
    assert.ok(catalog.entries.some(value => value.file.endsWith('/OwnSupportCode.tsx') && value.text === 'دریافت کد پشتیبانی انجام نشد.'));
    await open(); await frame().getByRole('heading', { name: entry.text, exact: true }).waitFor();
  });
  await check('English and empty preview edits retain exact source identity', async () => {
    await page.locator('#copy-search').fill(entry.text);
    await page.locator('[data-copy-id="' + entry.id + '"]').first().click();
    await page.locator('#copy-edit').fill('Created accounts');
    await frame().getByRole('heading', { name: 'Created accounts', exact: true }).waitFor();
    await page.locator('#copy-edit').fill('');
    await frame().locator('h2').first().waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.querySelector('#copy-preview').contentDocument.querySelector('h2').textContent === '');
    await page.locator('#copy-edit').fill('Accounts created');
    await frame().getByRole('heading', { name: 'Accounts created', exact: true }).waitFor();
    await page.locator('#pick-text').click();
    await frame().getByRole('heading', { name: 'Accounts created', exact: true }).click();
    await page.locator('#picked-note').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#copy-original').innerText(), entry.text);
    await page.locator('#pick-text').click();
    await page.locator('#reset-entry').click();
    await frame().getByRole('heading', { name: entry.text, exact: true }).waitFor();
  });
  await check('support login, empty and failed fixtures stay isolated', async () => {
    await open('auth-login'); await frame().getByRole('heading', { name: 'ورود پشتیبانی', exact: true }).waitFor();
    await open('empty-owner'); await frame().getByText('در این بازه حساب تازه‌ای با ثبت‌نام کامل وجود ندارد.', { exact: true }).waitFor();
    await open('errors'); await frame().getByRole('alert').waitFor();
  });
  await check('own support code is available in profile preview', async () => {
    await open('full-owner', 'settings/profile');
    await frame().getByRole('heading', { name: 'کد پشتیبانی من', exact: true }).waitFor();
    await frame().locator('.own-support-code code').waitFor();
    assert.equal(await frame().locator('.own-support-code code').innerText(), 'cf000000-0000-4000-8000-000000009698');
  });
  assert.equal(await readFile(resolve(entry.file), 'utf8'), original);
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(error.message); process.exitCode = 1;
} finally {
  await writeFile(resolve(artifacts, 'results.json'), JSON.stringify({ checks, errors, passed: !process.exitCode }, null, 2));
  await browser.close();
}
