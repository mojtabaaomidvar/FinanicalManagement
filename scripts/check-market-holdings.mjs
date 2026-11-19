import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Real React against isolated fictional copy-preview sessions; no financial writes outside 5701.
const base = 'http://127.0.0.1:5701';
const output = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) ?? '.local-test/market-holdings');
await mkdir(output, { recursive: true });
const results = { startedAt: new Date().toISOString(), checks: [], errors: [], externalRequests: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const contexts = [];
const root = await browser.newPage(); await root.goto(base);
const token = await root.evaluate(() => window.__COPY_WORKBENCH__.csrfToken); await root.close();
async function session(route = 'market', setup) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tehran' });
  contexts.push(context);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
      results.externalRequests.push(url.origin + url.pathname); await route.abort();
    } else await route.continue();
  });
  const response = await context.request.post(base + '/__copy/preview', {
    headers: { Origin: base, 'X-Copy-Workbench-Token': token }, data: { scenarioId: 'full-owner', route },
  });
  assert.equal(response.status(), 200);
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => results.errors.push(error.message));
  if (setup) await setup(page);
  await page.goto(base + (await response.json()).url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true, null, { timeout: 25000 });
  await page.locator('section.page.active').waitFor();
  return page;
}
async function api(page, path) {
  return page.evaluate(async path => (await fetch('/api/v1' + path)).json(), path);
}
async function dollars(page) {
  await page.locator('.market-tile').filter({ has: page.getByText('ارز', { exact: true }) }).click();
  await page.locator('.pt-tile').filter({ hasText: 'دلار آمریکا' }).click();
  await page.locator('.hold-target-name').waitFor();
}
async function check(name, run) {
  try { await run(); results.checks.push(name); console.log('PASS ' + name); }
  catch (error) { results.errors.push(name + ': ' + error.message); console.log('FAIL ' + name + ': ' + error.stack); }
}
try {
  await check('holdings pending save locks repeated writes input and every close path', async () => {
    const page = await session(); await dollars(page);
    const sheet = page.locator('.modal-sheet'); await sheet.locator('input').fill('۲۵۰');
    let release, writes = 0;
    const gate = new Promise(done => { release = done; });
    await page.route('**/api/v1/holdings/*', async route => {
      if (route.request().method() === 'PATCH') { writes++; await gate; }
      await route.continue();
    });
    try {
      await sheet.getByRole('button', { name: 'ذخیره مقدار', exact: true }).evaluate(button => { button.click(); button.click(); });
      await page.waitForTimeout(250); assert.equal(writes, 1);
      assert.equal(await sheet.locator('input').isDisabled(), true);
      await page.keyboard.press('Escape'); assert.equal(await sheet.isVisible(), true);
      await page.locator('.modal-overlay').click({ position: { x: 10, y: 10 } }); assert.equal(await sheet.isVisible(), true);
    } finally { release(); }
    await sheet.waitFor({ state: 'hidden' });
    assert.equal((await api(page, '/holdings')).items.find(item => item.symbol === 'USD').quantity, 250);
    await page.context().close();
  });
  await check('holdings initial read failure has retry and cannot turn an existing symbol into a new add', async () => {
    let fail = true, writes = 0;
    const page = await session('market', async page => {
      await page.route('**/api/v1/holdings', async route => {
        if (route.request().method() !== 'GET') writes++;
        if (fail && route.request().method() === 'GET') {
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SERVER', message: 'Holdings read failed' }) });
        } else await route.continue();
      });
    });
    await page.getByText('Holdings read failed', { exact: true }).waitFor();
    await page.locator('.market-tile').filter({ has: page.getByText('ارز', { exact: true }) }).click();
    await page.locator('.pt-tile').filter({ hasText: 'دلار آمریکا' }).click();
    assert.equal(await page.locator('.hold-target-name').count(), 0); assert.equal(writes, 0);
    fail = false; await page.getByRole('button', { name: 'دریافت دوباره دارایی‌ها', exact: true }).click();
    await page.locator('.pt-tile').filter({ hasText: 'دلار آمریکا' }).filter({ hasText: '۱۰۰ دارید' }).waitFor();
    await page.locator('.pt-tile').filter({ hasText: 'دلار آمریکا' }).click();
    await page.getByText('ویرایش دارایی', { exact: true }).waitFor();
    await page.context().close();
  });
  await check('holdings successful write followed by read failure retries only the read', async () => {
    const page = await session(); await dollars(page);
    const sheet = page.locator('.modal-sheet'); await sheet.locator('input').fill('۲۰۰');
    let saved = false, fail = true, writes = 0;
    await page.route('**/api/v1/holdings**', async route => {
      if (route.request().method() === 'PATCH') { saved = true; writes++; await route.continue(); }
      else if (saved && fail && route.request().method() === 'GET') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SERVER', message: 'Holdings refresh failed' }) });
      } else await route.continue();
    });
    await sheet.getByRole('button', { name: 'ذخیره مقدار', exact: true }).click();
    await sheet.waitFor({ state: 'hidden' }); await page.getByText('Holdings refresh failed', { exact: true }).waitFor();
    await page.getByText('تغییر ذخیره شد؛ فهرست دارایی‌ها تازه نشد.', { exact: true }).waitFor();
    fail = false; await page.getByRole('button', { name: 'دریافت دوباره دارایی‌ها', exact: true }).click();
    await page.locator('.pt-tile').filter({ hasText: 'دلار آمریکا' }).filter({ hasText: '۲۰۰ دارید' }).waitFor();
    assert.equal(writes, 1); await page.context().close();
  });
  await check('holdings accounts failure avoids false empty and total wealth and preserves cash chart', async () => {
    let fail = true;
    const page = await session('accounts', async page => {
      await page.route('**/api/v1/holdings', async route => {
        if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SERVER', message: 'Assets unavailable' }) });
        else await route.continue();
      });
    });
    await page.getByText('Assets unavailable', { exact: true }).waitFor();
    assert.equal(await page.locator('.accounts-empty').filter({ hasText: 'هنوز دارایی‌ای ثبت نشده' }).count(), 0);
    assert.equal((await page.locator('.wealth-total').innerText()).trim(), '—');
    const chart = await page.locator('.wealth-svg').innerHTML();
    fail = false; await page.getByRole('button', { name: 'دریافت دوباره دارایی‌ها', exact: true }).click();
    await page.locator('.hold-card').first().waitFor();
    assert.notEqual((await page.locator('.wealth-total').innerText()).trim(), '—');
    assert.equal(await page.locator('.wealth-svg').innerHTML(), chart);
    await page.screenshot({ path: resolve(output, 'accounts-holdings.png'), fullPage: true });
    await page.context().close();
  });
  await check('holdings decimal add edit and delete preserve financial records and send quantity without prices', async () => {
    const page = await session();
    const before = await api(page, '/transactions');
    await page.locator('.market-tile').filter({ has: page.getByText('ارز', { exact: true }) }).click();
    await page.locator('.pt-tile').filter({ hasText: 'یورو' }).click();
    const sheet = page.locator('.modal-sheet');
    await sheet.getByRole('textbox', { name: 'مقدار (واحد)', exact: true }).fill('۲٫۵');
    assert.match(await sheet.locator('.hold-preview').innerText(), /۲۹۷,۵۰۰/);
    let posted;
    await page.route('**/api/v1/holdings', async route => {
      if (route.request().method() === 'POST') posted = route.request().postDataJSON();
      await route.continue();
    });
    await sheet.getByRole('button', { name: 'افزودن', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    assert.equal(posted.quantity, 2.5); assert.equal(posted.unit, 'تومان');
    assert.equal('price' in posted, false); assert.equal('value' in posted, false);
    await page.locator('.pt-tile').filter({ hasText: 'یورو' }).click();
    await sheet.getByRole('textbox', { name: 'مقدار (واحد)', exact: true }).fill('۳٫۵');
    await sheet.getByRole('button', { name: 'ذخیره مقدار', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    const euro = (await api(page, '/holdings')).items.find(item => item.symbol === 'EUR'); assert.equal(euro.quantity, 3.5);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('copy-workbench:navigate', { detail: { route: 'accounts' } })));
    await page.locator('.hold-card').filter({ hasText: 'یورو' }).waitFor();
    let release, writes = 0, dialogs = 0;
    const gate = new Promise(done => { release = done; });
    page.on('dialog', async dialog => { dialogs++; await dialog.accept(); });
    await page.route('**/api/v1/holdings/' + euro.id, async route => {
      if (route.request().method() === 'DELETE') { writes++; await gate; }
      await route.continue();
    });
    try {
      await page.getByRole('button', { name: 'حذف یورو', exact: true }).click();
      await page.waitForTimeout(150);
      assert.equal(await page.getByRole('button', { name: 'حذف دلار آمریکا', exact: true }).isDisabled(), true);
      await page.locator('.hold-card').filter({ hasText: 'دلار آمریکا' }).evaluate(card => card.click());
      assert.equal(await page.locator('.hold-target-name').count(), 0); assert.equal(writes, 1); assert.equal(dialogs, 1);
    } finally { release(); }
    await page.locator('.hold-card').filter({ hasText: 'یورو' }).waitFor({ state: 'hidden' });
    assert.deepEqual(await api(page, '/transactions'), before);
    await page.context().close();
  });
  await check('holdings new loading retry and unavailable total copy supports English empty and English again', async () => {
    const catalog = await (await fetch(base + '/__copy/catalog')).json();
    const texts = ['در حال دریافت دارایی‌ها…', 'تغییر ذخیره شد؛ فهرست دارایی‌ها تازه نشد.', 'دریافت دوباره دارایی‌ها'];
    for (const text of texts) assert.ok(catalog.entries.find(entry => entry.file.endsWith('/HoldingsStatus.tsx') && entry.text === text));
    const unavailable = catalog.entries.find(entry => entry.file.endsWith('/AccountsPage.tsx') && entry.text === '—'); assert.ok(unavailable);
    let release;
    const gate = new Promise(done => { release = done; });
    const page = await session('accounts', async page => {
      await page.route('**/api/v1/holdings', async route => { await gate; await route.continue(); });
    });
    const loading = catalog.entries.find(entry => entry.text === texts[0] && entry.file.endsWith('/HoldingsStatus.tsx'));
    async function draft(entry, text) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin),
        [{ id: entry.id, original: entry.text, text, matchingIds: [entry.id], tokens: [] }]);
    }
    try {
      for (const text of ['Loading assets…', '', 'Loading assets…']) {
        await draft(loading, text);
        await page.waitForFunction(text => document.querySelector('[role=status].section-hint')?.textContent.trim() === text, text);
      }
      for (const text of ['Unavailable', '', 'Unavailable']) {
        await draft(unavailable, text);
        await page.waitForFunction(text => document.querySelector('.wealth-total')?.textContent.trim() === text, text);
      }
    } finally { release(); }
    await page.locator('.hold-card').first().waitFor(); await page.context().close();
  });
  await check('holdings older read response cannot overwrite the latest list', async () => {
    const page = await session();
    const initial = await api(page, '/holdings');
    await page.route('**/api/v1/holdings', route => route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ code: 'SERVER', message: 'Retry ordering check' }) }));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('copy-workbench:navigate', { detail: { route: 'accounts' } })));
    await page.getByText('Retry ordering check', { exact: true }).waitFor();
    await page.unroute('**/api/v1/holdings');
    let release, reads = 0;
    const gate = new Promise(done => { release = done; });
    await page.route('**/api/v1/holdings', async route => {
      const read = ++reads;
      if (read === 1) await gate;
      const snapshot = structuredClone(initial);
      snapshot.items.find(item => item.symbol === 'USD').quantity = read === 1 ? 111 : 222;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) });
    });
    try {
      await page.getByRole('button', { name: 'دریافت دوباره دارایی‌ها', exact: true }).evaluate(button => { button.click(); button.click(); });
      await page.locator('.hold-card').filter({ hasText: 'دلار آمریکا' }).filter({ hasText: '۲۲۲' }).waitFor();
      assert.equal(reads, 2);
      release(); await page.waitForTimeout(250);
      assert.match(await page.locator('.hold-card').filter({ hasText: 'دلار آمریکا' }).innerText(), /۲۲۲/);
    } finally { release(); }
    await page.context().close();
  });
} finally {
  await Promise.allSettled(contexts.map(context => context.close())); await browser.close();
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  if (results.errors.length || results.externalRequests.length) process.exitCode = 1;
}
