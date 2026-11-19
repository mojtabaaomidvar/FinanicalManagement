import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:5701';
const output = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) ?? '.local-test/bank-sms');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
await mkdir(output, { recursive: true });
const results = { startedAt: new Date().toISOString(), checks: [], errors: [], externalRequests: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const contexts = [];
const root = await browser.newPage(); await root.goto(base);
const token = await root.evaluate(() => window.__COPY_WORKBENCH__.csrfToken); await root.close();
const rawSms = 'بانک ملی؛ برداشت مبلغ ۲۵۰,۰۰۰ ریال؛ موجودی ۹,۰۰۰,۰۰۰ ریال';

async function session(pending = true, setup, raw = rawSms) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tehran' });
  contexts.push(context);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
      results.externalRequests.push(url.origin + url.pathname); await route.abort();
    } else await route.continue();
  });
  const response = await context.request.post(base + '/__copy/preview', {
    headers: { Origin: base, 'X-Copy-Workbench-Token': token },
    data: { scenarioId: pending ? 'sms-pending' : 'full-owner', route: 'dashboard' },
  });
  assert.equal(response.status(), 200);
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => results.errors.push(error.message));
  if (pending) await page.route('**/api/v1/sms?status=pending', async route => {
    const response = await route.fetch(); const rows = await response.json();
    for (const row of rows) { row.raw_text = raw; row.amount = 250000; }
    await route.fulfill({ response, json: rows });
  });
  if (setup) await setup(page);
  await page.goto(base + (await response.json()).url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true, null, { timeout: 25000 });
  await page.locator('section.page.active').waitFor();
  return page;
}
function pendingSheet(page) { return page.locator('.modal-sheet').filter({ has: page.locator('.pending-head') }); }
async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch('/api/v1' + path, { method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return response.status === 204 ? null : response.json();
  }, { path, method, body });
}
async function fail(route, message) {
  await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SERVER', message }) });
}
async function ready(page) {
  const sheet = pendingSheet(page); await sheet.waitFor();
  await sheet.getByRole('textbox', { name: 'مبلغ پیامک', exact: true }).waitFor();
  return sheet;
}
async function importer(page) {
  await page.getByRole('button', { name: 'افزودن تراکنش', exact: true }).click();
  await page.getByRole('button', { name: /ثبت از پیامک بانکی/ }).click();
  const sheet = page.locator('.modal-sheet').filter({ has: page.getByRole('textbox', { name: 'متن پیامک‌ها', exact: true }) });
  await sheet.waitFor(); return sheet;
}
async function receipts(page) {
  return page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('khaneyar:pending-sms:v1:')));
}
async function check(name, run) {
  if (only && !name.includes(only)) return;
  try { await run(); results.checks.push(name); console.log('PASS ' + name); }
  catch (error) { results.errors.push(name + ': ' + error.message); console.log('FAIL ' + name + ': ' + error.message); }
}

try {
  await check('import preview converts rial to toman and rejects messages without transactions', async () => {
    const page = await session(false); const sheet = await importer(page);
    const text = sheet.getByRole('textbox', { name: 'متن پیامک‌ها', exact: true });
    await text.fill(rawSms);
    assert.match(await sheet.locator('.sms-preview').innerText(), /۲۵,۰۰۰/);
    let writes = 0; await page.route('**/api/v1/sms', async route => {
      if (route.request().method() === 'POST') writes++;
      await route.continue();
    });
    await text.fill('سلام، کد ورود شما ۱۲۳۴۵۶');
    await sheet.getByRole('button', { name: 'افزودن پیامک‌ها', exact: true }).click();
    await page.getByText('پیامک واریز یا برداشت با مبلغ معتبر پیدا نشد', { exact: true }).waitFor();
    assert.equal(writes, 0); assert.equal(await text.inputValue(), 'سلام، کد ورود شما ۱۲۳۴۵۶');
    await page.context().close();
  });

  await check('import locks repeated requests input and close paths and sends original SMS units', async () => {
    const page = await session(false); const before = await api(page, '/transactions');
    const sheet = await importer(page); const text = sheet.getByRole('textbox', { name: 'متن پیامک‌ها', exact: true });
    await text.fill(rawSms + '\n\nسلام');
    let release, writes = [];
    const gate = new Promise(done => { release = done; });
    await page.route('**/api/v1/sms', async route => {
      if (route.request().method() === 'POST') { writes.push(route.request().postDataJSON()); await gate; }
      await route.continue();
    });
    try {
      await sheet.getByRole('button', { name: 'افزودن پیامک‌ها', exact: true }).evaluate(button => { button.click(); button.click(); });
      await page.waitForTimeout(150); assert.equal(writes.length, 1);
      assert.equal(writes[0].items.length, 1); assert.equal(writes[0].items[0].amount, 250000);
      assert.equal(await text.isDisabled(), true);
      await page.keyboard.press('Escape'); await sheet.getByRole('button', { name: 'انصراف', exact: true }).evaluate(button => button.click());
      assert.equal(await sheet.isVisible(), true);
    } finally { release(); }
    await sheet.waitFor({ state: 'hidden' });
    assert.deepEqual(await api(page, '/transactions'), before);
    await page.context().close();
  });

  await check('pending draft uses selected display currency without altering base transaction amount', async () => {
    const page = await session(); let sheet = await ready(page);
    assert.equal(await sheet.getByRole('textbox', { name: 'مبلغ پیامک', exact: true }).inputValue(), '۲۵,۰۰۰');
    await api(page, '/members/me/currency', 'POST', { currency: 'ریال' });
    await page.reload({ waitUntil: 'domcontentloaded' }); sheet = await ready(page);
    assert.equal(await sheet.getByRole('textbox', { name: 'مبلغ پیامک', exact: true }).inputValue(), '۲۵۰,۰۰۰');
    const before = await api(page, '/transactions');
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    const after = await api(page, '/transactions');
    assert.equal(after.length, before.length + 1); assert.equal(after.at(-1).amount, 25000);
    await page.context().close();
  });

  await check('unknown units and invalid amount cannot silently create an expense', async () => {
    const page = await session(true, undefined, 'برداشت مبلغ 250000'); const sheet = await ready(page);
    const input = sheet.getByRole('textbox', { name: 'مبلغ پیامک', exact: true });
    assert.equal(await input.inputValue(), '');
    await sheet.getByText('واحد مبلغ پیامک مشخص نیست؛ مبلغ را در واحد انتخابی وارد کنید.', { exact: true }).waitFor();
    const before = await api(page, '/transactions');
    for (const invalid of ['۱۲÷۰', '۱۲+', '-100', '']) {
      await input.fill(invalid); await sheet.getByRole('button', { name: 'ثبت', exact: true }).click();
      await sheet.getByText('لطفاً مبلغ معتبر وارد کنید', { exact: true }).waitFor();
      assert.equal(await input.inputValue(), invalid);
    }
    assert.deepEqual(await api(page, '/transactions'), before);
    await page.context().close();
  });

  await check('pending record locks before label request and creates only one expense', async () => {
    const page = await session(); const sheet = await ready(page);
    const before = await api(page, '/transactions');
    await sheet.getByRole('textbox', { name: 'لیبل پیامک', exact: true }).fill('آزمون ثبت پیامک');
    let release, labels = 0, writes = 0;
    const gate = new Promise(done => { release = done; });
    await page.route('**/api/v1/subcategories', async route => {
      if (route.request().method() === 'POST') { labels++; await gate; }
      await route.continue();
    });
    await page.route('**/api/v1/transactions', async route => {
      if (route.request().method() === 'POST') writes++;
      await route.continue();
    });
    try {
      await sheet.getByRole('button', { name: 'ثبت', exact: true }).evaluate(button => { button.click(); button.click(); });
      await page.waitForTimeout(300); assert.equal(labels, 1); assert.equal(writes, 0);
      assert.equal(await sheet.getByRole('textbox', { name: 'مبلغ پیامک', exact: true }).isDisabled(), true);
      await page.keyboard.press('Escape');
      await sheet.getByRole('button', { name: 'بعداً', exact: true }).evaluate(button => button.click());
      assert.equal(await sheet.isVisible(), true);
    } finally { release(); }
    await sheet.waitFor({ state: 'hidden' }); assert.equal(writes, 1);
    assert.equal((await api(page, '/transactions')).length, before.length + 1);
    assert.deepEqual(await receipts(page), []);
    await page.context().close();
  });

  await check('acknowledgement failure survives reload and retries without another financial write', async () => {
    const page = await session(); let sheet = await ready(page);
    const before = await api(page, '/transactions');
    await sheet.getByRole('textbox', { name: 'مبلغ پیامک', exact: true }).fill('۴۰۰۰۰');
    await page.route('**/api/v1/sms/*', route => route.request().method() === 'PATCH' ? fail(route, 'Ack failure') : route.continue());
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click();
    await sheet.getByText('تراکنش ثبت شد؛ تأیید پیامک ناموفق بود. دوباره تأیید کنید', { exact: true }).waitFor();
    const stored = await api(page, '/transactions'); assert.equal(stored.length, before.length + 1);
    const recovery = await receipts(page); assert.equal(recovery.length, 1); assert.equal(recovery[0][1], stored.at(-1).id);
    assert.equal(await sheet.getByRole('button', { name: 'نادیده', exact: true }).isDisabled(), true);
    await page.reload({ waitUntil: 'domcontentloaded' }); sheet = await ready(page);
    await sheet.getByRole('button', { name: 'تأیید دوباره پیامک', exact: true }).waitFor();
    assert.equal(await sheet.getByRole('textbox', { name: 'مبلغ پیامک', exact: true }).inputValue(), '۴۰,۰۰۰');
    await page.unroute('**/api/v1/sms/*');
    await sheet.getByRole('button', { name: 'تأیید دوباره پیامک', exact: true }).click();
    await sheet.waitFor({ state: 'hidden' });
    assert.deepEqual(await api(page, '/transactions'), stored); assert.deepEqual(await receipts(page), []);
    await page.context().close();
  });

  await check('missing saved transaction blocks acknowledgement and another expense', async () => {
    const page = await session(); const sheet = await ready(page);
    await page.route('**/api/v1/sms/*', route => route.request().method() === 'PATCH' ? fail(route, 'Ack failure') : route.continue());
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click();
    await sheet.getByRole('button', { name: 'تأیید دوباره پیامک', exact: true }).waitFor();
    const stored = await api(page, '/transactions');
    await api(page, '/transactions/' + stored.at(-1).id, 'DELETE');
    const before = await api(page, '/transactions');
    await page.unroute('**/api/v1/sms/*');
    await sheet.getByRole('button', { name: 'تأیید دوباره پیامک', exact: true }).click();
    await sheet.getByText('تراکنش قبلی پیدا نشد؛ فهرست تراکنش‌ها را بررسی کنید', { exact: true }).waitFor();
    assert.deepEqual(await api(page, '/transactions'), before);
    await page.context().close();
  });

  await check('SMS expense needs explicit shortage consent and negative balance persists', async () => {
    const page = await session(); const sheet = await ready(page);
    await sheet.getByRole('textbox', { name: 'مبلغ پیامک', exact: true }).fill('۵۰۰۰۰۰۰۰');
    const before = await api(page, '/transactions');
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click();
    const popup = page.getByRole('alertdialog'); await popup.waitFor();
    assert.deepEqual(await api(page, '/transactions'), before);
    await popup.getByRole('button', { name: 'اصلاح مبلغ', exact: true }).click();
    assert.deepEqual(await api(page, '/transactions'), before);
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click(); await popup.waitFor();
    await page.screenshot({ path: resolve(output, 'sms-shortage-popup.png'), fullPage: true });
    await popup.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    const after = await api(page, '/transactions'); assert.equal(after.length, before.length + 1);
    assert.equal(after.at(-1).amount, 50000000);
    const accounts = await api(page, '/accounts');
    const accountId = after.at(-1).account_id;
    const balance = after.reduce((value, tx) => value
      + (tx.account_id === accountId ? (tx.type === 'income' ? tx.amount : -tx.amount) : 0)
      + (tx.type === 'transfer' && tx.to_account_id === accountId ? tx.amount : 0),
      accounts.find(account => account.id === accountId).initial_balance);
    assert.ok(balance < 0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.deepEqual(await api(page, '/transactions'), after);
    await page.context().close();
  });

  await check('ignore request locks actions and never writes financial data', async () => {
    const page = await session(); const sheet = await ready(page); const before = await api(page, '/transactions');
    let release, writes = 0; const gate = new Promise(done => { release = done; });
    await page.route('**/api/v1/sms/*', async route => {
      if (route.request().method() === 'PATCH') { writes++; await gate; }
      await route.continue();
    });
    try {
      await sheet.getByRole('button', { name: 'نادیده', exact: true }).evaluate(button => { button.click(); button.click(); });
      await page.waitForTimeout(150); assert.equal(writes, 1);
      assert.equal(await sheet.getByRole('textbox', { name: 'مبلغ پیامک', exact: true }).isDisabled(), true);
      await sheet.locator('.btn-primary').evaluate(button => button.click());
    } finally { release(); }
    await sheet.waitFor({ state: 'hidden' });
    assert.deepEqual(await api(page, '/transactions'), before);
    await page.context().close();
  });

  await check('fresh balance change asks for consent again before financial creation', async () => {
    const page = await session(); const sheet = await ready(page);
    await sheet.getByRole('textbox', { name: 'مبلغ پیامک', exact: true }).fill('۵۰۰۰۰۰۰۰');
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click();
    const popup = page.getByRole('alertdialog'); await popup.waitFor();
    const firstBalance = await popup.locator('.tx-balance-remaining').innerText();
    const accountId = await sheet.getByRole('combobox', { name: 'حساب پیامک', exact: true }).inputValue();
    const actor = (await api(page, '/auth/members')).find(member => member.role === 'owner');
    const transactions = await api(page, '/transactions');
    await api(page, '/transactions', 'POST', { member_id: actor.id, type: 'income', amount: 10000,
      category: 'salary', account_id: accountId, date: transactions[0].date, repeat: 'none' });
    const before = await api(page, '/transactions');
    await popup.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click();
    await page.waitForFunction(first => document.querySelector('.tx-balance-remaining')?.textContent !== first, firstBalance);
    assert.deepEqual(await api(page, '/transactions'), before);
    await popup.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    assert.equal((await api(page, '/transactions')).length, before.length + 1);
    await page.context().close();
  });

  await check('failed financial write preserves draft and a retry records one expense', async () => {
    const page = await session(); const sheet = await ready(page); const before = await api(page, '/transactions');
    await sheet.getByRole('textbox', { name: 'مبلغ پیامک', exact: true }).fill('۷۰۰۰۰');
    await page.route('**/api/v1/transactions', route => route.request().method() === 'POST' ? fail(route, 'Financial write failure') : route.continue());
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click();
    await sheet.getByText('Financial write failure', { exact: true }).waitFor();
    assert.equal(await sheet.getByRole('textbox', { name: 'مبلغ پیامک', exact: true }).inputValue(), '۷۰,۰۰۰');
    assert.deepEqual(await receipts(page), []); assert.deepEqual(await api(page, '/transactions'), before);
    await page.unroute('**/api/v1/transactions');
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    const after = await api(page, '/transactions');
    assert.equal(after.length, before.length + 1); assert.equal(after.at(-1).amount, 70000);
    await page.context().close();
  });

  await check('ignore failure keeps the message available and retries without financial writes', async () => {
    const page = await session(); const sheet = await ready(page); const before = await api(page, '/transactions');
    await page.route('**/api/v1/sms/*', route => route.request().method() === 'PATCH' ? fail(route, 'Ignore failure') : route.continue());
    await sheet.getByRole('button', { name: 'نادیده', exact: true }).click();
    await sheet.getByText('Ignore failure', { exact: true }).waitFor();
    await page.unroute('**/api/v1/sms/*');
    await sheet.getByRole('button', { name: 'نادیده', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    assert.deepEqual(await api(page, '/transactions'), before);
    await page.context().close();
  });

  await check('pending read failure has a retry and restores the existing message', async () => {
    const page = await session(true, page => page.route('**/api/v1/sms?status=pending', route => fail(route, 'Read SMS failure')));
    const sheet = pendingSheet(page); await sheet.getByText('Read SMS failure', { exact: true }).waitFor();
    assert.equal(await sheet.locator('.pending-card').count(), 0);
    await page.unroute('**/api/v1/sms?status=pending');
    await sheet.getByRole('button', { name: 'دریافت دوباره پیامک‌ها', exact: true }).click();
    await sheet.locator('.pending-card').waitFor();
    await page.context().close();
  });

  await check('SMS fixed copy stays discoverable and editable after English empty and English', async () => {
    const catalog = await (await fetch(base + '/__copy/catalog')).json();
    const text = 'واحد مبلغ پیامک مشخص نیست؛ مبلغ را در واحد انتخابی وارد کنید.';
    for (const fixed of [text, 'در حال دریافت پیامک‌ها…', 'دریافت دوباره پیامک‌ها', 'تأیید دوباره پیامک',
      'تراکنش ثبت شد؛ تأیید پیامک ناموفق بود. دوباره تأیید کنید', 'مبلغ پیامک', 'در حال افزودن پیامک‌ها…']) {
      assert.ok(catalog.entries.some(entry => entry.text === fixed), 'Missing copy: ' + fixed);
    }
    const page = await session(true, undefined, 'برداشت مبلغ 250000'); const sheet = await ready(page);
    const entry = catalog.entries.find(entry => entry.text === text);
    for (const replacement of ['Enter the amount in your selected currency.', '', 'Enter the amount in your selected currency.']) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin),
        [{ id: entry.id, original: entry.text, text: replacement, matchingIds: [entry.id], tokens: [] }]);
      await page.waitForFunction(replacement => document.querySelector('.modal-sheet .section-hint')?.textContent.trim() === replacement, replacement);
    }
    assert.equal(await sheet.getByRole('textbox', { name: 'مبلغ پیامک', exact: true }).inputValue(), '');
    await page.context().close();
  });
} finally {
  await Promise.allSettled(contexts.map(context => context.close())); await browser.close();
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  if (results.errors.length || results.externalRequests.length) process.exitCode = 1;
}
