import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { createWorkbench } from './copy-workbench/server.mjs';

const output = resolve('.local-test/wallet-access-browser');
await mkdir(output, { recursive: true });
const workbench = await createWorkbench({ port: 0 });
await workbench.initialized;
assert.equal(workbench.status().ready, true, workbench.status().message);
const base = workbench.origin;
const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--explicitly-allowed-ports=' + new URL(base).port] });
const results = { checks: [], screenshots: [], errors: [], externalRequests: [], productionWrites: 0, manualWrites: 0 };
const editor = await browser.newPage();
await editor.goto(base);
const token = await editor.evaluate(() => window.__COPY_WORKBENCH__.csrfToken);
await editor.close();
const catalog = await (await fetch(base + '/__copy/catalog')).json();
let lastPage;

async function api(page, path) {
  return page.evaluate(async path => { const response = await fetch('/api/v1' + path); return { status: response.status, body: await response.json() }; }, path);
}
async function session(scenario, route = 'accounts') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tehran' });
  await context.route('**/*', async interception => {
    const url = new URL(interception.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
      results.externalRequests.push(url.origin + url.pathname); await interception.abort();
    } else await interception.continue();
  });
  await context.route('**/__copy/ui/preview-bridge.js', async interception => {
    const response = await interception.fetch(), source = await response.text();
    assert.ok(source.includes("location.port !== '5701'"));
    await interception.fulfill({ response, body: source.replace("location.port !== '5701'", `location.port !== '${new URL(base).port}'`)
      .replaceAll("document.querySelector('.hub-page')", "document.querySelector('.page-visit:not([hidden])')") });
  });
  const response = await context.request.post(base + '/__copy/preview', {
    headers: { Origin: base, 'X-Copy-Workbench-Token': token }, data: { scenarioId: scenario, route },
  });
  assert.equal(response.status(), 200);
  const page = await context.newPage(); lastPage = page; page.setDefaultTimeout(20000);
  page.on('pageerror', error => results.errors.push(error.message));
  await page.goto(base + (await response.json()).url);
  await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
  if (route === 'accounts') await page.locator('.wealth-total bdi').waitFor();
  return page;
}
async function reload(page) {
  await page.reload(); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
  await page.locator('.wealth-total bdi').waitFor();
}
async function capture(page, name) {
  const path = resolve(output, name + '.png'); await page.screenshot({ path, fullPage: true, animations: 'disabled' }); results.screenshots.push(path);
}
async function check(name, run) {
  if (process.env.WALLET_ACCESS_CHECK && !name.includes(process.env.WALLET_ACCESS_CHECK)) return;
  await run(); results.checks.push(name); console.log('PASS ' + name);
}
async function layout(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll('.wallet-amount')].every(element =>
    !element.querySelector('.fit-text-inner') || element.querySelector('.fit-text-inner').getBoundingClientRect().width <= element.querySelector('.fit-text').getBoundingClientRect().width + 1));
  const geometry = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    cards: [...document.querySelectorAll('.wallet-card')].filter(card => !card.querySelector('.account-negative-notice')).map(card => card.getBoundingClientRect().height),
    amounts: [...document.querySelectorAll('.wallet-amount')].map(element => {
      const number = element.querySelector('bdi').getBoundingClientRect(), unit = element.querySelector('.wallet-amount-unit').getBoundingClientRect();
      return { left: unit.right <= number.left + 1, sameLine: number.bottom > unit.top && number.top < unit.bottom, width: number.width };
    }),
  }));
  assert.equal(geometry.overflow, false, 'Page overflow');
  assert.ok(geometry.cards.every(height => height <= 64), 'Cash cards stay compact');
  assert.ok(geometry.amounts.length && geometry.amounts.every(row => row.left && row.sameLine && row.width > 0), 'Unit stays left of its amount');
  return geometry;
}
async function enrich(page) {
  const original = (await api(page, '/auth/members')).body, template = (await api(page, '/accounts')).body[0];
  const members = [...original, ...Array.from({ length: 9 }, (_, index) => ({ ...original[1], id: randomUUID(), name: 'عضو آزمایشی با نام بلند ' + (index + 1), role: 'member' }))];
  const accounts = members.flatMap((person, index) => [
    { ...template, id: randomUUID(), member_id: person.id, kind: 'wallet', title: 'کیف پول با عنوان بلند ' + person.name, initial_balance: String((index + 1) * 1000), card_number: null },
    { ...template, id: randomUUID(), member_id: person.id, kind: 'bank', title: 'حساب بانکی ' + person.name, initial_balance: String((index + 1) * 2000) },
  ]);
  const holdings = members.map((person, index) => ({ id: randomUUID(), family_id: person.family_id, member_id: person.id, kind: 'gold', name: 'طلای آزمایشی', symbol: 'IR_GOLD_18K', quantity: 1, price: (index + 1) * 5000, value: (index + 1) * 5000, priced: true, unit: 'gram', created_at: template.created_at }));
  await page.route('**/api/v1/auth/members', route => route.fulfill({ json: members }));
  await page.route(/\/api\/v1\/accounts(?:\?.*)?$/, route => route.fulfill({ json: new URL(route.request().url()).searchParams.get('view') === 'transfer-targets'
    ? accounts.map(({ id, family_id, member_id, kind }) => ({ id, family_id, member_id, kind })) : accounts }));
  await page.route('**/api/v1/accounts/*/balance', route => {
    const account = accounts.find(account => route.request().url().includes('/' + account.id + '/'));
    if (!account) return route.continue();
    return route.fulfill({ json: { account_id: account.id, revision: 0, ledger_balance: account.initial_balance, current_balance: account.initial_balance, discrepancy: '0', active_reconciliation_id: null } });
  });
  await page.route('**/api/v1/holdings', route => route.fulfill({ json: { items: holdings, total: holdings.reduce((sum, row) => sum + row.value, 0), unpriced: 0, stale: false } }));
  await reload(page);
  const manager = await page.locator('.wallet-owner-filter').count() > 0;
  await expect(page.locator('.wallet-card')).toHaveCount(manager ? members.length : 1);
  if (manager) await expect(page.locator('.wallet-owner-option')).toHaveCount(members.length + 1);
  await page.waitForFunction(() => document.querySelector('.wealth-total bdi'));
  return { members, accounts, holdings };
}

try {
  await check('filters and transfer loading/error labels are editable', async () => {
    for (const text of ['همه', 'خودم', 'نمایش کیف پول بر اساس عضو', 'کیف‌پول‌های', 'نمایش شماره کارت', 'پنهان کردن شماره کارت', 'دارایی عضو انتخاب‌شده', 'در حال دریافت مقصدهای انتقال…', 'دریافت مقصدهای انتقال انجام نشد.'])
      assert.ok(catalog.entries.some(entry => entry.text === text), text);
  });
  for (const scenario of ['full-owner', 'full-admin']) await check(scenario + ' filters accounts, holdings and authoritative totals together', async () => {
    const page = await session(scenario), data = await enrich(page);
    const filters = page.getByRole('group', { name: 'نمایش کیف پول بر اساس عضو' }), buttons = filters.getByRole('button');
    assert.equal(await buttons.count(), data.members.length + 1);
    assert.equal(await page.locator('.wallet-card').count(), data.members.length);
    const total = await page.locator('.wealth-total bdi').innerText();
    for (let index = 1; index < await buttons.count(); index++) {
      await buttons.nth(index).click();
      await expect(page.locator('.wallet-card')).toHaveCount(1); await expect(page.locator('.account-card.flat')).toHaveCount(1);
      await page.waitForFunction(() => document.querySelector('.wealth-total bdi'));
      assert.notEqual(await page.locator('.wealth-total bdi').innerText(), total);
      assert.equal(await filters.locator('[aria-pressed=true]').count(), 1);
      await expect(page.locator('.balance-label')).toHaveText(index === 1 ? 'دارایی کل من' : 'دارایی عضو انتخاب‌شده');
    }
    await buttons.first().click(); await page.waitForFunction(total => document.querySelector('.wealth-total bdi')?.textContent === total, total);
    for (const width of [320, 360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 }); const geometry = await layout(page);
      results.checks.push(scenario + ' ' + width + 'px cash height ' + Math.round(geometry.cards[0]));
      if ([360, 1440].includes(width)) await capture(page, scenario + '-' + width);
    }
    await page.setViewportSize({ width: 360, height: 844 });
    assert.ok(await filters.evaluate(element => element.scrollWidth > element.clientWidth));
    await buttons.last().click();
    const last = await buttons.last().boundingBox(), bar = await filters.boundingBox();
    assert.ok(last.x >= bar.x - 1 && last.x + last.width <= bar.x + bar.width + 1);
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await capture(page, scenario + '-dark');
    await page.context().close();
  });
  await check('member rejects leaked rows and preserves exact large negative rial/toman display', async () => {
    const page = await session('full-member'), personal = (await api(page, '/accounts')).body;
    assert.ok(personal.length && personal.every(row => row.member_id === personal[0].member_id));
    const targets = (await api(page, '/accounts?view=transfer-targets')).body;
    assert.ok(targets.some(row => row.member_id !== personal[0].member_id));
    assert.ok(targets.every(row => !('initial_balance' in row) && !('title' in row)));
    const data = await enrich(page);
    assert.equal(await page.locator('.wallet-owner-filter').count(), 0);
    assert.equal(await page.locator('.wallet-card').count(), 1);
    data.accounts.find(row => row.member_id === personal[0].member_id && row.kind === 'wallet').initial_balance = '-999999999999999';
    await reload(page); await page.locator('.wallet-balance.is-negative').waitFor();
    for (const width of [320, 390, 1440]) { await page.setViewportSize({ width, height: 844 }); await layout(page); }
    await page.setViewportSize({ width: 320, height: 844 }); await capture(page, 'negative-toman-320');
    await page.locator('.wallet-balance .wallet-amount-unit').click();
    await page.waitForFunction(() => document.querySelector('.wallet-balance .wallet-amount-unit')?.textContent === 'ریال');
    assert.ok((await page.locator('.wallet-balance bdi').innerText()).includes('۹,۹۹۹,۹۹۹,۹۹۹,۹۹۹,۹۹۰'));
    await layout(page); await capture(page, 'negative-rial-320'); await page.context().close();
  });
  await check('English and empty filter copy retains selection identities', async () => {
    const page = await session('full-owner'), entry = catalog.entries.find(entry => entry.file.endsWith('/WalletOwnerFilter.tsx') && entry.text === 'همه');
    assert.ok(entry);
    for (const text of ['All wallets', '', 'All wallets']) {
      await page.evaluate(draft => window.postMessage({ type: 'copy-drafts', drafts: [draft] }, location.origin), { id: entry.id, original: entry.text, text, matchingIds: [entry.id], tokens: [] });
      await page.waitForFunction(text => document.querySelector('.wallet-owner-option').textContent === text, text);
      await page.locator('.wallet-owner-option').nth(1).click(); await page.locator('.wallet-owner-option').first().click();
      assert.equal(await page.locator('.wallet-owner-option').first().getAttribute('aria-pressed'), 'true');
    }
    await page.context().close();
  });
  await check('selected member empty wallets keep the owner filter usable', async () => {
    const page = await session('full-owner');
    await page.locator('.wallet-owner-option').nth(2).click();
    await page.getByText('برای عضو انتخاب‌شده حساب بانکی ثبت نشده', { exact: true }).waitFor();
    await page.getByText('برای عضو انتخاب‌شده کیف‌پولی ثبت نشده', { exact: true }).waitFor();
    await capture(page, 'selected-member-empty-390');
    await page.locator('.wallet-owner-option').first().click();
    await expect(page.locator('.wallet-card')).toHaveCount(1);
    await page.context().close();
  });
  await check('selected owner stays visible while scrolling and moving the member strip', async () => {
    const page = await session('full-owner');
    await enrich(page);
    const scroll = page.locator('.accounts-page > .page-scroll');
    const context = page.locator('.wallet-owner-context');
    const filters = page.locator('.wallet-owner-filter');
    const buttons = filters.getByRole('button');
    for (const width of [320, 360, 390, 1440]) {
      await page.setViewportSize({ width, height: 700 });
      await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(context).toBeInViewport();
      await expect.poll(async () => Math.abs((await context.boundingBox()).y - (await scroll.boundingBox()).y)).toBeLessThan(2);
      assert.equal(await page.locator('.wallet-owner-current b').innerText(), await buttons.first().innerText());
      if ([360, 1440].includes(width)) await capture(page, 'sticky-owner-bottom-' + width);
    }
    await buttons.last().click();
    await expect(page.locator('.wallet-card')).toHaveCount(1);
    const selectedName = await buttons.last().innerText();
    await expect(page.locator('.wallet-owner-current b')).toHaveText(selectedName);
    await page.setViewportSize({ width: 360, height: 700 });
    await filters.evaluate(element => { element.scrollLeft = 0; });
    await expect(page.locator('.wallet-owner-current b')).toHaveText(selectedName);
    await capture(page, 'sticky-selected-owner-360');
    await page.context().close();
  });
  await check('bank numbers keep four ordered groups and reveal without opening the account', async () => {
    const page = await session('full-owner');
    const card = page.locator('.bank-wallet-card').first();
    const number = card.locator('.account-card-number');
    const groups = number.locator(':scope > span');
    await expect(groups).toHaveCount(4);
    assert.ok((await number.innerText()).includes('••••'));
    const toggle = card.getByRole('button', { name: 'نمایش شماره کارت', exact: true });
    const target = await toggle.boundingBox();
    assert.ok(target.width >= 44 && target.height >= 44);
    assert.equal(await number.evaluate(element => getComputedStyle(element).fontSize), '14px');
    await toggle.click();
    await expect(card.getByRole('button', { name: 'پنهان کردن شماره کارت', exact: true })).toHaveAttribute('aria-pressed', 'true');
    assert.ok(!(await number.innerText()).includes('•'));
    assert.equal((await groups.allInnerTexts()).join('').length, 16);
    await expect(page.locator('.wallet-account-sheet')).not.toBeVisible();
    await page.getByRole('heading', { name: 'کیف پول‌ها', exact: true }).click();
    for (const width of [320, 360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const height = await card.evaluate(element => element.getBoundingClientRect().height);
      assert.ok(height <= 128, 'Compact bank card: ' + height);
      await layout(page);
      if ([360, 1440].includes(width)) await capture(page, 'compact-bank-card-' + width);
    }
    await card.getByRole('button', { name: 'پنهان کردن شماره کارت', exact: true }).press('Enter');
    assert.ok((await number.innerText()).includes('••••'));
    await page.context().close();
  });
  await check('settings account view also identifies and filters the selected owner', async () => {
    const page = await session('full-owner', 'settings/accounts');
    const context = page.locator('.wallet-owner-context:visible');
    await expect(context).toHaveCount(1);
    await context.getByRole('button', { name: 'خودم', exact: true }).click();
    await expect(context.locator('.wallet-owner-current b')).toHaveText('خودم');
    await expect(page.locator('.bank-wallet-card:visible')).toHaveCount(1);
    await expect(page.locator('.wallet-card:visible')).toHaveCount(1);
    await page.setViewportSize({ width: 360, height: 844 });
    await capture(page, 'settings-owner-filter-360');
    await page.context().close();
  });
  await check('wallet balance failure and loading remain explicit and retryable', async () => {
    const page = await session('full-owner');
    let mode = 'error', release;
    const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/accounts/*/balance', async route => {
      if (mode === 'error') return route.fulfill({ status: 503, json: { message: 'Synthetic balance failure' } });
      if (mode === 'loading') await pending;
      return route.continue();
    });
    await page.reload(); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
    await page.getByText('موجودی دریافت نشد؛ دوباره دریافت کنید.', { exact: true }).first().waitFor();
    assert.equal(await page.locator('.wealth-total').innerText(), '—');
    await capture(page, 'balance-error-390');
    mode = 'loading';
    await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
    await page.getByText('در حال دریافت موجودی…', { exact: true }).first().waitFor();
    assert.equal(await page.locator('.wealth-total').innerText(), '—');
    await capture(page, 'balance-loading-390');
    mode = 'ready'; release(); await page.locator('.wealth-total bdi').waitFor();
    await page.context().close();
  });
  await check('member retries target failure and transfers without peer financial details', async () => {
    const page = await session('full-member', 'dashboard'), personal = (await api(page, '/accounts')).body;
    const destination = (await api(page, '/accounts?view=transfer-targets')).body.find(row => row.member_id !== personal[0].member_id);
    assert.ok(destination); let fail = true;
    await page.route(/\/api\/v1\/accounts\?view=transfer-targets$/, route => fail ? route.fulfill({ status: 503, json: { message: 'Synthetic destination error' } }) : route.continue());
    await page.getByRole('button', { name: 'افزودن تراکنش', exact: true }).click();
    const form = page.locator('.tx-simple'); await form.getByRole('tab', { name: 'انتقال', exact: true }).click();
    await form.getByText('دریافت مقصدهای انتقال انجام نشد.', { exact: true }).waitFor(); fail = false;
    await form.getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
    const target = form.getByRole('combobox', { name: 'حساب مقصد', exact: true });
    await target.locator('option[value="' + destination.id + '"]').waitFor({ state: 'attached' });
    assert.ok(!(await target.locator('option[value="' + destination.id + '"]').innerText()).includes('تومان'));
    await form.locator('.tx-amount').fill('100');
    await form.getByRole('combobox', { name: 'حساب مبدأ', exact: true }).selectOption(personal[0].id); await target.selectOption(destination.id);
    await form.locator('.tx-simple-details > summary').click();
    await form.getByRole('textbox', { name: 'توضیح تراکنش', exact: true }).fill('Wallet transfer acceptance');
    await form.getByRole('button', { name: 'ثبت انتقال', exact: true }).click(); await form.waitFor({ state: 'hidden' });
    const saved = (await api(page, '/transactions')).body.find(row => row.note === 'Wallet transfer acceptance');
    assert.equal(saved.account_id, personal[0].id); assert.equal(saved.to_account_id, destination.id); assert.equal(saved.amount, '100');
    await page.context().close();
  });
  assert.deepEqual(results.errors, []); assert.deepEqual(results.externalRequests, []);
} catch (error) {
  results.errors.push(error.stack); console.error(error);
  if (lastPage && !lastPage.isClosed()) {
    results.geometry = await lastPage.locator('.wallet-amount').evaluateAll(elements => elements.map(element => ({
      className: element.className, text: element.textContent, width: element.getBoundingClientRect().width,
      inner: element.querySelector('.fit-text-inner')?.getBoundingClientRect().width,
      outer: element.querySelector('.fit-text')?.getBoundingClientRect().width,
      fontSize: getComputedStyle(element.querySelector('.fit-text')).fontSize,
    })));
    console.error(JSON.stringify(results.geometry)); await capture(lastPage, 'failure').catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close(); await workbench.close();
}
