import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createWorkbench } from './copy-workbench/server.mjs';

// The same isolated Copy Studio launcher as other feature checks. Windows
// reserves 5701 here; adapt only the test bridge to this ephemeral loopback port.
const output = resolve('.local-test/finance-integrity');
await mkdir(output, { recursive: true });
const workbench = await createWorkbench({ port: 0 });
await workbench.initialized;
assert.equal(workbench.status().ready, true, workbench.status().message);
const base = workbench.origin, browser = await chromium.launch({ channel: 'msedge', headless: true });
const contexts = [], results = { checks: [], errors: [], externalRequests: [], screenshots: [], manualWrites: 0, billedInference: 0 };
const editor = await browser.newPage(); await editor.goto(base);
const token = await editor.evaluate(() => window.__COPY_WORKBENCH__.csrfToken); await editor.close();
const catalog = await (await fetch(base + '/__copy/catalog')).json();
async function session(route = 'sms', scenario = 'sms-pending', history = false) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tehran' });
  contexts.push(context);
  await context.route('**/*', async interception => {
    const url = new URL(interception.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
      results.externalRequests.push(url.origin + url.pathname); await interception.abort();
    } else await interception.continue();
  });
  await context.route('**/__copy/ui/preview-bridge.js', async interception => {
    const response = await interception.fetch(), original = await response.text();
    assert.ok(original.includes("location.port !== '5701'"));
    await interception.fulfill({ response, body: original.replace("location.port !== '5701'", `location.port !== '${new URL(base).port}'`) });
  });
  if (history) await context.route('**/api/v1/transactions', async interception => {
    if (interception.request().method() !== 'GET') return interception.continue();
    const response = await interception.fetch(), rows = await response.json();
    await interception.fulfill({ response, json: rows.map(row => row.type === 'income' && row.category === 'salary'
      ? { ...row, category: 'food', note: 'Historical user note' } : row) });
  });
  const preview = await context.request.post(base + '/__copy/preview', {
    headers: { Origin: base, 'X-Copy-Workbench-Token': token }, data: { route, scenarioId: scenario },
  });
  assert.equal(preview.status(), 200);
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.calls = [];
  page.on('pageerror', error => results.errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') page.calls.push(new URL(request.url()).pathname); });
  await page.goto(base + (await preview.json()).url);
  await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
  await page.locator('.floating-navigation').waitFor(); return page;
}
async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch('/api/v1' + path, { method,
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }, { path, method, body });
}
async function navigate(page, route) {
  await page.evaluate(route => window.dispatchEvent(new CustomEvent('copy-workbench:navigate', { detail: { route } })), route);
}
async function review(page, id) {
  await page.locator(`[data-sms-id="${id}"]`).click();
  await page.locator('.pending-card').waitFor();
  return page.locator('.modal-sheet').filter({ has: page.locator('.pending-card') });
}
async function check(name, run) {
  try { await run(); results.checks.push(name); console.log('PASS ' + name); }
  catch (error) { results.errors.push(name + ': ' + error.stack); console.error('FAIL ' + name + ': ' + error.message); }
}
async function capture(page, name) {
  const path = resolve(output, name + '.png'); await page.screenshot({ path, fullPage: true, animations: 'disabled' }); results.screenshots.push(path);
}
try {
  await check('online payment saves without a tariff, retains its choice on edit, and removes an earlier linked fee', async () => {
    const page = await session('hub', 'full-owner');
    const bank = (await api(page, '/accounts')).body.find(row => row.kind === 'bank');
    await page.getByRole('tab', { name: 'ثبت تراکنش', exact: true }).click();
    await page.locator('[data-billboard-layer="front"]').getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    const form = page.locator('.tx-simple');
    await form.locator('.tx-amount').fill('1200');
    await form.getByRole('combobox', { name: 'دسته‌بندی تراکنش', exact: true }).selectOption('food');
    await form.getByRole('combobox', { name: 'حساب تراکنش', exact: true }).selectOption(bank.id);
    await form.getByRole('button', { name: 'انتقال بانکی', exact: true }).click();
    await form.getByRole('combobox', { name: 'نوع انتقال بانکی', exact: true }).selectOption('paya');
    await form.locator('summary').click();
    await form.getByRole('textbox', { name: 'توضیح تراکنش', exact: true }).fill('Online payment lifecycle');
    const before = (await api(page, '/transactions')).body.length;
    await form.locator('.tx-simple-save').click(); await form.waitFor({ state: 'hidden' });
    const paid = (await api(page, '/transactions')).body.find(row => row.note === 'Online payment lifecycle');
    assert.equal(paid.payment_method, 'bank_transfer'); assert.equal(paid.transfer_fee_rial, 4000);
    assert.equal((await api(page, '/transactions')).body.length, before + 2);
    await navigate(page, 'transactions');
    const item = page.locator('.tx-item').filter({ hasText: 'Online payment lifecycle' });
    assert.equal(await item.count(), 1);
    await item.getByText('کارمزد انتقال:', { exact: false }).waitFor();
    await capture(page, 'nested-transfer-fee');
    await item.click();
    assert.equal(await form.getByRole('button', { name: 'انتقال بانکی', exact: true }).getAttribute('aria-pressed'), 'true');
    await form.getByRole('button', { name: 'پرداخت آنلاین', exact: true }).click();
    assert.equal(await form.getByRole('combobox', { name: 'نوع انتقال بانکی', exact: true }).count(), 0);
    const sent = page.waitForRequest(request => request.method() === 'PATCH' && request.url().endsWith('/transactions/' + paid.id));
    await form.locator('.tx-simple-save').click();
    const fields = (await sent).postDataJSON();
    assert.equal(fields.payment_method, 'online'); assert.equal(fields.transfer_fee_method, null);
    await form.waitFor({ state: 'hidden' });
    const now = (await api(page, '/transactions')).body;
    assert.equal(now.length, before + 1);
    assert.equal(now.find(row => row.id === paid.id).payment_method, 'online');
    await item.click();
    assert.equal(await form.getByRole('button', { name: 'پرداخت آنلاین', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await form.getByRole('combobox', { name: 'نوع انتقال بانکی', exact: true }).count(), 0);
    await capture(page, 'online-payment'); await page.context().close();
  });
  await check('fee-only view collapses linked rows and totals respect date, category, search and charged account', async () => {
    const page = await session('transactions', 'full-owner');
    const bank = (await api(page, '/accounts')).body.find(row => row.kind === 'bank');
    const destination = (await api(page, '/accounts', 'POST', { member_id: bank.member_id, title: 'Fee destination', kind: 'bank', card_number: '6037990000000002', initial_balance: 0 })).body;
    const fields = { member_id: bank.member_id, account_id: bank.id, type: 'expense', amount: 1200,
      category: 'food', date: new Date().toISOString().slice(0, 10), repeat: 'none', time: '14:37:52',
      payment_method: 'bank_transfer', transfer_fee_method: 'paya', note: 'Nested purchase' };
    assert.equal((await api(page, '/transactions', 'POST', fields)).status, 201);
    assert.equal((await api(page, '/transactions', 'POST', { ...fields, note: 'Old fee', date: '2020-01-01' })).status, 201);
    assert.equal((await api(page, '/transactions', 'POST', { ...fields, type: 'transfer', category: 'transfer', payment_method: null,
      to_account_id: destination.id, transfer_fee_method: 'card_to_card', note: 'Nested account transfer' })).status, 201);
    await page.reload(); await page.locator('.floating-navigation').waitFor();
    await page.locator('.tx-item').filter({ hasText: 'Nested purchase' }).waitFor();
    const raw = (await api(page, '/transactions')).body;
    const linked = raw.filter(row => row.source_kind === 'transfer_fee').length;
    assert.equal(await page.locator('.tx-item').count(), raw.length - linked);
    assert.equal(await page.locator('.tx-item').filter({ hasText: 'Nested purchase' }).count(), 1);
    await page.getByRole('button', { name: 'فیلتر', exact: true }).click();
    const modal = page.locator('.modal-sheet').filter({ has: page.getByRole('heading', { name: 'فیلتر تراکنش‌ها', exact: true }) });
    await modal.getByRole('checkbox', { name: 'فقط تراکنش‌های دارای کارمزد انتقال', exact: true }).check();
    await modal.getByRole('button', { name: 'این ماه', exact: true }).click();
    await modal.getByRole('button', { name: 'اعمال', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'مجموع کارمزد انتقال: ۱,۵۰۰' }).waitFor();
    assert.equal(await page.locator('.tx-item').count(), 2);
    await page.getByRole('searchbox', { name: 'جست‌وجو در تراکنش‌ها', exact: true }).fill('Nested purchase');
    await page.getByRole('status').filter({ hasText: 'مجموع کارمزد انتقال: ۴۰۰' }).waitFor();
    assert.equal(await page.locator('.tx-item').count(), 1);
    await page.getByRole('searchbox', { name: 'جست‌وجو در تراکنش‌ها', exact: true }).fill('');
    await page.getByRole('button', { name: 'فیلتر', exact: true }).click();
    await modal.getByRole('combobox', { name: 'دسته‌بندی', exact: true }).selectOption('food');
    await modal.getByRole('button', { name: 'اعمال', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'مجموع کارمزد انتقال: ۴۰۰' }).waitFor();
    assert.equal(await page.locator('.tx-item').count(), 1);
    await page.getByRole('button', { name: 'فیلتر', exact: true }).click();
    await modal.getByRole('combobox', { name: 'دسته‌بندی', exact: true }).selectOption('');
    await modal.getByRole('combobox', { name: 'حساب', exact: true }).selectOption(destination.id);
    await modal.getByRole('button', { name: 'اعمال', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'مجموع کارمزد انتقال: ۰' }).waitFor();
    assert.equal(await page.locator('.tx-item').count(), 0);
    await page.getByRole('button', { name: 'فیلتر', exact: true }).click();
    await modal.getByRole('combobox', { name: 'حساب', exact: true }).selectOption(bank.id);
    await modal.getByRole('button', { name: 'اعمال', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'مجموع کارمزد انتقال: ۱,۵۰۰' }).waitFor();
    assert.equal(await page.locator('.tx-item').count(), 2);
    await capture(page, 'transfer-fee-filter');
    await navigate(page, 'dashboard');
    const dashboard = page.locator('.page-visit:not([hidden])');
    await dashboard.locator('.tx-item').filter({ hasText: 'Nested purchase' }).waitFor();
    assert.equal(await dashboard.locator('.tx-item').filter({ hasText: 'کارمزد انتقال' }).count(), 2);
    // These are the parents' nested details, not three independent generated expenses.
    assert.equal(await dashboard.locator('.tx-item h4').filter({ hasText: 'کارمزد انتقال' }).count(), 0);
    await page.context().close();
  });
  await check('SMS online choice survives reopening its draft and atomic recording without a fee', async () => {
    const page = await session(); const sms = (await api(page, '/sms?status=pending')).body[0];
    let sheet = await review(page, sms.id);
    const bank = (await api(page, '/accounts')).body.find(row => row.kind === 'bank');
    await sheet.getByRole('combobox', { name: 'حساب پیامک', exact: true }).selectOption(bank.id);
    await sheet.getByRole('button', { name: 'پرداخت آنلاین', exact: true }).click();
    await sheet.getByRole('button', { name: 'بعداً', exact: true }).click();
    await sheet.waitFor({ state: 'hidden' });
    sheet = await review(page, sms.id);
    assert.equal(await sheet.getByRole('button', { name: 'پرداخت آنلاین', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await sheet.getByRole('combobox', { name: 'نوع انتقال بانکی', exact: true }).count(), 0);
    const before = (await api(page, '/transactions')).body.length;
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click();
    await sheet.waitFor({ state: 'hidden' });
    const recorded = (await api(page, '/sms')).body.find(row => row.id === sms.id);
    const tx = (await api(page, '/transactions')).body.find(row => row.id === recorded.transaction_id);
    assert.equal(tx.payment_method, 'online'); assert.equal(tx.transfer_fee_rial, null);
    assert.equal((await api(page, '/transactions')).body.length, before + 1);
    await page.context().close();
  });
  await check('online option copy supports English and empty wording without changing payment identity', async () => {
    const page = await session(); const sms = (await api(page, '/sms?status=pending')).body[0], sheet = await review(page, sms.id);
    const bank = (await api(page, '/accounts')).body.find(row => row.kind === 'bank');
    await sheet.getByRole('combobox', { name: 'حساب پیامک', exact: true }).selectOption(bank.id);
    const entry = catalog.entries.find(row => row.file.endsWith('/BankPaymentFields.tsx') && row.text === 'پرداخت آنلاین'); assert.ok(entry);
    const option = sheet.getByRole('group', { name: 'روش پرداخت هزینه', exact: true }).getByRole('button').nth(1);
    for (const text of ['Online payment', '', 'Online payment']) {
      await page.evaluate(draft => window.postMessage({ type: 'copy-drafts', drafts: [draft] }, location.origin),
        { id: entry.id, original: entry.text, text, matchingIds: [entry.id], tokens: [] });
      await page.waitForFunction(text => document.querySelector('.bank-payment-method .quick-chips button:nth-child(2)')?.textContent === text, text);
      await option.click(); assert.equal(await option.getAttribute('aria-pressed'), 'true');
      assert.equal(await sheet.getByRole('combobox', { name: 'نوع انتقال بانکی', exact: true }).count(), 0);
    }
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    const recorded = (await api(page, '/sms')).body.find(row => row.id === sms.id);
    assert.equal((await api(page, '/transactions')).body.find(row => row.id === recorded.transaction_id).payment_method, 'online');
    await page.context().close();
  });
  await check('all offered income and expense categories reach the transaction repository', async () => {
    const page = await session('hub', 'full-owner');
    await page.getByRole('tab', { name: 'ثبت تراکنش', exact: true }).click();
    await page.locator('[data-billboard-layer="front"]').getByRole('button', { name: 'ثبت درآمد', exact: true }).click();
    const form = page.locator('.tx-simple'), select = form.getByRole('combobox', { name: 'دسته‌بندی تراکنش', exact: true });
    const originalCount = (await api(page, '/transactions')).body.length;
    let count = 0;
    for (const [kind, label] of [['income', 'درآمد'], ['expense', 'هزینه']]) {
      if (!await form.isVisible()) await page.locator('[data-billboard-layer="front"]').getByRole('button', { name: 'ثبت درآمد', exact: true }).click();
      await form.getByRole('tab', { name: label, exact: true }).click();
      const categories = await select.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
      if (kind === 'income') assert.ok(categories.includes('ride') && categories.includes('rent-home') && categories.includes('rent-shop'));
      for (const category of categories) {
        if (!await form.isVisible()) await page.locator('[data-billboard-layer="front"]').getByRole('button', { name: 'ثبت درآمد', exact: true }).click();
        await form.getByRole('tab', { name: label, exact: true }).click();
        await form.locator('.tx-amount').fill('1200'); await select.selectOption(category);
        const wallet = (await api(page, '/accounts')).body.find(row => row.kind === 'wallet');
        await form.getByRole('combobox', { name: 'حساب تراکنش', exact: true }).selectOption(wallet.id);
        await form.locator('summary').click();
        await form.getByRole('textbox', { name: 'توضیح تراکنش', exact: true }).fill('Category ' + category);
        await form.locator('.tx-simple-save').click(); await form.waitFor({ state: 'hidden' });
        assert.ok((await api(page, '/transactions')).body.some(row => row.type === kind && row.category === category && row.note === 'Category ' + category));
        count++;
      }
    }
    assert.ok(count >= 25); results.categoryRegistrations = count;
    assert.equal((await api(page, '/transactions')).body.length, originalCount + count);
    await page.context().close();
  });
  await check('editing a historical mismatched category preserves its displayed and submitted value', async () => {
    const page = await session('transactions', 'full-owner', true);
    await page.locator('.tx-item').filter({ hasText: 'Historical user note' }).click();
    const form = page.locator('.tx-simple');
    assert.equal(await form.getByRole('combobox', { name: 'دسته‌بندی تراکنش', exact: true }).inputValue(), 'food');
    assert.equal(await form.getByRole('combobox', { name: 'دسته‌بندی تراکنش', exact: true }).locator('option:checked').textContent(), 'خورد و خوراک');
    if (await form.locator('details').getAttribute('open') === null) await form.locator('summary').click();
    await form.getByRole('textbox', { name: 'توضیح تراکنش', exact: true }).fill('Edited historical note');
    const sent = page.waitForRequest(request => request.method() === 'PATCH' && /\/transactions\//.test(request.url()));
    await form.locator('.tx-simple-save').click();
    const fields = (await sent).postDataJSON(); assert.equal(fields.category, 'food'); assert.equal(fields.type, 'income');
    await form.waitFor({ state: 'hidden' }); await page.context().close();
  });
  await check('SMS actual time and user note survive a lost atomic response without duplicates', async () => {
    const page = await session(); const sms = (await api(page, '/sms?status=pending')).body[0];
    const sheet = await review(page, sms.id);
    assert.equal(await sheet.getByRole('textbox', { name: 'ساعت انجام تراکنش', exact: true }).inputValue(), '14:37:52');
    assert.equal(await sheet.getByRole('textbox', { name: 'شرح تراکنش پیامک', exact: true }).inputValue(), '');
    const select = sheet.getByRole('combobox', { name: 'حساب پیامک', exact: true });
    const existingWallet = (await api(page, '/accounts')).body.find(row => row.kind === 'wallet');
    await select.selectOption(existingWallet ? existingWallet.id : { index: 1 });
    if (await sheet.getByRole('button', { name: 'کارت کشیدم', exact: true }).isVisible()) await sheet.getByRole('button', { name: 'کارت کشیدم', exact: true }).click();
    await sheet.getByRole('textbox', { name: 'شرح تراکنش پیامک', exact: true }).fill('شرح خودم، بدون نام بانک');
    const before = (await api(page, '/transactions')).body.length;
    let failed = false;
    await page.route('**/api/v1/sms/*/record', async interception => {
      if (!failed) {
        failed = true; const committed = await interception.fetch(); assert.equal(committed.status(), 200);
        await interception.fulfill({ status: 503, json: { error: 'SERVER', message: 'Synthetic lost response' } });
      } else await interception.continue();
    });
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click();
    await sheet.getByRole('alert').waitFor();
    assert.equal((await api(page, '/transactions')).body.length, before + 1);
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).evaluate(button => { button.click(); button.click(); });
    await sheet.waitFor({ state: 'hidden' });
    const rows = (await api(page, '/transactions')).body;
    assert.equal(rows.length, before + 1);
    const transaction = rows.find(row => row.note === 'شرح خودم، بدون نام بانک');
    assert.equal(transaction.time, '14:37:52'); assert.equal(transaction.date, sms.date);
    assert.equal((await api(page, '/sms')).body.find(row => row.id === sms.id).transaction_id, transaction.id);
    assert.equal(page.calls.filter(path => path === '/api/v1/transactions').length, 0);
    await navigate(page, 'dashboard');
    await page.getByText('۱۴:۳۷:۵۲', { exact: false }).first().waitFor();
    await capture(page, 'recorded-time'); await page.context().close();
  });
  await check('unknown SMS date stays empty and requires explicit review before any write', async () => {
    const page = await session('sms', 'full-owner');
    await api(page, '/sms', 'POST', { items: [{ raw_text: 'برداشت مبلغ 250000 ریال؛ موجودی 1000000', received_at: '2026-11-25T20:00:00Z' }] });
    await page.getByRole('button', { name: 'دریافت دوباره پیامک‌ها', exact: true }).click();
    const sms = (await api(page, '/sms?status=pending')).body[0], sheet = await review(page, sms.id);
    assert.equal(sms.date, null); assert.equal(sms.time, null); assert.equal(sms.bank, null);
    await sheet.getByText('تاریخ معتبر در پیامک پیدا نشد؛ تاریخ انجام تراکنش را انتخاب کنید.', { exact: true }).waitFor();
    assert.equal(await sheet.getByRole('textbox', { name: 'ساعت انجام تراکنش', exact: true }).inputValue(), '');
    await sheet.getByRole('combobox', { name: 'حساب پیامک', exact: true }).selectOption({ index: 1 });
    const before = (await api(page, '/transactions')).body.length;
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click();
    await sheet.getByRole('alert').filter({ hasText: 'تاریخ معتبر انتخاب کنید' }).waitFor();
    assert.equal((await api(page, '/transactions')).body.length, before);
    await capture(page, 'unknown-date'); await page.context().close();
  });
  await check('SMS copy remains editable in English and empty without touching user text', async () => {
    const page = await session(); const sms = (await api(page, '/sms?status=pending')).body[0], sheet = await review(page, sms.id);
    const entry = catalog.entries.find(row => row.file.endsWith('/PendingSmsFeature.tsx') && row.text === 'شرح تراکنش (اختیاری)'); assert.ok(entry);
    await sheet.getByRole('textbox', { name: 'شرح تراکنش پیامک', exact: true }).fill('My note');
    for (const text of ['Transaction note', '', 'Transaction note']) {
      await page.evaluate(draft => window.postMessage({ type: 'copy-drafts', drafts: [draft] }, location.origin),
        { id: entry.id, original: entry.text, text, matchingIds: [entry.id], tokens: [] });
      await page.waitForFunction(text => document.querySelector('[aria-label="شرح تراکنش پیامک"]')?.closest('.form-row')?.querySelector('label')?.textContent.trim() === text, text);
      assert.equal(await sheet.getByRole('textbox', { name: 'شرح تراکنش پیامک', exact: true }).inputValue(), 'My note');
      assert.equal(await sheet.getByRole('textbox', { name: 'ساعت انجام تراکنش', exact: true }).inputValue(), '14:37:52');
    }
    await page.context().close();
  });
  await check('invalid and ambiguous SMS timestamps are blank and cannot silently become today', async () => {
    const page = await session('sms', 'full-owner');
    for (const evidence of ['1405/07/31 24:00', '03/09/2026 12:00 و 13:00']) {
      await api(page, '/sms', 'POST', { items: [{ raw_text: 'برداشت مبلغ 250000 ریال؛ ' + evidence }] });
      await page.getByRole('button', { name: 'دریافت دوباره پیامک‌ها', exact: true }).click();
      const sms = (await api(page, '/sms?status=pending')).body.find(row => row.raw_text.includes(evidence)), sheet = await review(page, sms.id);
      assert.equal(sms.date, null); assert.equal(sms.time, null);
      assert.equal(await sheet.getByRole('textbox', { name: 'ساعت انجام تراکنش', exact: true }).inputValue(), '');
      await sheet.getByText('تاریخ معتبر در پیامک پیدا نشد؛ تاریخ انجام تراکنش را انتخاب کنید.', { exact: true }).waitFor();
      await sheet.getByRole('button', { name: 'بعداً', exact: true }).click();
    }
    assert.equal(page.calls.some(path => /\/sms\/[^/]+\/record$/.test(path)), false);
    await page.context().close();
  });
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser.close(); await workbench.close();
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
}
if (results.errors.length || results.externalRequests.length) process.exitCode = 1;
else console.log('Financial integrity: ' + results.checks.length + ' browser checks passed.');
