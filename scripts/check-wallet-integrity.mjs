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
const base = workbench.origin, browser = await chromium.launch({ channel: 'msedge', headless: true,
  // Windows can allocate an otherwise browser-blocked port to this isolated server.
  args: ['--explicitly-allowed-ports=' + new URL(base).port] });
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
async function openAction(page, name, account = card(page)) {
  await account.click();
  await sheet(page).getByRole('button', { name, exact: true }).click();
}
async function openCorrection(page, target = '۱۴۹۹.۹') {
  await openAction(page, 'اصلاح موجودی');
  await sheet(page).getByLabel('موجودی موردنظر', { exact: true }).waitFor();
  await sheet(page).getByLabel('موجودی موردنظر', { exact: true }).fill(target);
  await sheet(page).getByLabel('توضیحات اصلاح موجودی').fill('User-authored correction note');
}
async function chooseAndSubmit(page, mode) {
  await sheet(page).getByRole('radio', { name: mode, exact: true }).check();
  await sheet(page).getByRole('button', { name: 'بررسی و ادامه', exact: true }).click();
  await sheet(page).getByRole('heading', { name: 'بررسی اصلاح موجودی', exact: true }).waitFor();
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
  await check('global unit preference changes all retained financial views, not data or another member', async () => {
    const page = await session({ width: 360 });
    const initialWrites = page.writes.length;
    const before = { accounts: (await api(page, '/accounts')).body, transactions: (await api(page, '/transactions')).body,
      bills: (await api(page, '/bills')).body, members: (await api(page, '/auth/members')).body };
    assert.ok(Array.isArray(before.members));
    const refresh = visit(page).getByRole('button', { name: 'به‌روزرسانی', exact: true });
    assert.equal(await refresh.evaluate(button => button.closest('.card').querySelector('h3, h2, .card-title').textContent), 'حساب‌های بانکی');
    assert.equal(await visit(page).locator('.wealth-chart path').first().getAttribute('d').then(d => d.includes(' C')), true);
    await card(page).getByRole('button', { name: 'تغییر سراسری واحد نمایش مبالغ', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.page-visit:not([hidden]) .currency-unit')].filter(button => button.getAttribute('aria-label') === 'تغییر سراسری واحد نمایش مبالغ').every(button => button.textContent === 'ریال' && !button.disabled));
    assert.equal(await sheet(page).count(), 0, 'Changing a unit must not open account actions');
    for (const route of ['hub', 'dashboard', 'transactions', 'reports', 'budgets', 'bills', 'shopping', 'market', 'accounts']) {
      await navigate(page, route);
      const units = page.locator('.page-visit:not([hidden]) button[aria-label="تغییر سراسری واحد نمایش مبالغ"]');
      await units.first().waitFor();
      assert.ok((await units.allTextContents()).every(text => text === 'ریال'), route);
    }
    assert.deepEqual((await api(page, '/accounts')).body, before.accounts);
    assert.deepEqual((await api(page, '/transactions')).body, before.transactions);
    assert.deepEqual((await api(page, '/bills')).body, before.bills);
    const afterMembers = (await api(page, '/auth/members')).body;
    assert.equal(afterMembers.filter((member, i) => member.currency !== before.members[i].currency).length, 1);
    assert.deepEqual(afterMembers.map(({ currency, ...member }) => member), before.members.map(({ currency, ...member }) => member));
    // Existing route-entry usage and birthday synchronization are not financial writes.
    assert.deepEqual(page.writes.slice(initialWrites).filter(write => !(write.method === 'POST' && ['/api/v1/usage/open', '/api/v1/events/sync-birthdays'].includes(write.path))).map(write => [write.method, write.path]), [['PATCH', '/api/v1/members/me/currency']]);
    await page.reload(); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
    await card(page).getByRole('button', { name: 'تغییر سراسری واحد نمایش مبالغ', exact: true }).getByText('ریال', { exact: true }).waitFor();
    await capture(page, 'global-rial-wallet-360');
    await page.context().close();
  });
  await check('retained bill draft ignores global switching and converts only its own input exactly', async () => {
    const page = await session({ route: 'bills' });
    const initialWrites = page.writes.length;
    await page.locator('.page-visit:not([hidden])').getByRole('button', { name: 'ثبت قبض جدید', exact: true }).click();
    await sheet(page).getByLabel('عنوان قبض', { exact: true }).fill('Draft untouched');
    await sheet(page).getByLabel('مبلغ قبض', { exact: true }).fill('۱۴۹۹.۹');
    const originalDraft = await sheet(page).getByLabel('مبلغ قبض', { exact: true }).inputValue();
    await navigate(page, 'accounts');
    await card(page).getByRole('button', { name: 'تغییر سراسری واحد نمایش مبالغ', exact: true }).click();
    await card(page).getByRole('button', { name: 'تغییر سراسری واحد نمایش مبالغ', exact: true }).getByText('ریال', { exact: true }).waitFor();
    await navigate(page, 'bills');
    assert.equal(await sheet(page).getByLabel('مبلغ قبض', { exact: true }).inputValue(), originalDraft);
    assert.equal(await sheet(page).getByLabel('عنوان قبض', { exact: true }).inputValue(), 'Draft untouched');
    const unit = sheet(page).getByRole('button', { name: 'تغییر واحد ورودی مبلغ', exact: true });
    assert.equal(await unit.textContent(), 'تومان');
    await unit.click();
    assert.equal(await sheet(page).getByLabel('مبلغ قبض', { exact: true }).inputValue(), '۱۴,۹۹۹');
    await unit.click();
    assert.equal(await sheet(page).getByLabel('مبلغ قبض', { exact: true }).inputValue(), '۱,۴۹۹.۹');
    await sheet(page).getByLabel('مبلغ قبض', { exact: true }).fill('۱ +');
    await unit.click();
    assert.equal(await unit.textContent(), 'تومان');
    assert.equal(await sheet(page).getByLabel('مبلغ قبض', { exact: true }).inputValue(), '۱ +');
    assert.deepEqual(page.writes.slice(initialWrites).filter(write => !(write.method === 'POST' && ['/api/v1/usage/open', '/api/v1/events/sync-birthdays'].includes(write.path))).map(write => [write.method, write.path]), [['PATCH', '/api/v1/members/me/currency']]);
    await capture(page, 'bill-independent-input');
    await page.context().close();
  });
  await check('global preference failure rolls back display, preserves financial data, and remains retryable', async () => {
    let fail = true;
    const page = await session({ setup: async context => context.route('**/api/v1/members/me/currency', async route => {
      if (fail) await route.fulfill({ status: 503, json: { error: 'SERVER', message: 'Fixture currency unavailable' } });
      else await route.continue();
    }) });
    const initialWrites = page.writes.length;
    const before = (await api(page, '/transactions')).body;
    const unit = card(page).getByRole('button', { name: 'تغییر سراسری واحد نمایش مبالغ', exact: true });
    await unit.click();
    await page.getByText('Fixture currency unavailable', { exact: true }).waitFor();
    assert.equal(await unit.textContent(), 'تومان');
    assert.equal(await unit.isDisabled(), false);
    fail = false; await unit.click();
    await unit.getByText('ریال', { exact: true }).waitFor();
    assert.deepEqual((await api(page, '/transactions')).body, before);
    assert.deepEqual(page.writes.slice(initialWrites).filter(write => !(write.method === 'POST' && ['/api/v1/usage/open', '/api/v1/events/sync-birthdays'].includes(write.path))).map(write => [write.method, write.path]), Array(2).fill(['PATCH', '/api/v1/members/me/currency']));
    await page.context().close();
  });
  await check('compact wallet overview and correction form; masked card opens its actions', async () => {
    const page = await session({ width: 320 });
    const initialWrites = structuredClone(page.writes);
    assert.equal(await visit(page).locator('.wealth-card .section-hint').count(), 0);
    assert.equal(await visit(page).getByRole('button', { name: 'تراکنش‌ها', exact: true }).count(), 0);
    assert.equal(await visit(page).getByRole('button', { name: 'اصلاح موجودی', exact: true }).count(), 0);
    const logo = card(page).locator('img');
    await logo.waitFor();
    assert.ok((await logo.getAttribute('src')).startsWith('/bank-logos/'));
    await logo.evaluate(image => image.decode());
    assert.ok(await logo.evaluate(image => image.naturalWidth > 0));
    const themedBackground = await card(page).evaluate(element => getComputedStyle(element).backgroundColor);
    const neutralBackground = await card(page).evaluate(element => {
      element.classList.remove('is-branded');
      const color = getComputedStyle(element).backgroundColor;
      element.classList.add('is-branded');
      return color;
    });
    assert.notEqual(themedBackground, neutralBackground, 'The bank tint must survive card CSS specificity');
    assert.equal(await card(page).locator('.account-card-number').innerText(), '•••• •••• •••• ۰۰۰۱');
    await card(page).locator('.account-card-number').click();
    await sheet(page).getByRole('button', { name: 'اصلاح موجودی', exact: true }).click();
    await sheet(page).getByLabel('موجودی موردنظر', { exact: true }).waitFor();
    assert.equal(await sheet(page).getByRole('textbox').count(), 2);
    assert.equal(await sheet(page).getByRole('radio').count(), 2);
    assert.equal(await sheet(page).locator('input[type=radio]:checked').count(), 0);
    assert.equal(await sheet(page).locator('textarea').count(), 1);
    assert.deepEqual(await sheet(page).getByRole('button').allTextContents(), ['تومان', 'انصراف', 'بررسی و ادامه']);
    assert.equal(await sheet(page).getByRole('button', { name: 'بررسی و ادامه', exact: true }).isDisabled(), true);
    assert.equal(await sheet(page).locator('.wallet-mode-options').evaluate(element => element.getBoundingClientRect().bottom <= element.parentElement.querySelector('.wallet-target-field').getBoundingClientRect().top), true);
    assert.equal(await sheet(page).getByText(/موجودی فعلی:|موجودی حاصل از تراکنش‌ها:|واحد این فرم ثابت|مبلغ تغییر:|موجودی پس از اصلاح:/).count(), 0);
    await capture(page, 'compact-correction-target');
    await sheet(page).getByRole('button', { name: 'انصراف', exact: true }).click();
    await sheet(page).waitFor({ state: 'hidden' });
    assert.deepEqual(page.writes, initialWrites);
    await card(page).focus(); await card(page).press('Space');
    await sheet(page).getByRole('button', { name: 'بستن', exact: true }).click();
    await sheet(page).waitFor({ state: 'hidden' });
    await capture(page, 'compact-wallet-overview');
    await openAction(page, 'سابقهٔ اصلاح موجودی');
    await sheet(page).getByText('هنوز اصلاح موجودی ثبت نشده است.', { exact: true }).waitFor();
    assert.equal(await sheet(page).getByLabel('موجودی موردنظر', { exact: true }).count(), 0);
    assert.deepEqual(page.writes, initialWrites);
    await page.context().close();
  });
  await check('rapid global unit clicks issue one private preference request while all views stay consistent', async () => {
    let release, requests = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const page = await session({ setup: async context => context.route('**/api/v1/members/me/currency', async route => {
      requests += 1; await pending; await route.continue();
    }) });
    const before = (await api(page, '/transactions')).body;
    const unit = card(page).getByRole('button', { name: 'تغییر سراسری واحد نمایش مبالغ', exact: true });
    await unit.evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => document.querySelector('.account-card .currency-unit')?.disabled === true);
    assert.equal(await unit.textContent(), 'ریال');
    await navigate(page, 'transactions');
    const units = page.locator('.page-visit:not([hidden]) button[aria-label="تغییر سراسری واحد نمایش مبالغ"]');
    assert.ok((await units.allTextContents()).every(text => text === 'ریال'));
    release();
    await page.waitForFunction(() => [...document.querySelectorAll('.page-visit:not([hidden]) .currency-unit')].every(button => !button.disabled));
    assert.equal(requests, 1);
    assert.deepEqual((await api(page, '/transactions')).body, before);
    await page.context().close();
  });
  await check('a mismatched currency response cannot overwrite the current member or financial display', async () => {
    const page = await session({ setup: async context => context.route('**/api/v1/members/me/currency', async route => {
      const response = await route.fetch(), body = await response.json();
      await route.fulfill({ response, json: { ...body, id: 'another-fixture-member' } });
    }) });
    const before = (await api(page, '/transactions')).body;
    const unit = card(page).getByRole('button', { name: 'تغییر سراسری واحد نمایش مبالغ', exact: true });
    await unit.click();
    await page.getByText('پاسخ تغییر واحد نمایش با حساب شما سازگار نیست.', { exact: true }).waitFor();
    assert.equal(await unit.textContent(), 'تومان');
    assert.equal(await unit.isDisabled(), false);
    assert.deepEqual((await api(page, '/transactions')).body, before);
    await page.context().close();
  });
  await check('long transaction values and descriptions remain inside rows at all viewport sizes', async () => {
    const page = await session(), account = (await api(page, '/accounts')).body[0];
    const note = 'شرح طولانی تراکنش برای بررسی چیدمان '.repeat(5) + 'unbroken-description-'.repeat(3);
    const created = await api(page, '/transactions', 'POST', { member_id: account.member_id, type: 'income', amount: '999999999998.99', category: 'salary', date: '2026-11-24', account_id: account.id, note });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await page.reload(); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
    await openAction(page, 'تراکنش‌ها');
    const row = visit(page).locator('.tx-item').filter({ hasText: note });
    await row.waitFor();
    assert.equal((await row.locator('.tx-amount b').innerText()).replaceAll(',', ''), '۹۹۹۹۹۹۹۹۹۹۹۸.۹۹');
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await row.scrollIntoViewIfNeeded();
      const overflow = await row.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return [...element.querySelectorAll('.tx-info, .tx-info h4, .tx-info p, .tx-amount, .tx-amount b')].filter(child => {
          const box = child.getBoundingClientRect();
          return child.scrollWidth > child.clientWidth + 1 || box.left < bounds.left - 1 || box.right > bounds.right + 1;
        }).map(child => child.className || child.tagName);
      });
      assert.deepEqual(overflow, [], 'Transaction overflow at ' + width);
      assert.equal(await row.locator('.tx-description-preview').evaluate(element => getComputedStyle(element).textOverflow), 'ellipsis');
      assert.equal(await row.locator('.tx-description-preview').evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap');
      assert.equal(await row.locator('.tx-line-one').evaluate(element => element.querySelector('h4').getBoundingClientRect().left >= element.querySelector('.tx-member-label').getBoundingClientRect().right), true);
      assert.equal(await row.locator('.tx-info p').count(), 1);
      assert.equal(await row.locator('.tx-amount').evaluate(element => {
        const amount = element.getBoundingClientRect(), unit = element.querySelector('.currency-unit').getBoundingClientRect();
        return Math.abs(amount.left - unit.left) < 2;
      }), true, 'Amount and currency must occupy the left side of line three');
      assert.ok(!await row.locator('.tx-date-time').innerText().then(text => text.includes('· مجتبی')));
      await row.locator('.tx-amount b').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await capture(page, 'transaction-overflow-' + width);
    }
    await row.click();
    assert.equal(await sheet(page).locator('.tx-description-full').textContent(), note);
    await capture(page, 'transaction-complete-description');
    await page.context().close();
  });
  await check('bank styles are local and distinct; unknown card uses the neutral fallback', async () => {
    const page = await session({ width: 1280 }), account = (await api(page, '/accounts')).body[0];
    for (const [title, bank, card_number] of [
      ['Local Mellat card', 'mellat', '6104330000000001'],
      ['Neutral unknown card', null, '0000000000000001'],
    ]) {
      const created = await api(page, '/accounts', 'POST', { member_id: account.member_id, title, kind: 'bank', bank, card_number, initial_balance: '0' });
      assert.equal(created.status, 201, JSON.stringify(created.body));
    }
    await page.reload(); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
    const cards = visit(page).locator('.bank-wallet-card');
    await cards.nth(2).waitFor();
    const mellat = cards.filter({ hasText: 'Local Mellat card' }), neutral = cards.filter({ hasText: 'Neutral unknown card' });
    assert.equal(await mellat.locator('img').getAttribute('src'), '/bank-logos/mellat.png');
    await mellat.locator('img').evaluate(image => image.decode());
    assert.equal(await neutral.locator('img').count(), 0);
    assert.equal(await neutral.evaluate(element => element.classList.contains('is-branded')), false);
    assert.notEqual(await card(page).evaluate(element => getComputedStyle(element).backgroundColor), await mellat.evaluate(element => getComputedStyle(element).backgroundColor));
    await capture(page, 'desktop-local-bank-cards');
    assert.equal(results.externalRequests.length, 0);
    await page.context().close();
  });
  await check('read-only family wallet still opens transactions without mutation actions', async () => {
    const page = await session({ scenario: 'full-admin' });
    const wallet = visit(page).locator('.wallet-card').first();
    await wallet.waitFor();
    const initialWrites = structuredClone(page.writes);
    await wallet.focus(); await wallet.press('Enter');
    assert.deepEqual(await sheet(page).getByRole('button').allTextContents(), ['تراکنش‌ها', 'بستن']);
    await page.evaluate(() => history.back());
    await sheet(page).waitFor({ state: 'hidden' });
    assert.equal(await wallet.isVisible(), true);
    await openAction(page, 'تراکنش‌ها', wallet);
    await visit(page).getByRole('heading', { name: 'تراکنش‌های کیف پول', exact: true }).waitFor();
    await page.evaluate(() => history.back());
    await wallet.waitFor();
    assert.deepEqual(page.writes, initialWrites);
    await page.context().close();
    const memberPage = await session({ scenario: 'full-member' });
    await card(memberPage).waitFor();
    assert.equal(await visit(memberPage).locator('.wallet-card').count(), 0);
    await memberPage.context().close();
  });
  await check('card detail actions; metadata save does not change any financial row', async () => {
    const page = await session(), accounts = (await api(page, '/accounts')).body, before = (await api(page, '/transactions')).body;
    assert.equal(await card(page).getByRole('button').count(), 1);
    assert.equal(await card(page).getByRole('button', { name: 'تغییر سراسری واحد نمایش مبالغ', exact: true }).count(), 1);
    await openAction(page, 'تراکنش‌ها');
    await visit(page).getByRole('heading', { name: 'تراکنش‌های کیف پول' }).waitFor();
    assert.equal(await sheet(page).count(), 0);
    await visit(page).locator('.shared-page-back:visible').click();
    // Activating the card itself (keyboard) must not activate its child buttons.
    await card(page).focus(); await card(page).press('Enter');
    await sheet(page).getByRole('button', { name: 'ویرایش حساب', exact: true }).click();
    await sheet(page).getByLabel('عنوان کارت/حساب').fill('Renamed fixture bank');
    assert.equal(await sheet(page).getByLabel('موجودی موردنظر').count(), 0);
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
    assert.equal(await sheet(page).getByRole('button', { name: 'بررسی و ادامه' }).isDisabled(), true);
    await sheet(page).getByRole('radio', { name: 'مغایرت‌گیری', exact: true }).check();
    assert.equal(await sheet(page).getByRole('button', { name: 'بررسی و ادامه' }).isDisabled(), false);
    assert.equal(page.writes.filter(row => row.path.endsWith('/corrections')).length, 0);
    assert.equal(await sheet(page).locator('.wallet-mode-option').evaluateAll(labels => labels.every(label => {
      const bounds = label.getBoundingClientRect(), hint = label.nextElementSibling.getBoundingClientRect();
      return bounds.height >= 44 && hint.top >= bounds.bottom;
    })), true, 'Correction mode labels need separate readable hints and full touch targets');
    await capture(page, 'mobile-correction-options');
    await sheet(page).getByLabel('موجودی موردنظر', { exact: true }).fill('۱۴۹۹.۹');
    await sheet(page).getByRole('button', { name: 'بررسی و ادامه' }).click();
    await sheet(page).getByRole('heading', { name: 'بررسی اصلاح موجودی', exact: true }).waitFor();
    assert.equal(page.writes.filter(row => row.path.endsWith('/corrections')).length, 0);
    assert.equal(await sheet(page).getByText('مغایرت‌گیری', { exact: true }).count(), 1);
    await capture(page, 'mobile-correction-review');
    await sheet(page).getByRole('button', { name: 'تأیید و ثبت اصلاح' }).click();
    await sheet(page).getByRole('heading', { name: 'اصلاح موجودی ثبت شد' }).waitFor();
    assert.equal(await sheet(page).getByText(/موجودی قبل:|موجودی پس از اصلاح:|مبلغ تغییر:/).count(), 0);
    assert.deepEqual((await api(page, '/transactions')).body, before);
    const submitted = page.writes.filter(row => row.path.endsWith('/corrections'));
    assert.equal(submitted.length, 1); assert.equal(submitted[0].body.target_balance, '1499.9');
    assert.equal(submitted[0].body.mode, 'reconciliation');
    await sheet(page).getByRole('button', { name: 'بستن', exact: true }).click();
    await card(page).getByText('۱,۴۹۹.۹', { exact: true }).waitFor();
    assert.equal(await card(page).getByText(/اختلاف مغایرت‌گیری|موجودی حاصل از تراکنش‌ها/).count(), 0);
    assert.equal(await sheet(page).count(), 0);
    await capture(page, 'mobile-reconciled-wallet');
    const accounts = (await api(page, '/accounts')).body, retained = (await api(page, `/accounts/${accounts[0].id}/corrections`)).body;
    await openAction(page, 'سابقهٔ اصلاح موجودی');
    await sheet(page).locator('article').waitFor();
    assert.equal(await sheet(page).locator('article').count(), 1);
    await sheet(page).getByText('User-authored correction note', { exact: true }).waitFor();
    assert.deepEqual((await api(page, `/accounts/${accounts[0].id}/corrections`)).body, retained);
    assert.equal(page.writes.filter(row => row.path.endsWith('/corrections')).length, 1);
    await page.context().close();
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
    await openAction(page, 'اصلاح موجودی');
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
    await openAction(page, 'تراکنش‌ها');
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
    await openAction(page, 'تراکنش‌ها');
    assert.equal(await visit(page).getByLabel('جست‌وجو در تراکنش‌ها').inputValue(), 'Wallet scoped row');
    await capture(page, 'mobile-scoped-transactions'); await page.context().close();
  });
  await check('failed balance is explicit and never displayed as zero', async () => {
    const page = await session({ setup: async context => context.route('**/api/v1/accounts/*/balance', async interception => interception.fulfill({ status: 503, json: { error: 'SERVER', message: 'Fixture balance unavailable' } })) });
    await card(page).getByText('موجودی دریافت نشد؛ دوباره دریافت کنید.', { exact: true }).waitFor();
    assert.equal(await card(page).locator('.account-balance b').count(), 0);
    await openAction(page, 'تراکنش‌ها');
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
    await page.getByText('سابقه دریافت نشد؛ اطلاعات را دوباره دریافت کنید.', { exact: true }).waitFor({ state: 'hidden' });
    await sheet(page).getByRole('radio').first().waitFor();
    assert.equal(await sheet(page).getByText('سابقه دریافت نشد؛ اطلاعات را دوباره دریافت کنید.', { exact: true }).count(), 0);
    assert.equal(await sheet(page).getByRole('radio').count(), 2);
    historyFails = true; balanceFails = true;
    await chooseAndSubmit(page, 'مغایرت‌گیری');
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
    assert.equal(await sheet(page).getByRole('button', { name: 'بررسی و ادامه', exact: true }).count(), 0);
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
    await openAction(page, 'تراکنش‌ها');
    await visit(page).locator('.tx-item').filter({ hasText: 'Exact legacy income' }).click();
    await sheet(page).getByRole('button', { name: 'بازکردن تراکنش', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 844 });
    assert.ok(await sheet(page).getByLabel('مبلغ درآمد', { exact: true }).evaluate(input => input.getBoundingClientRect().width / input.parentElement.getBoundingClientRect().width > 0.6), 'List amount sizing must not shrink the form input');
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
    await openAction(page, 'تراکنش‌ها');
    await visit(page).locator('.tx-item').filter({ hasText: 'Scoped exact transfer' }).click();
    await sheet(page).getByText('کارمزد انتقال:', { exact: false }).waitFor();
    await sheet(page).getByRole('button', { name: 'بستن', exact: true }).click();
    await visit(page).locator('.shared-page-back:visible').click();
    await openAction(page, 'تراکنش‌ها', visit(page).locator('.account-card.flat:visible').filter({ hasText: 'Fee destination bank' }));
    const transfer = visit(page).locator('.tx-item').filter({ hasText: 'Scoped exact transfer' });
    await transfer.waitFor(); assert.equal(await transfer.count(), 1);
    assert.equal(await transfer.getByText('کارمزد انتقال:', { exact: false }).count(), 0);
    await transfer.click();
    assert.equal(await sheet(page).getByText('کارمزد انتقال:', { exact: false }).count(), 0);
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
    // Center the tappable card above the fixed tab bar before measuring. The
    // former inline action had a different hit target; automatic click scrolling
    // must not be mistaken for a failure to restore the user's list position.
    await cards().nth(5).evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const listPosition = await scroll.evaluate(element => element.scrollTop); assert.ok(listPosition > 0);
    await openAction(page, 'تراکنش‌ها', cards().nth(5));
    const txView = settings(page).locator('.wallet-transactions:visible');
    await txView.getByRole('heading', { name: 'تراکنش‌های کیف پول', exact: true }).waitFor();
    assert.equal(await scroll.evaluate(element => element.scrollTop), 0);
    await txView.getByLabel('جست‌وجو در تراکنش‌ها', { exact: true }).fill('Settings preserved search');
    await txView.getByLabel('بازگشت به کیف پول‌ها', { exact: true }).click();
    assert.equal(await scroll.evaluate(element => element.scrollTop), listPosition);
    await openAction(page, 'تراکنش‌ها', cards().nth(5));
    assert.equal(await txView.getByLabel('جست‌وجو در تراکنش‌ها', { exact: true }).inputValue(), 'Settings preserved search');
    await page.evaluate(() => history.back()); await txView.waitFor({ state: 'hidden' });
    await openAction(page, 'تراکنش‌ها', settings(page).locator('.account-card.flat:visible').first());
    const bankView = settings(page).locator('.wallet-transactions:visible');
    assert.equal(await bankView.getByLabel('جست‌وجو در تراکنش‌ها', { exact: true }).inputValue(), '');
    await bankView.locator('.tx-item').first().click();
    await sheet(page).getByRole('button', { name: 'بازکردن تراکنش', exact: true }).click();
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
