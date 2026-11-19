import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:5701';
const output = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) ?? '.local-test/market-prices');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
await mkdir(output, { recursive: true });
const results = { startedAt: new Date().toISOString(), checks: [], errors: [], externalRequests: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const contexts = [];
const root = await browser.newPage();
await root.goto(base);
const token = await root.evaluate(() => window.__COPY_WORKBENCH__.csrfToken);
await root.close();

async function session(setup) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tehran' });
  contexts.push(context);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
      results.externalRequests.push(url.origin + url.pathname);
      await route.abort();
    } else await route.continue();
  });
  const response = await context.request.post(base + '/__copy/preview', {
    headers: { Origin: base, 'X-Copy-Workbench-Token': token }, data: { scenarioId: 'full-owner', route: 'market' },
  });
  assert.equal(response.status(), 200);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => results.errors.push(error.message));
  if (setup) await setup(page);
  await page.goto(base + (await response.json()).url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true, null, { timeout: 25000 });
  await page.locator('section.page.active').waitFor();
  return page;
}

async function openCategory(page, name) {
  await page.locator('.market-tile').filter({ has: page.getByText(name === 'بورس' ? 'بورس تهران' : name, { exact: true }) }).click();
  await page.locator('h1').filter({ hasText: name }).waitFor();
}
async function failure(route, message) {
  await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SERVER', message }) });
}
async function financialData(page) {
  return page.evaluate(async () => {
    const paths = ['/transactions', '/accounts', '/holdings'];
    return Promise.all(paths.map(async path => (await fetch('/api/v1' + path)).json()));
  });
}
async function searchResponse(route, name, stale = false) {
  const response = await route.fetch();
  const data = await response.json();
  data.results[0].name = name;
  data.stale = stale;
  await route.fulfill({ response, json: data });
}
async function check(name, run) {
  if (only && !name.includes(only)) return;
  try { await run(); results.checks.push(name); console.log('PASS ' + name); }
  catch (error) { results.errors.push(name + ': ' + error.message); console.log('FAIL ' + name + ': ' + error.message); }
}

try {
  await check('initial price failure retries and keeps financial data unchanged', async () => {
    const page = await session(page => page.route('**/api/v1/market/prices', route => failure(route, 'Initial price failure')));
    await page.getByText('Initial price failure', { exact: true }).waitFor();
    assert.equal(await page.locator('.market-tile').count(), 0);
    const before = await financialData(page);
    await page.unroute('**/api/v1/market/prices');
    await page.getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
    await page.locator('.market-tile').first().waitFor();
    assert.deepEqual(await financialData(page), before);
    await page.context().close();
  });

  for (const category of [null, 'ارز']) {
    await check('price refresh failure remains visible with cached prices in ' + (category ?? 'main page'), async () => {
      const page = await session();
      await page.locator('.market-tile').first().waitFor();
      if (category) await openCategory(page, category);
      const selector = category ? '.pt-tile' : '.market-tile';
      const before = await page.locator(selector).allTextContents();
      await page.route('**/api/v1/market/prices', route => failure(route, 'Refresh price failure'));
      await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
      await page.getByText('قیمت‌ها تازه نشد؛ آخرین قیمت‌های دریافت‌شده نمایش داده می‌شوند.', { exact: true }).waitFor();
      await page.getByText('Refresh price failure', { exact: true }).waitFor();
      assert.deepEqual(await page.locator(selector).allTextContents(), before);
      await page.unroute('**/api/v1/market/prices');
      await page.getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
      await page.getByText('Refresh price failure', { exact: true }).waitFor({ state: 'hidden' });
      await page.context().close();
    });
  }

  await check('server stale prices stay marked in category pages', async () => {
    const page = await session(page => page.route('**/api/v1/market/prices', async route => {
      const response = await route.fetch();
      const data = await response.json();
      data.stale = true;
      await route.fulfill({ response, json: data });
    }));
    await page.getByText('این قیمت‌ها ممکن است قدیمی باشند.', { exact: true }).waitFor();
    await openCategory(page, 'ارز');
    await page.getByText('این قیمت‌ها ممکن است قدیمی باشند.', { exact: true }).waitFor();
    assert.equal(await page.locator('.pt-tile').count(), 2);
    await page.screenshot({ path: resolve(output, 'stale-currency-mobile.png'), fullPage: true });
    await page.context().close();
  });

  await check('stock search retries unchanged query and preserves financial data', async () => {
    const page = await session();
    await openCategory(page, 'بورس');
    const before = await financialData(page);
    const input = page.getByRole('searchbox', { name: 'جست‌وجوی نماد بورس', exact: true });
    await page.route('**/api/v1/market/stocks?*', route => failure(route, 'Stock search failure'));
    await input.fill('فولاد');
    await page.getByText('Stock search failure', { exact: true }).waitFor();
    await page.unroute('**/api/v1/market/stocks?*');
    let reads = 0;
    await page.route('**/api/v1/market/stocks?*', async route => {
      reads++;
      assert.equal(new URL(route.request().url()).searchParams.get('q'), 'فولاد');
      await searchResponse(route, 'نتیجهٔ تلاش دوباره', true);
    });
    await page.getByRole('button', { name: 'جست‌وجوی دوباره', exact: true }).click();
    await page.getByText('نتیجهٔ تلاش دوباره', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), 'فولاد');
    assert.equal(reads, 1);
    assert.match(await page.locator('.market-search-meta').innerText(), /قدیمی/);
    assert.deepEqual(await financialData(page), before);
    await page.screenshot({ path: resolve(output, 'stock-retry-mobile.png'), fullPage: true });
    await page.context().close();
  });

  await check('stock results ignore old responses and clear immediately for short queries', async () => {
    const page = await session();
    await openCategory(page, 'بورس');
    const input = page.getByRole('searchbox', { name: 'جست‌وجوی نماد بورس', exact: true });
    let release, started;
    const gate = new Promise(done => { release = done; });
    const requested = new Promise(done => { started = done; });
    await page.route('**/api/v1/market/stocks?*', async route => {
      const old = new URL(route.request().url()).searchParams.get('q') === 'فولا';
      if (old) { started(); await gate; }
      await searchResponse(route, old ? 'پاسخ قدیمی' : 'پاسخ تازه');
    });
    try {
      await input.fill('فولا'); await requested;
      await input.fill('فولاد');
      await page.getByText('پاسخ تازه', { exact: true }).waitFor();
      release(); await page.waitForTimeout(150);
      assert.equal(await page.getByText('پاسخ قدیمی', { exact: true }).count(), 0);
      await input.fill('ف');
      await page.getByText('برای جست‌وجو دست‌کم ۲ حرف بنویسید.', { exact: true }).waitFor();
      assert.equal(await page.locator('.market-stock').count(), 0);
      await page.getByRole('button', { name: 'پاک‌کردن', exact: true }).click();
      assert.equal(await input.inputValue(), '');
    } finally { release(); }
    await page.context().close();
  });

  await check('stock empty result stays distinct from failure', async () => {
    const page = await session();
    await openCategory(page, 'بورس');
    await page.route('**/api/v1/market/stocks?*', async route => {
      const response = await route.fetch(); const data = await response.json();
      data.results = []; data.total = 0;
      await route.fulfill({ response, json: data });
    });
    await page.getByRole('searchbox', { name: 'جست‌وجوی نماد بورس', exact: true }).fill('ناموجود');
    await page.getByText('نمادی با این نام پیدا نشد.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'جست‌وجوی دوباره', exact: true }).count(), 0);
    await page.context().close();
  });

  await check('market status and search retry copy stay editable in English empty and English', async () => {
    const catalog = await (await fetch(base + '/__copy/catalog')).json();
    const refreshText = 'قیمت‌ها تازه نشد؛ آخرین قیمت‌های دریافت‌شده نمایش داده می‌شوند.';
    const staleText = 'این قیمت‌ها ممکن است قدیمی باشند.';
    for (const text of [refreshText, staleText, 'جست‌وجوی دوباره']) {
      assert.ok(catalog.entries.some(entry => entry.text === text), 'Missing copy: ' + text);
    }
    async function draft(page, original, text) {
      const entry = catalog.entries.find(entry => entry.text === original);
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin),
        [{ id: entry.id, original: entry.text, text, matchingIds: [entry.id], tokens: [] }]);
    }
    const page = await session();
    await page.locator('.market-tile').first().waitFor();
    await page.route('**/api/v1/market/prices', route => failure(route, 'Copy refresh failure'));
    await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
    await page.getByText(refreshText, { exact: true }).waitFor();
    for (const text of ['Last received prices are shown.', '', 'Last received prices are shown.']) {
      await draft(page, refreshText, text);
      await page.waitForFunction(text => document.querySelector('[role=alert] .section-hint')?.textContent.trim() === text, text);
    }
    await page.context().close();
    const stockPage = await session(); await openCategory(stockPage, 'بورس');
    await stockPage.route('**/api/v1/market/stocks?*', route => failure(route, 'Copy stock failure'));
    await stockPage.getByRole('searchbox', { name: 'جست‌وجوی نماد بورس', exact: true }).fill('فولاد');
    const retry = stockPage.locator('.market-card [role=alert] button'); await retry.waitFor();
    for (const text of ['Retry search', '', 'Retry search']) {
      await draft(stockPage, 'جست‌وجوی دوباره', text);
      await stockPage.waitForFunction(text => document.querySelector('.market-card [role=alert] button')?.textContent.trim() === text, text);
    }
    await stockPage.context().close();
  });
} finally {
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser.close();
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  if (results.errors.length || results.externalRequests.length) process.exitCode = 1;
}
