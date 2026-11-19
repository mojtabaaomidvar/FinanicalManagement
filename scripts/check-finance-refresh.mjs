import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { ROUTES } from './copy-workbench/fixtures.mjs';

// Real React interactions, with isolated fictional data on the copy-preview server only.
const base = 'http://127.0.0.1:5701', output = resolve('.local-test/finance-refresh');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
await mkdir(output, { recursive: true });
const results = { checks: [], errors: [], externalRequests: [], screenshots: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const contexts = [];
const root = await browser.newPage(); await root.goto(base);
const token = await root.evaluate(() => window.__COPY_WORKBENCH__.csrfToken); await root.close();
const catalog = await (await fetch(base + '/__copy/catalog')).json();
async function session(route = 'dashboard', scenario = 'full-owner', width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: 'Asia/Tehran' });
  contexts.push(context);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
      results.externalRequests.push(url.origin + url.pathname); await route.abort();
    } else await route.continue();
  });
  const response = await context.request.post(base + '/__copy/preview', {
    headers: { Origin: base, 'X-Copy-Workbench-Token': token }, data: { scenarioId: scenario, route },
  });
  assert.equal(response.status(), 200);
  const page = await context.newPage(); page.setDefaultTimeout(9000);
  page.on('pageerror', error => results.errors.push(error.message));
  await page.goto(base + (await response.json()).url);
  await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true, null, { timeout: 25000 });
  await page.locator('section.page.active').waitFor();
  return page;
}
async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch('/api/v1' + path, { method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }, { path, method, body });
}
async function reload(page) {
  await page.reload(); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
  await page.locator('.floating-navigation').waitFor();
  if ((await page.evaluate(() => window.__COPY_PREVIEW__.route)) === 'dashboard') {
    await page.getByRole('button', { name: 'افزودن تراکنش', exact: true }).waitFor();
  }
}
async function showBillboard(page, key) {
  const deck = page.locator('.home-billboard-deck');
  await deck.focus(); await page.keyboard.press('Home');
  const keys = ['transaction', 'wallets', 'budget', 'dues'];
  for (let i = 0; i < keys.indexOf(key); i++) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(key => document.querySelector('.home-billboard-deck')?.dataset.billboardActive === key
      && document.querySelector('.home-billboard-deck')?.dataset.billboardPhase === 'idle', keys[i + 1]);
  }
  return page.locator('[data-billboard-layer="front"]');
}
async function openForm(page, type = 'expense') {
  const add = page.getByRole('button', { name: 'افزودن تراکنش', exact: true });
  if (await add.isVisible()) await add.click();
  else {
    if (!await page.locator('.home-billboard-deck').isVisible()) {
      await page.locator('.floating-navigation').getByRole('button', { name: 'داشبورد', exact: true }).click();
    }
    const poster = await showBillboard(page, 'transaction');
    await poster.getByRole('button', { name: type === 'expense' ? 'ثبت هزینه' : type === 'income' ? 'ثبت درآمد' : 'انتقال', exact: true }).click();
  }
  const form = page.locator('.tx-simple'); await form.waitFor();
  await form.locator('.tx-tab').filter({ hasText: type === 'expense' ? 'هزینه' : type === 'income' ? 'درآمد' : 'انتقال' }).click();
  return form;
}
async function chooseAccount(form, name = 'حساب تراکنش') {
  const select = form.getByRole('combobox', { name, exact: true });
  const id = await select.locator('option').nth(1).getAttribute('value');
  assert.ok(id); await select.selectOption(id); return id;
}
async function details(form) { if (await form.locator('details').getAttribute('open') === null) await form.locator('summary').click(); }
async function screenshot(page, name) {
  const path = resolve(output, name + '.png'); await page.screenshot({ path, animations: 'disabled' }); results.screenshots.push(path);
}
async function pageBack(page) {
  if (await page.locator('.hub-page:not(.home-sections-page)').isVisible()) {
    assert.equal(await page.locator('.mobile-page-back').count(), 0, 'Home must omit the back button');
    return null;
  }
  const back = page.getByRole('button', { name: 'بازگشت به صفحهٔ قبل', exact: true });
  await back.waitFor(); const box = await back.boundingBox(), width = page.viewportSize().width;
  const right = Math.max(16, (width - 552) / 2 + 16);
  assert.ok(box && Math.abs(width - box.x - box.width - right) < 2 && box.y < 60, 'Back must be at upper right');
  const title = page.locator('section.page.active > :is(.app-header, .hub-head) h1');
  if (await title.count()) {
    const titleBox = await title.boundingBox();
    assert.ok(titleBox && titleBox.x + titleBox.width <= box.x - 4, 'Back must not overlap the page title');
  }
  return back;
}
async function check(name, run) {
  if (only && !name.includes(only)) return;
  try { await run(); results.checks.push(name); console.log('PASS ' + name); }
  catch (error) { results.errors.push(name + ': ' + error.stack); console.log('FAIL ' + name + ': ' + error.message); }
}
try {
  await check('compact billboard bottom tabs and real touch swipe from action buttons preserve vertical scrolling', async () => {
    const page = await session('hub'), deck = page.locator('.home-billboard-deck');
    await showBillboard(page, 'transaction');
    const box = await deck.boundingBox(), tabs = await page.getByRole('tablist', { name: 'انتخاب کارت خانه' }).boundingBox();
    assert.ok(box.height < 285, 'Billboard should stay compact');
    assert.ok(tabs.y >= box.y + box.height - 8, 'Switch controls belong below the cards');
    const touch = await page.context().newCDPSession(page);
    const button = await page.locator('[data-billboard-layer="front"]').getByRole('button', { name: 'ثبت هزینه', exact: true }).boundingBox();
    const x = button.x + button.width / 2, y = button.y + button.height / 2;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const dx of [-12, -32, -65]) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + 3 }] });
      await page.waitForTimeout(30);
    }
    const under = await deck.evaluate(el => ({
      phase: el.dataset.billboardPhase,
      x: new DOMMatrix(getComputedStyle(el.querySelector('[data-billboard-layer="front"]')).transform).m41,
      blur: parseFloat(getComputedStyle(el.querySelector('[data-billboard-layer="underneath"]')).filter.slice(5)),
    }));
    assert.equal(under.phase, 'dragging'); assert.ok(Math.abs(under.x + 65) < 2);
    assert.ok(under.blur > 0 && under.blur < 7);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 125, y: y + 5 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('.home-billboard-deck').dataset.billboardActive === 'dues'
      && document.querySelector('.home-billboard-deck').dataset.billboardPhase === 'idle');
    assert.equal(await page.locator('.tx-simple').count(), 0, 'Swiping a button must not activate it');
    await page.getByRole('tab', { name: 'ثبت تراکنش', exact: true }).click();
    assert.equal(await deck.getAttribute('data-billboard-active'), 'transaction');
    await page.evaluate(() => document.activeElement?.blur());
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 80, y: box.y + 100 }] });
    for (const dy of [-20, -50, -100]) await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: box.x + 82, y: box.y + 100 + dy }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    assert.equal(await deck.getAttribute('data-billboard-active'), 'transaction');
    assert.ok(await page.evaluate(() => scrollY > 0), 'Vertical touch should scroll the page');
    await touch.detach(); await page.context().close();
  });

  await check('editable copy includes unified accounts, deck accessibility and recurring errors', async () => {
    for (const text of ['جزئیات بیشتر', 'مبلغ را فقط با عدد وارد کنید', 'نمایش همهٔ حساب‌های من', 'داشبورد', 'بخش‌های خانه', 'اعلان‌ها',
      'بازگشت به صفحهٔ قبل', 'ویرایش برنامهٔ تکرار', 'تسویهٔ درجا', 'در حال تسویه…', 'در حال بررسی حساب…',
      'بررسی حذف حساب', 'نام حساب برای تأیید حذف', 'تغییر شماره کارت را تأیید کنید.', 'حساب پرداخت یا دریافت را انتخاب کنید.',
      'انتخاب کارت خانه', 'موجودی کیف‌پول‌های من', 'مصرف بودجهٔ دسته‌ها',
      'در حال دریافت اطلاعات خانه…', 'بخشی از اطلاعات خانه دریافت نشد.', 'بخشی در این دسته نیست.']) {
      assert.ok(catalog.entries.some(entry => entry.text === text), 'Missing editable copy: ' + text);
    }
    assert.ok(catalog.entries.filter(entry => entry.file.endsWith('/bankCatalog.ts')).length >= 37);
    for (const id of ['home.billboard.wallet_count', 'home.billboard.budget_usage', 'home.billboard.due_summary']) {
      assert.ok(catalog.entries.some(entry => entry.sourceId === id || entry.id === id), 'Missing dynamic copy: ' + id);
    }
  });
  await check('layered billboard tracks both drag directions, reveals proportional blur and cancels or commits', async () => {
    for (const width of [320, 390, 1440]) {
      const page = await session('hub', 'full-owner', width), deck = page.locator('.home-billboard-deck');
      await deck.waitFor(); assert.equal(await page.locator('.home-billboard-tabs, .hub-add, .hub-banners').count(), 0);
      const posterBox = await deck.boundingBox(), quickBox = await page.locator('.home-quick-access').boundingBox();
      assert.ok(posterBox.y < quickBox.y);
      for (const key of ['transaction', 'wallets', 'budget', 'dues']) {
        const poster = await showBillboard(page, key);
        assert.equal(await poster.locator('svg.home-billboard-art').count(), 1);
        assert.equal(await page.locator('[data-billboard-card][inert]').count(), 3);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        for (const control of await poster.getByRole('button').all()) assert.ok((await control.boundingBox()).height >= 44);
        if (width === 390) {
          await screenshot(page, 'billboard-' + key + '-light');
          await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
          await screenshot(page, 'billboard-' + key + '-dark');
          await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
        }
      }
      await showBillboard(page, 'transaction');
      const art = await page.locator('[data-billboard-layer="front"] .home-billboard-art').boundingBox();
      const x = art.x + art.width / 2, y = art.y + art.height / 2;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 25, y, { steps: 4 });
      const first = await deck.evaluate(el => {
        const front = el.querySelector('[data-billboard-layer="front"]'), under = el.querySelector('[data-billboard-layer="underneath"]');
        return { x: new DOMMatrix(getComputedStyle(front).transform).m41, blur: parseFloat(getComputedStyle(under).filter.slice(5)), underneath: under.dataset.billboardCard };
      });
      assert.ok(Math.abs(first.x - 25) < 1); assert.equal(first.underneath, 'wallets'); assert.ok(first.blur > 0 && first.blur < 7);
      await page.waitForTimeout(160); await page.mouse.up();
      await page.waitForFunction(() => document.querySelector('.home-billboard-deck').dataset.billboardPhase === 'idle');
      assert.equal(await deck.getAttribute('data-billboard-active'), 'transaction');
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 65, y, { steps: 5 });
      const second = await deck.evaluate(el => ({
        x: new DOMMatrix(getComputedStyle(el.querySelector('[data-billboard-layer="front"]')).transform).m41,
        under: el.querySelector('[data-billboard-layer="underneath"]').dataset.billboardCard,
      }));
      assert.ok(Math.abs(second.x + 65) < 1); assert.equal(second.under, 'dues');
      await page.mouse.move(x - 140, y, { steps: 5 }); await page.mouse.up();
      await page.waitForFunction(() => document.querySelector('.home-billboard-deck').dataset.billboardActive === 'dues'
        && document.querySelector('.home-billboard-deck').dataset.billboardPhase === 'idle');
      if (width === 390) {
        await showBillboard(page, 'transaction');
        const touch = await page.context().newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 120, y }] });
        await page.waitForFunction(() => document.querySelector('.home-billboard-deck').dataset.billboardPhase === 'dragging');
        await screenshot(page, 'billboard-drag-blur');
        await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await page.waitForFunction(() => document.querySelector('.home-billboard-deck').dataset.billboardPhase === 'idle');
        assert.equal(await deck.getAttribute('data-billboard-active'), 'transaction'); await touch.detach();
      }
      if (width === 1440) await screenshot(page, 'billboard-desktop');
      await page.context().close();
    }
  });
  await check('automatic billboard pauses for focus, modals and reduced motion; actions work', async () => {
    const page = await session('hub'), deck = page.locator('.home-billboard-deck');
    await page.clock.install(); await deck.focus(); await page.locator('.hub-avatar').focus(); await page.mouse.move(0, 800);
    await page.clock.fastForward(6000); await page.clock.runFor(350);
    assert.equal(await deck.getAttribute('data-billboard-active'), 'wallets');
    await deck.focus(); await page.clock.fastForward(12000);
    assert.equal(await deck.getAttribute('data-billboard-active'), 'wallets');
    await page.clock.resume();
    const poster = await showBillboard(page, 'transaction');
    for (const [label, type] of [['ثبت هزینه', 'expense'], ['ثبت درآمد', 'income'], ['انتقال', 'transfer']]) {
      await poster.getByRole('button', { name: label, exact: true }).click(); await page.locator('.tx-simple').waitFor();
      assert.equal(await page.locator('.tx-simple .tx-tab.on').innerText(), type === 'expense' ? 'هزینه' : type === 'income' ? 'درآمد' : 'انتقال');
      await page.clock.fastForward(12000); assert.equal(await deck.getAttribute('data-billboard-active'), 'transaction');
      await page.keyboard.press('Escape'); await page.locator('.tx-simple').waitFor({ state: 'hidden' });
    }
    await page.clock.resume();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.hub-avatar').focus(); await page.mouse.move(0, 800); await page.clock.fastForward(12000);
    assert.equal(await deck.getAttribute('data-billboard-active'), 'transaction');
    assert.equal(await page.getByRole('button', { name: /نمایش خودکار کارت‌ها/ }).count(), 0);
    await page.clock.resume();
    const dues = await showBillboard(page, 'dues'); await dues.getByRole('button', { name: 'مشاهدهٔ موعدها', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.id === 'home-overview-title');
    const budget = await showBillboard(page, 'budget'); await budget.getByRole('button', { name: 'مشاهدهٔ بودجه‌ها', exact: true }).click(); await pageBack(page);
    await page.locator('.floating-navigation').getByRole('button', { name: 'داشبورد', exact: true }).click();
    const wallets = await showBillboard(page, 'wallets'); await wallets.getByRole('button', { name: 'مشاهدهٔ کیف‌پول‌ها', exact: true }).click();
    await page.getByRole('heading', { name: 'کیف پول‌ها', exact: true }).waitFor(); await page.context().close();
  });
  await check('unified accounts allow cash income, expenses and transfers with ownership and balance filtering', async () => {
    const page = await session('hub', 'full-member'), accounts = (await api(page, '/accounts')).body;
    const ownerId = accounts[0].member_id;
    const pocket = (await api(page, '/accounts', 'POST', { member_id: ownerId, title: 'Pocket cash', kind: 'wallet', initial_balance: 30000 })).body;
    const empty = (await api(page, '/accounts', 'POST', { member_id: ownerId, title: 'Empty pocket', kind: 'wallet', initial_balance: 0 })).body;
    await reload(page);
    for (const [type, amount, accountId, note] of [['income', '25000', empty.id, 'Cash deposit'], ['expense', '10000', pocket.id, 'Cash payment'], ['transfer', '5000', pocket.id, 'Cash transfer']]) {
      const form = await openForm(page, type), source = form.getByRole('combobox', { name: type === 'transfer' ? 'حساب مبدأ' : 'حساب تراکنش', exact: true });
      assert.equal(await form.locator('.tx-account-kinds').count(), 0);
      if (type !== 'income') {
        assert.equal(await source.locator('option[value="' + pocket.id + '"]').count(), 0);
        await form.getByRole('button', { name: 'نمایش همهٔ حساب‌های من', exact: true }).click();
        await form.locator('.tx-amount').fill('40000');
        assert.equal(await source.locator('option[value="' + pocket.id + '"]').count(), 0, 'Insufficient cash stays hidden even in all accounts');
      }
      await form.locator('.tx-amount').fill(amount);
      const visibleIds = await source.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
      assert.ok(visibleIds.includes(accountId));
      assert.ok(visibleIds.some(id => accounts.some(account => account.id === id && account.kind === 'bank')), 'Bank and cash coexist');
      await source.selectOption(accountId);
      if (type === 'transfer') await form.getByRole('combobox', { name: 'حساب مقصد', exact: true }).selectOption(empty.id);
      else await form.getByRole('combobox', { name: 'دسته‌بندی تراکنش', exact: true }).selectOption(type === 'income' ? 'salary' : 'food');
      await details(form); await form.getByRole('textbox', { name: 'توضیح تراکنش' }).fill(note);
      await form.locator('.tx-simple-save').click(); await form.waitFor({ state: 'hidden' });
      const saved = (await api(page, '/transactions')).body.find(row => row.note === note);
      assert.equal(saved.type, type); assert.equal(saved.account_id, accountId); assert.equal(saved.amount, Number(amount));
      if (type === 'transfer') assert.equal(saved.to_account_id, empty.id);
    }
    const billboard = await showBillboard(page, 'wallets'); await billboard.locator('.home-billboard-amount').waitFor();
    assert.equal(await billboard.locator('.home-billboard-amount bdi').innerText(), '۴۵,۰۰۰');
    await screenshot(page, 'cash-wallet-billboard'); await page.context().close();
  });
  await check('billboard loading, failed data, retry, empty and offline states do not invent financial totals', async () => {
    const empty = await session('hub', 'empty-owner');
    await (await showBillboard(empty, 'wallets')).getByRole('button', { name: 'ساخت کیف‌پول نقدی', exact: true }).waitFor();
    await (await showBillboard(empty, 'budget')).getByText('برای خرج ماه سقف بگذار', { exact: true }).waitFor(); await empty.context().close();
    const page = await session('hub');
    let release; const pending = new Promise(resolve => { release = resolve; });
    const delayed = async route => { await pending; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Fixture unavailable' }) }); };
    try {
      await page.route('**/api/v1/equipment', delayed); await reload(page);
      const billboard = await showBillboard(page, 'wallets');
      await billboard.getByText('در حال دریافت اطلاعات خانه…', { exact: true }).waitFor();
      assert.equal(await billboard.locator('.home-billboard-amount').count(), 0);
      release(); await billboard.getByText('بخشی از اطلاعات خانه دریافت نشد.', { exact: true }).waitFor();
      assert.equal(await billboard.locator('.home-billboard-amount').count(), 0);
      await page.unroute('**/api/v1/equipment', delayed);
      await billboard.getByRole('button', { name: 'تلاش دوباره', exact: true }).click(); await billboard.locator('.home-billboard-amount').waitFor();
      await page.context().setOffline(true); await billboard.getByText('اطلاعات مالی با اتصال به اینترنت در دسترس است.', { exact: true }).waitFor();
      assert.equal(await billboard.locator('.home-billboard-amount').count(), 0);
      assert.equal(await billboard.getByRole('button', { name: 'مشاهدهٔ کیف‌پول‌ها', exact: true }).isDisabled(), true);
      await (await showBillboard(page, 'dues')).getByText('موعدهای آفلاین شامل کارهای خانه است.', { exact: true }).waitFor();
    } finally { release(); await page.context().close(); }
  });
  await check('English and empty billboard headings keep cards and wallet amounts intact', async () => {
    const page = await session('hub'), billboard = await showBillboard(page, 'wallets');
    const entry = catalog.entries.find(entry => entry.file.endsWith('/HomeBillboard.tsx') && entry.text === 'موجودی کیف‌پول‌های من'); assert.ok(entry);
    const amount = await billboard.locator('.home-billboard-amount').innerText();
    for (const text of ['Cash wallets', '', 'Cash wallets']) {
      await page.evaluate(draft => window.postMessage({ type: 'copy-drafts', drafts: [draft] }, location.origin),
        { id: entry.id, original: entry.text, text, matchingIds: [entry.id], tokens: [] });
      await page.waitForFunction(text => document.querySelector('[data-billboard-layer="front"] h2').textContent === text, text);
      await showBillboard(page, 'budget'); await showBillboard(page, 'wallets');
      assert.equal(await billboard.locator('.home-billboard-amount').innerText(), amount);
    }
    await page.evaluate(() => window.postMessage({ type: 'copy-drafts', drafts: [] }, location.origin)); await page.context().close();
  });
  await check('one-page form has no calculator and rejects arithmetic without writes', async () => {
    const page = await session(), form = await openForm(page);
    assert.equal(await form.locator('.calc-key, .tx-keypad, .tx-amount-expr').count(), 0);
    assert.equal(await form.locator('details').getAttribute('open'), null);
    const amount = form.getByRole('textbox', { name: 'مبلغ هزینه' });
    await amount.pressSequentially('12345'); assert.equal(await amount.inputValue(), '۱۲,۳۴۵');
    const before = (await api(page, '/transactions')).body.length;
    for (const value of ['12+5', '-12', '12abc5', '1.2.3']) {
      await amount.fill(value); await form.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
      assert.equal((await api(page, '/transactions')).body.length, before);
      assert.equal(await form.isVisible(), true);
    }
    await amount.fill('1200.5'); await form.getByRole('combobox', { name: 'دسته‌بندی تراکنش' }).selectOption('food');
    await chooseAccount(form); await details(form); await form.getByRole('textbox', { name: 'توضیح تراکنش' }).fill('Fractional payment');
    await form.getByRole('button', { name: 'ثبت هزینه', exact: true }).click(); await form.waitFor({ state: 'hidden' });
    assert.equal((await api(page, '/transactions')).body.find(row => row.note === 'Fractional payment').amount, 1200.5);
    await page.context().close();
  });
  await check('own account choices hide low wallets and insufficient funds even after show-all', async () => {
    const page = await session(), accounts = (await api(page, '/accounts')).body;
    const owner = accounts[0].member_id;
    const added = [];
    for (const [title, initial_balance, kind] of [['Low wallet', 99999, 'wallet'], ['Boundary wallet', 100000, 'wallet'],
      ['Zero wallet', 0, 'wallet'], ['Short bank', 1000, 'bank']]) {
      const created = await api(page, '/accounts', 'POST', { member_id: owner, title, kind, initial_balance, card_number: kind === 'bank' ? '6037990000000099' : null });
      assert.equal(created.status, 201); added.push(created.body);
    }
    const members = (await api(page, '/auth/members')).body, child = members.find(row => row.relation === 'فرزند');
    assert.equal((await api(page, '/accounts', 'POST', { member_id: child.id, title: 'Child card', kind: 'bank', initial_balance: 500000, card_number: '6037990000000088' })).status, 201);
    await reload(page); const form = await openForm(page), select = form.getByRole('combobox', { name: 'حساب تراکنش' });
    let labels = await select.locator('option').allTextContents();
    assert.ok(labels.some(text => text.includes('Boundary wallet')));
    assert.ok(!labels.some(text => /Low wallet|Zero wallet|Child card/.test(text)));
    assert.ok(!labels.some(text => /603799|شماره کارت|شماره حساب/.test(text)));
    await form.getByRole('button', { name: 'نمایش همهٔ حساب‌های من' }).click();
    assert.ok((await select.locator('option').allTextContents()).some(text => text.includes('Low wallet')));
    await form.getByRole('textbox', { name: 'مبلغ هزینه' }).fill('100000');
    await page.waitForFunction(() => ![...document.querySelectorAll('.tx-simple-account select:first-of-type option')].some(option => option.textContent.includes('Low wallet')));
    labels = await select.locator('option').allTextContents(); assert.ok(!labels.some(text => /Low wallet|Zero wallet|Short bank|Child card/.test(text)));
    await form.getByRole('tab', { name: 'درآمد', exact: true }).click();
    assert.ok((await select.locator('option').allTextContents()).some(text => text.includes('Zero wallet')));
    await form.getByRole('tab', { name: 'انتقال', exact: true }).click();
    await form.getByRole('textbox', { name: 'مبلغ انتقال' }).fill('100000');
    const source = form.getByRole('combobox', { name: 'حساب مبدأ' });
    assert.ok(!(await source.locator('option').allTextContents()).some(text => /Low wallet|Short bank|Child card/.test(text)));
    assert.ok((await form.getByRole('combobox', { name: 'حساب مقصد' }).locator('option').allTextContents()).some(text => text.includes('Child card')));
    await screenshot(page, 'transfer-accounts'); await page.context().close();
  });
  await check('expense, income and transfer save correct account and amount contracts', async () => {
    const page = await session();
    for (const type of ['expense', 'income', 'transfer']) {
      const form = await openForm(page, type); await form.locator('.tx-amount').fill('1200');
      const accountId = await chooseAccount(form, type === 'transfer' ? 'حساب مبدأ' : 'حساب تراکنش');
      let destination;
      if (type === 'transfer') destination = await chooseAccount(form, 'حساب مقصد');
      else await form.getByRole('combobox', { name: 'دسته‌بندی تراکنش' }).selectOption(type === 'expense' ? 'food' : 'salary');
      await details(form); await form.getByRole('textbox', { name: 'توضیح تراکنش' }).fill('Saved ' + type);
      await form.locator('.tx-simple-save').click(); await form.waitFor({ state: 'hidden' });
      const stored = (await api(page, '/transactions')).body.find(row => row.note === 'Saved ' + type);
      assert.equal(stored.type, type); assert.equal(stored.amount, 1200); assert.equal(stored.account_id, accountId);
      if (destination) assert.equal(stored.to_account_id, destination);
    }
    await page.context().close();
  });
  await check('receipt failure and double-click retry preserve one financial transaction', async () => {
    const page = await session(), form = await openForm(page); await form.locator('.tx-amount').fill('1500');
    await chooseAccount(form); await form.getByRole('combobox', { name: 'دسته‌بندی تراکنش' }).selectOption('food');
    await details(form); await form.getByRole('textbox', { name: 'توضیح تراکنش' }).fill('Receipt retry');
    await form.locator('input[type=file]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHqkAAAAASUVORK5CYII=', 'base64') });
    let failed = false;
    await page.route('**/api/v1/transactions/*/photos', async route => {
      if (!failed) { failed = true; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'SERVER', message: 'Receipt temporarily unavailable' }) }); }
      else await route.continue();
    });
    await form.locator('.tx-simple-save').click(); await form.locator('.tx-save-status').waitFor();
    const saved = (await api(page, '/transactions')).body.filter(row => row.note === 'Receipt retry'); assert.equal(saved.length, 1);
    await page.waitForFunction(() => document.querySelector('.tx-simple')?.getAttribute('aria-busy') === 'false'
      && document.querySelector('.tx-simple-save')?.disabled === false);
    await form.locator('.tx-simple-save').evaluate(button => { button.click(); button.click(); });
    await form.waitFor({ state: 'hidden' });
    const after = (await api(page, '/transactions')).body.filter(row => row.note === 'Receipt retry');
    assert.equal(after.length, 1); assert.equal(after[0].id, saved[0].id); assert.equal(after[0].photos.length, 1);
    await page.context().close();
  });
  await check('fresh balance changes block spending before labels or payment can be saved', async () => {
    const page = await session(), form = await openForm(page); await form.locator('.tx-amount').fill('1200');
    const accountId = await chooseAccount(form);
    await form.getByRole('combobox', { name: 'دسته‌بندی تراکنش' }).selectOption('food');
    await details(form); await form.getByRole('textbox', { name: 'توضیح تراکنش' }).fill('Stale balance attempt');
    const accounts = (await api(page, '/accounts')).body, transactions = (await api(page, '/transactions')).body;
    const account = accounts.find(item => item.id === accountId);
    const balance = transactions.reduce((sum, row) => sum + (row.account_id === accountId ? row.amount * (row.type === 'income' ? 1 : -1) : 0)
      + (row.type === 'transfer' && row.to_account_id === accountId ? row.amount : 0), account.initial_balance);
    assert.equal((await api(page, '/transactions', 'POST', { member_id: account.member_id, type: 'expense', amount: balance - 100,
      category: 'food', date: account.created_at.slice(0, 10), note: 'Another payment', account_id: accountId })).status, 201);
    await form.locator('.tx-simple-save').click();
    await page.locator('.toast').filter({ hasText: 'موجودی این حساب برای مبلغ واردشده کافی نیست' }).waitFor();
    assert.ok(!(await api(page, '/transactions')).body.some(row => row.note === 'Stale balance attempt'));
    assert.equal(await form.getByRole('combobox', { name: 'حساب تراکنش' }).inputValue(), '');
    await page.context().close();
  });
  await check('future recurring edit and early settlement preserve past payment fields', async () => {
    const page = await session('settings/scheduled'), original = (await api(page, '/transactions')).body.find(row => row.repeat !== 'none');
    const row = page.locator('.scheduled-row').filter({ hasText: original.note });
    await row.getByRole('button', { name: /ویرایش تکرار/ }).click();
    await page.getByRole('textbox', { name: 'مبلغ تراکنش تکرارشونده' }).fill('2200');
    await page.getByRole('textbox', { name: 'توضیح تراکنش تکرارشونده' }).fill('Future recurring amount');
    await page.locator('.scheduled-form-sheet').getByRole('button', { name: 'ثبت', exact: true }).click();
    await page.locator('.scheduled-form-sheet').waitFor({ state: 'hidden' });
    const changed = (await api(page, '/transactions')).body.find(item => item.id === original.id);
    assert.equal(changed.recurring_plan.amount, 2200);
    for (const key of ['amount', 'date', 'category', 'note', 'account_id']) assert.equal(changed[key], original[key]);
    await page.locator('.scheduled-row').filter({ hasText: 'Future recurring amount' }).getByRole('button', { name: /تسویهٔ درجا/ }).click();
    const sheet = page.locator('.scheduled-settle-sheet'); await chooseAccount(sheet, 'حساب تسویه');
    await screenshot(page, 'recurring-settle'); await sheet.getByRole('button', { name: 'تأیید تسویه' }).click();
    await sheet.waitFor({ state: 'hidden' });
    const payments = (await api(page, '/transactions')).body.filter(item => item.recurring_source_id === original.id);
    assert.equal(payments.length, 1); assert.equal(payments[0].amount, 2200);
    assert.ok(payments[0].recurring_due_date > payments[0].date);
    await page.context().close();
  });
  await check('account deletion requires its exact title and history blocks deletion', async () => {
    const page = await session('accounts'), accounts = (await api(page, '/accounts')).body;
    const own = (await api(page, '/accounts', 'POST', { member_id: accounts[0].member_id, title: 'Unused wallet', kind: 'wallet', initial_balance: 0 })).body;
    await reload(page);
    await page.getByRole('button', { name: 'حذف Unused wallet', exact: true }).click();
    const sheet = page.locator('.account-delete-sheet');
    assert.equal(await sheet.getByRole('button', { name: 'حذف حساب', exact: true }).isDisabled(), true);
    await sheet.getByRole('textbox', { name: 'نام حساب برای تأیید حذف' }).fill('Unused wallet');
    await sheet.getByRole('button', { name: 'حذف حساب', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    assert.ok(!(await api(page, '/accounts')).body.some(row => row.id === own.id));
    await page.getByRole('button', { name: 'حذف ' + accounts[0].title, exact: true }).click();
    await sheet.getByText(/این حساب سابقهٔ تراکنش دارد/).waitFor();
    assert.equal(await sheet.getByRole('button', { name: 'حذف حساب', exact: true }).count(), 0);
    await page.context().close();
  });
  await check('glass navigation shows grouped compact sections, retains personal pins and removes all drag controls', async () => {
    const page = await session('hub'); await screenshot(page, 'mobile-home-light'); await pageBack(page);
    assert.equal(await page.locator('.hub-head .hub-bell, [data-home-arrange], [data-home-drag], .home-billboard-tabs').count(), 0);
    assert.equal(await page.locator('.home-catalog').count(), 0);
    const nav = page.locator('.floating-navigation');
    assert.deepEqual(await nav.locator('button > span:last-child').allTextContents(), ['داشبورد', 'بخش‌های خانه', 'اعلان‌ها']);
    await nav.getByRole('button', { name: 'بخش‌های خانه', exact: true }).click();
    await page.locator('.home-sections-page').waitFor(); await pageBack(page);
    assert.equal(await page.locator('.home-group').count(), 4);
    assert.equal(await page.locator('.home-catalog [data-pin-module]').count(), 20);
    assert.equal(await page.locator('[data-home-drag], .home-drag-handle, details.home-group').count(), 0);
    for (const tile of await page.locator('.home-module-tile').all()) assert.ok((await tile.boundingBox()).height < 140, 'Compact tile height');
    await screenshot(page, 'mobile-home-sections');
    const pin = page.locator('.home-catalog [data-pin-module="accounts"]'); await pin.click();
    await page.waitForFunction(() => !document.querySelector('.home-preferences-status').textContent.includes('در حال ذخیره'));
    await nav.getByRole('button', { name: 'داشبورد', exact: true }).click();
    await page.locator('[data-home-shortcut="accounts"]').waitFor();
    await page.locator('[data-shortcut-id="accounts"] [data-pin-module]').click();
    await page.waitForFunction(() => !document.querySelector('.home-preferences-status').textContent.includes('در حال ذخیره'));
    for (const route of ROUTES.filter(item => !item.section && !['auth', 'invite'].includes(item.id))) {
      await page.evaluate(route => window.dispatchEvent(new CustomEvent('copy-workbench:navigate', { detail: { route } })), route.id);
      await pageBack(page); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Overflow: ' + route.id);
    }
    await nav.getByRole('button', { name: 'اعلان‌ها' }).click();
    await page.locator('.notifications-page').waitFor(); await pageBack(page);
    assert.equal(await page.locator('.modal-sheet').count(), 0);
    for (const row of await page.locator('.notif-txt').all()) {
      assert.equal(await row.locator(':scope > b').count(), 1);
      assert.equal(await row.locator(':scope > span').count(), 1);
    }
    await screenshot(page, 'notifications-page');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('copy-workbench:navigate', { detail: { route: 'dashboard' } })));
    const form = await openForm(page); await details(form);
    assert.equal(await page.locator('.mobile-page-back').isVisible(), false);
    await form.getByRole('button', { name: 'تاریخ و ساعت تراکنش' }).click(); await page.locator('.dp-overlay').waitFor();
    assert.equal(await page.locator('.mobile-page-back').isVisible(), false);
    await page.keyboard.press('Escape'); await page.locator('.dp-overlay').waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape'); await form.waitFor({ state: 'hidden' }); await pageBack(page); await page.context().close();
  });
  await check('approved form remains readable on small screens and in dark theme', async () => {
    const page = await session('dashboard', 'full-owner', 360), form = await openForm(page);
    await form.locator('.tx-amount').fill('123456'); await screenshot(page, 'mobile-form-light');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await screenshot(page, 'mobile-form-dark'); await details(form); await screenshot(page, 'mobile-form-details-dark');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.context().close();
  });
  await check('back follows settings layers and appears on mobile and desktop login and invitation while Home omits it', async () => {
    for (const width of [390, 1440]) {
      const page = await session('settings/scheduled', 'full-owner', width);
      const back = await pageBack(page);
      assert.equal(await page.locator('.settings-inline-back').isVisible(), false);
      await back.click(); await page.getByRole('heading', { name: 'تنظیمات', exact: true }).waitFor();
      await pageBack(page); await back.click(); await page.locator('.hub-page').waitFor();
      await pageBack(page);
      if (width === 1440) await screenshot(page, 'desktop-home-light');
      await page.context().close();
      for (const [route, scenario] of [['auth', 'auth-login'], ['invite', 'invite-valid']]) {
        const guest = await session(route, scenario, width); await pageBack(guest);
        await guest.context().close();
      }
    }
  });
  await check('English and empty copy edits keep user data and account identifiers intact', async () => {
    const page = await session(), form = await openForm(page); await form.locator('.tx-amount').fill('1200');
    const accountId = await chooseAccount(form); await details(form); await form.getByRole('textbox', { name: 'توضیح تراکنش' }).fill('ثبت هزینه');
    const entry = catalog.entries.find(entry => entry.text === 'ثبت هزینه' && entry.file.endsWith('/TransactionFormFeature.tsx'));
    assert.ok(entry);
    for (const text of ['Save expense', '', 'Save expense']) {
      await page.evaluate(draft => window.postMessage({ type: 'copy-drafts', drafts: [draft] }, location.origin),
        { id: entry.id, original: entry.text, text, matchingIds: [entry.id], tokens: [] });
      await page.waitForFunction(text => document.querySelector('.tx-simple-save').textContent === text, text);
      assert.equal(await form.locator('.tx-amount').inputValue(), '۱,۲۰۰');
      assert.equal(await form.getByRole('textbox', { name: 'توضیح تراکنش' }).inputValue(), 'ثبت هزینه');
      assert.equal(await form.getByRole('combobox', { name: 'حساب تراکنش' }).inputValue(), accountId);
    }
    await page.evaluate(() => window.postMessage({ type: 'copy-drafts', drafts: [] }, location.origin));
    await page.context().close();
  });
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser.close();
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
}
if (results.errors.length || results.externalRequests.length) {
  console.error(JSON.stringify(results.errors, null, 2)); process.exitCode = 1;
} else console.log('Finance refresh: ' + results.checks.length + ' checks passed.');
