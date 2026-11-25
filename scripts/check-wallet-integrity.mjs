import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createWorkbench } from './copy-workbench/server.mjs';

// Uses only the isolated fixture launcher. External requests are blocked.
const output = resolve('.local-test/wallet-integrity');
await mkdir(output, { recursive: true });
const workbench = await createWorkbench({ port: 0 }); await workbench.initialized;
assert.equal(workbench.status().ready, true, workbench.status().message);
const base = workbench.origin, browser = await chromium.launch({ channel: 'msedge', headless: true });
const contexts = [], results = { checks: [], errors: [], externalRequests: [], screenshots: [], manualWrites: 0, productionWrites: 0 };
const editor = await browser.newPage(); await editor.goto(base);
const token = await editor.evaluate(() => window.__COPY_WORKBENCH__.csrfToken); await editor.close();
let lastPage;
async function session({ route = 'accounts', scenario = 'full-owner', width = 390, setup } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: 'Asia/Tehran' }); contexts.push(context);
  await context.route('**/*', async interception => {
    const url = new URL(interception.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) { results.externalRequests.push(url.origin + url.pathname); await interception.abort(); }
    else await interception.continue();
  });
  await context.route('**/__copy/ui/preview-bridge.js', async interception => {
    const response = await interception.fetch(), source = await response.text();
    assert.ok(source.includes("location.port !== '5701'"));
    // This acceptance context intentionally reloads the SAME fixture identity.
    // Keep encrypted recovery storage on reload; ordinary Copy Studio still
    // resets it for every new sample. Accept the router's restored destination.
    assert.ok(source.includes('await resetFakeStorage();'));
    const body = source.replace("location.port !== '5701'", `location.port !== '${new URL(base).port}'`)
      .replace('await resetFakeStorage();', "if (!sessionStorage.getItem('wallet-acceptance-initialized')) { await resetFakeStorage(); sessionStorage.setItem('wallet-acceptance-initialized', '1'); }")
      .replaceAll("document.querySelector('.hub-page')", "document.querySelector('.page-visit:not([hidden])')");
    await interception.fulfill({ response, body });
  });
  if (setup) await setup(context);
  const preview = await context.request.post(base + '/__copy/preview', {
    headers: { Origin: base, 'X-Copy-Workbench-Token': token }, data: { route, scenarioId: scenario },
  }); assert.equal(preview.status(), 200);
  const page = await context.newPage(); lastPage = page; page.setDefaultTimeout(15000); page.writes = [];
  page.on('pageerror', error => results.errors.push(error.message));
  page.on('request', request => { if (['POST', 'PATCH', 'DELETE'].includes(request.method()) && request.url().includes('/api/v1/')) page.writes.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postDataJSON() }); });
  await page.goto(base + (await preview.json()).url);
  await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
  await page.locator(`.page-visit[data-route="${route}"]:not([hidden])`).waitFor();
  return page;
}
function visit(page) { return page.locator('.page-visit:not([hidden]) .wallet-visit:not([hidden])'); }
function card(page) { return visit(page).locator('.account-card.flat:visible').first(); }
function sheet(page) { return page.locator('.modal-sheet:visible'); }
function settings(page) { return page.locator('.page-visit:not([hidden]) .settings-visit:not([hidden])'); }
async function navigate(page, route) {
  await page.evaluate(route => window.dispatchEvent(new CustomEvent('copy-workbench:navigate', { detail: { route } })), route);
  await page.locator(`.page-visit[data-route="${route}"]:not([hidden])`).waitFor();
}
async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch('/api/v1' + path, { method, headers: { 'Content-Type': 'application/json' }, body: ['POST', 'PATCH', 'DELETE'].includes(method) ? JSON.stringify(body ?? {}) : undefined });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }, { path, method, body });
}
async function openCorrection(page, target = '۱۴۹۹.۹') {
  await card(page).getByRole('button', { name: 'اصلاح موجودی', exact: true }).click();
  await sheet(page).getByLabel('موجودی هدف', { exact: true }).waitFor();
  await sheet(page).getByLabel('موجودی هدف', { exact: true }).fill(target);
  await sheet(page).getByLabel('توضیح اصلاح موجودی').fill('User-authored correction note');
  await sheet(page).getByRole('button', { name: 'بررسی روش ثبت' }).click();
  await sheet(page).getByText('نحوه ثبت اصلاح موجودی را انتخاب کنید.', { exact: true }).waitFor();
}
async function chooseAndSubmit(page, mode) {
  await sheet(page).getByRole('radio', { name: mode, exact: true }).check();
  await sheet(page).getByRole('button', { name: 'تأیید و ثبت اصلاح' }).click();
}
async function capture(page, name) {
  const path = resolve(output, name + '.png'); await page.screenshot({ path, animations: 'disabled' }); results.screenshots.push(path);
}
async function check(name, run) {
  if (process.env.WALLET_CHECK && !name.includes(process.env.WALLET_CHECK)) return;
  try { await run(); results.checks.push(name); console.log('PASS ' + name); }
  catch (error) { results.errors.push(name + ': ' + error.stack); console.error('FAIL ' + name + ': ' + error.message); if (lastPage && !lastPage.isClosed()) await capture(lastPage, 'failure-' + results.errors.length); }
}
try {
  await check('separate card buttons; metadata save does not change any financial row', async () => {
    const page = await session(), accounts = (await api(page, '/accounts')).body, before = (await api(page, '/transactions')).body;
    await card(page).getByRole('button', { name: 'تراکنش‌ها', exact: true }).click();
    await visit(page).getByRole('heading', { name: 'تراکنش‌های کیف پول' }).waitFor();
    assert.equal(await sheet(page).count(), 0);
    await visit(page).locator('.shared-page-back:visible').click();
    // Activating the card itself (keyboard) must not activate its child buttons.
    await card(page).focus(); await card(page).press('Enter');
    await sheet(page).getByLabel('عنوان کارت/حساب').fill('Renamed fixture bank');
    assert.equal(await sheet(page).getByLabel('موجودی هدف').count(), 0);
    assert.equal(await sheet(page).locator('.num-input').count(), 0);
    await sheet(page).getByRole('button', { name: 'ذخیره', exact: true }).click();
    await sheet(page).waitFor({ state: 'hidden' });
    assert.deepEqual((await api(page, '/transactions')).body, before);
    assert.equal((await api(page, '/accounts')).body[0].initial_balance, accounts[0].initial_balance);
    assert.equal(page.writes.filter(row => row.path.endsWith('/corrections') || row.path === '/api/v1/transactions').length, 0);
    await page.context().close();
  });
  await check('exact correction review has no default mode; reconciliation preserves financial history', async () => {
    const page = await session(), before = (await api(page, '/transactions')).body;
    // The correction transaction shares the ordinary transaction ceiling, not
    // the wider database column. Reconciliation does not create a transaction.
    await openCorrection(page, '-۱۰۰۰۰۰۰۰۰۰۰۰۰');
    await sheet(page).getByRole('radio', { name: 'ثبت در تراکنش‌ها', exact: true }).check();
    await sheet(page).getByText('مبلغ اصلاح از سقف تراکنش بیشتر است؛ این روش قابل ثبت نیست.', { exact: true }).waitFor();
    assert.equal(await sheet(page).getByRole('button', { name: 'تأیید و ثبت اصلاح' }).isDisabled(), true);
    await sheet(page).getByRole('radio', { name: 'صرفاً اصلاح جهت مغایرت‌گیری', exact: true }).check();
    assert.equal(await sheet(page).getByRole('button', { name: 'تأیید و ثبت اصلاح' }).isDisabled(), false);
    assert.equal(page.writes.filter(row => row.path.endsWith('/corrections')).length, 0);
    await sheet(page).getByRole('button', { name: 'بازگشت به مبلغ', exact: true }).click();
    await sheet(page).getByLabel('موجودی هدف', { exact: true }).fill('۱۴۹۹.۹');
    await sheet(page).getByRole('button', { name: 'بررسی روش ثبت' }).click();
    assert.equal(await sheet(page).locator('input[type=radio]:checked').count(), 0);
    assert.equal(await sheet(page).getByRole('button', { name: 'تأیید و ثبت اصلاح' }).isDisabled(), true);
    assert.equal(page.writes.filter(row => row.path.endsWith('/corrections')).length, 0);
    await capture(page, 'mobile-correction-review');
    await chooseAndSubmit(page, 'صرفاً اصلاح جهت مغایرت‌گیری');
    await sheet(page).getByRole('heading', { name: 'اصلاح موجودی ثبت شد' }).waitFor();
    assert.deepEqual((await api(page, '/transactions')).body, before);
    const submitted = page.writes.filter(row => row.path.endsWith('/corrections'));
    assert.equal(submitted.length, 1); assert.equal(submitted[0].body.target_balance, '1499.9');
    assert.equal(submitted[0].body.mode, 'reconciliation');
    await sheet(page).getByRole('button', { name: 'بستن', exact: true }).click();
    await card(page).getByText('۱,۴۹۹.۹', { exact: true }).waitFor();
    await card(page).getByText(/اختلاف مغایرت‌گیری/).waitFor();
    await capture(page, 'mobile-reconciled-wallet'); await page.context().close();
  });
  await check('ledger correction adds exactly one immutable linked adjustment', async () => {
    const page = await session({ width: 1280 }), before = (await api(page, '/transactions')).body;
    await openCorrection(page, '-۱.۰۱'); await chooseAndSubmit(page, 'ثبت در تراکنش‌ها');
    await sheet(page).getByRole('heading', { name: 'اصلاح موجودی ثبت شد' }).waitFor();
    const after = (await api(page, '/transactions')).body, created = after.filter(row => !before.some(old => old.id === row.id));
    assert.equal(created.length, 1); assert.equal(created[0].source_kind, 'wallet_correction');
    assert.equal((await api(page, '/transactions/' + created[0].id, 'DELETE')).body.error, 'SOURCE_IMMUTABLE');
    await capture(page, 'desktop-correction-history'); await page.context().close();
  });
  await check('lost success response recovers the same operation after reload without another write', async () => {
    let dropped = false;
    const page = await session({ setup: async context => {
      await context.route('**/api/v1/accounts/*/corrections', async interception => {
        if (interception.request().method() === 'POST' && !dropped) { dropped = true; await interception.fetch(); await interception.fulfill({ status: 503, json: { error: 'SERVER', message: 'Fixture lost response' } }); }
        else await interception.continue();
      });
    } });
    await openCorrection(page); await chooseAndSubmit(page, 'ثبت در تراکنش‌ها');
    await sheet(page).getByRole('heading', { name: 'بررسی نتیجهٔ درخواست قبلی' }).waitFor();
    assert.equal(page.writes.filter(row => row.method === 'POST' && row.path.endsWith('/corrections')).length, 1);
    await page.reload(); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
    await card(page).getByRole('button', { name: 'اصلاح موجودی', exact: true }).click();
    await sheet(page).getByRole('heading', { name: 'بررسی نتیجهٔ درخواست قبلی' }).waitFor();
    assert.equal(page.writes.filter(row => row.method === 'POST' && row.path.endsWith('/corrections')).length, 1);
    await sheet(page).getByRole('button', { name: 'بررسی نتیجه', exact: true }).click();
    await sheet(page).getByRole('heading', { name: 'نتیجهٔ ثبت قبلی بازیابی شد' }).waitFor();
    assert.equal(page.writes.filter(row => row.method === 'POST' && row.path.endsWith('/corrections')).length, 1);
    const accounts = (await api(page, '/accounts')).body;
    assert.equal((await api(page, `/accounts/${accounts[0].id}/corrections`)).body.length, 1);
    await page.context().close();
  });
  await check('fixed account survives filter reset; inclusive dates and browser Back retain state', async () => {
    const page = await session(), accounts = (await api(page, '/accounts')).body;
    // Two visible accounts, each with a distinct row. Only the selected account may appear.
    await api(page, '/transactions', 'POST', { member_id: accounts[0].member_id, type: 'income', amount: 1, category: 'salary', date: '2026-11-24', account_id: accounts[0].id, note: 'Wallet scoped row' });
    await api(page, '/transactions', 'POST', { member_id: accounts[1].member_id, type: 'income', amount: 1, category: 'salary', date: '2026-11-24', account_id: accounts[1].id, note: 'Other wallet row' });
    await page.reload(); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
    await card(page).getByRole('button', { name: 'تراکنش‌ها', exact: true }).click();
    await visit(page).getByRole('heading', { name: 'تراکنش‌های کیف پول' }).waitFor();
    await visit(page).getByText('Wallet scoped row', { exact: true }).waitFor();
    assert.equal(await visit(page).getByText('Other wallet row', { exact: true }).count(), 0);
    const balance = await visit(page).locator('.balance-card').innerText();
    // The full fixture also contains an expense on this exact date. Test the
    // requested income filter, rather than assuming the fixture has no rows.
    await visit(page).getByRole('button', { name: 'درآمد', exact: true }).click();
    await visit(page).getByRole('button', { name: 'فیلتر', exact: true }).click();
    assert.equal(await sheet(page).getByLabel('حساب', { exact: true }).count(), 0);
    await sheet(page).getByLabel('تاریخ شروع تراکنش‌ها', { exact: true }).click();
    await page.locator('.dp-overlay:visible').getByRole('button', { name: '۳', exact: true }).click();
    await sheet(page).getByLabel('تاریخ پایان تراکنش‌ها', { exact: true }).click();
    await page.locator('.dp-overlay:visible').getByRole('button', { name: '۳', exact: true }).click();
    await sheet(page).getByRole('button', { name: 'اعمال', exact: true }).click();
    await sheet(page).waitFor({ state: 'hidden' });
    await visit(page).getByText('Wallet scoped row', { exact: true }).waitFor();
    assert.equal(await visit(page).locator('.tx-item:visible').count(), 1);
    assert.equal(await visit(page).locator('.balance-card').innerText(), balance);
    await visit(page).getByRole('button', { name: 'پاک‌کردن فیلترها', exact: true }).click();
    assert.equal(await visit(page).getByText('Other wallet row', { exact: true }).count(), 0);
    await visit(page).getByLabel('جست‌وجو در تراکنش‌ها').fill('Wallet scoped row');
    await page.evaluate(() => history.back());
    await visit(page).getByRole('heading', { name: 'کیف پول‌ها', exact: true }).waitFor();
    await card(page).getByRole('button', { name: 'تراکنش‌ها', exact: true }).click();
    assert.equal(await visit(page).getByLabel('جست‌وجو در تراکنش‌ها').inputValue(), 'Wallet scoped row');
    await capture(page, 'mobile-scoped-transactions'); await page.context().close();
  });
  await check('failed balance is explicit and never displayed as zero', async () => {
    const page = await session({ setup: async context => context.route('**/api/v1/accounts/*/balance', async interception => interception.fulfill({ status: 503, json: { error: 'SERVER', message: 'Fixture balance unavailable' } })) });
    await card(page).getByText('موجودی دریافت نشد؛ دوباره دریافت کنید.', { exact: true }).waitFor();
    assert.equal(await card(page).locator('.account-balance b').count(), 0);
    await card(page).getByRole('button', { name: 'تراکنش‌ها', exact: true }).click();
    await visit(page).getByText('موجودی دریافت نشد؛ دوباره دریافت کنید.', { exact: true }).waitFor();
    await page.context().close();
  });
  await check('history failure is retryable; committed correction remains success after refresh failure', async () => {
    let historyFails = true, balanceFails = false;
    const page = await session({ setup: async context => {
      await context.route('**/api/v1/accounts/*/corrections', async interception => {
        if (interception.request().method() === 'GET' && historyFails) return interception.fulfill({ status: 503, json: { error: 'SERVER', message: 'Fixture history unavailable' } });
        await interception.continue();
      });
      await context.route('**/api/v1/accounts/*/balance', async interception => {
        if (balanceFails) return interception.fulfill({ status: 503, json: { error: 'SERVER', message: 'Fixture refresh unavailable' } });
        await interception.continue();
      });
    } });
    await openCorrection(page);
    await sheet(page).getByText('سابقه دریافت نشد؛ اطلاعات را دوباره دریافت کنید.', { exact: true }).waitFor();
    historyFails = false;
    await sheet(page).getByRole('button', { name: 'دریافت دوبارهٔ سابقه', exact: true }).click();
    await sheet(page).getByText('هنوز اصلاح موجودی ثبت نشده است.', { exact: true }).waitFor();
    assert.equal(await sheet(page).getByRole('radio').count(), 2);
    historyFails = true; balanceFails = true;
    await chooseAndSubmit(page, 'صرفاً اصلاح جهت مغایرت‌گیری');
    await sheet(page).getByRole('heading', { name: 'اصلاح موجودی ثبت شد', exact: true }).waitFor();
    await sheet(page).getByText('سابقه دریافت نشد؛ اطلاعات را دوباره دریافت کنید.', { exact: true }).waitFor();
    assert.equal(page.writes.filter(row => row.path.endsWith('/corrections')).length, 1);
    assert.equal(await sheet(page).getByRole('button', { name: 'تأیید و ثبت اصلاح', exact: true }).count(), 0);
    await page.context().close();
  });
  await check('failed receipt lookup preserves operation and supports explicit same-id retry', async () => {
    let failLookup = true, dropped = false;
    const page = await session({ setup: async context => {
      await context.route('**/api/v1/accounts/*/corrections', async interception => {
        if (interception.request().method() === 'POST' && !dropped) { dropped = true; await interception.fetch(); return interception.fulfill({ status: 503, json: { error: 'SERVER', message: 'Fixture lost response' } }); }
        await interception.continue();
      });
      await context.route('**/api/v1/accounts/*/corrections/*', async interception => {
        if (failLookup) return interception.fulfill({ status: 503, json: { error: 'SERVER', message: 'Fixture receipt unavailable' } });
        await interception.continue();
      });
    } });
    await openCorrection(page); await chooseAndSubmit(page, 'ثبت در تراکنش‌ها');
    await sheet(page).getByRole('heading', { name: 'بررسی نتیجهٔ درخواست قبلی', exact: true }).waitFor();
    const operation = page.writes.find(row => row.path.endsWith('/corrections')).body;
    await sheet(page).getByRole('button', { name: 'بررسی نتیجه', exact: true }).click();
    await sheet(page).getByRole('alert').waitFor();
    assert.equal(await sheet(page).getByRole('button', { name: 'بررسی روش ثبت', exact: true }).count(), 0);
    assert.equal(page.writes.filter(row => row.path.endsWith('/corrections')).length, 1);
    failLookup = false;
    await sheet(page).getByRole('button', { name: 'ارسال دوبارهٔ همان درخواست', exact: true }).click();
    await sheet(page).getByRole('heading', { name: 'نتیجهٔ ثبت قبلی بازیابی شد', exact: true }).waitFor();
    const sent = page.writes.filter(row => row.path.endsWith('/corrections'));
    assert.equal(sent.length, 2); assert.deepEqual(sent[1].body, operation);
    const account = (await api(page, '/accounts')).body[0];
    assert.equal((await api(page, `/accounts/${account.id}/corrections`)).body.length, 1);
    await page.context().close();
  });
  await check('unchanged transaction edits and input-unit switches retain historical fractional amounts', async () => {
    const page = await session(), account = (await api(page, '/accounts')).body[0];
    const created = await api(page, '/transactions', 'POST', { member_id: account.member_id, type: 'income', amount: '1.01', category: 'salary', date: '2026-11-24', account_id: account.id, note: 'Exact legacy income' });
    assert.equal(created.status, 201);
    await page.reload(); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
    await card(page).getByRole('button', { name: 'تراکنش‌ها', exact: true }).click();
    await visit(page).locator('.tx-item').filter({ hasText: 'Exact legacy income' }).click();
    assert.equal(await sheet(page).getByLabel('مبلغ درآمد', { exact: true }).inputValue(), '۱.۰۱');
    await sheet(page).getByLabel('تغییر واحد ورودی مبلغ', { exact: true }).click();
    assert.equal(await sheet(page).getByLabel('مبلغ درآمد', { exact: true }).inputValue(), '۱۰.۱');
    await sheet(page).getByLabel('تغییر واحد ورودی مبلغ', { exact: true }).click();
    assert.equal(await sheet(page).getByLabel('مبلغ درآمد', { exact: true }).inputValue(), '۱.۰۱');
    await sheet(page).getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
    await sheet(page).waitFor({ state: 'hidden' });
    const sent = page.writes.find(row => row.method === 'PATCH' && row.path.endsWith(created.body.id));
    assert.equal(sent.body.amount, '1.01');
    assert.equal((await api(page, '/transactions')).body.find(row => row.id === created.body.id).amount, '1.01');
    await page.context().close();
  });
  await check('source-only transfer fee attribution; destination scope includes incoming transfer', async () => {
    const page = await session(), accounts = (await api(page, '/accounts')).body;
    const destination = await api(page, '/accounts', 'POST', { member_id: accounts[0].member_id, title: 'Fee destination bank', kind: 'bank', card_number: '6037990000000002', initial_balance: '0' });
    assert.equal(destination.status, 201);
    const created = await api(page, '/transactions', 'POST', { member_id: accounts[0].member_id, type: 'transfer', amount: '1.1', category: 'transfer', date: '2026-11-24', account_id: accounts[0].id, to_account_id: destination.body.id, transfer_fee_method: 'card_to_card', note: 'Scoped exact transfer' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await page.reload(); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
    await card(page).getByRole('button', { name: 'تراکنش‌ها', exact: true }).click();
    await visit(page).locator('.tx-item').filter({ hasText: 'Scoped exact transfer' }).getByText('کارمزد انتقال:', { exact: false }).waitFor();
    await visit(page).locator('.shared-page-back:visible').click();
    await visit(page).locator('.account-card.flat:visible').filter({ hasText: 'Fee destination bank' }).getByRole('button', { name: 'تراکنش‌ها', exact: true }).click();
    const transfer = visit(page).locator('.tx-item').filter({ hasText: 'Scoped exact transfer' });
    await transfer.waitFor(); assert.equal(await transfer.count(), 1);
    assert.equal(await transfer.getByText('کارمزد انتقال:', { exact: false }).count(), 0);
    assert.equal(await visit(page).getByText(/مجموع کارمزد انتقال/).count(), 0);
    await page.context().close();
  });
  await check('settings wallets retain per-view scroll, search and inactive form draft through Back', async () => {
    const page = await session({ route: 'settings' });
    const account = (await api(page, '/accounts')).body[0];
    for (let i = 0; i < 10; i++) assert.equal((await api(page, '/accounts', 'POST', { member_id: account.member_id, title: 'Scroll wallet ' + i, kind: 'wallet', initial_balance: '0' })).status, 201);
    await page.reload(); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
    await settings(page).getByRole('button', { name: 'کارت‌ها و حساب‌ها', exact: false }).click();
    const scroll = settings(page).locator('.page-scroll');
    const cards = () => settings(page).locator('.account-card.flat:visible, .wallet-card:visible');
    await cards().nth(5).getByRole('button', { name: 'تراکنش‌ها', exact: true }).scrollIntoViewIfNeeded();
    const listPosition = await scroll.evaluate(element => element.scrollTop); assert.ok(listPosition > 0);
    await cards().nth(5).getByRole('button', { name: 'تراکنش‌ها', exact: true }).click();
    const txView = settings(page).locator('.wallet-transactions:visible');
    await txView.getByRole('heading', { name: 'تراکنش‌های کیف پول', exact: true }).waitFor();
    assert.equal(await scroll.evaluate(element => element.scrollTop), 0);
    await txView.getByLabel('جست‌وجو در تراکنش‌ها', { exact: true }).fill('Settings preserved search');
    await txView.getByLabel('بازگشت به کیف پول‌ها', { exact: true }).click();
    assert.equal(await scroll.evaluate(element => element.scrollTop), listPosition);
    await cards().nth(5).getByRole('button', { name: 'تراکنش‌ها', exact: true }).click();
    assert.equal(await txView.getByLabel('جست‌وجو در تراکنش‌ها', { exact: true }).inputValue(), 'Settings preserved search');
    await page.evaluate(() => history.back()); await txView.waitFor({ state: 'hidden' });
    await settings(page).locator('.account-card.flat:visible').first().getByRole('button', { name: 'تراکنش‌ها', exact: true }).click();
    const bankView = settings(page).locator('.wallet-transactions:visible');
    assert.equal(await bankView.getByLabel('جست‌وجو در تراکنش‌ها', { exact: true }).inputValue(), '');
    await bankView.locator('.tx-item').first().click();
    await sheet(page).locator('summary').click();
    await sheet(page).getByLabel('توضیح تراکنش', { exact: true }).fill('Inactive settings draft');
    await navigate(page, 'calendar'); assert.equal(await sheet(page).count(), 0);
    await page.evaluate(() => history.back());
    await sheet(page).getByLabel('توضیح تراکنش', { exact: true }).waitFor();
    assert.equal(await sheet(page).getByLabel('توضیح تراکنش', { exact: true }).inputValue(), 'Inactive settings draft');
    await page.evaluate(() => history.back()); await sheet(page).waitFor({ state: 'hidden' });
    assert.equal(await bankView.isVisible(), true);
    await page.evaluate(() => history.back()); await bankView.waitFor({ state: 'hidden' });
    assert.equal(page.writes.filter(row => row.method === 'PATCH' && row.path.includes('/transactions/')).length, 0);
    await capture(page, 'settings-restored-wallets'); await page.context().close();
  });
  await check('SMS keeps exact typed digits and selected account across balance failure', async () => {
    let fails = false;
    const page = await session({ route: 'sms', scenario: 'sms-pending', setup: async context => context.route('**/api/v1/accounts/*/balance', async interception => {
      if (fails) return interception.fulfill({ status: 503, json: { error: 'SERVER', message: 'Fixture balance unavailable' } });
      await interception.continue();
    }) });
    await page.locator('.page-visit:not([hidden]) [data-sms-id]').first().click();
    await sheet(page).getByLabel('مبلغ پیامک', { exact: true }).waitFor();
    await sheet(page).getByLabel('مبلغ پیامک', { exact: true }).fill('9007199254740993');
    assert.equal(await sheet(page).getByLabel('مبلغ پیامک', { exact: true }).inputValue(), '۹,۰۰۷,۱۹۹,۲۵۴,۷۴۰,۹۹۳');
    await sheet(page).getByLabel('مبلغ پیامک', { exact: true }).fill('0.1');
    const own = (await api(page, '/accounts')).body[0];
    await sheet(page).getByLabel('حساب پیامک', { exact: true }).selectOption(own.id);
    fails = true;
    await sheet(page).getByRole('button', { name: 'بعداً', exact: true }).click();
    await sheet(page).waitFor({ state: 'hidden' });
    await page.locator('.page-visit:not([hidden]) [data-sms-id]').first().click();
    await sheet(page).getByText('موجودی بعضی حساب‌ها دریافت نشد؛ انتخاب قبلی حفظ شده است.', { exact: true }).waitFor();
    assert.equal(await sheet(page).getByLabel('حساب پیامک', { exact: true }).inputValue(), own.id);
    assert.equal(await sheet(page).getByLabel('حساب پیامک', { exact: true }).locator('option:checked').isDisabled(), true);
    assert.equal(await sheet(page).getByRole('button', { name: 'ثبت', exact: true }).isDisabled(), true);
    assert.equal(page.writes.filter(row => row.path.includes('/sms/') && row.path.endsWith('/record')).length, 0);
    await page.context().close();
  });
  await check('shopping unchanged edit and decimal typing preserve the exact row total', async () => {
    const page = await session({ route: 'shopping' });
    const lists = (await api(page, '/shopping/lists')).body;
    const created = await api(page, `/shopping/lists/${lists[0].id}/items`, 'POST', { title: 'Exact shopping row', qty: '3', price: '1.01' });
    assert.equal(created.status, 201);
    await page.reload(); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
    await page.locator('.page-visit:not([hidden]) .shop-item').filter({ hasText: 'Exact shopping row' }).click();
    const price = sheet(page).getByLabel('قیمت کل قلم خرید', { exact: true });
    assert.equal(await price.inputValue(), '۱.۰۱');
    assert.equal(await price.getAttribute('inputmode'), 'decimal');
    await price.fill('1.001');
    await sheet(page).getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
    await page.getByText('قیمت را درست وارد کنید؛ مبلغ بدون گرد کردن ثبت می‌شود', { exact: true }).waitFor();
    assert.equal(page.writes.filter(row => row.method === 'PATCH' && row.path.endsWith(created.body.id)).length, 0);
    await price.fill('0.01');
    assert.equal(await price.inputValue(), '۰.۰۱');
    await price.fill('1.01');
    await sheet(page).getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
    await sheet(page).waitFor({ state: 'hidden' });
    const sent = page.writes.find(row => row.method === 'PATCH' && row.path.endsWith(created.body.id));
    assert.equal(sent.body.price, '1.01');
    const fresh = (await api(page, '/shopping/lists')).body.find(row => row.id === lists[0].id);
    assert.equal(fresh.items.find(row => row.id === created.body.id).price, '1.01');
    await page.context().close();
  });
  assert.equal(results.externalRequests.length, 0);
} finally {
  if (lastPage && !lastPage.isClosed()) await capture(lastPage, 'last-state');
  await writeFile(resolve(output, 'result.json'), JSON.stringify(results, null, 2));
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close(); await workbench.close();
}
assert.equal(results.errors.length, 0, results.errors.join('\n'));
console.log(`PASS ${results.checks.length} wallet browser checks; no external or real-data writes`);
