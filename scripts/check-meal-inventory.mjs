import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';

const context = JSON.parse(process.env.MEAL_BROWSER_CONTEXT);
const backend = new URL(context.backend);
assert.equal(backend.hostname, '127.0.0.1');
const root = resolve('dist'), output = resolve('.local-test/meal-inventory');
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
    assert.ok(path.startsWith(root + sep));
    let bytes = await readFile(path);
    if (extname(path) === '.js') bytes = Buffer.from(bytes.toString().replaceAll('https://api.khaanehyar.ir', ''));
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome' });
const errors = [], passed = [];
async function api(method, path, body) {
  const response = await fetch(new URL('/api/v1' + path, backend), { method,
    headers: { Authorization: `Bearer ${context.owner.token}`, 'Content-Type': 'application/json', 'X-Khaneyar-Money-Contract': 'decimal-v1' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${response.ok ? '' : await response.text()}`);
  return response.status === 204 ? null : response.json();
}
async function open(width) {
  const browserContext = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
  const page = await browserContext.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.addInitScript(() => { localStorage.setItem('khaneyar.intro.seen', '1'); localStorage.setItem('khaneyar.a2hs.installed', '1'); });
  await page.goto(base);
  const form = page.locator('.auth-track form').first();
  await form.locator('input[type=tel]').fill(context.owner.phone);
  await form.locator('input[type=password]').fill(context.password);
  await form.evaluate(form => form.requestSubmit());
  await page.locator('.application-shell').waitFor();
  await page.getByRole('button', { name: 'بخش‌های خانه', exact: true }).click();
  await page.locator('[data-open-module="meals"]').click();
  await page.locator('.meals-page').waitFor();
  await expect(page.getByText('در حال دریافت برنامهٔ غذایی…', { exact: true })).toHaveCount(0);
  return { page, browserContext };
}
try {
  const list = await api('POST', '/shopping/lists', { title: 'خرید بررسی وعده' });
  const stock = await api('POST', '/inventory', { title: 'برنج', unit: 'کیلو', quantity: 2, category: 'grains' });
  await api('POST', '/meals/dishes', { title: 'غذای بررسی مستقل', ingredients: [
    { title: 'برنج', catalog_id: 'preset:برنج', qty: null },
    { title: 'پیاز', catalog_id: 'preset:پیاز', qty: null },
    { title: 'مادهٔ اختصاصی بررسی', qty: null },
  ] });
  const { page, browserContext } = await open(360);
  await page.getByRole('button', { name: 'کتابخانهٔ غذاها', exact: true }).click();
  await expect(page.locator('.meal-category-strip button').nth(1)).toHaveText('صبحانه');
  await expect(page.locator('.meal-category-strip button').nth(2)).toHaveText('ناهار');
  await expect(page.locator('.meal-category-strip button').nth(3)).toHaveText('شام');
  await expect(page.locator('.meal-category-strip button').nth(4)).toHaveText('میان وعده');
  await page.getByRole('searchbox', { name: 'جست‌وجو در کتابخانهٔ غذاها' }).fill('نیمرو');
  await page.locator('.meal-food-tile').first().click();
  await expect(page.locator('.meal-inventory-status').first()).not.toHaveText('در حال بررسی انبار…');
  assert.equal(await page.locator('.meal-inventory-status').count(), await page.locator('.meal-name-ingredient').count());
  await page.screenshot({ path: resolve(output, 'library-statuses-360.png') });
  await page.getByRole('button', { name: 'بازگشت به انتخاب غذا', exact: true }).click();
  passed.push('All library materials show a reviewed status; category order is fixed.');
  await page.getByRole('button', { name: 'برنامهٔ هفته', exact: true }).click();
  await page.locator('.meal-slot-dish').first().click();
  await page.getByLabel('غذای بررسی مستقل', { exact: false }).check();
  await page.getByRole('button', { name: 'ذخیرهٔ وعده', exact: true }).click();
  const pending = page.getByRole('dialog', { name: 'تعیین تکلیف مواد ناموجود' });
  await expect(pending).toBeVisible();
  assert.equal(await pending.locator('fieldset').count(), 2);
  assert.equal(await pending.locator('input[type=radio]:checked').count(), 0);
  await pending.getByRole('button', { name: 'تأیید و ثبت وعده', exact: true }).click();
  await expect(pending.getByRole('alert')).toHaveText('برای همهٔ مواد ناموجود یک گزینه انتخاب کنید.');
  await pending.locator('fieldset').nth(0).getByLabel('افزودن به لیست خرید', { exact: true }).check();
  await expect(pending.getByRole('alert')).toHaveCount(0);
  await pending.getByRole('button', { name: 'انصراف', exact: true }).click();
  assert.equal((await api('GET', '/shopping/lists')).find(row => row.id === list.id).items.length, 0);
  passed.push('Missing and unresolved materials require separate explicit decisions; cancelling writes nothing.');
  await page.locator('.meal-slot-dish').first().click();
  await page.getByLabel('غذای بررسی مستقل', { exact: false }).check();
  await page.getByRole('button', { name: 'ذخیرهٔ وعده', exact: true }).click();
  await expect(pending).toBeVisible();
  await pending.locator('fieldset').nth(0).getByLabel('افزودن به لیست خرید', { exact: true }).check();
  await pending.getByRole('button', { name: 'تأیید و ثبت وعده', exact: true }).click();
  await expect(pending.getByRole('alert')).toBeVisible();
  await pending.getByRole('textbox', { name: 'مقدار خرید پیاز', exact: true }).fill('۲');
  await expect(pending.getByRole('alert')).toHaveCount(0);
  await pending.getByRole('textbox', { name: 'واحد خرید پیاز', exact: true }).fill('عدد');
  await pending.locator('fieldset').nth(1).getByLabel('موجود است، اما در انبار ثبت نشده', { exact: true }).check();
  await pending.getByRole('combobox', { name: 'لیست خرید مقصد', exact: true }).selectOption(list.id);
  await page.screenshot({ path: resolve(output, 'independent-decisions-360.png') });
  await pending.getByRole('button', { name: 'تأیید و ثبت وعده', exact: true }).click();
  await expect(pending).not.toBeVisible();
  await expect(page.locator('.meal-slot-dish').first()).toContainText('غذای بررسی مستقل');
  const purchased = (await api('GET', '/shopping/lists')).find(row => row.id === list.id).items;
  assert.equal(purchased.length, 1); assert.equal(purchased[0].title, 'پیاز'); assert.equal(Number(purchased[0].qty), 2);
  assert.equal((await api('GET', '/inventory')).find(row => row.id === stock.id).quantity, '2.00');
  assert.deepEqual(await api('GET', '/transactions'), []);
  passed.push('Mixed decisions save the meal and only the selected purchases without stock or money changes.');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await browserContext.close();
  const desktop = await open(1280);
  await desktop.page.getByRole('button', { name: 'کتابخانهٔ غذاها', exact: true }).click();
  await desktop.page.getByRole('searchbox', { name: 'جست‌وجو در کتابخانهٔ غذاها' }).fill('نیمرو');
  await desktop.page.locator('.meal-food-tile').first().click();
  await expect(desktop.page.locator('.meal-inventory-status').first()).not.toHaveText('در حال بررسی انبار…');
  await desktop.page.screenshot({ path: resolve(output, 'library-statuses-1280.png') });
  assert.equal(await desktop.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  passed.push('The real interface fits mobile and desktop without JavaScript errors.');
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed, isolated: true }, null, 2));
  passed.forEach(result => console.log('PASS ' + result));
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
