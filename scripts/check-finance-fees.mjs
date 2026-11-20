import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:5701', output = resolve('.local-test/finance-fees');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
await mkdir(output, { recursive: true });
const results = { checks: [], errors: [], externalRequests: [] }, contexts = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const root = await browser.newPage(); await root.goto(base);
const token = await root.evaluate(() => window.__COPY_WORKBENCH__.csrfToken); await root.close();
async function session(route = 'dashboard', scenarioId = 'full-owner') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tehran' }); contexts.push(context);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) { results.externalRequests.push(url.origin + url.pathname); await route.abort(); }
    else await route.continue();
  });
  const response = await context.request.post(base + '/__copy/preview', { headers: { Origin: base, 'X-Copy-Workbench-Token': token }, data: { scenarioId, route } });
  assert.equal(response.status(), 200);
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => results.errors.push(error.message));
  await page.goto(base + (await response.json()).url); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
  await page.locator('section.page.active').waitFor(); return page;
}
async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch('/api/v1' + path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }, { path, method, body });
}
async function reload(page) { await page.reload(); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true); await page.locator('.floating-navigation').waitFor(); }
async function form(page) {
  await page.getByRole('button', { name: 'افزودن تراکنش', exact: true }).click();
  const form = page.locator('.tx-simple'); await form.waitFor();
  await form.getByRole('tab', { name: 'انتقال', exact: true }).click(); return form;
}
async function banks(page, balance = 5000000) {
  const owner = (await api(page, '/accounts')).body[0].member_id;
  const add = async (title, initial_balance) => (await api(page, '/accounts', 'POST', { member_id: owner, title, kind: 'bank', bank: 'ملی', initial_balance })).body;
  const source = await add('Fee source', balance), destination = await add('Fee destination', 0);
  await reload(page); return { source, destination, owner };
}
async function fill(form, source, destination, amount = '1000000') {
  await form.locator('.tx-amount').fill(amount);
  await form.getByRole('combobox', { name: 'حساب مبدأ', exact: true }).selectOption(source.id);
  await form.getByRole('combobox', { name: 'حساب مقصد', exact: true }).selectOption(destination.id);
}
async function check(name, run) {
  if (only && !name.includes(only)) return;
  try { await run(); results.checks.push(name); console.log('PASS ' + name); }
  catch (error) { results.errors.push(name + ': ' + error.stack); console.log('FAIL ' + name + ': ' + error.message); }
}
try {
  await check('fee and SMS display copy is editable while parser vocabulary stays protected', async () => {
    const catalog = await (await fetch(base + '/__copy/catalog')).json();
    for (const text of ['این انتقال کارمزد هم داشت؟', 'نوع انتقال بانکی', 'انتخاب حساب پیشنهادی',
      'موجودی حساب پیشنهادی برای این هزینه کافی نیست.', 'مبلغ پرداخت باید عدد صحیح مثبت به ریال باشد.']) {
      assert.ok(catalog.entries.some(entry => entry.text === text), 'Missing editable copy: ' + text);
    }
    assert.equal(catalog.entries.filter(entry => entry.file.endsWith('/sms-parser-account-suggestion.ts')).length, 0);
  });
  await check('notifications start at the top and keep their header there while scrolling', async () => {
    const page = await session('notifications'); const header = page.locator('.notifications-page .app-header');
    await header.waitFor(); await page.waitForTimeout(350);
    assert.ok((await header.boundingBox()).y <= 2);
    const first = await page.locator('.notifications-content').boundingBox(); assert.ok(first.y < 120);
    await page.evaluate(() => window.scrollTo(0, 400)); await page.waitForTimeout(150);
    assert.ok((await header.boundingBox()).y <= 2);
    await page.screenshot({ path: resolve(output, 'notifications.png') }); await page.context().close();
  });
  await check('billboard pill and dots sit tightly together directly beneath the banner', async () => {
    const page = await session('hub'); await page.emulateMedia({ reducedMotion: 'reduce' });
    const deck = page.locator('.home-billboard-deck'); await deck.focus(); await page.keyboard.press('Home');
    const front = await page.locator('[data-billboard-layer="front"]').boundingBox();
    const tabs = page.getByRole('tablist', { name: 'انتخاب کارت خانه' });
    const pill = await tabs.locator('[aria-selected=true] > span').boundingBox();
    assert.ok(pill.width >= 30 && pill.y - (front.y + front.height) <= 8, JSON.stringify({ pill, front }));
    const spans = await tabs.locator('button > span').evaluateAll(nodes => nodes.map(node => { const b = node.getBoundingClientRect(); return { x: b.x, width: b.width }; }).sort((a, b) => a.x - b.x));
    for (let i = 1; i < spans.length; i++) assert.ok(spans[i].x - spans[i - 1].x - spans[i - 1].width <= 6);
    assert.equal(await page.getByRole('button', { name: /نمایش خودکار کارت‌ها/ }).count(), 0);
    await page.screenshot({ path: resolve(output, 'billboard.png') }); await page.context().close();
  });
  await check('all five transfer methods create the expected silent source expense; no-fee creates none', async () => {
    for (const [method, expected] of [['internal', 0], ['card_to_card', 11000], ['paya', 4000], ['satna', 2000], ['pol', 8000], [null, null]]) {
      const page = await session(); const { source, destination } = await banks(page);
      const sheet = await form(page); await fill(sheet, source, destination);
      await sheet.getByRole('button', { name: method ? 'بله' : 'خیر', exact: true }).click();
      if (method) { await sheet.getByRole('combobox', { name: 'نوع انتقال بانکی' }).selectOption(method); await sheet.getByText('در حال بررسی حساب…', { exact: true }).waitFor({ state: 'hidden' }); }
      assert.equal(await sheet.locator('.tx-transfer-fee').getByText(/۱۱,۰۰۰|۱,۱۰۰/).count(), 0);
      await sheet.locator('.tx-simple-save').click(); await sheet.waitFor({ state: 'hidden' });
      const rows = (await api(page, '/transactions')).body;
      const parent = rows.find(row => row.account_id === source.id && row.type === 'transfer'); assert.ok(parent);
      assert.equal(parent.transfer_fee_rial ?? null, expected);
      const fees = rows.filter(row => row.transfer_fee_for_id === parent.id); assert.equal(fees.length, expected ? 1 : 0);
      if (expected) { assert.equal(fees[0].amount, expected / 10); assert.equal(fees[0].category, 'finance'); assert.equal(fees[0].account_id, source.id); }
      if (method) assert.equal(await api(page, '/transactions/transfer-fee?method=paya_group&amount_rial=1&payment_count=3').then(r => r.body.fee_rial), 31200);
      await page.context().close();
    }
  });
  await check('bank source below amount plus fee is hidden; switching to cash clears the fee choice', async () => {
    const page = await session(); const { source, destination, owner } = await banks(page, 1001099.9);
    const cash = (await api(page, '/accounts', 'POST', { member_id: owner, title: 'Fee cash', kind: 'wallet', initial_balance: 2000000 })).body;
    await reload(page); const sheet = await form(page); await fill(sheet, source, destination);
    await sheet.getByRole('button', { name: 'بله', exact: true }).click();
    await sheet.getByRole('combobox', { name: 'نوع انتقال بانکی' }).selectOption('card_to_card');
    const sourceSelect = sheet.getByRole('combobox', { name: 'حساب مبدأ', exact: true });
    await sourceSelect.locator(`option[value="${source.id}"]`).waitFor({ state: 'detached' });
    assert.equal(await sourceSelect.inputValue(), '');
    await sourceSelect.selectOption(cash.id); assert.equal(await sheet.locator('.tx-transfer-fee').count(), 0);
    await sheet.locator('.tx-simple-save').click(); await sheet.waitFor({ state: 'hidden' });
    const parent = (await api(page, '/transactions')).body.find(row => row.account_id === cash.id);
    assert.equal(parent.transfer_fee_method, null); await page.context().close();
  });
  await check('quote failure keeps the form open and a retry creates one transfer with one fee', async () => {
    const page = await session(); const { source, destination } = await banks(page); const sheet = await form(page); await fill(sheet, source, destination);
    await page.route('**/api/v1/transactions/transfer-fee?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'SERVER', message: 'Quote unavailable' }) }));
    await sheet.getByRole('button', { name: 'بله', exact: true }).click(); await sheet.getByRole('combobox', { name: 'نوع انتقال بانکی' }).selectOption('paya');
    await sheet.locator('.tx-transfer-fee [role=alert]').waitFor(); await sheet.locator('.tx-simple-save').click();
    await sheet.getByText('در حال بررسی حساب…', { exact: true }).waitFor({ state: 'hidden' }); assert.equal(await sheet.isVisible(), true);
    assert.equal((await api(page, '/transactions')).body.filter(row => row.account_id === source.id).length, 0);
    await page.unroute('**/api/v1/transactions/transfer-fee?**'); await sheet.locator('.tx-simple-save').click(); await sheet.waitFor({ state: 'hidden' });
    assert.equal((await api(page, '/transactions')).body.filter(row => row.account_id === source.id).length, 2); await page.context().close();
  });
  await check('SMS suggests an owned name/account, hides insufficient choices, and only hints a foreign member', async () => {
    const page = await session('sms', 'sms-pending'); const rows = (await api(page, '/accounts')).body, owner = rows[0].member_id;
    const members = (await api(page, '/auth/members')).body, actor = members.find(member => member.id === owner), foreign = members.find(member => member.id !== owner);
    const own = (await api(page, '/accounts', 'POST', { member_id: owner, title: 'جاری ملی پیشنهاد', bank: 'ملی', kind: 'bank', initial_balance: 50000 })).body;
    const texts = [`${actor.name}؛ جاری ملی پیشنهاد؛ برداشت ۲۵۰,۰۰۰ ریال`, `${foreign.name}؛ سپرده ملت؛ برداشت ۲۵۰,۰۰۰ ریال`];
    await api(page, '/sms', 'POST', { items: texts.map(raw_text => ({ raw_text, type: 'expense', amount: 250000, date: '2026-11-19' })) });
    await reload(page);
    for (const raw of texts) {
      const pending = (await api(page, '/sms?status=pending')).body.find(row => row.raw_text === raw);
      await page.locator(`[data-sms-id="${pending.id}"]`).click(); const sheet = page.locator('.modal-sheet').filter({ has: page.locator('.pending-head') });
      const suggestion = sheet.locator('.sms-account-suggestion'); await suggestion.waitFor();
      if (raw === texts[0]) {
        await suggestion.getByRole('button', { name: 'انتخاب حساب پیشنهادی' }).click();
        const select = sheet.getByRole('combobox', { name: 'حساب پیامک' }); assert.equal(await select.inputValue(), own.id);
        await sheet.getByRole('textbox', { name: 'مبلغ پیامک' }).fill('60000'); await select.locator(`option[value="${own.id}"]`).waitFor({ state: 'detached' });
        assert.equal(await suggestion.getByRole('button', { name: 'انتخاب حساب پیشنهادی' }).isDisabled(), true);
      } else { assert.equal(await suggestion.getByRole('button', { name: 'انتخاب حساب پیشنهادی' }).count(), 0); await suggestion.getByText(foreign.name, { exact: true }).waitFor(); }
      await sheet.getByRole('button', { name: 'بعداً', exact: true }).click();
    }
    await page.context().close();
  });
  await check('wallet rial digits survive create, display, edit and reload; toman rounds the display', async () => {
    const page = await session('accounts'); const owner = (await api(page, '/accounts')).body[0].member_id;
    await api(page, '/members/me/currency', 'PATCH', { currency: 'ریال' }); await reload(page);
    await page.locator('.card').filter({ has: page.getByRole('heading', { name: 'کیف‌پول‌ها', exact: true }) }).getByRole('button', { name: 'افزودن', exact: true }).click();
    let sheet = page.locator('.account-form-sheet'); await sheet.waitFor();
    await sheet.getByRole('textbox', { name: /عنوان|نام/ }).first().fill('Odd rial wallet');
    await sheet.getByLabel('موجودی اولیه (اختیاری)', { exact: true }).fill('14999');
    await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    const account = (await api(page, '/accounts')).body.find(row => row.title === 'Odd rial wallet'); assert.equal(account.member_id, owner); assert.equal(account.initial_balance, 1499.9);
    const card = page.getByRole('button', { name: 'ویرایش Odd rial wallet', exact: true }); await card.getByText('۱۴,۹۹۹', { exact: true }).waitFor();
    await card.click(); sheet = page.locator('.account-form-sheet'); assert.equal(await sheet.getByLabel('موجودی فعلی', { exact: true }).inputValue(), '۱۴,۹۹۹');
    await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    await api(page, '/members/me/currency', 'PATCH', { currency: 'تومان' }); await reload(page); await page.getByRole('button', { name: 'ویرایش Odd rial wallet', exact: true }).getByText('۱,۵۰۰', { exact: true }).waitFor();
    assert.equal((await api(page, '/accounts')).body.find(row => row.id === account.id).initial_balance, 1499.9);
    await page.context().close();
  });
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser.close();
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
}
if (results.errors.length || results.externalRequests.length) { console.error(JSON.stringify(results.errors, null, 2)); process.exitCode = 1; }
else console.log('Finance fees: ' + results.checks.length + ' checks passed.');
