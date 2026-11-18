import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Regression checks: real React UI against fictional, in-memory copy-preview data.
// Start it with npm run copy:studio; no production or manual sandbox data is used.
const base = 'http://127.0.0.1:5701';
const output = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) ?? '.local-test/finance-transactions');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
await mkdir(output, { recursive: true });
const results = { origin: base, startedAt: new Date().toISOString(), checks: [], findings: [], errors: [], externalRequests: [], screenshots: [] };
if (process.argv.includes('--retry')) {
  const previous = JSON.parse(await readFile(resolve(output, 'results.json'), 'utf8'));
  results.checks = previous.checks; results.screenshots = previous.screenshots; results.visual = previous.visual;
  results.startedAt = previous.startedAt; results.retriedAt = new Date().toISOString();
  results.regularFlow = previous.regularFlow; results.copyEntries = previous.copyEntries;
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const contexts = [];
let token;
async function persist() { await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2)); }
async function session(scenario = 'full-owner', route = 'dashboard', viewport = { width: 390, height: 844 }, embedded = false) {
  const context = await browser.newContext({ viewport, timezoneId: 'Asia/Tehran' });
  contexts.push(context);
  await context.route('**/*', async request => {
    const url = new URL(request.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
      results.externalRequests.push(url.origin + url.pathname); await request.abort();
    } else await request.continue();
  });
  const response = await context.request.post(base + '/__copy/preview', {
    headers: { Origin: base, 'X-Copy-Workbench-Token': token }, data: { scenarioId: scenario, route },
  });
  assert.equal(response.status(), 200);
  const { url } = await response.json();
  const page = await context.newPage();
  page.on('pageerror', error => results.errors.push(error.message));
  page.setDefaultTimeout(7000);
  if (embedded) {
    // The preview sends picker messages to its same-origin parent, as in the editor.
    await page.addInitScript(() => {
      window.__financeCopyPicks = [];
      window.addEventListener('message', event => {
        if (event.origin === location.origin && event.source === document.querySelector('iframe')?.contentWindow
          && event.data?.type === 'copy-pick') window.__financeCopyPicks.push(event.data);
      });
    });
    await page.route(base + '/__finance-copy-host', request => request.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="'
        + (base + url).replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '"></iframe>',
    }));
  }
  await page.goto(embedded ? base + '/__finance-copy-host' : base + url, { waitUntil: 'domcontentloaded' });
  const preview = embedded ? await (await page.locator('iframe').elementHandle()).contentFrame() : page;
  await preview.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true, null, { timeout: 22000 });
  await preview.locator('section.page.active').waitFor();
  if (scenario.startsWith('full-')) await preview.getByText('نمونه', { exact: false }).filter({ visible: true }).first().waitFor();
  return preview;
}
async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch('/api/v1' + path, { method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }, { path, method, body });
}
async function accountBalance(page, accountId) {
  const [accounts, transactions] = await Promise.all([api(page, '/accounts'), api(page, '/transactions')]);
  return transactions.body.reduce((balance, row) => balance
    + (row.account_id === accountId ? (row.type === 'income' ? row.amount : -row.amount) : 0)
    + (row.type === 'transfer' && row.to_account_id === accountId ? row.amount : 0),
  accounts.body.find(row => row.id === accountId).initial_balance);
}
async function shot(page, name, fullPage = true) {
  const path = resolve(output, name + '.png');
  await page.screenshot({ path, fullPage, timeout: 22000, animations: 'disabled' }); results.screenshots.push(path);
}
async function form(page) {
  await page.getByRole('button', { name: 'افزودن تراکنش', exact: true }).click();
  await page.locator('.tx-cat').filter({ hasText: 'خورد و خوراک' }).click();
  const select = page.locator('.tx-chips select').first();
  const id = await select.locator('option').nth(1).getAttribute('value');
  await select.selectOption(id);
  return id;
}
async function keys(page, values) {
  for (const name of values) await page.locator('.calc-key').getByText(name, { exact: true }).click();
}
async function receipts(page, count) {
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    canvas.getContext('2d').fillRect(0, 0, 16, 16); return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles(Array.from({ length: count }, (_, index) => ({
    name: `receipt-${index}.png`, mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
  })));
  await page.waitForFunction(count => document.querySelectorAll('.tx-photo-mini').length === count
    && document.querySelector('.tx-save-btn')?.disabled === false, count);
}
async function clear(page) {
  const count = (await page.locator('.tx-form .tx-amount').inputValue()).length;
  for (let index = 0; index < count; index++) await page.getByRole('button', { name: 'پاک‌کردن رقم آخر', exact: true }).click();
}
function numeric(text) {
  return Number(text.replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).replace(/[^\d.-]/g, ''));
}
function contrastRatio(foreground, background) {
  const luminance = color => {
    const channels = color.match(/[\d.]+/g).slice(0, 3).map(value => Number(value) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}
async function metric(page, index, expected) {
  await page.waitForFunction(({ index, expected }) => {
    const text = document.querySelectorAll('.hp-metric-value')[index]?.textContent ?? '';
    return Number(text.replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).replace(/[^\d-]/g, '')) === expected;
  }, { index, expected });
}
async function budgetSummary(page, expected) {
  await page.waitForFunction(expected => {
    const values = [...document.querySelectorAll('.budget-summary-nums > div > b')].map(element =>
      Number(element.textContent.replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).replace(/[^\d.-]/g, '')));
    return values.length === expected.length && values.every((value, index) => value === expected[index]);
  }, expected);
}
async function navigate(page, route) {
  await page.locator('section.page.active').waitFor();
  await page.evaluate(route => window.dispatchEvent(new CustomEvent('copy-workbench:navigate', { detail: { route } })), route);
  await page.waitForTimeout(150);
}
async function check(name, run) {
  if (only && !name.includes(only)) return;
  if (results.checks.includes(name)) return;
  try { await run(); results.checks.push(name); console.log('PASS ' + name); }
  catch (error) { results.errors.push(name + ': ' + error.message); console.log('FAIL ' + name + ': ' + error.stack); }
  await persist();
}
try {
  const root = await browser.newPage(); await root.goto(base, { waitUntil: 'domcontentloaded' });
  token = await root.evaluate(() => window.__COPY_WORKBENCH__.csrfToken); await root.close();
  const catalog = await (await fetch(base + '/__copy/catalog')).json();
  const warningText = 'تراکنش ذخیره شده است؛ بعضی رسیدها هنوز ذخیره نشده‌اند. با ذخیرهٔ دوباره، همین تراکنش تکمیل می‌شود.';
  const warningEntry = catalog.entries.find(entry => entry.file.endsWith('/TransactionFormFeature.tsx') && entry.text === warningText);

  await check('new finance status and validation copy is available in the local editor', async () => {
    const displayTexts = [warningText, 'موجودی نقد حساب‌ها', 'مبلغ یا عبارت محاسباتی را کامل و درست وارد کنید',
      'تاریخ تراکنش را انتخاب کنید', 'تراکنش ذخیره شد، اما بعضی رسیدها ذخیره نشدند؛ دوباره تلاش کنید',
      'تراکنش ذخیره شد، اما اطلاعات صفحه تازه نشد؛ صفحه را بازخوانی کنید',
      'ثبت هزینه', 'ثبت درآمد', 'ثبت انتقال', 'ذخیرهٔ تغییرات', 'در حال ذخیره…',
      'تایپ کنید یا از دکمه‌های زیر استفاده کنید', 'حساب مبدأ', 'حساب مقصد', 'حساب تراکنش',
      'تاریخ و ساعت تراکنش', 'تکرار تراکنش', 'تاریخ پایان تکرار', 'توضیح تراکنش', 'افزودن تصویر رسید',
      'در حال بررسی موجودی…', 'موجودی کافی نیست', 'اصلاح مبلغ', 'تأیید و ثبت',
      'با ثبت این هزینه، موجودی حساب منفی می‌شود.', 'مانده پس از ثبت',
      'حساب انتخاب‌شده در دسترس نیست؛ حساب دیگری انتخاب کنید', 'بررسی موجودی حساب ممکن نشد؛ دوباره تلاش کنید',
      'موجودی منفی است؛ برای اصلاح، موجودی فعلی حساب را به‌روز کنید.'];
    results.copyEntries = displayTexts.map(text => {
      const entry = catalog.entries.find(entry => entry.text === text
        && ['/TransactionFormFeature.tsx', '/useTxFormModel.ts', '/HomeSummaryWidget.tsx', '/NegativeBalanceNotice.tsx'].some(file => entry.file.endsWith(file)));
      assert.ok(entry, 'Missing editable display text: ' + text);
      return { id: entry.id, text: entry.text, file: entry.file };
    });
    assert.ok(warningEntry);
    assert.equal(catalog.entries.some(entry => entry.file.endsWith('/shared/ui/Form.tsx') && entry.text === 'aria-label'), false);
    assert.ok(catalog.entries.some(entry => entry.file.endsWith('/TransactionFormFeature.tsx') && entry.text === 'افزودن تصویر رسید' && entry.kind === 'jsx-text'));
  });

  await check('typing and inserting formatted amounts retain the caret and preserve fractions on edit', async () => {
    const page = await session(); await form(page);
    const amount = page.getByRole('textbox', { name: 'مبلغ هزینه', exact: true });
    assert.equal(await amount.getAttribute('inputmode'), 'decimal');
    await amount.pressSequentially('12345'); assert.equal(await amount.inputValue(), '۱۲,۳۴۵');
    await amount.evaluate(input => input.setSelectionRange(1, 4));
    await amount.pressSequentially('9'); assert.equal(await amount.inputValue(), '۱,۹۴۵');
    assert.equal(await amount.evaluate(input => input.selectionStart), 3);
    await amount.pressSequentially('8'); assert.equal(await amount.inputValue(), '۱۹,۸۴۵');
    await amount.press('Backspace'); assert.equal(await amount.inputValue(), '۱,۹۴۵');
    // Insert a whole clipboard-style string without reading or changing the user's clipboard.
    await amount.press('Control+A'); await page.keyboard.insertText('١٬٢٠٠٫٥');
    assert.equal(await amount.inputValue(), '۱,۲۰۰.۵');
    await page.getByRole('textbox', { name: 'توضیح تراکنش' }).fill('Finance entry: typed fractional amount');
    await shot(page, 'typed-amount-focused', false);
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const created = (await api(page, '/transactions')).body.find(row => row.note === 'Finance entry: typed fractional amount');
    assert.equal(created.amount, 1200.5);
    await page.locator('.tx-item').filter({ hasText: created.note }).click();
    assert.equal(await amount.inputValue(), '۱,۲۰۰.۵');
    await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const edited = (await api(page, '/transactions')).body.filter(row => row.note === created.note);
    assert.equal(edited.length, 1); assert.equal(edited[0].id, created.id); assert.equal(edited[0].amount, 1200.5);
    await page.context().close();
  });

  await check('typed arithmetic combines with the keypad and currency switches without premature rounding', async () => {
    const page = await session(); await form(page); const amount = page.locator('.tx-form .tx-amount');
    await amount.fill('12-20'); await keys(page, ['+', '۱', '۰']);
    assert.equal(await amount.inputValue(), '-۸+۱۰');
    assert.ok((await page.locator('.tx-amount-expr').innerText()).includes('۲'));
    await amount.fill('۱٫۵+۰٫۲۵'); await keys(page, ['×', '۲']);
    assert.equal(await amount.inputValue(), '۱.۷۵×۲');
    assert.ok((await page.locator('.tx-amount-expr').innerText()).includes('۳.۵'));
    await page.locator('.tx-currency-btn').click(); assert.equal(await amount.inputValue(), '۳۵');
    await page.locator('.tx-currency-btn').click(); assert.equal(await amount.inputValue(), '۳.۵');
    await amount.fill('12/3+2*4'); assert.equal(await amount.inputValue(), '۱۲÷۳+۲×۴');
    await page.getByRole('textbox', { name: 'توضیح تراکنش' }).fill('Finance entry: keyboard operators');
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    assert.equal((await api(page, '/transactions')).body.find(row => row.note === 'Finance entry: keyboard operators').amount, 12);
    await page.context().close();
  });

  await check('expense income and transfer inputs group typing and keypad amounts and delete across separators', async () => {
    const page = await session(); await form(page);
    for (const type of ['هزینه', 'درآمد', 'انتقال']) {
      await page.getByRole('tab', { name: type, exact: true }).click();
      if (type !== 'انتقال') await page.locator('.tx-cat').first().click();
      const amount = page.locator('.tx-form .tx-amount');
      await amount.fill(''); await amount.pressSequentially('1234567');
      assert.equal(await amount.inputValue(), '۱,۲۳۴,۵۶۷');
      await keys(page, ['۰۰۰']); assert.equal(await amount.inputValue(), '۱,۲۳۴,۵۶۷,۰۰۰');
      await page.getByRole('button', { name: 'پاک‌کردن رقم آخر', exact: true }).click();
      assert.equal(await amount.inputValue(), '۱۲۳,۴۵۶,۷۰۰');
      await amount.fill('1234+5678.25'); assert.equal(await amount.inputValue(), '۱,۲۳۴+۵,۶۷۸.۲۵');
      await amount.fill('1234'); await amount.evaluate(input => input.setSelectionRange(2, 2));
      await amount.press('Backspace'); assert.equal(await amount.inputValue(), '۲۳۴');
      await amount.fill('1234'); await amount.evaluate(input => input.setSelectionRange(1, 1));
      await amount.press('Delete'); assert.equal(await amount.inputValue(), '۱۳۴');
    }
    await page.context().close();
  });

  await check('unsupported pasted text and negative amounts cannot silently create another expense', async () => {
    const page = await session(); await form(page); const before = (await api(page, '/transactions')).body.length;
    for (const [input, expected] of [['12/0', '۱۲÷۰'], ['12abc5', '۱۲abc۵'], ['۱۲ تومان', '۱۲ تومان'],
      ['12+', '۱۲+'], ['-12', '-۱۲'], ['1.2.3', '۱.۲.۳']]) {
      await page.locator('.tx-form .tx-amount').fill(input);
      await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
      await page.locator('.toast').filter({ hasText: 'لطفاً مبلغ معتبر وارد کنید' }).waitFor();
      assert.equal((await api(page, '/transactions')).body.length, before);
      assert.equal(await page.locator('.tx-form .tx-amount').inputValue(), expected);
      assert.equal(await page.locator('.tx-sheet').isVisible(), true);
    }
    await page.context().close();
  });

  await check('named controls and save labels preserve income and transfer contracts', async () => {
    const page = await session(); await form(page);
    await page.getByRole('combobox', { name: 'حساب تراکنش', exact: true }).waitFor();
    const date = page.getByRole('button', { name: 'تاریخ و ساعت تراکنش', exact: true });
    assert.ok(await date.evaluate(button => document.getElementById(button.getAttribute('aria-describedby'))?.textContent.includes('/')));
    await date.click(); await page.locator('.dp-overlay').waitFor();
    await page.keyboard.press('Escape'); await page.locator('.dp-overlay').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.tx-sheet').isVisible(), true);
    await date.click(); await page.locator('.dp-overlay').waitFor();
    await page.keyboard.press('Escape'); await page.locator('.dp-overlay').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.tx-sheet').isVisible(), true);
    await page.getByRole('combobox', { name: 'تکرار تراکنش', exact: true }).selectOption('monthly');
    await page.getByRole('button', { name: 'تاریخ پایان تکرار', exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'تکرار تراکنش', exact: true }).selectOption('none');
    assert.equal(await page.locator('.tx-scan-btn').innerText(), 'افزودن تصویر رسید');
    await page.getByRole('tab', { name: 'درآمد', exact: true }).click(); await page.locator('.tx-cat').first().click();
    await page.getByRole('textbox', { name: 'مبلغ درآمد', exact: true }).fill('۲۰۰۰');
    await page.getByRole('textbox', { name: 'توضیح تراکنش', exact: true }).fill('Finance entry: income');
    await page.getByRole('button', { name: 'ثبت درآمد', exact: true }).click(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    assert.equal((await api(page, '/transactions')).body.find(row => row.note === 'Finance entry: income').type, 'income');
    const cashBefore = numeric(await page.locator('.hp-balance').innerText());
    await page.getByRole('button', { name: 'افزودن تراکنش', exact: true }).click();
    await page.getByRole('tab', { name: 'انتقال', exact: true }).click();
    const source = page.getByRole('combobox', { name: 'حساب مبدأ', exact: true });
    const sourceId = await source.locator('option').nth(1).getAttribute('value'); await source.selectOption(sourceId);
    const destination = page.getByRole('combobox', { name: 'حساب مقصد', exact: true });
    const destinationId = await destination.locator('option').nth(1).getAttribute('value'); await destination.selectOption(destinationId);
    await page.getByRole('textbox', { name: 'مبلغ انتقال', exact: true }).fill('۱۰۰۰');
    await page.getByRole('textbox', { name: 'توضیح تراکنش' }).fill('Finance entry: transfer');
    await page.getByRole('button', { name: 'ثبت انتقال', exact: true }).click(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const stored = (await api(page, '/transactions')).body.find(row => row.note === 'Finance entry: transfer');
    assert.equal(stored.type, 'transfer'); assert.equal(stored.account_id, sourceId); assert.equal(stored.to_account_id, destinationId);
    assert.equal(numeric(await page.locator('.hp-balance').innerText()), cashBefore);
    await page.context().close();
  });

  await check('new save amount and account copy remains editable in English and empty without changing form values', async () => {
    const preview = await session('full-owner', 'dashboard', { width: 390, height: 844 }, true);
    const page = preview.page(); const accountId = await form(preview);
    await preview.locator('.tx-form .tx-amount').fill('۱۲۰۰'); await preview.locator('.tx-desc-input').fill('ثبت هزینه');
    const entries = ['ثبت هزینه', 'مبلغ هزینه', 'حساب تراکنش'].map(text => {
      const entry = catalog.entries.find(entry => entry.text === text && entry.file.endsWith('/TransactionFormFeature.tsx')
        && (text !== 'حساب تراکنش' || entry.context === 'aria-label'));
      assert.ok(entry, 'Missing finance copy: ' + text); return entry;
    });
    await page.evaluate(() => {
      document.querySelector('iframe').contentWindow.postMessage({ type: 'copy-pick-mode', enabled: true }, location.origin);
    });
    await preview.waitForFunction(() => document.body.classList.contains('copy-preview-pick-mode'));
    for (const [index, selector] of ['.tx-save-btn span', '.tx-amount-cap'].entries()) {
      await preview.locator(selector).click();
      await page.waitForFunction(count => window.__financeCopyPicks.length >= count, index + 1);
      assert.ok(await page.evaluate(({ index, id }) => window.__financeCopyPicks[index].entryIds?.includes(id), { index, id: entries[index].id }));
    }
    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'copy-pick-mode', enabled: false }, location.origin));
    await preview.waitForFunction(() => !document.body.classList.contains('copy-preview-pick-mode'));
    for (const texts of [['Save expense', 'Expense amount', 'Expense account'], ['', '', ''], ['Save expense', 'Expense amount', 'Expense account']]) {
      await page.evaluate(drafts => document.querySelector('iframe').contentWindow.postMessage({ type: 'copy-drafts', drafts }, location.origin), entries.map((entry, index) => ({
        id: entry.id, original: entry.text, text: texts[index], matchingIds: [entry.id], tokens: [],
      })));
      await preview.waitForFunction(texts => document.querySelector('.tx-save-btn span')?.textContent === texts[0]
        && document.querySelector('.tx-amount-cap')?.textContent === texts[1]
        && (document.querySelector('.tx-chips select')?.getAttribute('aria-label') ?? '') === texts[2], texts);
      assert.equal(await preview.locator('.tx-form .tx-amount').inputValue(), '۱,۲۰۰');
      assert.equal(await preview.locator('.tx-desc-input').inputValue(), 'ثبت هزینه');
      assert.equal(await preview.locator('.tx-chips select').first().inputValue(), accountId);
    }
    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'copy-drafts', drafts: [] }, location.origin));
    await preview.getByRole('button', { name: 'ثبت هزینه', exact: true }).waitFor();
    await preview.getByRole('button', { name: 'ثبت هزینه', exact: true }).click(); await preview.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const stored = (await api(preview, '/transactions')).body.find(row => row.note === 'ثبت هزینه');
    assert.equal(stored.amount, 1200); assert.equal(stored.account_id, accountId); assert.equal(stored.type, 'expense');
    await page.context().close();
  });

  await check('overspending a bank account requires explicit consent before any write and cancellation preserves the draft', async () => {
    const page = await session('full-owner', 'dashboard', { width: 360, height: 780 }); const accountId = await form(page);
    const available = await accountBalance(page, accountId); const before = (await api(page, '/transactions')).body.length;
    let writes = 0;
    page.on('request', request => { if (['POST', 'PATCH', 'DELETE'].includes(request.method()) && /\/api\/v1\//.test(request.url())) writes++; });
    await page.locator('.tx-form .tx-amount').fill(String(available + 1000));
    await page.locator('.tx-desc-input').fill('Finance balance: bank overdraft');
    await page.locator('.tx-tag').filter({ hasText: 'نان' }).click();
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.locator('.tx-balance-warning').waitFor();
    assert.equal(writes, 0); assert.equal((await api(page, '/transactions')).body.length, before);
    assert.equal(numeric(await page.locator('.tx-balance-remaining').innerText()), -1000);
    assert.equal(await page.locator('.tx-balance-warning').evaluate(node => document.activeElement === node), true);
    const geometry = await page.locator('.tx-balance-warning').evaluate(node => ({
      width: document.documentElement.scrollWidth,
      popup: (() => { const rect = node.closest('.tx-balance-popup').getBoundingClientRect();
        return { width: rect.width, height: rect.height, centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2 }; })(),
      buttons: [...node.querySelectorAll('button')].map(button => {
        const rect = button.getBoundingClientRect(); return { left: rect.left, right: rect.right, height: rect.height };
      }),
    }));
    assert.equal(geometry.width, 360);
    assert.ok(geometry.popup.width <= 320 && geometry.popup.height <= 260);
    assert.ok(Math.abs(geometry.popup.centerX - 180) < 2 && Math.abs(geometry.popup.centerY - 390) < 2);
    assert.equal(await page.locator('.tx-balance-warning').getAttribute('role'), 'alertdialog');
    assert.equal(await page.locator('.tx-fields').evaluate(fieldset => fieldset.disabled), true);
    for (const rect of geometry.buttons) assert.ok(rect.left >= 0 && rect.right <= 360 && rect.height >= 44);
    const confirmColors = await page.locator('.tx-balance-warning .btn-primary').evaluate(button => [getComputedStyle(button).color, getComputedStyle(button).backgroundColor]);
    assert.ok(contrastRatio(...confirmColors) >= 4.5);
    await shot(page, 'insufficient-balance-360', false);
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await shot(page, 'insufficient-balance-dark', false);
    await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button', { name: 'اصلاح مبلغ', exact: true }).evaluate(button => document.activeElement === button), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.getByRole('button', { name: 'تأیید و ثبت', exact: true }).evaluate(button => document.activeElement === button), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button', { name: 'اصلاح مبلغ', exact: true }).evaluate(button => document.activeElement === button), true);
    await page.getByRole('button', { name: 'اصلاح مبلغ', exact: true }).click();
    assert.equal(await page.locator('.tx-balance-warning').count(), 0); assert.equal(writes, 0);
    assert.equal(numeric(await page.locator('.tx-form .tx-amount').inputValue()), available + 1000);
    assert.equal(await page.locator('.tx-desc-input').inputValue(), 'Finance balance: bank overdraft');
    assert.equal(await page.locator('.tx-chips select').first().inputValue(), accountId);
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' }); assert.equal(await accountBalance(page, accountId), -1000);
    await navigate(page, 'accounts');
    const card = page.locator('.account-card').filter({ hasText: 'نمونه: حساب روزمره' });
    await card.locator('.account-negative-notice').waitFor(); assert.equal(numeric(await card.locator('.account-balance b').innerText()), -1000);
    await page.context().close();
  });

  await check('changing the expense or account cancels consent and a changed balance requires fresh confirmation', async () => {
    const page = await session(); const bankId = await form(page);
    const wallet = (await api(page, '/accounts')).body.find(row => row.kind === 'wallet');
    await page.getByRole('combobox', { name: 'حساب تراکنش', exact: true }).selectOption(wallet.id);
    const available = await accountBalance(page, wallet.id);
    await page.locator('.tx-form .tx-amount').fill(String(available + 1000));
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click(); await page.locator('.tx-balance-warning').waitFor();
    await page.getByRole('button', { name: 'اصلاح مبلغ', exact: true }).click();
    await page.locator('.tx-form .tx-amount').fill(String(available + 2000)); assert.equal(await page.locator('.tx-balance-warning').count(), 0);
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click(); await page.locator('.tx-balance-warning').waitFor();
    await page.getByRole('button', { name: 'اصلاح مبلغ', exact: true }).click();
    await page.getByRole('combobox', { name: 'حساب تراکنش', exact: true }).selectOption(bankId);
    assert.equal(await page.locator('.tx-balance-warning').count(), 0);
    await page.getByRole('combobox', { name: 'حساب تراکنش', exact: true }).selectOption(wallet.id);
    await page.locator('.tx-desc-input').fill('Finance balance: fresh consent');
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click(); await page.locator('.tx-balance-warning').waitFor();
    assert.equal(numeric(await page.locator('.tx-balance-remaining').innerText()), -2000);
    const before = (await api(page, '/transactions')).body.length;
    await api(page, '/accounts/' + wallet.id, 'PATCH', { initial_balance: wallet.initial_balance - 1000 });
    await page.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tx-balance-remaining')?.textContent.includes('۳,۰۰۰'));
    assert.equal((await api(page, '/transactions')).body.length, before);
    await page.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' }); assert.equal(await accountBalance(page, wallet.id), -3000);
    await page.context().close();
  });

  await check('popup Escape outside click and history back preserve the underlying expense form without saving', async () => {
    const page = await session(); const accountId = await form(page); const available = await accountBalance(page, accountId);
    const before = (await api(page, '/transactions')).body.length;
    await page.locator('.tx-form .tx-amount').fill(String(available + 1000));
    for (const action of ['escape', 'outside', 'back']) {
      await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click(); await page.locator('.tx-balance-warning').waitFor();
      if (action === 'escape') await page.keyboard.press('Escape');
      else if (action === 'outside') await page.locator('.tx-balance-overlay').click({ position: { x: 4, y: 4 } });
      else await page.evaluate(() => history.back());
      await page.locator('.tx-balance-warning').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('.tx-sheet').isVisible(), true);
      assert.equal(numeric(await page.locator('.tx-form .tx-amount').inputValue()), available + 1000);
      assert.equal((await api(page, '/transactions')).body.length, before);
    }
    await page.context().close();
  });

  await check('negative wallet balances survive reload and disappear only after a stored balance correction', async () => {
    const page = await session(); await form(page);
    const wallet = (await api(page, '/accounts')).body.find(row => row.kind === 'wallet');
    await page.getByRole('combobox', { name: 'حساب تراکنش', exact: true }).selectOption(wallet.id);
    const available = await accountBalance(page, wallet.id);
    await page.locator('.tx-form .tx-amount').fill(String(available + 0.5));
    await page.locator('.tx-desc-input').fill('Finance balance: persisted negative wallet');
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    await navigate(page, 'accounts');
    const card = page.locator('.wallet-card').filter({ hasText: wallet.title }); await card.locator('.account-negative-notice').waitFor();
    assert.equal(numeric(await card.locator('.wallet-balance b').innerText()), -0.5);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true, null, { timeout: 22000 });
    await navigate(page, 'accounts'); await card.locator('.account-negative-notice').waitFor();
    assert.equal(await accountBalance(page, wallet.id), -0.5); await shot(page, 'negative-wallet-after-reload', false);
    await card.click(); const sheet = page.locator('.modal-sheet').filter({ hasText: 'ویرایش کیف‌پول' });
    await sheet.locator('.num-input').fill('۰'); await sheet.locator('.bal-sign input').uncheck();
    await sheet.locator('.bal-warn-ack input').check(); await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click();
    await sheet.waitFor({ state: 'hidden' }); assert.equal(await accountBalance(page, wallet.id), 0);
    await card.locator('.account-negative-notice').waitFor({ state: 'hidden' });
    assert.equal(await card.locator('.account-negative-notice').count(), 0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true, null, { timeout: 22000 });
    assert.equal(await accountBalance(page, wallet.id), 0);
    await page.context().close();
  });

  await check('expense editing restores its stored effect and a zero balance still requires consent for the next cost', async () => {
    const page = await session();
    const row = (await api(page, '/transactions')).body.find(row => row.note === 'نمونه: خرید مواد غذایی');
    const available = await accountBalance(page, row.account_id) + row.amount;
    await page.locator('.tx-item').filter({ hasText: row.note }).click();
    await page.locator('.tx-form .tx-amount').fill(String(available));
    await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    assert.equal(await accountBalance(page, row.account_id), 0);
    await form(page); await page.locator('.tx-form .tx-amount').fill('۱۰');
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click(); await page.locator('.tx-balance-warning').waitFor();
    assert.equal(numeric(await page.locator('.tx-balance-remaining').innerText()), -10);
    await page.context().close();
  });

  await check('balance checks lock repeated saving while loading and failures cannot bypass verification', async () => {
    const page = await session(); await form(page); await page.locator('.tx-form .tx-amount').fill('۱۰۰');
    const before = (await api(page, '/transactions')).body.length;
    let release; const held = new Promise(done => { release = done; });
    await page.route('**/api/v1/accounts', async route => { await held; await route.continue(); });
    await page.locator('.tx-save-btn').evaluate(button => { button.click(); button.click(); });
    await page.getByRole('button', { name: 'در حال بررسی موجودی…', exact: true }).waitFor();
    assert.equal(await page.locator('.tx-save-btn').isDisabled(), true);
    assert.equal(await page.locator('.tx-fields').evaluate(fieldset => fieldset.disabled), true);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.tx-sheet').isVisible(), true);
    release(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' }); await page.unroute('**/api/v1/accounts');
    assert.equal((await api(page, '/transactions')).body.length, before + 1);
    await form(page); await page.locator('.tx-form .tx-amount').fill('۲۰۰');
    await page.route('**/api/v1/transactions', route => route.request().method() === 'GET'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'CHECK_FAILURE', message: 'Fixture balance unavailable' }) })
      : route.continue());
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.locator('.toast').filter({ hasText: 'بررسی موجودی حساب ممکن نشد؛ دوباره تلاش کنید' }).waitFor();
    assert.equal(await page.locator('.tx-sheet').isVisible(), true); assert.equal(await page.locator('.tx-form .tx-amount').inputValue(), '۲۰۰');
    await page.unroute('**/api/v1/transactions'); assert.equal((await api(page, '/transactions')).body.length, before + 1);
    await page.context().close();
  });

  await check('an approved overdraft reuses its consent when retrying a receipt on the same stored expense', async () => {
    const page = await session(); const accountId = await form(page); const available = await accountBalance(page, accountId);
    await page.locator('.tx-form .tx-amount').fill(String(available + 1000));
    await page.locator('.tx-desc-input').fill('Finance balance: overdraft receipt retry'); await receipts(page, 1);
    await page.route('**/api/v1/uploads/photo', route => route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: 'CHECK_FAILURE', message: 'Fixture receipt unavailable' }) }));
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click();
    await page.locator('.tx-save-status').waitFor();
    await page.waitForFunction(() => document.querySelector('.tx-save-btn')?.disabled === false);
    assert.equal(await page.locator('.tx-balance-warning').count(), 0);
    await page.unroute('**/api/v1/uploads/photo');
    await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const rows = (await api(page, '/transactions')).body.filter(row => row.note === 'Finance balance: overdraft receipt retry');
    assert.equal(rows.length, 1); assert.equal(rows[0].photos.length, 1); assert.equal(await accountBalance(page, accountId), -1000);
    await page.context().close();
  });

  await check('balance warning copy stays editable in English and empty while account values and consent remain protected', async () => {
    const preview = await session('full-owner', 'dashboard', { width: 390, height: 844 }, true);
    const page = preview.page(); const accountId = await form(preview); const available = await accountBalance(preview, accountId);
    await preview.locator('.tx-form .tx-amount').fill(String(available + 1000));
    await preview.locator('.tx-desc-input').fill('موجودی کافی نیست');
    await preview.getByRole('button', { name: 'ثبت هزینه', exact: true }).click(); await preview.locator('.tx-balance-warning').waitFor();
    const originals = ['موجودی کافی نیست', 'تأیید و ثبت'];
    const entries = originals.map(text => catalog.entries.find(entry => entry.text === text && entry.file.endsWith('/TransactionFormFeature.tsx')));
    assert.ok(entries.every(Boolean));
    for (const texts of [['Insufficient balance', 'Confirm negative balance'], ['', ''], ['Insufficient balance', 'Confirm negative balance']]) {
      await page.evaluate(drafts => document.querySelector('iframe').contentWindow.postMessage({ type: 'copy-drafts', drafts }, location.origin),
        entries.map((entry, index) => ({ id: entry.id, original: entry.text, text: texts[index], matchingIds: [entry.id], tokens: [] })));
      await preview.waitForFunction(texts => document.querySelector('.tx-balance-warning h3')?.textContent === texts[0]
        && document.querySelector('.tx-balance-warning .btn-primary')?.textContent === texts[1], texts);
      assert.equal(numeric(await preview.locator('.tx-balance-remaining').innerText()), -1000);
      assert.equal(await preview.locator('.tx-desc-input').inputValue(), 'موجودی کافی نیست');
      assert.equal(await preview.locator('.tx-chips select').first().inputValue(), accountId);
      assert.equal(await accountBalance(preview, accountId), available);
    }
    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'copy-drafts', drafts: [] }, location.origin));
    await preview.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click(); await preview.locator('.tx-sheet').waitFor({ state: 'hidden' });
    assert.equal(await accountBalance(preview, accountId), -1000); await page.context().close();
  });

  await check('negative total cash keeps its sign in the dashboard and home account summary', async () => {
    const page = await session(); const accountId = await form(page);
    const accounts = (await api(page, '/accounts')).body;
    const balances = await Promise.all(accounts.map(account => accountBalance(page, account.id)));
    const total = balances.reduce((sum, value) => sum + value, 0);
    await page.locator('.tx-form .tx-amount').fill(String(total + 1000));
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    assert.equal(numeric(await page.locator('.hp-balance').innerText()), -1000);
    await navigate(page, 'hub');
    await page.locator('details[data-home-group="money"] > summary').click();
    await page.locator('section.page.active').getByText(/-۱,۰۰۰/).first().waitFor();
    assert.ok((await page.locator('section.page.active').innerText()).includes('-۱,۰۰۰'));
    assert.ok(await accountBalance(page, accountId) < 0);
    await page.context().close();
  });

  await check('regular expense creation, edit, account balance and budget update', async () => {
    const page = await session();
    const before = (await api(page, '/transactions')).body;
    const expenseBefore = numeric(await page.locator('.hp-metric-value').nth(1).innerText());
    const cashBefore = numeric(await page.locator('.hp-balance').innerText());
    const food = page.locator('.budget-circle').filter({ hasText: 'خورد و خوراک' });
    const budgetBefore = numeric((await food.locator('span').first().innerText()).split('از')[0]);
    const accountId = await form(page);
    await keys(page, ['۱', '۲', '۰۰۰']);
    await page.locator('.tx-desc-input').fill('Finance review: regular expense');
    await shot(page, 'mobile-expense-form-light');
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const after = (await api(page, '/transactions')).body;
    const created = after.find(row => row.note === 'Finance review: regular expense');
    assert.equal(after.length, before.length + 1); assert.equal(created.amount, 12000); assert.equal(created.account_id, accountId);
    await metric(page, 1, expenseBefore + 12000);
    assert.equal(numeric(await page.locator('.hp-balance').innerText()), cashBefore - 12000);
    assert.equal(numeric((await food.locator('span').first().innerText()).split('از')[0]), budgetBefore + 12000);
    await page.locator('.tx-item').filter({ hasText: 'Finance review: regular expense' }).click();
    await clear(page); await keys(page, ['۲', '۰۰۰']);
    await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const edited = (await api(page, '/transactions')).body;
    assert.equal(edited.length, after.length); assert.equal(edited.find(row => row.id === created.id).amount, 2000);
    await metric(page, 1, expenseBefore + 2000);
    assert.equal(numeric(await page.locator('.hp-balance').innerText()), cashBefore - 2000);
    assert.equal(numeric((await food.locator('span').first().innerText()).split('از')[0]), budgetBefore + 2000);
    const foodBudget = await page.locator('.budget-circle').filter({ hasText: 'خورد و خوراک' }).innerText().catch(() => '');
    results.regularFlow = { createdAmount: 12000, editedAmount: 2000, accountId, dashboard: await page.locator('.home-panel').innerText(), foodBudget };
    await navigate(page, 'accounts'); await page.getByRole('heading', { name: 'کیف پول‌ها', exact: true }).waitFor();
    const account = (await api(page, '/accounts')).body.find(account => account.id === accountId);
    const expectedBalance = edited.reduce((balance, row) => balance
      + (row.account_id === accountId ? row.type === 'income' ? row.amount : -row.amount : 0)
      + (row.type === 'transfer' && row.to_account_id === accountId ? row.amount : 0), Number(account.initial_balance ?? 0));
    assert.equal(numeric(await page.locator('.account-card, .wallet-card').filter({ hasText: account.title })
      .locator('.account-balance b, .wallet-balance b').innerText()), expectedBalance);
    results.regularFlow.accounts = await page.locator('.content').innerText();
    await shot(page, 'accounts-after-edit'); await page.context().close();
  });

  await check('invalid division is rejected and the original input stays editable', async () => {
    const page = await session(); const before = (await api(page, '/transactions')).body.length;
    await form(page); await keys(page, ['۱', '۲', '÷', '۰']);
    const displayed = await page.locator('.tx-form .tx-amount').inputValue();
    await page.locator('.tx-desc-input').fill('Finance review: invalid division');
    await shot(page, 'invalid-division');
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.locator('.toast').filter({ hasText: 'لطفاً مبلغ معتبر وارد کنید' }).waitFor();
    const rows = (await api(page, '/transactions')).body; const row = rows.find(row => row.note === 'Finance review: invalid division');
    assert.equal(rows.length, before); assert.equal(row, undefined);
    assert.equal(await page.locator('.tx-form .tx-amount').inputValue(), displayed);
    assert.equal(await page.locator('.tx-sheet').isVisible(), true);
    await page.locator('.tx-currency-btn').click();
    assert.ok((await page.locator('.tx-currency-btn').innerText()).includes('تومان'));
    assert.equal(await page.locator('.tx-form .tx-amount').inputValue(), displayed);
    await page.context().close();
  });

  await check('000 extends the current operand and preserves arithmetic operators', async () => {
    const page = await session(); await form(page); await keys(page, ['۱', '۲', '+', '۵', '۰۰۰']);
    const displayed = await page.locator('.tx-form .tx-amount').inputValue();
    assert.equal(displayed, '۱۲+۵,۰۰۰');
    assert.ok((await page.locator('.tx-amount-expr').innerText()).includes('۵,۰۱۲'));
    await page.locator('.tx-currency-btn').click();
    assert.equal(numeric(await page.locator('.tx-form .tx-amount').inputValue()), 50120);
    await page.locator('.tx-currency-btn').click();
    assert.equal(numeric(await page.locator('.tx-form .tx-amount').inputValue()), 5012);
    await page.locator('.tx-desc-input').fill('Finance regression: currency roundtrip');
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    assert.equal((await api(page, '/transactions')).body.find(row => row.note === 'Finance regression: currency roundtrip').amount, 5012);
    await page.context().close();
  });

  await check('rapid double save locks before label creation and creates one expense', async () => {
    const page = await session(); const before = (await api(page, '/transactions')).body.length;
    await form(page); await keys(page, ['۷', '۰۰۰']);
    await page.locator('.tx-tag').filter({ hasText: 'نان' }).click();
    await page.locator('.tx-desc-input').fill('Finance review: rapid repeated save');
    let labelRequests = 0;
    let releaseLabel;
    const heldLabel = new Promise(done => { releaseLabel = done; });
    await page.route('**/api/v1/subcategories', async route => {
      if (route.request().method() === 'POST') { labelRequests++; await heldLabel; }
      await route.continue();
    });
    const labelRequest = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/v1/subcategories'));
    await page.evaluate(() => { const save = document.querySelector('.tx-save-btn'); save.click(); save.click(); });
    try {
      await labelRequest;
      await page.waitForFunction(() => document.querySelector('.tx-close-btn')?.disabled === true);
      assert.equal(await page.locator('.tx-save-btn').innerText(), 'در حال ذخیره…');
      assert.equal(await page.locator('.tx-close-btn').isDisabled(), true, 'Close is locked during saving');
      assert.equal(await page.locator('.tx-fields').evaluate(fieldset => fieldset.disabled), true, 'Fields are locked during saving');
      assert.equal(await page.locator('.calc-key').first().isDisabled(), true, 'Keypad inherits the fieldset lock');
      await page.keyboard.press('Escape'); assert.equal(await page.locator('.tx-sheet').isVisible(), true);
      assert.equal(labelRequests, 1);
    } finally { releaseLabel(); }
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const rows = (await api(page, '/transactions')).body;
    const matching = rows.filter(row => row.note === 'Finance review: rapid repeated save');
    assert.equal(labelRequests, 1); assert.equal(matching.length, 1); assert.equal(rows.length, before + 1);
    await page.context().close();
  });

  await check('receipt upload failure retains the saved expense and retry attaches to its identity', async () => {
    const page = await session(); await form(page); await keys(page, ['۸', '۰۰۰']);
    await page.locator('.tx-desc-input').fill('Finance review: receipt retry');
    await receipts(page, 1);
    await page.route('**/api/v1/uploads/photo', route => route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: 'REVIEW_UPLOAD_FAILURE', message: 'Fixture receipt upload failed' }) }));
    const save = page.getByRole('button', { name: 'ثبت هزینه', exact: true });
    await save.click(); await page.locator('.tx-save-status').filter({ hasText: 'Fixture receipt upload failed' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.tx-save-btn')?.disabled === false);
    const afterFailure = (await api(page, '/transactions')).body.filter(row => row.note === 'Finance review: receipt retry');
    assert.equal(afterFailure.length, 1);
    assert.equal(await page.locator('.tx-head-title').innerText(), 'ویرایش تراکنش');
    const storedId = afterFailure[0].id;
    assert.equal(await page.locator('.tx-item').filter({ hasText: 'Finance review: receipt retry' }).count(), 1);
    await page.waitForFunction(() => {
      const status = document.querySelector('.tx-save-status')?.getBoundingClientRect();
      const header = document.querySelector('.tx-head')?.getBoundingClientRect();
      return status && header && status.top >= header.bottom - 1 && status.bottom <= innerHeight;
    });
    await shot(page, 'receipt-failure-retains-expense', false);
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await shot(page, 'receipt-failure-dark', false);
    await page.evaluate(() => document.documentElement.dataset.theme = 'light');

    assert.ok(warningEntry);
    for (const text of ['Expense saved; retry the receipt.', '', warningText]) {
      await page.evaluate(draft => window.postMessage({ type: 'copy-drafts', drafts: [draft] }, location.origin), {
        id: warningEntry.id, original: warningEntry.text, text, matchingIds: [warningEntry.id], tokens: [],
      });
      await page.waitForFunction(text => document.querySelector('.tx-save-status > p')?.textContent === text, text);
      assert.equal(await page.locator('.tx-desc-input').inputValue(), 'Finance review: receipt retry');
      assert.equal(numeric(await page.locator('.tx-form .tx-amount').inputValue()), 8000);
    }
    await page.evaluate(() => window.postMessage({ type: 'copy-drafts', drafts: [] }, location.origin));
    await page.unroute('**/api/v1/uploads/photo');
    await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const afterRetry = (await api(page, '/transactions')).body.filter(row => row.note === 'Finance review: receipt retry');
    assert.equal(afterRetry.length, 1); assert.equal(afterRetry[0].id, storedId); assert.equal(afterRetry[0].photos.length, 1);
    await page.context().close();
  });

  await check('retry after the second receipt fails preserves the first receipt and one expense', async () => {
    const page = await session(); await form(page); await keys(page, ['۹', '۰۰۰']);
    await page.locator('.tx-desc-input').fill('Finance regression: partial receipts'); await receipts(page, 2);
    let uploads = 0, links = 0;
    page.on('request', request => { if (request.method() === 'POST' && /\/transactions\/[^/]+\/photos$/.test(request.url())) links++; });
    await page.route('**/api/v1/uploads/photo', async route => {
      uploads++;
      if (uploads === 2) await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: 'REVIEW_UPLOAD_FAILURE', message: 'Second receipt failed' }) });
      else await route.continue();
    });
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.locator('.tx-save-status').filter({ hasText: 'Second receipt failed' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.tx-save-btn')?.disabled === false);
    const first = (await api(page, '/transactions')).body.find(row => row.note === 'Finance regression: partial receipts');
    assert.equal(first.photos.length, 1); const firstPhotoId = first.photos[0].id;
    await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const rows = (await api(page, '/transactions')).body.filter(row => row.note === 'Finance regression: partial receipts');
    assert.equal(rows.length, 1); assert.equal(rows[0].id, first.id); assert.equal(rows[0].photos.length, 2);
    assert.ok(rows[0].photos.some(photo => photo.id === firstPhotoId)); assert.equal(uploads, 3); assert.equal(links, 2);
    await page.context().close();
  });

  await check('a successful upload is reused when attaching its receipt needs retry', async () => {
    const page = await session(); await form(page); await keys(page, ['۳', '۰۰۰']);
    await page.locator('.tx-desc-input').fill('Finance regression: retry attachment'); await receipts(page, 1);
    let uploads = 0, links = 0;
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/uploads/photo')) uploads++; });
    await page.route('**/api/v1/transactions/*/photos', async route => {
      links++;
      if (links === 1) await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: 'REVIEW_LINK_FAILURE', message: 'Linking receipt failed' }) });
      else await route.continue();
    });
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.locator('.tx-save-status').filter({ hasText: 'Linking receipt failed' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.tx-save-btn')?.disabled === false);
    await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const rows = (await api(page, '/transactions')).body.filter(row => row.note === 'Finance regression: retry attachment');
    assert.equal(rows.length, 1); assert.equal(rows[0].photos.length, 1); assert.equal(uploads, 1); assert.equal(links, 2);
    await page.context().close();
  });

  await check('a receipt that succeeded before another failed can be removed by its server id', async () => {
    const page = await session(); await form(page); await keys(page, ['۴', '۰۰۰']);
    await page.locator('.tx-desc-input').fill('Finance regression: remove saved receipt'); await receipts(page, 2);
    let uploads = 0;
    await page.route('**/api/v1/uploads/photo', async route => {
      uploads++;
      if (uploads === 2) await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: 'REVIEW_UPLOAD_FAILURE', message: 'Second receipt failed' }) });
      else await route.continue();
    });
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.locator('.tx-save-status').waitFor();
    await page.waitForFunction(() => document.querySelector('.tx-save-btn')?.disabled === false);
    const stored = (await api(page, '/transactions')).body.find(row => row.note === 'Finance regression: remove saved receipt');
    assert.equal(stored.photos.length, 1);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'حذف تصویر', exact: true }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('.tx-photo-mini').length === 1
      && document.querySelector('.tx-save-btn')?.disabled === false);
    assert.equal((await api(page, '/transactions')).body.find(row => row.id === stored.id).photos.length, 0);
    await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const rows = (await api(page, '/transactions')).body.filter(row => row.note === 'Finance regression: remove saved receipt');
    assert.equal(rows.length, 1); assert.equal(rows[0].photos.length, 1);
    assert.notEqual(rows[0].photos[0].id, stored.photos[0].id); await page.context().close();
  });

  await check('primary save errors and households without accounts keep the unsaved form', async () => {
    for (const scenario of ['save-errors', 'empty-owner']) {
      const page = await session(scenario, 'transactions');
      await page.getByRole('button', { name: 'افزودن تراکنش', exact: true }).click();
      await page.locator('.tx-cat').filter({ hasText: 'خورد و خوراک' }).click(); await keys(page, ['۱', '۰۰۰']);
      if (scenario === 'save-errors') {
        const id = await page.locator('.tx-chips select option').nth(1).getAttribute('value');
        await page.locator('.tx-chips select').first().selectOption(id);
      }
      const before = (await api(page, '/transactions')).body.length;
      await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click(); await page.locator('.toast').waitFor();
      assert.equal((await api(page, '/transactions')).body.length, before);
      assert.equal(await page.locator('.tx-sheet').isVisible(), true);
      assert.equal(await page.locator('.tx-head-title').innerText(), 'تراکنش جدید');
      await page.waitForFunction(() => document.querySelector('.tx-save-btn')?.disabled === false);
      await shot(page, scenario); await page.context().close();
    }
  });

  await check('dashboard cash includes opening balances and agrees with the cash accounts', async () => {
    const page = await session(); const accounts = (await api(page, '/accounts')).body;
    const transactions = (await api(page, '/transactions')).body;
    const initial = accounts.reduce((sum, row) => sum + Number(row.initial_balance ?? 0), 0);
    const net = transactions.reduce((sum, row) => sum + (row.type === 'income' ? row.amount : row.type === 'expense' ? -row.amount : 0), 0);
    const displayed = await page.locator('.hp-balance').innerText();
    assert.ok(initial > 0); assert.equal(numeric(displayed), initial + net);
    assert.equal(await page.locator('.hp-label').innerText(), 'موجودی نقد حساب‌ها');
    await shot(page, 'dashboard-cash-includes-initial'); await page.context().close();
  });

  await check('mobile tablet desktop form dimensions and action accessibility', async () => {
    results.visual = [];
    for (const viewport of [{ width: 360, height: 780 }, { width: 768, height: 1024 }, { width: 1280, height: 900 }]) {
      const page = await session('full-owner', 'dashboard', viewport); await form(page); await keys(page, ['۱', '۰۰۰']);
      const details = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
        save: { text: document.querySelector('.tx-save-btn').textContent.trim(), width: document.querySelector('.tx-save-btn').getBoundingClientRect().width,
          height: document.querySelector('.tx-save-btn').getBoundingClientRect().height,
          color: getComputedStyle(document.querySelector('.tx-save-btn')).color,
          background: getComputedStyle(document.querySelector('.tx-save-btn')).backgroundColor },
        amountInput: document.querySelector('.tx-form .tx-amount').tagName,
        controlsDisabled: document.querySelector('.tx-fields').disabled,
      }));
      results.visual.push(details); assert.ok(details.documentWidth <= viewport.width);
      assert.ok(details.save.width >= 44 && details.save.height >= 44);
      assert.equal(details.save.text, 'ثبت هزینه'); assert.equal(details.amountInput, 'INPUT');
      assert.ok(contrastRatio(details.save.color, details.save.background) >= 4.5);
      await shot(page, 'expense-form-' + viewport.width); await page.context().close();
    }
    const page = await session(); await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await form(page); await keys(page, ['۱', '۰۰۰']);
    const colors = await page.locator('.tx-save-btn').evaluate(button => [getComputedStyle(button).color, getComputedStyle(button).backgroundColor]);
    assert.ok(contrastRatio(...colors) >= 4.5);
    await page.locator('.tx-form .tx-amount').focus();
    assert.ok(await page.locator('.tx-form .tx-amount').evaluate(input => parseFloat(getComputedStyle(input).outlineWidth) >= 2));
    await page.keyboard.press('Tab');
    assert.ok(await page.getByRole('combobox', { name: 'حساب تراکنش' }).evaluate(select => document.activeElement === select));
    await shot(page, 'expense-form-dark'); await page.context().close();

    const editing = await session('full-owner', 'dashboard', { width: 360, height: 780 });
    await editing.locator('.tx-item').first().click();
    const save = editing.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true });
    await save.waitFor();
    await editing.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.querySelector('.tx-sheet').getAnimations().map(animation => animation.finished));
    });
    const rect = await save.boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= 360 && rect.height >= 44);
    await save.focus(); assert.ok(await save.evaluate(button => parseFloat(getComputedStyle(button).outlineWidth) >= 2));
    assert.equal(await editing.evaluate(() => document.documentElement.scrollWidth), 360);
    await shot(editing, 'expense-form-edit-360', false); await editing.context().close();
  });
  await check('transaction list search matches digits grouping dates and Arabic keyboard text', async () => {
    const page = await session('full-owner', 'transactions');
    const search = page.getByRole('searchbox', { name: 'جست‌وجو در تراکنش‌ها', exact: true });
    const rows = (await api(page, '/transactions')).body;
    const food = rows.find(row => row.category === 'food');
    const foodRow = page.locator('.tx-item').filter({ hasText: food.note });
    const jalali = (await foodRow.locator('.tx-info p').innerText()).match(/[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}/)[0];
    const enDate = jalali.replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776));
    const cases = ['1250000', '1,250,000', '۱۲۵۰۰۰۰', '۱٬۲۵۰٬۰۰۰', '١٢٥٠٠٠٠', 'مواد غذايي', jalali, enDate];
    for (const query of cases) {
      await search.fill(query);
      await page.waitForFunction(() => document.querySelectorAll('.tx-item').length === 1);
      assert.ok((await page.locator('.tx-item').innerText()).includes(food.note), query);
      assert.equal(await search.inputValue(), query);
    }
    await search.fill('تكرارشونده');
    await page.waitForFunction(() => document.querySelectorAll('.tx-item').length === 1);
    assert.ok((await page.locator('.tx-item').innerText()).includes('پرداخت تکرارشونده'));
    await shot(page, 'list-search-persian'); await page.context().close();
  });

  await check('transaction list search uses the displayed currency and retains fractional stored amounts', async () => {
    const page = await session('full-owner', 'transactions');
    const rows = (await api(page, '/transactions')).body;
    const source = rows.find(row => row.category === 'food');
    const created = await api(page, '/transactions', 'POST', {
      member_id: source.member_id, type: 'expense', amount: 1200.5, category: 'food', date: source.date,
      account_id: source.account_id, note: 'Cafe Receipt', repeat: 'none',
    });
    assert.equal(created.status, 201);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const search = page.getByRole('searchbox', { name: 'جست‌وجو در تراکنش‌ها', exact: true });
    for (const query of ['cafe receipt', '۱٬۲۰۰٫۵']) {
      await search.fill(query); await page.waitForFunction(() => document.querySelectorAll('.tx-item').length === 1);
      assert.ok((await page.locator('.tx-item').innerText()).includes('Cafe Receipt'));
    }
    await api(page, '/members/me/currency', 'POST', { currency: 'ریال' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await search.fill('12,005'); await page.waitForFunction(() => document.querySelectorAll('.tx-item').length === 1);
    assert.ok((await page.locator('.tx-item').innerText()).includes('Cafe Receipt'));
    assert.ok((await page.locator('.tx-item').innerText()).includes('ریال'));
    assert.equal((await api(page, '/transactions')).body.find(row => row.id === created.body.id).amount, 1200.5);
    await page.context().close();
  });

  await check('transaction list filter drafts cancel through buttons Escape outside and history without applying', async () => {
    const page = await session('full-owner', 'transactions'); const original = await page.locator('.tx-item').count();
    for (const mode of ['button', 'escape', 'outside', 'history']) {
      await page.getByRole('button', { name: 'فیلتر', exact: true }).click();
      await page.getByRole('combobox', { name: 'دسته‌بندی', exact: true }).selectOption('food');
      assert.equal(await page.locator('.tx-item').count(), original);
      if (mode === 'button') await page.getByRole('button', { name: 'انصراف', exact: true }).click();
      if (mode === 'escape') await page.keyboard.press('Escape');
      if (mode === 'outside') await page.locator('.modal-overlay').click({ position: { x: 4, y: 4 } });
      if (mode === 'history') await page.evaluate(() => history.back());
      await page.locator('.modal-sheet').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('.tx-item').count(), original);
    }
    await page.getByRole('button', { name: 'فیلتر', exact: true }).click();
    assert.equal(await page.getByRole('combobox', { name: 'دسته‌بندی', exact: true }).inputValue(), '');
    await page.getByRole('combobox', { name: 'دسته‌بندی', exact: true }).selectOption('food');
    await page.getByRole('button', { name: 'اعمال', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.tx-item').length === 1);
    assert.ok((await page.locator('.tx-item').innerText()).includes('مواد غذایی'));
    assert.equal(await page.locator('.adv-filter-chip').count(), 1);
    await shot(page, 'list-category-filter'); await page.context().close();
  });

  await check('transaction list account filtering includes transfers to the destination and clearing preserves search', async () => {
    const page = await session('full-owner', 'transactions');
    const wallet = (await api(page, '/accounts')).body.find(row => row.kind === 'wallet');
    const original = await page.locator('.tx-item').count();
    const search = page.getByRole('searchbox', { name: 'جست‌وجو در تراکنش‌ها', exact: true });
    await page.getByRole('button', { name: 'فیلتر', exact: true }).click();
    await page.getByRole('combobox', { name: 'حساب', exact: true }).selectOption(wallet.id);
    await page.getByRole('button', { name: 'اعمال', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.tx-item').length === 1);
    assert.ok((await page.locator('.tx-item').innerText()).includes('جابه‌جایی بین حساب‌ها'));
    await search.fill('300000');
    await page.getByRole('button', { name: 'فیلتر', exact: true }).click();
    await page.getByRole('button', { name: 'حذف فیلترها', exact: true }).click();
    assert.equal(await page.getByRole('combobox', { name: 'حساب', exact: true }).inputValue(), '');
    await page.getByRole('button', { name: 'انصراف', exact: true }).click();
    await page.getByRole('button', { name: 'فیلتر', exact: true }).click();
    assert.equal(await page.getByRole('combobox', { name: 'حساب', exact: true }).inputValue(), wallet.id);
    await page.getByRole('button', { name: 'انصراف', exact: true }).click();
    const clearFilters = page.getByRole('button', { name: 'پاک‌کردن فیلترها', exact: true });
    await clearFilters.focus(); await clearFilters.press('Enter');
    assert.equal(await page.locator('.adv-filter-chip').count(), 0);
    assert.equal(await page.locator('.modal-sheet').count(), 0);
    assert.equal(await search.inputValue(), '300000');
    assert.equal(await page.locator('.tx-item').count(), 1);
    await search.fill(''); await page.waitForFunction(count => document.querySelectorAll('.tx-item').length === count, original);
    await page.context().close();
  });

  await check('transaction list empty and unmatched states offer the correct next action without changing records', async () => {
    const page = await session('full-owner', 'transactions'); const original = (await api(page, '/transactions')).body.length;
    const search = page.getByRole('searchbox', { name: 'جست‌وجو در تراکنش‌ها', exact: true });
    await page.locator('.list-toolbar').getByRole('button', { name: 'هزینه', exact: true }).click();
    await page.getByRole('button', { name: 'فیلتر', exact: true }).click();
    await page.getByRole('combobox', { name: 'دسته‌بندی', exact: true }).selectOption('food');
    await page.getByRole('button', { name: 'اعمال', exact: true }).click();
    await search.fill('no matching receipt'); await page.locator('.tx-list-empty').waitFor();
    assert.equal(await page.locator('.tx-list-empty p').innerText(), 'نتیجه‌ای پیدا نشد');
    await shot(page, 'list-no-results');
    await page.getByRole('button', { name: 'پاک‌کردن جست‌وجو و فیلترها', exact: true }).click();
    await page.waitForFunction(count => document.querySelectorAll('.tx-item').length === count, original);
    assert.equal(await search.inputValue(), ''); assert.equal(await page.locator('.adv-filter-chip').count(), 0);
    assert.equal(await page.locator('.list-toolbar').getByRole('button', { name: 'همه', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal((await api(page, '/transactions')).body.length, original); await page.context().close();
    const empty = await session('empty-owner', 'transactions');
    assert.equal(await empty.locator('.tx-list-empty p').innerText(), 'هنوز تراکنشی ثبت نکرده‌اید');
    await shot(empty, 'list-empty-household');
    await empty.getByRole('button', { name: 'ثبت اولین تراکنش', exact: true }).click();
    await empty.locator('.tx-sheet').waitFor();
    assert.equal(await empty.locator('.tx-head-title').innerText(), 'تراکنش جدید');
    assert.equal((await api(empty, '/transactions')).body.length, 0); await empty.context().close();
  });

  await check('transaction list rows open their stored expense with Enter and Space and fit mobile and desktop', async () => {
    const page = await session('full-owner', 'transactions', { width: 360, height: 780 });
    const food = (await api(page, '/transactions')).body.find(row => row.category === 'food');
    for (const key of ['Enter', 'Space']) {
      const row = page.locator('.tx-item').filter({ hasText: food.note });
      assert.equal(await row.getAttribute('role'), 'button'); await row.focus();
      assert.ok(await row.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth) >= 2));
      await row.press(key); await page.locator('.tx-sheet').waitFor();
      assert.equal(await page.getByRole('textbox', { name: 'توضیح تراکنش' }).inputValue(), food.note);
      assert.equal(numeric(await page.locator('.tx-form .tx-amount').inputValue()), food.amount);
      await page.keyboard.press('Escape'); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    }
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      const filter = await page.locator('.filter-btn').boundingBox(); assert.ok(filter.width >= 44 && filter.height >= 44);
      await shot(page, 'list-' + width);
    }
    await page.setViewportSize({ width: 360, height: 780 });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await page.getByRole('button', { name: 'فیلتر', exact: true }).click();
    await page.getByRole('combobox', { name: 'دسته‌بندی', exact: true }).selectOption('food');
    await page.getByRole('button', { name: 'اعمال', exact: true }).click();
    const clear = await page.getByRole('button', { name: 'پاک‌کردن فیلترها', exact: true }).boundingBox(); assert.ok(clear.height >= 44);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 360);
    await shot(page, 'list-filter-dark'); await page.context().close();
  });

  await check('transaction list active filter actions remain readable in light and dark themes', async () => {
    const page = await session('full-owner', 'transactions', { width: 360, height: 780 });
    await page.getByRole('button', { name: 'فیلتر', exact: true }).click();
    await page.getByRole('combobox', { name: 'دسته‌بندی', exact: true }).selectOption('food');
    await page.getByRole('button', { name: 'اعمال', exact: true }).click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      const colors = await page.locator('.adv-filter-chip').evaluate(chip => {
        // Composite translucent theme tokens over the actual ancestor backgrounds.
        const layers = [];
        for (let element = chip; element; element = element.parentElement) layers.unshift(element);
        let background = [255, 255, 255];
        for (const layer of layers) {
          const channels = getComputedStyle(layer).backgroundColor.match(/[\d.]+/g).map(Number);
          const alpha = channels[3] ?? 1;
          background = background.map((value, index) => channels[index] * alpha + value * (1 - alpha));
        }
        return [getComputedStyle(chip.querySelector('.adv-clear')).color, 'rgb(' + background.join(',') + ')'];
      });
      assert.ok(contrastRatio(...colors) >= 4.5, theme + ': active-filter button contrast');
      await shot(page, 'list-active-filter-' + theme);
    }
    await page.context().close();
  });

  await check('transaction list copy stays editable in English and empty without changing query filter or user data', async () => {
    const page = await session('full-owner', 'transactions');
    const search = page.getByRole('searchbox', { name: 'جست‌وجو در تراکنش‌ها', exact: true });
    const displayTexts = ['جست‌وجو در تراکنش‌ها', 'جست‌وجو در تراکنش‌ها…', 'پاک‌کردن فیلترها',
      'نتیجه‌ای پیدا نشد', 'پاک‌کردن جست‌وجو و فیلترها', 'هنوز تراکنشی ثبت نکرده‌اید', 'ثبت اولین تراکنش', 'انصراف'];
    const entries = displayTexts.map(text => catalog.entries.find(entry => entry.text === text && entry.file.endsWith('/TransactionListFeature.tsx')));
    assert.ok(entries.every(Boolean), 'Missing editable list copy');
    await page.getByRole('button', { name: 'فیلتر', exact: true }).click();
    await page.getByRole('combobox', { name: 'دسته‌بندی', exact: true }).selectOption('food');
    await page.getByRole('button', { name: 'اعمال', exact: true }).click();
    await search.fill('نتیجه‌ای پیدا نشد'); await page.locator('.tx-list-empty').waitFor();
    const indexes = [0, 1, 3, 4];
    for (const texts of [['Search transactions', 'Search transactions…', 'No results', 'Clear search and filters'], ['', '', '', ''],
      ['Search transactions', 'Search transactions…', 'No results', 'Clear search and filters']]) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), indexes.map((index, position) => ({
        id: entries[index].id, original: entries[index].text, text: texts[position], matchingIds: [entries[index].id], tokens: [],
      })));
      await page.waitForFunction(texts => document.querySelector('.search-box input')?.getAttribute('aria-label') === texts[0]
        && document.querySelector('.search-box input')?.getAttribute('placeholder') === texts[1]
        && document.querySelector('.tx-list-empty p')?.textContent === texts[2]
        && document.querySelector('.tx-list-empty button')?.textContent === texts[3], texts);
      assert.equal(await page.locator('.search-box input').inputValue(), 'نتیجه‌ای پیدا نشد');
      assert.equal(await page.locator('.adv-filter-chip').count(), 1);
    }
    await page.evaluate(() => window.postMessage({ type: 'copy-drafts', drafts: [] }, location.origin));
    await page.getByRole('button', { name: 'پاک‌کردن جست‌وجو و فیلترها', exact: true }).waitFor();
    await search.fill('1250000');
    await page.waitForFunction(() => document.querySelectorAll('.tx-item').length === 1);
    assert.ok((await page.locator('.tx-item').innerText()).includes('نمونه: خرید مواد غذایی'));
    await page.context().close();
  });
  await check('budget summary agrees with category capacity while unbudgeted spending stays visible', async () => {
    const page = await session('full-owner', 'budgets');
    const source = (await api(page, '/transactions')).body.find(row => row.category === 'food');
    await api(page, '/transactions', 'POST', { type: 'expense', amount: 500000, category: 'transport', date: source.date,
      account_id: source.account_id, note: 'Budget regression: unbudgeted spending' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await budgetSummary(page, [6500000, 6250000, 250000]);
    const values = await page.locator('.budget-summary-nums > div > b').allInnerTexts();
    assert.deepEqual(values.map(numeric), [6500000, 6250000, 250000]);
    assert.equal(numeric(await page.locator('.budget-unbudgeted').innerText()), 500000);
    await shot(page, 'budget-summary-unbudgeted');
    await navigate(page, 'dashboard');
    assert.equal(numeric(await page.locator('.hp-cap-value').innerText()), 250000);
    assert.equal(numeric(await page.locator('.hp-unbudgeted').innerText()), 500000);
    await metric(page, 1, 6750000);
    await shot(page, 'budget-dashboard-unbudgeted'); await page.context().close();
  });

  await check('budget absence and overspending have distinct summaries and monthly deficits retain their sign', async () => {
    const page = await session('full-owner', 'budgets');
    const budgets = (await api(page, '/category-budgets')).body;
    for (const budget of budgets) await api(page, '/category-budgets/' + encodeURIComponent(budget.category), 'DELETE');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const remaining = page.locator('.budget-summary-nums > div > b').nth(2);
    assert.equal(await remaining.innerText(), '—');
    assert.equal(numeric(await page.locator('.budget-unbudgeted').innerText()), 6250000);
    assert.equal(await remaining.getAttribute('class') ?? '', '');
    await shot(page, 'budget-none');
    await api(page, '/category-budgets', 'POST', { category: 'food', amount: 1000000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await budgetSummary(page, [1000000, 1250000, 250000]);
    assert.equal(numeric(await remaining.innerText()), 250000);
    assert.ok((await remaining.locator('..').innerText()).includes('مصرف بیش از بودجه'));
    assert.equal(numeric(await page.locator('.budget-unbudgeted').innerText()), 5000000);
    const income = (await api(page, '/transactions')).body.find(row => row.type === 'income');
    await api(page, '/transactions/' + income.id, 'PATCH', { amount: 1 });
    await page.reload({ waitUntil: 'domcontentloaded' }); await navigate(page, 'dashboard');
    await metric(page, 2, -6249999);
    assert.equal(numeric(await page.locator('.hp-metric-value').nth(2).innerText()), -6249999);
    await shot(page, 'budget-monthly-deficit'); await page.context().close();
  });

  await check('budget amounts retain invalid input and enforce the currency and server limit before writing', async () => {
    const page = await session('full-owner', 'budgets'); const original = (await api(page, '/category-budgets')).body;
    let writes = 0;
    await page.route('**/api/v1/category-budgets', async route => {
      if (route.request().method() === 'POST') writes++;
      await route.continue();
    });
    await page.locator('.budget-row').filter({ hasText: 'خورد و خوراک' }).click();
    const amount = page.getByRole('textbox', { name: 'مبلغ بودجه ماهانه', exact: true });
    for (const raw of ['0', '-12', '12abc5', '12+', '1.5', '1000000000000']) {
      await amount.fill(raw); const retained = await amount.inputValue();
      await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
      await page.locator('.budget-save-notice').waitFor();
      assert.equal(await amount.inputValue(), retained); assert.equal(writes, 0);
    }
    assert.deepEqual((await api(page, '/category-budgets')).body, original);
    await amount.fill(''); await amount.pressSequentially('1234567'); assert.equal(await amount.inputValue(), '۱,۲۳۴,۵۶۷');
    await amount.fill('1234'); await amount.evaluate(input => input.setSelectionRange(2, 2));
    await amount.press('Backspace'); assert.equal(await amount.inputValue(), '۲۳۴');
    await amount.fill('1234'); await amount.evaluate(input => input.setSelectionRange(1, 1));
    await amount.press('Delete'); assert.equal(await amount.inputValue(), '۱۳۴');
    await page.getByRole('button', { name: 'انصراف', exact: true }).click();
    await api(page, '/members/me/currency', 'POST', { currency: 'ریال' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.budget-row').filter({ hasText: 'خورد و خوراک' }).click();
    await amount.fill('1'); await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
    await page.locator('.budget-save-notice').waitFor(); assert.equal(writes, 0);
    await amount.fill('20000000'); await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
    await page.locator('.modal-sheet').waitFor({ state: 'hidden' });
    assert.equal((await api(page, '/category-budgets')).body.find(row => row.category === 'food').amount, 2000000);
    assert.equal(writes, 1); await page.context().close();
  });

  await check('budget saving locks the draft and repeated clicks until the write and refresh finish', async () => {
    const page = await session('full-owner', 'budgets'); let writes = 0, release;
    const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/category-budgets', async route => {
      if (route.request().method() === 'POST') { writes++; await pending; }
      await route.continue();
    });
    await page.locator('.budget-row').filter({ hasText: 'خورد و خوراک' }).click();
    const amount = page.getByRole('textbox', { name: 'مبلغ بودجه ماهانه', exact: true });
    await amount.fill('2000000');
    await page.getByRole('button', { name: 'ذخیره', exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.getByRole('button', { name: 'در حال ذخیره…', exact: true }).waitFor();
    assert.equal(await amount.isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'انصراف', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('.budget-row:enabled').count(), 0);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.modal-sheet').count(), 1);
    await page.locator('.modal-overlay').click({ position: { x: 4, y: 4 } });
    assert.equal(await page.locator('.modal-sheet').count(), 1);
    await page.waitForTimeout(100); assert.equal(writes, 1);
    release(); await page.locator('.modal-sheet').waitFor({ state: 'hidden' });
    assert.equal(writes, 1);
    assert.equal((await api(page, '/category-budgets')).body.find(row => row.category === 'food').amount, 2000000);
    await page.context().close();
  });

  await check('budget cap increase needs consent and stays locked through both writes without duplicate requests', async () => {
    const page = await session('full-owner', 'budgets'); let caps = 0, writes = 0, release;
    const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/family/settings', async route => { caps++; await pending; await route.continue(); });
    await page.route('**/api/v1/category-budgets', async route => { if (route.request().method() === 'POST') writes++; await route.continue(); });
    await page.locator('.budget-row').filter({ hasText: 'خورد و خوراک' }).click();
    const amount = page.getByRole('textbox', { name: 'مبلغ بودجه ماهانه', exact: true });
    await amount.fill('20000000'); await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'سقف ماهانه را زیاد کن و ذخیره کن', exact: true });
    await confirm.waitFor(); assert.equal(writes, 0); assert.equal(caps, 0);
    await amount.fill('2000'); assert.equal(await confirm.count(), 0);
    await amount.fill('20000000'); await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
    await confirm.evaluate(button => { button.click(); button.click(); });
    await page.getByRole('button', { name: 'در حال ذخیره…', exact: true }).waitFor();
    assert.equal(await amount.isDisabled(), true); await page.waitForTimeout(100);
    assert.equal(caps, 1); assert.equal(writes, 0);
    release(); await page.locator('.modal-sheet').waitFor({ state: 'hidden' });
    assert.equal(caps, 1); assert.equal(writes, 1);
    assert.equal((await api(page, '/auth/family')).body.budget, 25500000);
    assert.equal((await api(page, '/category-budgets')).body.find(row => row.category === 'food').amount, 20000000);
    await page.context().close();
  });

  await check('budget partial cap success is disclosed and retry saves only the unsaved category', async () => {
    const page = await session('full-owner', 'budgets'); let caps = 0, writes = 0;
    await page.route('**/api/v1/family/settings', async route => { caps++; await route.continue(); });
    await page.route('**/api/v1/category-budgets', async route => {
      if (route.request().method() === 'POST' && ++writes === 1) await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: 'BUDGET_FAILURE', message: 'Fixture category write unavailable' }) });
      else await route.continue();
    });
    await page.locator('.budget-row').filter({ hasText: 'خورد و خوراک' }).click();
    const amount = page.getByRole('textbox', { name: 'مبلغ بودجه ماهانه', exact: true });
    await amount.fill('20000000'); await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
    await page.getByRole('button', { name: 'سقف ماهانه را زیاد کن و ذخیره کن', exact: true }).click();
    await page.locator('.budget-save-notice').waitFor();
    await page.waitForFunction(() => document.querySelector('.budget-fields')?.disabled === false);
    assert.equal(await page.locator('.budget-save-notice').innerText(), 'سقف ماهانه تغییر کرد، اما بودجهٔ دسته ذخیره نشد؛ دوباره تلاش کنید');
    assert.equal(await amount.inputValue(), '۲۰,۰۰۰,۰۰۰');
    assert.equal(await page.locator('.budget-fields .budget-cap.over').count(), 0);
    assert.equal((await api(page, '/auth/family')).body.budget, 25500000);
    assert.equal((await api(page, '/category-budgets')).body.find(row => row.category === 'food').amount, 1000000);
    await page.locator('.toast').waitFor({ state: 'hidden' });
    await shot(page, 'budget-partial-save');
    await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
    await page.locator('.modal-sheet').waitFor({ state: 'hidden' });
    assert.equal(caps, 1); assert.equal(writes, 2);
    assert.equal((await api(page, '/category-budgets')).body.filter(row => row.category === 'food').length, 1);
    assert.equal((await api(page, '/category-budgets')).body.find(row => row.category === 'food').amount, 20000000);
    await page.context().close();
  });

  await check('budget cap failure preserves the draft and blocks the category write until retry succeeds', async () => {
    const page = await session('full-owner', 'budgets'); let writes = 0;
    await page.route('**/api/v1/family/settings', route => route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: 'CAP_FAILURE', message: 'Fixture monthly cap unavailable' }) }));
    await page.route('**/api/v1/category-budgets', async route => { if (route.request().method() === 'POST') writes++; await route.continue(); });
    await page.locator('.budget-row').filter({ hasText: 'خورد و خوراک' }).click();
    const amount = page.getByRole('textbox', { name: 'مبلغ بودجه ماهانه', exact: true });
    await amount.fill('20000000'); await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'سقف ماهانه را زیاد کن و ذخیره کن', exact: true });
    await confirm.click(); await page.locator('.budget-save-notice').waitFor();
    await page.waitForFunction(() => document.querySelector('.budget-fields')?.disabled === false);
    assert.equal(writes, 0); assert.equal(await amount.inputValue(), '۲۰,۰۰۰,۰۰۰');
    assert.equal((await api(page, '/auth/family')).body.budget, 18000000);
    await page.unroute('**/api/v1/family/settings'); await confirm.click();
    await page.locator('.modal-sheet').waitFor({ state: 'hidden' });
    assert.equal(writes, 1); await page.context().close();
  });

  await check('budget managers share server permissions and deletion leaves financial transactions intact', async () => {
    for (const scenario of ['full-owner', 'full-admin', 'full-member']) {
      const page = await session(scenario, 'budgets'); const row = page.locator('.budget-row').filter({ hasText: 'خورد و خوراک' });
      assert.equal(await row.isDisabled(), scenario === 'full-member');
      if (scenario === 'full-member') {
        assert.equal(await page.locator('.modal-sheet').count(), 0); await page.context().close(); continue;
      }
      const transactions = (await api(page, '/transactions')).body;
      await row.click(); await page.getByRole('button', { name: 'حذف', exact: true }).click();
      await page.locator('.modal-sheet').waitFor({ state: 'hidden' });
      assert.equal((await api(page, '/category-budgets')).body.some(row => row.category === 'food'), false);
      assert.deepEqual((await api(page, '/transactions')).body, transactions);
      assert.equal(numeric(await page.locator('.budget-unbudgeted').innerText()), 1250000);
      await page.context().close();
    }
  });

  await check('budget monthly reports resolve custom category names and clear them in months without that expense', async () => {
    const page = await session('full-owner', 'reports');
    const category = (await api(page, '/custom-categories')).body[0];
    const source = (await api(page, '/transactions')).body.find(row => row.category === 'food');
    await api(page, '/transactions', 'POST', { type: 'expense', category: category.id, amount: 2500, date: source.date,
      account_id: source.account_id, note: 'Budget report: custom category expense' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const row = page.locator('.cat-report .cat-row').filter({ hasText: category.name });
    await row.waitFor(); assert.equal(numeric(await row.locator('b').innerText()), 2500);
    await page.getByRole('button', { name: 'ماه قبل', exact: true }).click(); assert.equal(await row.count(), 0);
    await page.getByRole('button', { name: 'ماه بعد', exact: true }).click(); await row.waitFor();
    assert.equal((await api(page, '/custom-categories')).body[0].name, category.name);
    await shot(page, 'budget-report-custom-category'); await page.context().close();
  });

  await check('budget editable labels validation and loading copy preserve draft values in English and empty', async () => {
    const page = await session('full-owner', 'budgets');
    const labelTexts = ['بودجهٔ دسته‌ها', 'مصرف بودجه‌ها', 'مبلغ بودجه ماهانه', 'مبلغ بودجه را کامل و در محدودهٔ مجاز وارد کنید'];
    const entries = labelTexts.map(text => catalog.entries.find(entry => entry.file.endsWith('/BudgetsPage.tsx') && entry.text === text));
    assert.ok(entries.every(Boolean));
    for (const text of ['در حال ذخیره…', 'خطا در ذخیرهٔ بودجه', 'خطا در حذف بودجه',
      'سقف ماهانه تغییر کرد، اما بودجهٔ دسته ذخیره نشد؛ دوباره تلاش کنید',
      'تغییر بودجه ذخیره شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید',
      'بودجه حذف شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید'])
      assert.ok(catalog.entries.some(entry => entry.file.endsWith('/BudgetsPage.tsx') && entry.text === text), text);
    await page.locator('.budget-row').filter({ hasText: 'خورد و خوراک' }).click();
    const amount = page.getByRole('textbox', { name: 'مبلغ بودجه ماهانه', exact: true });
    await amount.fill('12abc5'); await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
    await page.locator('.budget-save-notice').waitFor();
    const original = (await api(page, '/category-budgets')).body;
    for (const texts of [['Category budgets', 'Budget spending', 'Monthly budget amount', 'Enter a valid budget amount'], ['', '', '', ''],
      ['Category budgets', 'Budget spending', 'Monthly budget amount', 'Enter a valid budget amount']]) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), entries.map((entry, index) => ({
        id: entry.id, original: entry.text, text: texts[index], matchingIds: [entry.id], tokens: [],
      })));
      await page.waitForFunction(texts => document.querySelectorAll('.budget-summary-nums > div > span')[0]?.textContent === texts[0]
        && document.querySelectorAll('.budget-summary-nums > div > span')[1]?.textContent === texts[1]
        && document.querySelector('.budget-fields label')?.textContent === texts[2]
        && document.querySelector('.budget-save-notice')?.textContent === texts[3], texts);
      assert.equal(await page.locator('.budget-fields .num-input').inputValue(), '۱۲abc۵');
      assert.deepEqual((await api(page, '/category-budgets')).body, original);
    }
    await page.evaluate(() => window.postMessage({ type: 'copy-drafts', drafts: [] }, location.origin));
    await page.getByRole('button', { name: 'انصراف', exact: true }).click(); await page.context().close();
  });

  await check('budget summaries and save actions fit mobile and retain readable contrast in both themes', async () => {
    const page = await session('full-owner', 'budgets', { width: 360, height: 780 });
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await shot(page, 'budget-' + width);
    }
    await page.setViewportSize({ width: 360, height: 780 });
    await page.locator('.budget-row').filter({ hasText: 'خورد و خوراک' }).click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      const save = page.getByRole('button', { name: 'ذخیره', exact: true });
      const rect = await save.boundingBox(); assert.ok(rect.height >= 44 && rect.x >= 0 && rect.x + rect.width <= 360);
      const actions = await page.locator('.budget-fields .modal-actions button').evaluateAll(buttons => buttons.map(button => {
        const { x, y, width, height } = button.getBoundingClientRect(); return { x, y, width, height };
      }));
      assert.ok(actions.every(action => action.height >= 44 && action.x >= 0 && action.x + action.width <= 360));
      assert.ok(actions.every(action => Math.abs(action.y - actions[0].y) < 1));
      const colors = await save.evaluate(button => [getComputedStyle(button).color, getComputedStyle(button).backgroundColor]);
      assert.ok(contrastRatio(...colors) >= 4.5, theme);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 360);
      await shot(page, 'budget-edit-' + theme, false);
    }
    await page.context().close();
  });
  await check('accounts transfer creation edit and deletion preserve total cash and weekly reports', async () => {
    const page = await session();
    const accounts = (await api(page, '/accounts')).body;
    const [source, destination] = accounts;
    const before = await Promise.all([accountBalance(page, source.id), accountBalance(page, destination.id)]);
    const weekly = await page.locator('.strip').filter({ has: page.locator('.week-bars') }).innerText();
    const cash = numeric(await page.locator('.hp-balance').innerText());
    await page.getByRole('button', { name: 'افزودن تراکنش', exact: true }).click();
    await page.getByRole('tab', { name: 'انتقال', exact: true }).click();
    await page.getByRole('combobox', { name: 'حساب مبدأ', exact: true }).selectOption(source.id);
    await page.getByRole('combobox', { name: 'حساب مقصد', exact: true }).selectOption(destination.id);
    await page.getByRole('textbox', { name: 'مبلغ انتقال', exact: true }).fill('۱۲۰۰');
    await page.getByRole('textbox', { name: 'توضیح تراکنش' }).fill('Accounts regression: transfer');
    await page.getByRole('button', { name: 'ثبت انتقال', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const stored = (await api(page, '/transactions')).body.find(row => row.note === 'Accounts regression: transfer');
    assert.ok(stored); assert.equal(await accountBalance(page, source.id), before[0] - 1200);
    assert.equal(await accountBalance(page, destination.id), before[1] + 1200);
    assert.equal(await page.locator('.strip').filter({ has: page.locator('.week-bars') }).innerText(), weekly);
    assert.equal(numeric(await page.locator('.hp-balance').innerText()), cash);
    await navigate(page, 'transactions');
    await page.locator('.tx-item').filter({ hasText: 'Accounts regression: transfer' }).click();
    await page.getByRole('textbox', { name: 'مبلغ انتقال', exact: true }).fill('۲۵۰۰');
    await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    assert.equal((await api(page, '/transactions')).body.filter(row => row.id === stored.id).length, 1);
    assert.equal(await accountBalance(page, source.id), before[0] - 2500);
    assert.equal(await accountBalance(page, destination.id), before[1] + 2500);
    await page.locator('.tx-item').filter({ hasText: 'Accounts regression: transfer' }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'حذف تراکنش', exact: true }).click();
    await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    assert.equal(await accountBalance(page, source.id), before[0]); assert.equal(await accountBalance(page, destination.id), before[1]);
    await navigate(page, 'dashboard');
    assert.equal(await page.locator('.strip').filter({ has: page.locator('.week-bars') }).innerText(), weekly);
    assert.equal(numeric(await page.locator('.hp-balance').innerText()), cash);
    await shot(page, 'accounts-transfer-report'); await page.context().close();
  });

  await check('accounts cash chart ignores unassigned records and internal transfers and weekly deficits keep the sign', async () => {
    const page = await session('full-owner', 'accounts');
    const transactions = (await api(page, '/transactions')).body, source = transactions.find(row => row.type === 'expense');
    const accounts = (await api(page, '/accounts')).body;
    const path = await page.locator('.wealth-svg path[fill="none"]').getAttribute('d');
    await api(page, '/transactions', 'POST', { member_id: source.member_id, type: 'expense', amount: 90000000,
      category: 'food', date: source.date, account_id: null, note: 'Accounts regression: unassigned' });
    await api(page, '/transactions', 'POST', { member_id: source.member_id, type: 'transfer', amount: 100000,
      category: 'transfer', date: source.date, account_id: accounts[0].id, to_account_id: accounts[1].id });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('.wealth-svg path[fill="none"]') !== null);
    assert.equal(await page.locator('.wealth-svg path[fill="none"]').getAttribute('d'), path);
    await page.getByRole('img', { name: 'روند موجودی نقد حساب‌ها', exact: true }).waitFor();
    await navigate(page, 'dashboard');
    await page.waitForFunction(() => document.querySelector('.strip-net')?.textContent.includes('-'));
    assert.ok(numeric(await page.locator('.strip-net').innerText()) < 0);
    await shot(page, 'accounts-weekly-deficit'); await page.context().close();
  });

  await check('accounts balance input groups digits keeps the caret and rejects invalid input before writes', async () => {
    const page = await session('full-owner', 'accounts'); let writes = 0;
    await page.route('**/api/v1/accounts', async route => { if (route.request().method() === 'POST') writes++; await route.continue(); });
    await page.locator('.card').filter({ has: page.getByRole('heading', { name: 'کیف‌پول‌ها', exact: true }) }).getByRole('button', { name: 'افزودن', exact: true }).click();
    const sheet = page.locator('.account-form-sheet');
    await sheet.getByRole('textbox', { name: 'نام کیف‌پول', exact: true }).fill('Accounts regression: new wallet');
    const amount = sheet.getByRole('textbox', { name: 'موجودی اولیه (اختیاری)', exact: true });
    for (const raw of ['12abc5', '-12', '1.5', '1+2', '1000000000000000']) {
      await amount.fill(raw); const retained = await amount.inputValue();
      await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click();
      await sheet.locator('.account-save-notice').waitFor(); assert.equal(await amount.inputValue(), retained); assert.equal(writes, 0);
    }
    await amount.fill(''); await amount.pressSequentially('1234567'); assert.equal(await amount.inputValue(), '۱,۲۳۴,۵۶۷');
    await amount.fill('1234'); await amount.evaluate(input => input.setSelectionRange(2, 2));
    await amount.press('Backspace'); assert.equal(await amount.inputValue(), '۲۳۴');
    await amount.fill('1234'); await amount.evaluate(input => input.setSelectionRange(1, 1));
    await amount.press('Delete'); assert.equal(await amount.inputValue(), '۱۳۴');
    await amount.fill('١٢٥٠'); await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click();
    await sheet.waitFor({ state: 'hidden' }); assert.equal(writes, 1);
    assert.equal((await api(page, '/accounts')).body.find(row => row.title === 'Accounts regression: new wallet').initial_balance, 1250);
    await shot(page, 'accounts-new-wallet'); await page.context().close();
  });

  await check('accounts saves and refreshes lock repeated writes closing and account switching', async () => {
    const page = await session('full-owner', 'accounts'), wallet = (await api(page, '/accounts')).body.find(row => row.kind === 'wallet');
    await page.locator('.wallet-card').filter({ hasText: wallet.title }).click();
    const sheet = page.locator('.account-form-sheet'); let writes = 0, release, refreshRelease, holdRefresh = false, reads = 0;
    const pending = new Promise(resolve => { release = resolve; }), refreshing = new Promise(resolve => { refreshRelease = resolve; });
    let startRead; const readStarted = new Promise(resolve => { startRead = resolve; });
    await page.route('**/api/v1/accounts/' + wallet.id, async route => { if (route.request().method() === 'PATCH') { writes++; await pending; } await route.continue(); });
    await page.route('**/api/v1/accounts', async route => { if (holdRefresh && route.request().method() === 'GET') { reads++; startRead(); await refreshing; } await route.continue(); });
    await sheet.getByRole('textbox', { name: 'نام کیف‌پول', exact: true }).fill('Accounts regression: locked save');
    await sheet.getByRole('button', { name: 'ذخیره', exact: true }).evaluate(button => { button.click(); button.click(); button.click(); });
    await sheet.getByRole('button', { name: 'در حال ذخیره…', exact: true }).waitFor();
    assert.equal(await sheet.locator('fieldset').evaluate(fieldset => fieldset.disabled), true);
    assert.equal(await sheet.getByRole('textbox', { name: 'نام کیف‌پول', exact: true }).isDisabled(), true);
    assert.equal(await sheet.getByRole('button', { name: 'انصراف', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape'); assert.equal(await sheet.isVisible(), true);
    await page.locator('.modal-overlay').click({ position: { x: 1, y: 1 }, force: true }); assert.equal(await sheet.isVisible(), true);
    await page.locator('.account-card').first().evaluate(card => card.click());
    assert.equal(await sheet.getByRole('textbox', { name: 'نام کیف‌پول', exact: true }).inputValue(), 'Accounts regression: locked save');
    holdRefresh = true; release(); await sheet.waitFor({ state: 'hidden' });
    await Promise.race([readStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('Account refresh did not start')), 7000))]);
    await page.waitForFunction(() => [...document.querySelectorAll('.link-btn')].filter(button => button.textContent === 'افزودن').every(button => button.disabled));
    assert.equal(writes, 1); assert.ok(reads >= 1); refreshRelease();
    await page.locator('.wallet-card').filter({ hasText: 'Accounts regression: locked save' }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.link-btn')].some(button => button.textContent === 'افزودن' && !button.disabled));
    assert.equal(writes, 1); await page.context().close();
  });

  await check('accounts partial metadata success is disclosed and balance retry creates only one adjustment', async () => {
    const page = await session('full-owner', 'accounts'), wallet = (await api(page, '/accounts')).body.find(row => row.kind === 'wallet');
    const balance = await accountBalance(page, wallet.id), before = (await api(page, '/transactions')).body.length;
    await page.locator('.wallet-card').filter({ hasText: wallet.title }).click(); const sheet = page.locator('.account-form-sheet'); let adjustments = 0;
    await page.route('**/api/v1/transactions', async route => {
      if (route.request().method() === 'POST' && ++adjustments === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'TEMPORARY', message: 'Temporary fixture failure' }) });
      else await route.continue();
    });
    await sheet.getByRole('textbox', { name: 'نام کیف‌پول', exact: true }).fill('Accounts regression: partial save');
    await sheet.getByRole('textbox', { name: 'موجودی فعلی', exact: true }).fill(String(balance + 1000));
    await sheet.locator('.bal-warn-ack input').check(); await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click();
    await sheet.locator('.account-save-notice').waitFor();
    assert.equal(await sheet.locator('.account-save-notice').innerText(), 'اطلاعات حساب ذخیره شد، اما اصلاح موجودی انجام نشد؛ دوباره تلاش کنید');
    assert.equal((await api(page, '/accounts')).body.find(row => row.id === wallet.id).title, 'Accounts regression: partial save');
    assert.equal(await accountBalance(page, wallet.id), balance); assert.equal((await api(page, '/transactions')).body.length, before);
    await shot(page, 'accounts-partial-save', false);
    await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    assert.equal(adjustments, 2); assert.equal((await api(page, '/transactions')).body.length, before + 1);
    assert.equal(await accountBalance(page, wallet.id), balance + 1000); await page.context().close();
  });

  await check('accounts changed balance and changed target require renewed consent without silently undoing another transaction', async () => {
    const page = await session('full-owner', 'accounts'), wallet = (await api(page, '/accounts')).body.find(row => row.kind === 'wallet');
    const balance = await accountBalance(page, wallet.id);
    await page.locator('.wallet-card').filter({ hasText: wallet.title }).click(); const sheet = page.locator('.account-form-sheet');
    const amount = sheet.getByRole('textbox', { name: 'موجودی فعلی', exact: true }), ack = sheet.locator('.bal-warn-ack input');
    await amount.fill(String(balance + 1000)); await ack.check(); await amount.fill(String(balance + 2000)); assert.equal(await ack.isChecked(), false);
    await ack.check(); await sheet.locator('.bal-sign input').check(); assert.equal(await ack.isChecked(), false);
    await sheet.locator('.bal-sign input').uncheck(); await ack.check();
    await api(page, '/transactions', 'POST', { member_id: wallet.member_id, type: 'income', amount: 500,
      category: 'salary', date: '2026-11-18', account_id: wallet.id, note: 'Accounts regression: concurrent income' });
    const before = (await api(page, '/transactions')).body.length;
    await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click(); await sheet.locator('.account-save-notice').waitFor();
    assert.equal(await ack.isChecked(), false); assert.equal((await api(page, '/transactions')).body.length, before);
    assert.equal(numeric(await sheet.locator('.account-reviewed-balance b').innerText()), balance + 500);
    assert.equal(numeric(await amount.inputValue()), balance + 2000);
    await shot(page, 'accounts-fresh-balance-consent', false);
    await ack.check(); await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    assert.equal(await accountBalance(page, wallet.id), balance + 2000); assert.equal((await api(page, '/transactions')).body.length, before + 1);
    await page.context().close();
  });

  await check('accounts metadata editing preserves fractional negative balances and correction limits block metadata writes', async () => {
    const page = await session('full-owner', 'accounts'), wallet = (await api(page, '/accounts')).body.find(row => row.kind === 'wallet');
    const balance = await accountBalance(page, wallet.id);
    await api(page, '/accounts/' + wallet.id, 'PATCH', { initial_balance: wallet.initial_balance - balance - 0.5 });
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('.wallet-card .account-negative-notice').waitFor();
    await page.locator('.wallet-card').filter({ hasText: wallet.title }).click(); const sheet = page.locator('.account-form-sheet');
    await sheet.getByRole('textbox', { name: 'نام کیف‌پول', exact: true }).fill('Accounts regression: negative title');
    const before = (await api(page, '/transactions')).body.length;
    await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    assert.equal(await accountBalance(page, wallet.id), -0.5); assert.equal((await api(page, '/transactions')).body.length, before);
    await page.locator('.wallet-card').filter({ hasText: 'Accounts regression: negative title' }).click();
    await sheet.getByRole('textbox', { name: 'نام کیف‌پول', exact: true }).fill('Should stay unsaved');
    await sheet.getByRole('textbox', { name: 'موجودی فعلی', exact: true }).fill('1000000000000');
    await sheet.locator('.bal-sign input').uncheck(); await sheet.locator('.bal-warn-ack input').check();
    await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click(); await sheet.locator('.account-save-notice').waitFor();
    assert.equal((await api(page, '/accounts')).body.find(row => row.id === wallet.id).title, 'Accounts regression: negative title');
    assert.equal((await api(page, '/transactions')).body.length, before); await page.context().close();
  });

  await check('accounts bank input accepts Arabic digits and the immediately saved SMS decision blocks closing until finished', async () => {
    const page = await session('full-owner', 'accounts'), bank = (await api(page, '/accounts')).body.find(row => row.kind !== 'wallet');
    await page.locator('.account-card').filter({ hasText: bank.title }).click(); const sheet = page.locator('.account-form-sheet');
    const arabic = bank.card_number.replace(/\d/g, digit => String.fromCharCode(1632 + Number(digit)));
    await sheet.getByRole('textbox', { name: 'شماره کارت', exact: true }).fill(arabic);
    assert.equal(await sheet.getByRole('textbox', { name: 'شماره کارت', exact: true }).inputValue(), bank.card_number);
    let release; const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/sms/accounts/' + bank.id + '/enabled', async route => { await pending; await route.continue(); });
    const sms = sheet.getByRole('checkbox', { name: 'تشخیص تراکنش از پیامک', exact: true }); const on = await sms.isChecked();
    await sheet.locator('.sms-opt .switch').click(); await page.waitForFunction(() => document.querySelector('.account-fields')?.disabled === true);
    await page.keyboard.press('Escape'); assert.equal(await sheet.isVisible(), true); release();
    await page.waitForFunction(() => document.querySelector('.account-fields')?.disabled === false);
    await sheet.getByRole('button', { name: 'انصراف', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    assert.equal((await api(page, '/accounts')).body.find(row => row.id === bank.id).sms_enabled, !on);
    await page.context().close();
  });

  await check('accounts owner and admin can manage family accounts and deleting an account preserves the ledger', async () => {
    for (const scenario of ['full-owner', 'full-admin', 'full-member']) {
      const page = await session(scenario, 'accounts'), actor = (await api(page, '/auth/session')).body.member;
      const accounts = (await api(page, '/accounts')).body, own = accounts.find(row => row.member_id === actor.id);
      let other = accounts.find(row => row.member_id !== actor.id);
      if (!other) {
        const otherMember = (await api(page, '/auth/members')).body.find(row => row.id !== actor.id);
        other = (await api(page, '/accounts', 'POST', { member_id: otherMember.id, kind: 'wallet', title: 'Accounts regression: another member', initial_balance: 1000 })).body;
        await page.reload({ waitUntil: 'domcontentloaded' });
      }
      const otherCard = page.locator('.account-card, .wallet-card').filter({ hasText: other.title });
      if (scenario === 'full-member') {
        assert.equal(await otherCard.getAttribute('role'), null); assert.equal(await otherCard.locator('.account-actions button').count(), 0);
        assert.equal(await page.locator('.account-card, .wallet-card').filter({ hasText: own.title }).getAttribute('role'), 'button');
      } else {
        await otherCard.click(); await page.locator('.account-form-sheet').waitFor(); await page.getByRole('button', { name: 'انصراف', exact: true }).click();
        const before = (await api(page, '/transactions')).body;
        page.once('dialog', dialog => dialog.accept()); await otherCard.getByRole('button', { name: 'حذف ' + other.title, exact: true }).click();
        await otherCard.waitFor({ state: 'hidden' }); const after = (await api(page, '/transactions')).body;
        assert.deepEqual(after.map(row => row.id), before.map(row => row.id)); assert.equal(after.some(row => row.account_id === other.id || row.to_account_id === other.id), false);
      }
      await page.context().close();
    }
  });

  await check('accounts editable validation loading and accessible copy preserve values in English and empty', async () => {
    const page = await session('full-owner', 'accounts'), wallet = (await api(page, '/accounts')).body.find(row => row.kind === 'wallet');
    for (const text of ['موجودی معتبر وارد کنید', 'در حال ذخیره…', 'موجودی حساب تغییر کرده؛ مبلغ اصلاح را دوباره بررسی و تأیید کنید',
      'اطلاعات حساب ذخیره شد، اما اصلاح موجودی انجام نشد؛ دوباره تلاش کنید', 'مبلغ اصلاح موجودی از سقف مجاز تراکنش بیشتر است',
      'حساب ذخیره شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید', 'حساب حذف شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید',
      'این حساب در دسترس نیست؛ فهرست حساب‌ها را تازه کنید', 'موجودی ثبت‌شده:', 'روند موجودی نقد حساب‌ها', 'تاریخ شروع نمودار', 'تاریخ پایان نمودار'])
      assert.ok(catalog.entries.some(entry => entry.text === text && ['/useAccountsModel.ts', '/AccountFormFeature.tsx', '/AccountsPage.tsx'].some(file => entry.file.endsWith(file))), text);
    await page.locator('.wallet-card').filter({ hasText: wallet.title }).click(); const sheet = page.locator('.account-form-sheet');
    await sheet.getByRole('textbox', { name: 'موجودی فعلی', exact: true }).fill('12abc5');
    await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click(); await sheet.locator('.account-save-notice').waitFor();
    const entries = [catalog.entries.find(entry => entry.file.endsWith('/useAccountsModel.ts') && entry.text === 'موجودی معتبر وارد کنید'),
      catalog.entries.find(entry => entry.file.endsWith('/AccountFormFeature.tsx') && entry.text === 'موجودی فعلی'),
      catalog.entries.filter(entry => entry.file.endsWith('/AccountFormFeature.tsx') && entry.text === 'نام کیف‌پول').at(-1)];
    assert.ok(entries.every(Boolean)); const before = (await api(page, '/accounts')).body;
    for (const texts of [['Enter a valid balance', 'Current balance', 'Wallet name'], ['', '', ''], ['Enter a valid balance', 'Current balance', 'Wallet name']]) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), entries.map((entry, index) => ({
        id: entry.id, original: entry.text, text: texts[index], matchingIds: [entry.id], tokens: [],
      })));
      await page.waitForFunction(texts => document.querySelector('.account-save-notice')?.textContent === texts[0]
        && document.querySelector('.amt-field')?.parentElement.querySelector('label')?.textContent === texts[1]
        && document.querySelector('.account-fields .text-input')?.getAttribute('aria-label') === texts[2], texts);
      assert.equal(await sheet.locator('.num-input').inputValue(), '۱۲abc۵'); assert.deepEqual((await api(page, '/accounts')).body, before);
    }
    await page.evaluate(() => window.postMessage({ type: 'copy-drafts', drafts: [] }, location.origin)); await page.context().close();
  });

  await check('accounts date range edits stay in the draft on cancellation and account forms fit both themes and screen sizes', async () => {
    const page = await session('full-owner', 'accounts', { width: 360, height: 780 });
    await page.getByRole('button', { name: 'انتخاب بازه دلخواه', exact: true }).click();
    await page.getByRole('button', { name: 'اعمال', exact: true }).click();
    const dates = await page.locator('.wealth-dates').innerText(); const path = await page.locator('.wealth-svg path[fill="none"]').getAttribute('d');
    await page.getByRole('button', { name: 'دلخواه', exact: true }).click();
    await page.getByRole('button', { name: 'تاریخ شروع نمودار', exact: true }).click();
    await page.locator('.dp-box').getByRole('button', { name: 'امروز', exact: true }).click();
    await page.getByRole('button', { name: 'انصراف', exact: true }).click();
    assert.equal(await page.locator('.wealth-dates').innerText(), dates); assert.equal(await page.locator('.wealth-svg path[fill="none"]').getAttribute('d'), path);
    await page.getByRole('button', { name: 'دلخواه', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'تاریخ شروع نمودار', exact: true }).innerText(), dates.split('\n')[0]);
    await page.keyboard.press('Escape');
    for (const width of [360, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width); await shot(page, 'accounts-' + width); }
    await page.setViewportSize({ width: 360, height: 780 }); await page.locator('.wallet-card').first().click();
    const sheet = page.locator('.account-form-sheet');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      const save = sheet.getByRole('button', { name: 'ذخیره', exact: true }); const colors = await save.evaluate(button => [getComputedStyle(button).color, getComputedStyle(button).backgroundColor]);
      assert.ok(contrastRatio(...colors) >= 4.5, theme);
      const actions = await sheet.locator('.modal-actions button').evaluateAll(buttons => buttons.map(button => { const { x, y, width, height } = button.getBoundingClientRect(); return { x, y, width, height }; }));
      assert.ok(actions.every(action => action.height >= 44 && action.x >= 0 && action.x + action.width <= 360 && Math.abs(action.y - actions[0].y) < 1));
      await shot(page, 'accounts-edit-' + theme, false);
    }
    await page.context().close();
  });
  await check('accounts failed balance verification and a removed account block correction writes and preserve the draft', async () => {
    const page = await session('full-owner', 'accounts'), wallet = (await api(page, '/accounts')).body.find(row => row.kind === 'wallet');
    const balance = await accountBalance(page, wallet.id), before = (await api(page, '/transactions')).body.length;
    await page.locator('.wallet-card').filter({ hasText: wallet.title }).click(); const sheet = page.locator('.account-form-sheet');
    await sheet.getByRole('textbox', { name: 'موجودی فعلی', exact: true }).fill(String(balance + 1000));
    await sheet.locator('.bal-warn-ack input').check(); let writes = 0;
    await page.route('**/api/v1/accounts/' + wallet.id, async route => { if (route.request().method() === 'PATCH') writes++; await route.continue(); });
    await page.route('**/api/v1/transactions', async route => {
      if (route.request().method() === 'GET') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'TEMPORARY', message: 'Temporary fixture read failure' }) });
      else await route.continue();
    });
    await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click(); await sheet.locator('.account-save-notice').waitFor();
    assert.equal(writes, 0); assert.equal(numeric(await sheet.locator('.num-input').inputValue()), balance + 1000);
    await page.unroute('**/api/v1/transactions'); assert.equal((await api(page, '/transactions')).body.length, before);
    await api(page, '/accounts/' + wallet.id, 'DELETE');
    await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.account-save-notice')?.textContent === 'این حساب در دسترس نیست؛ فهرست حساب‌ها را تازه کنید');
    assert.equal(writes, 0); assert.equal((await api(page, '/transactions')).body.length, before);
    await shot(page, 'accounts-unavailable-correction', false); await page.context().close();
  });

  await check('accounts saving label remains editable in English and empty while the write is locked and amounts stay intact', async () => {
    const page = await session('full-owner', 'accounts'), wallet = (await api(page, '/accounts')).body.find(row => row.kind === 'wallet');
    await page.locator('.wallet-card').filter({ hasText: wallet.title }).click(); const sheet = page.locator('.account-form-sheet');
    const amount = await sheet.locator('.num-input').inputValue(); let release, writes = 0;
    const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/accounts/' + wallet.id, async route => { if (route.request().method() === 'PATCH') { writes++; await pending; } await route.continue(); });
    await sheet.getByRole('textbox', { name: 'نام کیف‌پول', exact: true }).fill('Accounts regression: editable saving');
    await sheet.getByRole('button', { name: 'ذخیره', exact: true }).click(); await sheet.getByRole('button', { name: 'در حال ذخیره…', exact: true }).waitFor();
    const entry = catalog.entries.find(entry => entry.file.endsWith('/AccountFormFeature.tsx') && entry.text === 'در حال ذخیره…'); assert.ok(entry);
    for (const text of ['Saving…', '', 'Saving…']) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), [{ id: entry.id, original: entry.text, text, matchingIds: [entry.id], tokens: [] }]);
      await page.waitForFunction(text => document.querySelector('.account-form-sheet .btn-primary')?.textContent === text, text);
      assert.equal(await sheet.locator('.btn-primary').isDisabled(), true); assert.equal(await sheet.locator('.num-input').inputValue(), amount);
      assert.equal(writes, 1);
    }
    release(); await sheet.waitFor({ state: 'hidden' });
    assert.equal((await api(page, '/accounts')).body.find(row => row.id === wallet.id).title, 'Accounts regression: editable saving');
    assert.equal(writes, 1); await page.context().close();
  });
  await check('category workflows inline creation locks the transaction draft and closing through creation and refresh', async () => {
    const page = await session(); await form(page);
    await page.getByRole('textbox', { name: 'مبلغ هزینه', exact: true }).fill('1234');
    await page.getByRole('button', { name: 'تغییر دسته‌بندی', exact: true }).click();
    await page.locator('.tx-cat').filter({ hasText: 'دسته جدید' }).click();
    await page.getByRole('textbox', { name: 'نام دستهٔ جدید', exact: true }).fill('Category regression: locked');
    let release, refreshRelease, startRead, writes = 0, holdRefresh = false;
    const pending = new Promise(resolve => { release = resolve; }), refreshing = new Promise(resolve => { refreshRelease = resolve; });
    const readStarted = new Promise(resolve => { startRead = resolve; });
    await page.route('**/api/v1/custom-categories', async route => {
      if (route.request().method() === 'POST') { writes++; await pending; }
      if (holdRefresh && route.request().method() === 'GET') { startRead(); await refreshing; }
      await route.continue();
    });
    await page.locator('.tx-add-cat button').evaluate(button => { button.click(); button.click(); button.click(); });
    await page.getByRole('button', { name: 'در حال ساخت دسته…', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'درآمد', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('textbox', { name: 'نام دستهٔ جدید', exact: true }).isDisabled(), true);
    await page.getByRole('tab', { name: 'درآمد', exact: true }).evaluate(button => button.click());
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.tx-sheet').isVisible(), true);
    await page.locator('.modal-overlay').click({ position: { x: 1, y: 1 }, force: true }); assert.equal(await page.locator('.tx-sheet').isVisible(), true);
    assert.equal(await page.locator('.tx-amount-mini b').innerText(), '۱,۲۳۴');
    holdRefresh = true; release();
    await Promise.race([readStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('Category refresh did not start')), 7000))]);
    assert.equal(await page.getByRole('button', { name: 'بستن', exact: true }).isDisabled(), true); assert.equal(writes, 1);
    refreshRelease(); await page.locator('.tx-add-cat').waitFor({ state: 'hidden' });
    await page.getByRole('textbox', { name: 'مبلغ هزینه', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'مبلغ هزینه', exact: true }).inputValue(), '۱,۲۳۴');
    const created = (await api(page, '/custom-categories')).body.filter(row => row.name === 'Category regression: locked');
    assert.equal(created.length, 1); assert.equal(created[0].type, 'expense'); assert.equal(writes, 1);
    await shot(page, 'categories-inline-locked'); await page.context().close();
  });

  await check('category workflows inline failure preserves the name and amount and retry selects one saved category', async () => {
    const page = await session(); await page.getByRole('button', { name: 'افزودن تراکنش', exact: true }).click();
    await page.getByRole('tab', { name: 'درآمد', exact: true }).click();
    await page.locator('.tx-cat').filter({ hasText: 'دسته جدید' }).click();
    const name = page.getByRole('textbox', { name: 'نام دستهٔ جدید', exact: true });
    await name.fill(''); await name.press('Enter'); await page.locator('.tx-category-error').waitFor();
    assert.equal(await page.locator('.tx-category-error').innerText(), 'نام دسته را وارد کنید');
    await name.fill('Category regression: retry'); let writes = 0;
    await page.route('**/api/v1/custom-categories', async route => {
      if (route.request().method() === 'POST' && ++writes === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'TEMPORARY', message: 'Temporary fixture failure' }) });
      else await route.continue();
    });
    await name.press('Enter'); await page.locator('.tx-category-error').waitFor();
    assert.equal(await name.inputValue(), 'Category regression: retry');
    await page.waitForFunction(() => document.querySelector('.tx-fields')?.disabled === false);
    await name.press('Enter'); await page.locator('.tx-add-cat').waitFor({ state: 'hidden' });
    const rows = (await api(page, '/custom-categories')).body.filter(row => row.name === 'Category regression: retry');
    assert.equal(rows.length, 1); assert.equal(rows[0].type, 'income'); assert.equal(writes, 2);
    await page.getByRole('textbox', { name: 'مبلغ درآمد', exact: true }).fill('2000');
    await page.getByRole('combobox', { name: 'حساب تراکنش', exact: true }).selectOption({ index: 1 });
    await page.getByRole('textbox', { name: 'توضیح تراکنش', exact: true }).fill('Category regression: income');
    await page.getByRole('button', { name: 'ثبت درآمد', exact: true }).click(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const stored = (await api(page, '/transactions')).body.find(row => row.note === 'Category regression: income');
    assert.equal(stored.category, rows[0].id); assert.equal(stored.type, 'income'); assert.equal(stored.amount, 2000);
    await page.context().close();
  });

  await check('category workflows preset copy edits preserve the stored label in English and empty without replacing user data', async () => {
    const page = await session(); const accountId = await form(page);
    await page.getByRole('textbox', { name: 'مبلغ هزینه', exact: true }).fill('1200');
    const entries = catalog.entries.filter(entry => entry.file.endsWith('/TransactionFormFeature.tsx') && entry.text === 'نان');
    assert.equal(entries.length, 1);
    const entry = entries[0], index = await page.locator('.tx-tags button').evaluateAll(buttons => buttons.findIndex(button => button.textContent === 'نان'));
    assert.ok(index >= 0); const tag = page.locator('.tx-tags button').nth(index);
    const before = (await api(page, '/transactions')).body;
    for (const text of ['Bread', '', 'Bread']) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), [{ id: entry.id, original: entry.text, text, matchingIds: [entry.id], tokens: [] }]);
      await page.waitForFunction(({ index, text }) => document.querySelectorAll('.tx-tags button')[index]?.textContent === text, { index, text });
      if (await tag.getAttribute('aria-pressed') === 'true') await tag.click();
      await tag.click(); assert.equal(await tag.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.getByRole('textbox', { name: 'مبلغ هزینه', exact: true }).inputValue(), '۱,۲۰۰');
      assert.equal(await page.getByRole('combobox', { name: 'حساب تراکنش', exact: true }).inputValue(), accountId);
      assert.deepEqual((await api(page, '/transactions')).body, before);
    }
    await page.getByRole('textbox', { name: 'توضیح تراکنش', exact: true }).fill('Category regression: editable preset');
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const stored = (await api(page, '/transactions')).body.find(row => row.note === 'Category regression: editable preset');
    const label = (await api(page, '/subcategories')).body.find(row => row.id === stored.subcategory_id);
    assert.equal(label.name, 'نان'); assert.equal(label.category, 'food'); assert.equal(stored.amount, 1200); assert.equal(stored.account_id, accountId);
    await navigate(page, 'transactions'); const row = page.locator('.tx-item').filter({ hasText: 'Category regression: editable preset' });
    assert.ok((await row.innerText()).includes('نان')); assert.equal((await row.innerText()).includes('Bread'), false);
    await shot(page, 'categories-stored-preset'); await page.context().close();
  });

  await check('category workflows settings saves lock names and types through refresh and reject duplicate names within one type', async () => {
    const page = await session('full-owner', 'settings/categories');
    const name = page.getByRole('textbox', { name: 'نام دستهٔ جدید', exact: true }); let release, writes = 0;
    const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/custom-categories', async route => { if (route.request().method() === 'POST') { writes++; await pending; } await route.continue(); });
    await name.fill('Category regression: settings');
    await page.locator('.chip-adder button').evaluate(button => { button.click(); button.click(); });
    await page.getByRole('button', { name: 'در حال ذخیره…', exact: true }).waitFor();
    assert.equal(await name.isDisabled(), true);
    assert.equal(await page.locator('.seg-btn').filter({ hasText: 'درآمد' }).isDisabled(), true);
    await page.locator('.seg-btn').filter({ hasText: 'درآمد' }).evaluate(button => button.click());
    release(); await page.waitForFunction(() => document.querySelector('.category-fields')?.disabled === false);
    const created = (await api(page, '/custom-categories')).body.find(row => row.name === 'Category regression: settings');
    assert.equal(created.type, 'expense'); assert.equal(writes, 1);
    await name.fill('Category regression: settings'); await name.press('Enter'); await page.locator('.category-save-notice').waitFor();
    assert.equal(writes, 1); assert.equal(await name.inputValue(), 'Category regression: settings');
    await page.locator('.seg-btn').filter({ hasText: 'درآمد' }).click(); await name.press('Enter');
    await page.waitForFunction(() => document.querySelector('.category-fields')?.disabled === false && document.querySelector('.chip-adder input')?.value === '');
    const rows = (await api(page, '/custom-categories')).body.filter(row => row.name === 'Category regression: settings');
    assert.equal(rows.length, 2); assert.deepEqual(rows.map(row => row.type).sort(), ['expense', 'income']);
    await shot(page, 'categories-settings'); await page.context().close();
  });

  await check('category workflows same named expense and income categories keep distinct label parents and groups', async () => {
    const page = await session('full-owner', 'settings/labels');
    const expense = (await api(page, '/custom-categories', 'POST', { type: 'expense', name: 'Same category' })).body;
    const income = (await api(page, '/custom-categories', 'POST', { type: 'income', name: 'Same category' })).body;
    await page.reload({ waitUntil: 'domcontentloaded' });
    const parent = page.getByRole('combobox', { name: 'دستهٔ برچسب', exact: true }), name = page.getByRole('textbox', { name: 'نام برچسب جدید', exact: true });
    await parent.locator('option[value="' + expense.id + '"]').waitFor({ state: 'attached' });
    assert.equal(await parent.locator('option[value="' + expense.id + '"]').innerText(), 'Same category (هزینه)');
    assert.equal(await parent.locator('option[value="' + income.id + '"]').innerText(), 'Same category (درآمد)');
    let release, writes = 0; const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/subcategories', async route => { if (route.request().method() === 'POST') { writes++; await pending; } await route.continue(); });
    await parent.selectOption(expense.id); await name.fill('Same label');
    await page.locator('.chip-adder button').evaluate(button => { button.click(); button.click(); });
    await page.getByRole('button', { name: 'در حال ذخیره…', exact: true }).waitFor();
    assert.equal(await parent.isDisabled(), true); assert.equal(await name.isDisabled(), true); release();
    await page.waitForFunction(() => document.querySelector('.category-fields')?.disabled === false && document.querySelector('.chip-adder input')?.value === '');
    await name.fill('Same label'); await name.press('Enter'); await page.locator('.category-save-notice').waitFor(); assert.equal(writes, 1);
    await parent.selectOption(income.id); await name.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.label-group').length === 3 && document.querySelector('.category-fields')?.disabled === false);
    const labels = (await api(page, '/subcategories')).body.filter(row => row.name === 'Same label');
    assert.equal(labels.length, 2); assert.deepEqual(labels.map(row => row.category).sort(), [expense.id, income.id].sort());
    assert.equal(await page.locator('.label-group').filter({ hasText: 'Same category (هزینه)' }).count(), 1);
    assert.equal(await page.locator('.label-group').filter({ hasText: 'Same category (درآمد)' }).count(), 1);
    await shot(page, 'categories-distinct-label-groups'); await page.context().close();
  });

  await check('category workflows deleting an unused category confirms dependent labels and budget while keeping financial records', async () => {
    const page = await session('full-owner', 'settings/categories');
    const category = (await api(page, '/custom-categories', 'POST', { type: 'expense', name: 'Category with dependencies' })).body;
    await api(page, '/subcategories', 'POST', { category: category.id, name: 'Dependent label' });
    const originalBudget = (await api(page, '/category-budgets')).body;
    await api(page, '/category-budgets', 'POST', { category: category.id, amount: 1000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const remove = page.getByRole('button', { name: 'حذف ' + category.name, exact: true }); await remove.waitFor();
    const before = (await api(page, '/transactions')).body; let confirmation;
    page.once('dialog', async dialog => { confirmation = dialog.message(); await dialog.dismiss(); }); await remove.click();
    assert.ok(confirmation.includes('برچسب‌ها و بودجهٔ وابسته'));
    assert.equal((await api(page, '/custom-categories')).body.some(row => row.id === category.id), true);
    assert.equal((await api(page, '/subcategories')).body.some(row => row.category === category.id), true);
    page.once('dialog', dialog => dialog.accept()); await remove.click(); await remove.waitFor({ state: 'hidden' });
    assert.equal((await api(page, '/subcategories')).body.some(row => row.category === category.id), false);
    assert.deepEqual((await api(page, '/category-budgets')).body, originalBudget);
    assert.deepEqual((await api(page, '/transactions')).body, before);
    await shot(page, 'categories-after-dependent-delete'); await page.context().close();
  });

  await check('category workflows used categories remain protected even when the cached usage is stale', async () => {
    const page = await session('full-owner', 'settings/categories');
    const category = (await api(page, '/custom-categories', 'POST', { type: 'expense', name: 'Protected category' })).body;
    await page.reload({ waitUntil: 'domcontentloaded' });
    const remove = page.getByRole('button', { name: 'حذف ' + category.name, exact: true }); await remove.waitFor();
    const source = (await api(page, '/transactions')).body.find(row => row.type === 'expense');
    await api(page, '/transactions', 'POST', { member_id: source.member_id, type: 'expense', amount: 100,
      category: category.id, date: source.date, account_id: source.account_id });
    const before = (await api(page, '/transactions')).body;
    page.once('dialog', dialog => dialog.accept()); await remove.click(); await page.locator('.category-save-notice').waitFor();
    assert.equal((await api(page, '/custom-categories')).body.some(row => row.id === category.id), true);
    assert.deepEqual((await api(page, '/transactions')).body, before);
    await page.reload({ waitUntil: 'domcontentloaded' }); await remove.waitFor();
    let deletes = 0; await page.route('**/api/v1/custom-categories/' + category.id, async route => { if (route.request().method() === 'DELETE') deletes++; await route.continue(); });
    await remove.click(); await page.locator('.category-save-notice').waitFor(); assert.equal(deletes, 0);
    await shot(page, 'categories-used-protection'); await page.context().close();
  });

  await check('category workflows removing a used label explains lost links preserves money and cannot recreate it on an unchanged edit', async () => {
    const page = await session('full-owner', 'settings/labels'), label = (await api(page, '/subcategories')).body[0];
    const before = (await api(page, '/transactions')).body, target = before.find(row => row.subcategory_id === label.id); assert.ok(target);
    const remove = page.getByRole('button', { name: 'حذف ' + label.name, exact: true }); let confirmation;
    page.once('dialog', async dialog => { confirmation = dialog.message(); await dialog.dismiss(); }); await remove.click();
    assert.ok(confirmation.includes('تراکنش برداشته شود')); assert.ok(confirmation.includes('مبلغ و حساب تغییر نمی‌کند'));
    assert.deepEqual((await api(page, '/transactions')).body, before);
    let release, deletes = 0; const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/subcategories/' + label.id, async route => { if (route.request().method() === 'DELETE') { deletes++; await pending; } await route.continue(); });
    page.once('dialog', dialog => dialog.accept()); await remove.click();
    await page.waitForFunction(() => document.querySelector('.category-fields')?.disabled === true);
    await remove.evaluate(button => button.click()); assert.equal(await page.getByRole('combobox', { name: 'دستهٔ برچسب', exact: true }).isDisabled(), true);
    release(); await remove.waitFor({ state: 'hidden' }); assert.equal(deletes, 1);
    const after = (await api(page, '/transactions')).body;
    assert.deepEqual(after, before.map(row => ({ ...row, subcategory_id: row.subcategory_id === label.id ? null : row.subcategory_id })));
    await navigate(page, 'transactions'); await page.locator('.tx-item').filter({ hasText: target.note }).click();
    assert.equal(await page.locator('.tx-tag.on').count(), 0);
    await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const stored = (await api(page, '/transactions')).body.find(row => row.id === target.id);
    assert.equal(stored.subcategory_id, null); assert.equal(stored.amount, target.amount); assert.equal(stored.account_id, target.account_id);
    assert.equal((await api(page, '/subcategories')).body.some(row => row.id === label.id), false);
    await shot(page, 'categories-removed-label-history'); await page.context().close();
  });

  await check('category workflows validation and accessible text remain editable in English and empty without changing category values', async () => {
    const page = await session('full-owner', 'settings/labels');
    const name = page.getByRole('textbox', { name: 'نام برچسب جدید', exact: true }), parent = page.getByRole('combobox', { name: 'دستهٔ برچسب', exact: true });
    await name.fill('   '); await page.locator('.chip-adder').evaluate(form => form.requestSubmit()); await page.locator('.category-save-notice').waitFor();
    const entries = [catalog.entries.find(entry => entry.file.endsWith('/LabelsCard.tsx') && entry.text === 'نام برچسب را بنویسید'),
      catalog.entries.find(entry => entry.file.endsWith('/LabelsCard.tsx') && entry.text === 'نام برچسب جدید'),
      catalog.entries.find(entry => entry.file.endsWith('/LabelsCard.tsx') && entry.text === 'دستهٔ برچسب')]; assert.ok(entries.every(Boolean));
    const before = (await api(page, '/subcategories')).body, value = await parent.inputValue();
    for (const texts of [['Enter a label name', 'New label name', 'Label category'], ['', '', ''], ['Enter a label name', 'New label name', 'Label category']]) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), entries.map((entry, index) => ({
        id: entry.id, original: entry.text, text: texts[index], matchingIds: [entry.id], tokens: [],
      })));
      await page.waitForFunction(texts => document.querySelector('.category-save-notice')?.textContent === texts[0]
        && document.querySelector('.chip-adder input')?.getAttribute('aria-label') === texts[1]
        && document.querySelector('.category-fields select')?.getAttribute('aria-label') === texts[2], texts);
      assert.equal(await page.locator('.chip-adder input').inputValue(), '   '); assert.equal(await page.locator('.category-fields select').inputValue(), value);
      assert.deepEqual((await api(page, '/subcategories')).body, before);
    }
    for (const text of ['در حال ساخت دسته…', 'دسته ساخته شد؛ اطلاعات صفحه تازه نشد. دوباره تلاش کنید', 'نام دسته را بنویسید',
      'دسته اضافه شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید', 'دسته حذف شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید',
      'برچسب اضافه شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید', 'برچسب حذف شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید'])
      assert.ok(catalog.entries.some(entry => entry.text === text), text);
    for (const id of ['categories.remove_dependencies', 'categories.remove', 'labels.remove_used', 'labels.remove'])
      assert.ok(catalog.entries.some(entry => entry.id.includes(id)), id);
    await page.context().close();
  });

  await check('category workflows inline loading copy remains editable while saved type and draft fields stay locked', async () => {
    const page = await session(); await page.getByRole('button', { name: 'افزودن تراکنش', exact: true }).click();
    await page.locator('.tx-cat').filter({ hasText: 'دسته جدید' }).click();
    const name = page.getByRole('textbox', { name: 'نام دستهٔ جدید', exact: true }); await name.fill('Category regression: copy');
    let release, writes = 0; const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/custom-categories', async route => { if (route.request().method() === 'POST') { writes++; await pending; } await route.continue(); });
    await name.press('Enter'); await page.getByRole('button', { name: 'در حال ساخت دسته…', exact: true }).waitFor();
    const entry = catalog.entries.find(entry => entry.file.endsWith('/TransactionFormFeature.tsx') && entry.text === 'در حال ساخت دسته…'); assert.ok(entry);
    for (const text of ['Creating category…', '', 'Creating category…']) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), [{ id: entry.id, original: entry.text, text, matchingIds: [entry.id], tokens: [] }]);
      await page.waitForFunction(text => document.querySelector('.tx-add-cat button')?.textContent === text, text);
      assert.equal(await page.locator('.tx-add-cat button').isDisabled(), true); assert.equal(await name.inputValue(), 'Category regression: copy'); assert.equal(writes, 1);
    }
    release(); await page.locator('.tx-add-cat').waitFor({ state: 'hidden' });
    assert.equal((await api(page, '/custom-categories')).body.filter(row => row.name === 'Category regression: copy').length, 1);
    await page.context().close();
  });

  await check('category workflows empty states and settings layouts fit long names mobile desktop and both themes', async () => {
    const empty = await session('empty-owner', 'settings/categories');
    assert.ok((await empty.locator('.content').innerText()).includes('هنوز دستهٔ دلخواهی نساخته‌اید')); await empty.context().close();
    for (const route of ['settings/categories', 'settings/labels']) {
      const page = await session('full-owner', route, { width: 360, height: 780 });
      const category = (await api(page, '/custom-categories', 'POST', { type: 'expense', name: 'W'.repeat(30) })).body;
      await api(page, '/subcategories', 'POST', { category: category.id, name: 'W'.repeat(30) });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'حذف ' + 'W'.repeat(30), exact: true }).waitFor();
      for (const width of [360, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, route + ' ' + width);
        await shot(page, route.replace('/', '-') + '-' + width);
      }
      await page.setViewportSize({ width: 360, height: 780 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        const button = page.locator('.chip-adder button'); const colors = await button.evaluate(button => [getComputedStyle(button).color, getComputedStyle(button).backgroundColor]);
        assert.ok(contrastRatio(...colors) >= 4.5, route + ' ' + theme);
        const box = await button.boundingBox(); assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= 360);
        const removal = await page.getByRole('button', { name: 'حذف ' + 'W'.repeat(30), exact: true }).boundingBox();
        assert.ok(removal.width >= 44 && removal.height >= 44 && removal.x >= 0 && removal.x + removal.width <= 360);
        await shot(page, route.replace('/', '-') + '-' + theme);
      }
      await page.context().close();
    }
  });
  await check('category workflows label search finds stored names and deleted labels no longer match without removing transactions', async () => {
    const page = await session('full-owner', 'transactions'), source = (await api(page, '/transactions')).body.find(row => row.type === 'expense');
    const label = (await api(page, '/subcategories', 'POST', { category: 'food', name: 'كيك مراسم' })).body;
    const transaction = (await api(page, '/transactions', 'POST', { member_id: source.member_id, type: 'expense', amount: 100,
      category: 'food', date: source.date, account_id: source.account_id, subcategory_id: label.id, note: 'Label search regression' })).body;
    await page.reload({ waitUntil: 'domcontentloaded' }); const search = page.getByRole('searchbox', { name: 'جست‌وجو در تراکنش‌ها', exact: true });
    await search.fill('کیک مراسم'); await page.waitForFunction(() => document.querySelectorAll('.tx-item').length === 1);
    assert.ok((await page.locator('.tx-item').innerText()).includes('Label search regression'));
    await api(page, '/subcategories/' + label.id, 'DELETE'); await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.tx-item').filter({ hasText: 'Label search regression' }).waitFor(); await search.fill('کیک مراسم');
    await page.waitForFunction(() => document.querySelectorAll('.tx-item').length === 0);
    const stored = (await api(page, '/transactions')).body.find(row => row.id === transaction.id);
    assert.equal(stored.amount, 100); assert.equal(stored.account_id, source.account_id); assert.equal(stored.subcategory_id, null);
    await page.context().close();
  });

  await check('category workflows losing a selected custom parent requires a new selection instead of saving under another category', async () => {
    const page = await session('full-owner', 'settings/labels');
    const category = (await api(page, '/custom-categories', 'POST', { type: 'expense', name: 'Temporary parent' })).body;
    await page.reload({ waitUntil: 'domcontentloaded' });
    const parent = page.getByRole('combobox', { name: 'دستهٔ برچسب', exact: true }), name = page.getByRole('textbox', { name: 'نام برچسب جدید', exact: true });
    await parent.locator('option[value="' + category.id + '"]').waitFor({ state: 'attached' }); await parent.selectOption(category.id); await name.fill('Keep this draft');
    await api(page, '/custom-categories/' + category.id, 'DELETE');
    const existing = (await api(page, '/subcategories')).body[0]; page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'حذف ' + existing.name, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.category-fields select')?.value === '' && document.querySelector('.category-fields')?.disabled === false);
    await name.press('Enter'); await page.locator('.category-save-notice').waitFor();
    assert.equal(await name.inputValue(), 'Keep this draft'); assert.equal((await api(page, '/subcategories')).body.some(row => row.name === 'Keep this draft'), false);
    assert.equal(await page.locator('.category-save-notice').innerText(), 'دستهٔ برچسب را انتخاب کنید');
    await parent.selectOption('food'); await name.press('Enter');
    await page.waitForFunction(() => document.querySelector('.chip-adder input')?.value === '' && document.querySelector('.category-fields')?.disabled === false);
    assert.equal((await api(page, '/subcategories')).body.find(row => row.name === 'Keep this draft').category, 'food'); await page.context().close();
  });
  async function createBill(page, title, amount) {
    await page.getByRole('button', { name: 'ثبت قبض جدید', exact: true }).click();
    const sheet = page.locator('.bill-form-sheet');
    await sheet.getByRole('textbox', { name: 'عنوان قبض', exact: true }).fill(title);
    await sheet.locator('.num-input').fill(String(amount));
    await sheet.getByRole('button', { name: 'ثبت قبض', exact: true }).click();
    await sheet.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('.bill-page .btn-primary')?.disabled === false);
    return (await api(page, '/bills')).body.find(bill => bill.title === title);
  }
  async function openBillPay(page, title, accountId = '') {
    const row = page.locator('.bill-item').filter({ hasText: title });
    await row.locator('.bill-pay').click();
    const sheet = page.locator('.bill-pay-sheet');
    await sheet.getByRole('combobox', { name: 'حساب پرداخت قبض', exact: true }).selectOption(accountId);
    return sheet;
  }

  await check('bill workflows create edit pay and reverse preserve one linked expense and account totals', async () => {
    const page = await session('full-owner', 'bills');
    const txs = (await api(page, '/transactions')).body, accounts = (await api(page, '/accounts')).body;
    const account = accounts[0], balance = await accountBalance(page, account.id);
    const bill = await createBill(page, 'Bill regression: create', 1200.25);
    assert.ok(bill); assert.equal(bill.amount, 1200.25); assert.equal(bill.state, 'unpaid');
    assert.deepEqual((await api(page, '/transactions')).body, txs);
    const row = page.locator('.bill-item').filter({ hasText: bill.title });
    await row.focus(); await row.press('Enter');
    const form = page.locator('.bill-form-sheet'); assert.equal(numeric(await form.locator('.num-input').inputValue()), 1200.25);
    await form.getByRole('textbox', { name: 'عنوان قبض', exact: true }).fill('Bill regression: edited');
    await form.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click(); await form.waitFor({ state: 'hidden' });
    const pay = await openBillPay(page, 'Bill regression: edited', account.id);
    await pay.getByRole('button', { name: 'پرداخت شد', exact: true }).focus();
    await pay.getByRole('button', { name: 'پرداخت شد', exact: true }).press('Enter');
    await pay.waitFor({ state: 'hidden' }); await page.locator('.bill-item').filter({ hasText: 'Bill regression: edited' }).locator('.bill-undo').waitFor();
    const paid = (await api(page, '/bills')).body.find(item => item.id === bill.id);
    const transaction = (await api(page, '/transactions')).body.find(item => item.id === paid.transaction_id);
    assert.equal(transaction.amount, 1200.25); assert.equal(transaction.account_id, account.id); assert.equal(transaction.category, 'bills');
    assert.equal((await api(page, '/transactions')).body.length, txs.length + 1); assert.equal(await accountBalance(page, account.id), balance - 1200.25);
    page.once('dialog', dialog => { assert.ok(dialog.message().includes('تراکنش')); return dialog.accept(); });
    await page.locator('.bill-item').filter({ hasText: 'Bill regression: edited' }).locator('.bill-undo').click();
    await page.locator('.bill-item').filter({ hasText: 'Bill regression: edited' }).locator('.bill-pay').waitFor();
    assert.deepEqual((await api(page, '/transactions')).body, txs); assert.equal(await accountBalance(page, account.id), balance);
    await shot(page, 'bills-restored-ledger'); await page.context().close();
  });

  await check('bill workflows amount typing preserves caret invalid input identifiers and fractional currency edits', async () => {
    const page = await session('full-owner', 'bills');
    await page.getByRole('button', { name: 'ثبت قبض جدید', exact: true }).click(); const sheet = page.locator('.bill-form-sheet');
    const amount = sheet.getByRole('textbox', { name: 'مبلغ قبض', exact: true });
    await sheet.getByRole('textbox', { name: 'عنوان قبض', exact: true }).fill('Bill regression: amounts');
    await amount.fill('1234'); await amount.evaluate(input => input.setSelectionRange(1, 1)); await amount.press('9');
    assert.equal(await amount.inputValue(), '۱۹,۲۳۴'); assert.equal(await amount.evaluate(input => input.selectionStart), 2);
    const before = (await api(page, '/bills')).body;
    for (const value of ['12abc5', '-1200', '۱۲÷۰', '۱۲+', '0', '10000000000000']) {
      await amount.fill(value); await sheet.getByRole('button', { name: 'ثبت قبض', exact: true }).click();
      await sheet.locator('.bill-form-error').waitFor(); assert.deepEqual((await api(page, '/bills')).body, before);
      assert.ok(await amount.inputValue());
    }
    await amount.fill('1200.25');
    await sheet.getByRole('textbox', { name: 'شناسهٔ قبض', exact: true }).fill('001a');
    await sheet.getByRole('button', { name: 'ثبت قبض', exact: true }).click(); await sheet.locator('.bill-form-error').waitFor();
    assert.deepEqual((await api(page, '/bills')).body, before);
    await sheet.getByRole('textbox', { name: 'شناسهٔ قبض', exact: true }).fill('۰۰۱۲۳');
    await sheet.getByRole('textbox', { name: 'شناسهٔ پرداخت', exact: true }).fill('٠٠٤٥٦');
    await sheet.getByRole('textbox', { name: 'عنوان قبض', exact: true }).press('Enter'); await sheet.waitFor({ state: 'hidden' });
    const bill = (await api(page, '/bills')).body.find(item => item.title === 'Bill regression: amounts');
    assert.equal(bill.bill_no, '00123'); assert.equal(bill.payment_no, '00456'); assert.equal(bill.amount, 1200.25);
    await api(page, '/members/me/currency', 'POST', { currency: 'ریال' }); await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.bill-item').filter({ hasText: bill.title }).click();
    assert.equal(numeric(await sheet.locator('.num-input').inputValue()), 12002.5);
    await sheet.getByRole('textbox', { name: 'یادداشت قبض', exact: true }).fill('Preserve the amount');
    await sheet.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    assert.equal((await api(page, '/bills')).body.find(item => item.id === bill.id).amount, 1200.25);
    await page.context().close();
  });

  await check('bill workflows saving locks fields closing switching and repeated writes through refresh', async () => {
    const page = await session('full-owner', 'bills');
    await page.getByRole('button', { name: 'ثبت قبض جدید', exact: true }).click(); const sheet = page.locator('.bill-form-sheet');
    await sheet.getByRole('textbox', { name: 'عنوان قبض', exact: true }).fill('Bill regression: locked'); await sheet.locator('.num-input').fill('3000');
    let releaseWrite, releaseRefresh, writes = 0;
    const writeGate = new Promise(resolve => { releaseWrite = resolve; }), refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
    await page.route('**/api/v1/bills', async route => {
      if (route.request().method() === 'POST') { writes++; await writeGate; }
      else if (writes) await refreshGate;
      await route.continue();
    });
    await sheet.locator('button[type=submit]').evaluate(button => { button.click(); button.click(); });
    await sheet.getByRole('button', { name: 'در حال ذخیره…', exact: true }).waitFor(); assert.equal(writes, 1);
    assert.equal(await sheet.locator('fieldset').evaluate(fieldset => fieldset.disabled), true);
    const loading = catalog.entries.find(entry => entry.file.endsWith('/BillsPage.tsx') && entry.text === 'در حال ذخیره…'); assert.ok(loading);
    for (const text of ['Saving…', '', 'Saving…']) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), [{ id: loading.id, original: loading.text, text, matchingIds: [loading.id], tokens: [] }]);
      await page.waitForFunction(text => document.querySelector('.bill-form-sheet button[type=submit]')?.textContent === text, text);
      assert.equal(await sheet.locator('button[type=submit]').isDisabled(), true); assert.equal(writes, 1);
    }
    await page.keyboard.press('Escape'); await page.locator('.modal-overlay').last().click({ position: { x: 2, y: 2 } });
    await page.evaluate(() => history.back()); assert.equal(await sheet.isVisible(), true);
    await page.locator('.bill-item').first().evaluate(row => row.click()); assert.equal(await sheet.getByRole('textbox', { name: 'عنوان قبض', exact: true }).inputValue(), 'Bill regression: locked');
    releaseWrite(); await sheet.waitFor({ state: 'hidden' }); assert.equal(await page.getByRole('button', { name: 'ثبت قبض جدید', exact: true }).isDisabled(), true);
    releaseRefresh(); await page.waitForFunction(() => document.querySelector('.bill-page .btn-primary')?.disabled === false);
    assert.equal(writes, 1); assert.equal((await api(page, '/bills')).body.filter(item => item.title === 'Bill regression: locked').length, 1);
    await page.context().close();
  });

  await check('bill workflows overspending requires compact consent and refreshed balances require confirmation again', async () => {
    const page = await session('full-owner', 'bills'), wallet = (await api(page, '/accounts')).body.find(item => item.kind === 'wallet');
    const available = await accountBalance(page, wallet.id), before = (await api(page, '/transactions')).body;
    const bill = await createBill(page, 'Bill regression: overdraft', available + 1000);
    const sheet = await openBillPay(page, bill.title, wallet.id); await sheet.getByRole('button', { name: 'پرداخت شد', exact: true }).click();
    const popup = page.getByRole('alertdialog'); await popup.waitFor(); assert.equal(numeric(await popup.locator('.tx-balance-remaining').innerText()), -1000);
    await popup.focus(); await popup.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'تأیید و ثبت');
    await popup.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'تغییر حساب');
    const box = await popup.boundingBox(); assert.ok(box.width <= 320 && box.height < 340);
    assert.deepEqual((await api(page, '/transactions')).body, before);
    await page.keyboard.press('Escape'); await popup.waitFor({ state: 'hidden' }); assert.equal(await sheet.isVisible(), true);
    await sheet.getByRole('button', { name: 'پرداخت شد', exact: true }).click(); await popup.waitFor();
    await page.locator('.tx-balance-overlay').click({ position: { x: 1, y: 1 } }); await popup.waitFor({ state: 'hidden' });
    await sheet.getByRole('button', { name: 'پرداخت شد', exact: true }).click(); await popup.waitFor();
    await page.evaluate(() => history.back()); await popup.waitFor({ state: 'hidden' }); assert.equal(await sheet.isVisible(), true);
    await sheet.getByRole('button', { name: 'پرداخت شد', exact: true }).click(); await popup.waitFor();
    await api(page, '/accounts/' + wallet.id, 'PATCH', { initial_balance: wallet.initial_balance - 1000 });
    await popup.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tx-balance-remaining')?.textContent.includes('۲,۰۰۰'));
    assert.deepEqual((await api(page, '/transactions')).body, before);
    await shot(page, 'bills-shortage-popup', false);
    await popup.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    assert.equal(await accountBalance(page, wallet.id), -2000); assert.equal((await api(page, '/transactions')).body.length, before.length + 1);
    await page.reload({ waitUntil: 'domcontentloaded' }); assert.equal(await accountBalance(page, wallet.id), -2000);
    await navigate(page, 'accounts'); await page.locator('.wallet-card').filter({ hasText: wallet.title }).locator('.account-negative-notice').waitFor();
    await page.context().close();
  });

  await check('bill workflows balance checks and payment lock drafts and failures keep a retryable unpaid bill', async () => {
    const page = await session('full-owner', 'bills'), account = (await api(page, '/accounts')).body[0];
    const bill = await createBill(page, 'Bill regression: pay retry', 2500), before = (await api(page, '/transactions')).body;
    const sheet = await openBillPay(page, bill.title, account.id);
    let release, reads = 0, pays = 0, failPay = true;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/accounts', async route => { if (route.request().method() === 'GET') { reads++; await gate; } await route.continue(); });
    await page.route('**/api/v1/bills/' + bill.id + '/pay', async route => {
      pays++; if (failPay) { failPay = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Bill test payment failed' } }) }); }
      else await route.continue();
    });
    await sheet.locator('.btn-primary').evaluate(button => { button.click(); button.click(); });
    await sheet.getByRole('button', { name: 'در حال بررسی…', exact: true }).waitFor(); assert.equal(reads, 1);
    await page.keyboard.press('Escape'); await page.evaluate(() => history.back()); assert.equal(await sheet.isVisible(), true);
    assert.equal(await sheet.locator('fieldset').evaluate(fieldset => fieldset.disabled), true); assert.equal(await sheet.locator('select').inputValue(), account.id);
    release(); await sheet.locator('.bill-pay-error').waitFor(); assert.equal(pays, 1);
    assert.deepEqual((await api(page, '/transactions')).body, before); assert.equal((await api(page, '/bills')).body.find(item => item.id === bill.id).state, 'unpaid');
    await sheet.getByRole('button', { name: 'پرداخت شد', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    assert.equal(pays, 2); assert.equal((await api(page, '/transactions')).body.length, before.length + 1); await page.context().close();
  });

  await check('bill workflows missing accounts failed verification and changed bills cannot bypass review', async () => {
    const page = await session('full-owner', 'bills'), wallet = (await api(page, '/accounts')).body.find(item => item.kind === 'wallet');
    const bill = await createBill(page, 'Bill regression: changes', 1000), before = (await api(page, '/transactions')).body;
    const sheet = await openBillPay(page, bill.title, wallet.id);
    await page.route('**/api/v1/transactions', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Read failed' } }) }));
    await sheet.getByRole('button', { name: 'پرداخت شد', exact: true }).click(); await sheet.locator('.bill-pay-error').waitFor();
    assert.ok((await sheet.locator('.bill-pay-error').innerText()).includes('بررسی')); await page.unroute('**/api/v1/transactions');
    await api(page, '/accounts/' + wallet.id, 'DELETE'); await sheet.getByRole('button', { name: 'پرداخت شد', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.bill-pay-error')?.textContent.includes('حساب انتخاب‌شده'));
    assert.equal((await api(page, '/transactions')).body.length, before.length);
    await sheet.locator('select').selectOption('');
    await api(page, '/bills/' + bill.id, 'PATCH', { kind: bill.kind, title: bill.title, amount: 2000, due_date: bill.due_date });
    await sheet.getByRole('button', { name: 'پرداخت شد', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.bill-pay-error')?.textContent.includes('قبض تغییر کرده'));
    assert.equal((await api(page, '/transactions')).body.length, before.length);
    await sheet.getByRole('button', { name: 'پرداخت شد', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    const paid = (await api(page, '/bills')).body.find(item => item.id === bill.id), tx = (await api(page, '/transactions')).body.find(item => item.id === paid.transaction_id);
    assert.equal(tx.amount, 2000); assert.equal(tx.account_id, null); await page.context().close();
  });

  await check('bill workflows successful writes followed by refresh failure disclose success and retry only reads', async () => {
    const page = await session('full-owner', 'bills'), account = (await api(page, '/accounts')).body[0];
    const bill = await createBill(page, 'Bill regression: refresh', 1700), before = (await api(page, '/transactions')).body;
    const sheet = await openBillPay(page, bill.title, account.id); let pays = 0, failReads = false;
    await page.route('**/api/v1/bills/' + bill.id + '/pay', async route => { pays++; const response = await route.fetch(); failReads = true; await route.fulfill({ response }); });
    await page.route('**/api/v1/bills', async route => {
      if (failReads && route.request().method() === 'GET') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Bill list unavailable' } }) });
      else await route.continue();
    });
    await sheet.getByRole('button', { name: 'پرداخت شد', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
    await page.locator('.bill-read-error').waitFor(); assert.ok((await page.locator('.bill-notice').innerText()).includes('پرداخت ثبت شد'));
    assert.equal(await page.getByRole('button', { name: 'ثبت قبض جدید', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('.bill-item').filter({ hasText: bill.title }).locator('.bill-pay').isDisabled(), true);
    assert.equal(pays, 1); assert.equal((await api(page, '/transactions')).body.length, before.length + 1);
    failReads = false; await page.getByRole('button', { name: 'دریافت دوباره', exact: true }).click();
    await page.locator('.bill-item').filter({ hasText: bill.title }).locator('.bill-undo').waitFor(); assert.equal(pays, 1);
    assert.equal((await api(page, '/transactions')).body.length, before.length + 1); await page.context().close();
  });

  await check('bill workflows empty loading and read errors stay distinct and cancellation does not create money', async () => {
    const empty = await session('empty-owner', 'bills'); await empty.getByText('هنوز قبضی ثبت نشده.', { exact: false }).waitFor();
    await shot(empty, 'bills-empty'); await empty.context().close();
    const page = await session('full-owner', 'bills'), txs = (await api(page, '/transactions')).body;
    const bill = await createBill(page, 'Bill regression: cancelled', 5000);
    page.once('dialog', dialog => { assert.ok(dialog.message().includes('هزینه‌ای ثبت نمی‌شود')); return dialog.accept(); });
    await page.locator('.bill-item').filter({ hasText: bill.title }).locator('.bill-skip').click();
    await page.locator('.bill-item.is-cancelled').filter({ hasText: bill.title }).waitFor(); assert.deepEqual((await api(page, '/transactions')).body, txs);
    await page.route('**/api/v1/bills', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Bill read failed' } }) }));
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('.bill-read-error').waitFor();
    assert.equal(await page.getByText('هنوز قبضی ثبت نشده.', { exact: false }).count(), 0);
    await page.unroute('**/api/v1/bills'); await page.getByRole('button', { name: 'دریافت دوباره', exact: true }).click();
    await page.locator('.bill-item').first().waitFor();
    page.once('dialog', dialog => dialog.accept()); await page.locator('.bill-item').filter({ hasText: bill.title }).locator('.bill-del').click();
    await page.locator('.bill-item').filter({ hasText: bill.title }).waitFor({ state: 'hidden' }); assert.deepEqual((await api(page, '/transactions')).body, txs);
    await page.context().close();
  });

  await check('bill workflows unpaid today and past dates and undo permissions retain backend meaning', async () => {
    for (const scenario of ['full-owner', 'full-admin', 'full-member']) {
      const page = await session(scenario, 'bills');
      const bill = (await api(page, '/bills')).body.find(item => item.state === 'paid');
      const owner = (await api(page, '/auth/members')).body.find(item => item.role === 'owner');
      // Supply a foreign payer in the read response; fixture tests cover the server permission check.
      await page.route('**/api/v1/bills', async route => {
        const response = await route.fetch(), rows = await response.json();
        if (route.request().method() === 'GET') for (const item of rows) if (item.id === bill.id) item.paid_by_member_id = owner.id;
        await route.fulfill({ response, json: rows });
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      const row = page.locator('.bill-item').filter({ hasText: bill.title });
      await row.waitFor();
      assert.equal(await row.locator('.bill-undo').count(), scenario === 'full-member' ? 0 : 1);
      const created = await createBill(page, 'Bill regression: due today', 1000);
      assert.equal(await page.locator('.bill-item').filter({ hasText: created.title }).getAttribute('class'), 'bill-item');
      assert.ok(await page.locator('.bill-item.is-overdue').count());
      await page.context().close();
    }
  });

  await check('bill workflows editable validation loading warning and accessible copy preserve stored values', async () => {
    const page = await session('full-owner', 'bills'); await page.getByRole('button', { name: 'ثبت قبض جدید', exact: true }).click();
    const sheet = page.locator('.bill-form-sheet'); await sheet.getByRole('textbox', { name: 'عنوان قبض', exact: true }).fill('Bill regression: copy');
    await sheet.locator('.num-input').fill('12abc'); await sheet.getByRole('button', { name: 'ثبت قبض', exact: true }).click(); await sheet.locator('.bill-form-error').waitFor();
    const entries = [catalog.entries.find(entry => entry.file.endsWith('/BillsPage.tsx') && entry.text === 'مبلغ قبض را درست وارد کنید'),
      catalog.entries.find(entry => entry.file.endsWith('/BillsPage.tsx') && entry.text === 'مبلغ قبض')]; assert.ok(entries.every(Boolean));
    const before = (await api(page, '/bills')).body;
    for (const texts of [['Enter a valid amount', 'Bill amount'], ['', ''], ['Enter a valid amount', 'Bill amount']]) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), entries.map((entry, index) => ({ id: entry.id, original: entry.text, text: texts[index], matchingIds: [entry.id], tokens: [] })));
      await page.waitForFunction(texts => document.querySelector('.bill-form-error')?.textContent === texts[0] && document.querySelector('.bill-form-sheet .num-input')?.getAttribute('aria-label') === texts[1], texts);
      assert.equal(await sheet.locator('.num-input').inputValue(), '۱۲abc'); assert.equal(await sheet.locator('select').inputValue(), 'electricity');
      assert.deepEqual((await api(page, '/bills')).body, before);
    }
    for (const text of ['در حال دریافت قبوض…', 'دریافت قبوض ممکن نشد؛ دوباره تلاش کنید.', 'در حال بررسی…', 'در حال ثبت…', 'در حال ذخیره…',
      'با ثبت این پرداخت، موجودی حساب منفی می‌شود.', 'حساب انتخاب‌شده در دسترس نیست؛ حساب دیگری انتخاب کنید', 'قبض تغییر کرده؛ مبلغ تازه را بررسی و دوباره تأیید کنید',
      'قبض ذخیره شد؛ اطلاعات صفحه تازه نشد. دوباره دریافت کنید', 'پرداخت ثبت شد؛ اطلاعات صفحه تازه نشد. دوباره دریافت کنید'])
      assert.ok(catalog.entries.some(entry => entry.file.endsWith('/BillsPage.tsx') && entry.text === text), text);
    await sheet.getByRole('button', { name: 'انصراف', exact: true }).click();
    const wallet = (await api(page, '/accounts')).body.find(item => item.kind === 'wallet');
    const bill = await createBill(page, 'Bill regression: copy popup', await accountBalance(page, wallet.id) + 1000);
    const pay = await openBillPay(page, bill.title, wallet.id); await pay.getByRole('button', { name: 'پرداخت شد', exact: true }).click(); await page.getByRole('alertdialog').waitFor();
    const warning = catalog.entries.find(entry => entry.file.endsWith('/BillsPage.tsx') && entry.text === 'با ثبت این پرداخت، موجودی حساب منفی می‌شود.'); assert.ok(warning);
    for (const text of ['This payment makes the balance negative.', '', 'This payment makes the balance negative.']) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), [{ id: warning.id, original: warning.text, text, matchingIds: [warning.id], tokens: [] }]);
      await page.waitForFunction(text => document.querySelector('.tx-balance-warning > p')?.textContent === text, text);
      assert.equal(await pay.locator('select').inputValue(), wallet.id); assert.equal(numeric(await page.locator('.tx-balance-remaining').innerText()), -1000);
    }
    await page.context().close();
  });

  await check('bill workflows mobile tablet desktop layouts long names themes contrast and touch targets', async () => {
    const page = await session('full-owner', 'bills'), bill = await createBill(page, 'W'.repeat(120), 1234567890.25);
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const row = page.locator('.bill-item').filter({ hasText: bill.title });
        for (const button of await page.locator('.bill-actions button').all()) {
          const box = await button.boundingBox(); assert.ok(box.height >= 44 && box.width >= 44);
          if (!(await button.getAttribute('class')).includes('bill-del')) {
            const colors = await button.evaluate(button => ({ foreground: getComputedStyle(button).color, background: getComputedStyle(button.closest('.bill-item')).backgroundColor }));
            assert.ok(contrastRatio(colors.foreground, colors.background) >= 4.5, 'Bill action text contrast');
          }
        }
        const colors = await page.locator('.bill-page .btn-primary').evaluate(button => ({ foreground: getComputedStyle(button).color, background: getComputedStyle(button).backgroundColor }));
        assert.ok(contrastRatio(colors.foreground, colors.background) >= 4.5);
        await shot(page, 'bills-' + width + '-' + theme);
      }
    }
    await page.setViewportSize({ width: 360, height: 800 }); await page.locator('.bill-item').filter({ hasText: bill.title }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await shot(page, 'bills-form-mobile'); await page.context().close();
  });
  await check('bill workflows payment writing and refresh remain locked and loading read copy stays editable', async () => {
    const page = await session('full-owner', 'bills'), account = (await api(page, '/accounts')).body[0];
    const bill = await createBill(page, 'Bill regression: payment locked', 1500), before = (await api(page, '/transactions')).body;
    const sheet = await openBillPay(page, bill.title, account.id);
    let releasePay, releaseRefresh, pays = 0, refreshing = false;
    const payGate = new Promise(resolve => { releasePay = resolve; }), refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
    await page.route('**/api/v1/bills/' + bill.id + '/pay', async route => {
      pays++; await payGate; const response = await route.fetch(); refreshing = true; await route.fulfill({ response });
    });
    await page.route('**/api/v1/bills', async route => { if (refreshing) await refreshGate; await route.continue(); });
    await sheet.getByRole('button', { name: 'پرداخت شد', exact: true }).click();
    await sheet.getByRole('button', { name: 'در حال ثبت…', exact: true }).waitFor(); assert.equal(pays, 1);
    await sheet.locator('.btn-primary').evaluate(button => { button.click(); button.click(); });
    await page.keyboard.press('Escape'); await page.locator('.modal-overlay').last().click({ position: { x: 1, y: 1 } });
    assert.equal(await sheet.isVisible(), true); assert.equal(await sheet.locator('select').isDisabled(), true); assert.equal(pays, 1);
    releasePay(); await sheet.waitFor({ state: 'hidden' });
    await page.getByText('در حال دریافت قبوض…', { exact: true }).waitFor();
    const loading = catalog.entries.find(entry => entry.file.endsWith('/BillsPage.tsx') && entry.text === 'در حال دریافت قبوض…'); assert.ok(loading);
    for (const text of ['Loading bills…', '', 'Loading bills…']) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), [{ id: loading.id, original: loading.text, text, matchingIds: [loading.id], tokens: [] }]);
      await page.waitForFunction(text => [...document.querySelectorAll('.bill-page .content > p[role=status]')].some(element => element.textContent === text), text);
      assert.equal(await page.getByRole('button', { name: 'ثبت قبض جدید', exact: true }).isDisabled(), true); assert.equal(pays, 1);
    }
    releaseRefresh(); await page.waitForFunction(() => document.querySelector('.bill-page .btn-primary')?.disabled === false);
    assert.equal(pays, 1); assert.equal((await api(page, '/transactions')).body.length, before.length + 1); await page.context().close();
  });
  await check('bill workflows read failures inside open forms preserve the draft and offer a read only retry', async () => {
    const page = await session('full-owner', 'bills'), bills = (await api(page, '/bills')).body, before = (await api(page, '/transactions')).body;
    const failure = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Bill read interrupted' } }) });
    await page.getByRole('button', { name: 'ثبت قبض جدید', exact: true }).click();
    const sheet = page.locator('.bill-form-sheet'); await sheet.getByRole('textbox', { name: 'عنوان قبض', exact: true }).fill('Keep this unsaved bill'); await sheet.locator('.num-input').fill('1200');
    await page.route('**/api/v1/bills', failure); await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await sheet.locator('.bill-read-error').waitFor(); assert.equal(await sheet.locator('button[type=submit]').isDisabled(), true);
    assert.equal(await sheet.getByRole('textbox', { name: 'عنوان قبض', exact: true }).inputValue(), 'Keep this unsaved bill'); assert.equal(await sheet.locator('.num-input').inputValue(), '۱,۲۰۰');
    await page.unroute('**/api/v1/bills'); await sheet.getByRole('button', { name: 'دریافت دوباره', exact: true }).click();
    await sheet.locator('.bill-read-error').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('.bill-form-sheet button[type=submit]')?.disabled === false);
    assert.equal(await sheet.getByRole('textbox', { name: 'عنوان قبض', exact: true }).inputValue(), 'Keep this unsaved bill');
    await sheet.getByRole('button', { name: 'انصراف', exact: true }).click();
    const account = (await api(page, '/accounts')).body[0], bill = bills.find(item => item.state === 'unpaid');
    const pay = await openBillPay(page, bill.title, account.id);
    await page.route('**/api/v1/bills', failure); await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await pay.locator('.bill-read-error').waitFor(); assert.equal(await pay.locator('.btn-primary').isDisabled(), true);
    assert.equal(await pay.locator('select').inputValue(), account.id);
    await page.unroute('**/api/v1/bills'); await pay.getByRole('button', { name: 'دریافت دوباره', exact: true }).click();
    await pay.locator('.bill-read-error').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('.bill-pay-sheet .btn-primary')?.disabled === false);
    assert.equal(await pay.locator('select').inputValue(), account.id);
    assert.deepEqual((await api(page, '/bills')).body, bills); assert.deepEqual((await api(page, '/transactions')).body, before);
    await page.context().close();
  });
  async function scheduledForm(page, note = 'Recurring regression: form', amount = '1200') {
    await page.getByRole('button', { name: 'افزودن تراکنش تکرارشونده', exact: true }).click();
    const sheet = page.locator('.scheduled-form-sheet');
    await sheet.locator('.num-input').fill(amount);
    await sheet.getByRole('textbox', { name: 'توضیح تراکنش تکرارشونده', exact: true }).fill(note);
    await sheet.getByRole('button', { name: 'تاریخ پایان تکرار', exact: true }).click();
    await page.getByRole('button', { name: 'ماه بعد', exact: true }).click(); await page.getByRole('button', { name: 'ماه بعد', exact: true }).click();
    await page.locator('button.dp-day').getByText('۱', { exact: true }).first().click();
    return sheet;
  }
  async function dueSeed(page, note = 'Recurring regression: due', options = {}) {
    const rows = (await api(page, '/transactions')).body, source = rows.find(row => row.category === 'food');
    const dateOffset = offset => { const value = new Date(source.date + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };
    const response = await api(page, '/transactions', 'POST', { member_id: source.member_id, type: 'expense', amount: 1700, category: 'bills',
      date: dateOffset(-7), account_id: source.account_id, note, repeat: 'weekly', repeat_end: dateOffset(60), ...options });
    assert.equal(response.status, 201); await page.reload({ waitUntil: 'domcontentloaded' }); await navigate(page, 'dashboard');
    await page.locator('.due-item').filter({ hasText: note }).first().waitFor(); return response.body;
  }
  async function openDue(page, note) {
    await page.locator('.due-item').filter({ hasText: note }).getByRole('button', { name: 'ثبت این نوبت', exact: true }).click();
    await page.locator('.tx-sheet').waitFor();
    await page.waitForFunction(() => document.querySelector('.tx-fields')?.disabled === false || document.querySelector('.tx-occurrence-status'));
  }

  await check('recurring workflows creation counts the first expense once and future occurrences require confirmation', async () => {
    const page = await session('full-owner', 'settings/scheduled'), before = (await api(page, '/transactions')).body;
    const accounts = (await api(page, '/accounts')).body, balances = await Promise.all(accounts.map(account => accountBalance(page, account.id)));
    const sheet = await scheduledForm(page, 'Recurring regression: first entry', '1200.25');
    await sheet.getByRole('textbox', { name: 'توضیح تراکنش تکرارشونده', exact: true }).press('Enter'); await sheet.waitFor({ state: 'hidden' });
    await page.locator('.scheduled-row').filter({ hasText: 'Recurring regression: first entry' }).waitFor();
    const after = (await api(page, '/transactions')).body, tx = after.find(row => row.note === 'Recurring regression: first entry');
    assert.equal(after.length, before.length + 1); assert.equal(tx.amount, 1200.25); assert.equal(tx.type, 'expense'); assert.equal(tx.repeat, 'monthly');
    assert.equal(tx.account_id, null); assert.deepEqual(tx.handled_occurrences, []);
    assert.deepEqual(await Promise.all(accounts.map(account => accountBalance(page, account.id))), balances);
    await shot(page, 'recurring-created'); await page.context().close();
  });

  await check('recurring workflows invalid amounts dates and notes preserve the unsaved draft', async () => {
    const page = await session('full-owner', 'settings/scheduled'); const sheet = await scheduledForm(page, 'Keep this recurrence');
    const amount = sheet.locator('.num-input'), before = (await api(page, '/transactions')).body;
    await amount.fill('1234'); await amount.evaluate(input => input.setSelectionRange(1, 1)); await amount.press('9');
    assert.equal(await amount.inputValue(), '۱۹,۲۳۴'); assert.equal(await amount.evaluate(input => input.selectionStart), 2);
    for (const value of ['12abc5', '-1200', '12+', '12/0', '0', '1000000000000']) {
      await amount.fill(value); await sheet.getByRole('button', { name: 'ثبت', exact: true }).click(); await sheet.locator('.scheduled-form-error').waitFor();
      assert.deepEqual((await api(page, '/transactions')).body, before);
    }
    await amount.fill('1200'); await sheet.getByRole('textbox', { name: 'توضیح تراکنش تکرارشونده', exact: true }).fill('   ');
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click(); await sheet.locator('.scheduled-form-error').waitFor();
    assert.deepEqual((await api(page, '/transactions')).body, before);
    await sheet.getByRole('textbox', { name: 'توضیح تراکنش تکرارشونده', exact: true }).fill('Keep this recurrence');
    await sheet.getByRole('button', { name: 'تاریخ پایان تکرار', exact: true }).click();
    await page.getByRole('button', { name: 'ماه قبل', exact: true }).click(); await page.getByRole('button', { name: 'ماه قبل', exact: true }).click(); await page.getByRole('button', { name: 'ماه قبل', exact: true }).click();
    await page.locator('button.dp-day').getByText('۱', { exact: true }).first().click();
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click();
    assert.equal(await sheet.locator('.scheduled-form-error').innerText(), 'تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد');
    assert.deepEqual((await api(page, '/transactions')).body, before); await page.context().close();
  });

  await check('recurring workflows synchronous save locks fields closing and duplicate submissions through refresh', async () => {
    const page = await session('full-owner', 'settings/scheduled'), sheet = await scheduledForm(page, 'Recurring regression: locked');
    let writes = 0, releaseWrite, releaseRefresh;
    const writeGate = new Promise(resolve => { releaseWrite = resolve; }), refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
    await page.route('**/api/v1/transactions', async route => {
      if (route.request().method() === 'POST') { writes++; await writeGate; }
      else if (writes) await refreshGate;
      await route.continue();
    });
    await sheet.locator('button[type=submit]').evaluate(button => { button.click(); button.click(); });
    await sheet.getByRole('button', { name: 'در حال ذخیره…', exact: true }).waitFor(); assert.equal(writes, 1);
    assert.equal(await sheet.locator('fieldset').evaluate(fieldset => fieldset.disabled), true);
    await page.keyboard.press('Escape'); await page.locator('.modal-overlay').last().click({ position: { x: 1, y: 1 } }); await page.evaluate(() => history.back());
    assert.equal(await sheet.isVisible(), true);
    const loading = catalog.entries.find(entry => entry.file.endsWith('/ScheduledTxsCard.tsx') && entry.text === 'در حال ذخیره…'); assert.ok(loading);
    for (const text of ['Saving recurrence…', '', 'Saving recurrence…']) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), [{ id: loading.id, original: loading.text, text, matchingIds: [loading.id], tokens: [] }]);
      await page.waitForFunction(text => document.querySelector('.scheduled-form-sheet button[type=submit]')?.textContent === text, text);
      assert.equal(await sheet.locator('button[type=submit]').isDisabled(), true); assert.equal(writes, 1);
    }
    releaseWrite(); await sheet.waitFor({ state: 'hidden' }); assert.equal(await page.locator('.sched-add').isDisabled(), true);
    releaseRefresh(); await page.waitForFunction(() => document.querySelector('.sched-add')?.disabled === false);
    assert.equal((await api(page, '/transactions')).body.filter(row => row.note === 'Recurring regression: locked').length, 1); await page.context().close();
  });

  await check('recurring workflows stopping repetition preserves the fresh ledger accounts receipts and handled history', async () => {
    const page = await session('full-owner', 'settings/scheduled'), before = (await api(page, '/transactions')).body;
    const tx = before.find(row => row.note.includes('پرداخت تکرارشونده'));
    const fresh = (await api(page, '/transactions/' + tx.id, 'PATCH', { ...tx, amount: tx.amount + 2000, note: 'Updated rent on another screen' })).body;
    const account = (await api(page, '/accounts')).body.find(account => account.id === tx.account_id), balance = await accountBalance(page, account.id);
    page.once('dialog', dialog => { assert.ok(dialog.message().includes('تراکنش‌های ثبت‌شده باقی')); return dialog.accept(); });
    await page.locator('.scheduled-row').filter({ hasText: tx.note }).locator('.scheduled-stop').click();
    await page.locator('.scheduled-row').filter({ hasText: tx.note }).waitFor({ state: 'hidden' });
    const after = (await api(page, '/transactions')).body, stopped = after.find(row => row.id === tx.id);
    assert.equal(after.length, before.length); assert.deepEqual(stopped, { ...fresh, repeat: 'none', repeat_end: null, revision: fresh.revision + 1 });
    assert.equal(await accountBalance(page, account.id), balance);
    await shot(page, 'recurring-stopped-history'); await page.context().close();
  });

  await check('recurring workflows owner admin and own record permissions match existing contracts', async () => {
    for (const scenario of ['full-owner', 'full-admin', 'full-member']) {
      const page = await session(scenario, 'settings/scheduled'), rows = (await api(page, '/transactions')).body.filter(row => row.repeat !== 'none');
      const actor = (await api(page, '/auth/session')).body.member;
      for (const tx of rows) {
        const row = page.locator('.scheduled-row').filter({ hasText: tx.note });
        assert.equal(await row.locator('.scheduled-stop').count(), scenario !== 'full-member' || tx.member_id === actor.id ? 1 : 0);
      }
      await navigate(page, 'dashboard');
      if (scenario === 'full-member') assert.equal(await page.locator('.due-rec').count(), 0);
      else { await dueSeed(page, 'Recurring permission current date ' + scenario); await page.locator('.due-rec').waitFor(); }
      await page.context().close();
    }
  });

  await check('recurring workflows realizing a due date creates one ordinary expense with balance consent', async () => {
    const page = await session(), wallet = (await api(page, '/accounts')).body.find(account => account.kind === 'wallet');
    const balance = await accountBalance(page, wallet.id), tx = await dueSeed(page, 'Recurring regression: shortage', { account_id: wallet.id, amount: balance + 1000 });
    const before = (await api(page, '/transactions')).body;
    await openDue(page, tx.note); assert.equal(await page.getByRole('combobox', { name: 'تکرار تراکنش', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('tab', { name: 'درآمد', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click(); await page.getByRole('alertdialog').waitFor();
    assert.equal((await api(page, '/transactions')).body.length, before.length);
    await page.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const after = (await api(page, '/transactions')).body, created = after.find(row => !before.some(previous => previous.id === row.id));
    assert.equal(after.length, before.length + 1); assert.equal(created.repeat, 'none'); assert.equal(created.amount, tx.amount); assert.equal(created.account_id, wallet.id);
    assert.equal(after.find(row => row.id === tx.id).handled_occurrences.length, 1);
    assert.equal(await accountBalance(page, wallet.id), balance - tx.amount - tx.amount);
    await page.locator('.due-item').filter({ hasText: tx.note }).waitFor({ state: 'hidden' }); await page.context().close();
  });

  await check('recurring workflows acknowledgement failure retries the saved identity without another expense even after reload', async () => {
    const page = await session(), tx = await dueSeed(page, 'Recurring regression: durable retry'), before = (await api(page, '/transactions')).body;
    let writes = 0, patches = 0, fail = true;
    await page.route('**/api/v1/transactions', async route => { if (route.request().method() === 'POST') writes++; await route.continue(); });
    await page.route('**/api/v1/transactions/*', async route => { if (route.request().method() === 'PATCH') patches++; await route.continue(); });
    await page.route('**/api/v1/transactions/' + tx.id + '/occurrences', async route => {
      if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Acknowledgement failed' } }) });
      else await route.continue();
    });
    await openDue(page, tx.note); await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.locator('.tx-occurrence-status').waitFor(); await page.waitForFunction(() => document.querySelector('.tx-save-btn')?.disabled === false);
    assert.equal(writes, 1); assert.equal(patches, 0); assert.equal((await api(page, '/transactions')).body.length, before.length + 1);
    assert.equal(await page.locator('.tx-fields').evaluate(fieldset => fieldset.disabled), true);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('khaneyar:pending-occurrence:')).length), 1);
    await shot(page, 'recurring-pending-acknowledgement');
    await page.reload({ waitUntil: 'domcontentloaded' }); await openDue(page, tx.note);
    await page.locator('.tx-occurrence-status').waitFor(); fail = false;
    await page.locator('.tx-save-btn').click(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    assert.equal(writes, 1); assert.equal(patches, 0); assert.equal((await api(page, '/transactions')).body.length, before.length + 1);
    assert.equal((await api(page, '/transactions')).body.find(row => row.id === tx.id).handled_occurrences.length, 1);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('khaneyar:pending-occurrence:')).length), 0);
    await page.context().close();
  });

  await check('recurring workflows a lost acknowledgement response never rewrites the saved expense', async () => {
    const page = await session(), tx = await dueSeed(page, 'Recurring regression: lost acknowledgement'), before = (await api(page, '/transactions')).body;
    let marks = 0, writes = 0;
    await page.route('**/api/v1/transactions', async route => { if (route.request().method() === 'POST') writes++; await route.continue(); });
    await page.route('**/api/v1/transactions/' + tx.id + '/occurrences', async route => {
      marks++; await route.fetch(); await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Response lost after commit' } }) });
    });
    await openDue(page, tx.note); await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click(); await page.locator('.tx-occurrence-status').waitFor();
    await page.waitForFunction(() => document.querySelector('.tx-save-btn')?.disabled === false);
    await page.locator('.tx-save-btn').click(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    assert.equal(writes, 1); assert.equal(marks, 1); assert.equal((await api(page, '/transactions')).body.length, before.length + 1);
    await page.context().close();
  });

  await check('recurring workflows skipping confirms the exact consequence locks all items and failure remains retryable', async () => {
    const page = await session(), tx = await dueSeed(page, 'Recurring regression: skip'), before = (await api(page, '/transactions')).body;
    const row = page.locator('.due-item').filter({ hasText: tx.note });
    page.once('dialog', dialog => { assert.ok(dialog.message().includes('هزینه یا درآمدی ثبت نمی‌شود')); return dialog.dismiss(); });
    await row.getByRole('button', { name: 'رد این نوبت', exact: true }).click(); assert.deepEqual((await api(page, '/transactions')).body, before);
    let release, marks = 0, fail = true; const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/transactions/' + tx.id + '/occurrences', async route => {
      marks++; await gate;
      if (fail) { fail = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Skip failed' } }) }); }
      else await route.continue();
    });
    page.once('dialog', dialog => dialog.accept()); await row.getByRole('button', { name: 'رد این نوبت', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.due-actions button')].every(button => button.disabled));
    assert.equal(marks, 1); release(); await page.locator('.recurring-notice').waitFor();
    assert.deepEqual((await api(page, '/transactions')).body, before);
    page.once('dialog', dialog => dialog.accept()); await row.getByRole('button', { name: 'رد این نوبت', exact: true }).click(); await row.waitFor({ state: 'hidden' });
    const after = (await api(page, '/transactions')).body;
    assert.equal(after.length, before.length); assert.equal(after.find(row => row.id === tx.id).handled_occurrences.length, 1); await page.context().close();
  });

  await check('recurring workflows handled stopped and unreadable schedules cannot create another occurrence', async () => {
    const page = await session(), tx = await dueSeed(page, 'Recurring regression: stale'), before = (await api(page, '/transactions')).body;
    await page.route('**/api/v1/transactions', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Read failed' } }) }));
    await page.locator('.due-item').filter({ hasText: tx.note }).getByRole('button', { name: 'ثبت این نوبت', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.due-actions button')].every(button => !button.disabled));
    assert.equal(await page.locator('.tx-sheet').count(), 0); await page.unroute('**/api/v1/transactions');
    assert.deepEqual((await api(page, '/transactions')).body, before);
    await api(page, '/transactions/' + tx.id, 'PATCH', { ...tx, repeat: 'none', repeat_end: null });
    await page.locator('.due-item').filter({ hasText: tx.note }).getByRole('button', { name: 'ثبت این نوبت', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.due-actions button')].every(button => !button.disabled));
    assert.equal(await page.locator('.tx-sheet').count(), 0); assert.equal((await api(page, '/transactions')).body.length, before.length);
    await page.context().close();
  });

  await check('recurring workflows editable validation accessible copy and saved acknowledgement text protect user values', async () => {
    const page = await session('full-owner', 'settings/scheduled'), sheet = await scheduledForm(page, 'User note is preserved', '12abc');
    await sheet.getByRole('button', { name: 'ثبت', exact: true }).click(); await sheet.locator('.scheduled-form-error').waitFor();
    const entries = [catalog.entries.find(entry => entry.file.endsWith('/ScheduledTxsCard.tsx') && entry.text === 'مبلغ معتبر وارد کنید'),
      catalog.entries.find(entry => entry.file.endsWith('/ScheduledTxsCard.tsx') && entry.text === 'مبلغ تراکنش تکرارشونده')]; assert.ok(entries.every(Boolean));
    const before = (await api(page, '/transactions')).body;
    for (const texts of [['Enter a valid amount', 'Recurring amount'], ['', ''], ['Enter a valid amount', 'Recurring amount']]) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), entries.map((entry, index) => ({ id: entry.id, original: entry.text, text: texts[index], matchingIds: [entry.id], tokens: [] })));
      await page.waitForFunction(texts => document.querySelector('.scheduled-form-error')?.textContent === texts[0] && document.querySelector('.scheduled-form-sheet .num-input')?.getAttribute('aria-label') === texts[1], texts);
      assert.equal(await sheet.locator('.num-input').inputValue(), '۱۲abc'); assert.equal(await sheet.locator('select').first().inputValue(), 'food');
      assert.deepEqual((await api(page, '/transactions')).body, before);
    }
    for (const text of ['تراکنش این نوبت ثبت شده؛ فقط تأیید سررسید باقی مانده است.', 'تراکنش ثبت شد؛ تأیید سررسید ناموفق بود. دوباره تأیید کنید',
      'در حال بررسی سررسید…', 'تکرار متوقف شد؛ سابقهٔ مالی باقی ماند', 'تراکنش ثبت شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید',
      'بررسی سررسید ممکن نشد؛ دوباره تلاش کنید', 'این نوبت رد شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید'])
      assert.ok(catalog.entries.some(entry => entry.text === text), text);
    assert.ok(catalog.entries.some(entry => entry.id.includes('recurring.stop'))); assert.ok(catalog.entries.some(entry => entry.id.includes('recurring.skip')));
    await page.context().close();
  });

  await check('recurring workflows long titles more than six due dates themes layouts contrast and touch targets', async () => {
    const page = await session(), tx = await dueSeed(page, 'W'.repeat(200));
    for (let index = 0; index < 6; index++) {
      assert.equal((await api(page, '/transactions', 'POST', { member_id: tx.member_id, type: 'expense', amount: 1700,
        category: 'bills', account_id: null, note: 'Recurring layout extra ' + index, date: tx.date, repeat: 'weekly', repeat_end: tx.repeat_end })).status, 201);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'نمایش سررسیدهای بیشتر', exact: true }).waitFor();
    const initial = await page.locator('.due-item').count(); assert.equal(initial, 6);
    await page.getByRole('button', { name: 'نمایش سررسیدهای بیشتر', exact: true }).click(); assert.ok(await page.locator('.due-item').count() > initial);
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        for (const button of await page.locator('.due-actions button').all()) { const box = await button.boundingBox(); assert.ok(box.height >= 44 && box.width >= 44); }
        const colors = await page.locator('.due-yes').first().evaluate(button => ({ foreground: getComputedStyle(button).color, background: getComputedStyle(button).backgroundColor }));
        assert.ok(contrastRatio(colors.foreground, colors.background) >= 4.5); await shot(page, 'recurring-due-' + width + '-' + theme);
      }
    }
    await navigate(page, 'settings');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('copy-workbench:settings', { detail: { section: 'scheduled' } })));
    await page.locator('.scheduled-row').filter({ hasText: tx.note }).waitFor();
    await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const box = await page.locator('.scheduled-row').filter({ hasText: tx.note }).locator('.scheduled-stop').boundingBox(); assert.ok(box.height >= 44 && box.width >= 44, JSON.stringify(box));
      await shot(page, 'recurring-settings-' + width);
    }
    const sheet = await scheduledForm(page, 'Another recurrence'); await page.setViewportSize({ width: 360, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await shot(page, 'recurring-form-mobile'); await page.context().close();
  });
  await check('recurring workflows receipt and acknowledgement failures retry one expense and one attached receipt', async () => {
    const page = await session(), tx = await dueSeed(page, 'Recurring regression: receipt retry'), before = (await api(page, '/transactions')).body;
    let writes = 0, patches = 0, failMark = true, failUpload = true;
    await page.route('**/api/v1/transactions', async route => { if (route.request().method() === 'POST') writes++; await route.continue(); });
    await page.route('**/api/v1/transactions/*', async route => { if (route.request().method() === 'PATCH') patches++; await route.continue(); });
    await page.route('**/api/v1/transactions/' + tx.id + '/occurrences', async route => {
      if (failMark) { failMark = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Mark retry needed' } }) }); }
      else await route.continue();
    });
    await page.route('**/api/v1/uploads/photo', async route => {
      if (failUpload) { failUpload = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Upload retry needed' } }) }); }
      else await route.continue();
    });
    await openDue(page, tx.note); await receipts(page, 1); await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.locator('.tx-occurrence-status').waitFor(); await page.waitForFunction(() => document.querySelector('.tx-save-btn')?.disabled === false);
    assert.equal(writes, 1); assert.equal(patches, 0);
    const saved = (await api(page, '/transactions')).body.find(row => !before.some(previous => previous.id === row.id));
    await page.locator('.tx-save-btn').click(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const after = (await api(page, '/transactions')).body;
    assert.equal(writes, 1); assert.equal(patches, 0); assert.equal(after.length, before.length + 1);
    assert.equal(after.find(row => row.id === saved.id).photos.length, 1); await page.context().close();
  });
  await check('recurring workflows successful acknowledgement keeps receipt retry financially locked and copy editable', async () => {
    const page = await session(), tx = await dueSeed(page, 'Recurring regression: acknowledged receipt retry'), before = (await api(page, '/transactions')).body;
    let writes = 0, patches = 0, marks = 0, failUpload = true;
    await page.route('**/api/v1/transactions', async route => { if (route.request().method() === 'POST') writes++; await route.continue(); });
    await page.route('**/api/v1/transactions/*', async route => { if (route.request().method() === 'PATCH') patches++; await route.continue(); });
    await page.route('**/api/v1/transactions/' + tx.id + '/occurrences', async route => { marks++; await route.continue(); });
    await page.route('**/api/v1/uploads/photo', async route => {
      if (failUpload) { failUpload = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Receipt upload failed' } }) }); }
      else await route.continue();
    });
    await openDue(page, tx.note); await receipts(page, 1); await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.getByRole('button', { name: 'ذخیرهٔ رسیدها', exact: true }).waitFor();
    assert.equal(writes, 1); assert.equal(patches, 0); assert.equal(marks, 1);
    assert.equal(await page.locator('.tx-fields').evaluate(fieldset => fieldset.disabled), true);
    assert.equal(await page.locator('.tx-trash-btn').count(), 0); assert.equal(await page.locator('.tx-occurrence-status').count(), 0);
    const saved = (await api(page, '/transactions')).body.find(row => !before.some(previous => previous.id === row.id));
    const entry = catalog.entries.find(entry => entry.file.endsWith('/TransactionFormFeature.tsx') && entry.text === 'ذخیرهٔ رسیدها'); assert.ok(entry);
    for (const text of ['Save receipts', '', 'Save receipts']) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), [{ id: entry.id, original: entry.text, text, matchingIds: [entry.id], tokens: [] }]);
      await page.waitForFunction(text => document.querySelector('.tx-save-btn span')?.textContent === text, text);
      assert.equal(await page.locator('.tx-desc-input').inputValue(), tx.note); assert.equal(await page.locator('.tx-fields').evaluate(fieldset => fieldset.disabled), true);
    }
    await page.locator('.tx-save-btn').click(); await page.locator('.tx-sheet').waitFor({ state: 'hidden' });
    const after = (await api(page, '/transactions')).body;
    assert.equal(writes, 1); assert.equal(patches, 0); assert.equal(marks, 1); assert.equal(after.length, before.length + 1);
    const completed = after.find(row => row.id === saved.id); assert.equal(completed.photos.length, 1);
    assert.deepEqual({ ...completed, photos: [] }, saved); await page.context().close();
  });
  await check('recurring workflows scheduled write and refresh failures preserve drafts income and stop history', async () => {
    const page = await session('full-owner', 'settings/scheduled'), before = (await api(page, '/transactions')).body;
    const sheet = await scheduledForm(page, 'Recurring regression: recover income', '2000.25');
    await sheet.getByRole('button', { name: 'درآمد', exact: true }).click();
    let failWrite = true, failRead = false, writes = 0;
    await page.route('**/api/v1/transactions', async route => {
      if (route.request().method() === 'POST') {
        writes++;
        if (failWrite) { failWrite = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Scheduled save interrupted' } }) }); }
        const response = await route.fetch(); failRead = true; return route.fulfill({ response });
      }
      if (failRead) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Scheduled refresh interrupted' } }) });
      await route.continue();
    });
    await sheet.locator('button[type=submit]').click(); await sheet.locator('.scheduled-form-error').waitFor();
    assert.equal(await sheet.locator('.num-input').inputValue(), '۲,۰۰۰.۲۵'); assert.equal(await sheet.locator('input[type=text]').last().inputValue(), 'Recurring regression: recover income');
    assert.equal(await sheet.isVisible(), true); assert.deepEqual((await api(page, '/transactions')).body, before);
    await sheet.locator('button[type=submit]').click(); await sheet.waitFor({ state: 'hidden' });
    await page.getByText('تراکنش ثبت شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید', { exact: true }).waitFor();
    assert.equal(writes, 2); await page.unroute('**/api/v1/transactions');
    const after = (await api(page, '/transactions')).body, saved = after.find(row => !before.some(previous => previous.id === row.id));
    assert.equal(after.length, before.length + 1); assert.equal(saved.type, 'income'); assert.equal(saved.amount, 2000.25); assert.equal(saved.account_id, null);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const row = page.locator('.scheduled-row').filter({ hasText: saved.note }); await row.waitFor();
    let failStop = true;
    await page.route('**/api/v1/transactions/' + saved.id, async route => {
      if (route.request().method() === 'PATCH' && failStop) { failStop = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Stop interrupted' } }) }); }
      await route.continue();
    });
    page.once('dialog', dialog => dialog.accept()); await row.locator('.scheduled-stop').click();
    await page.waitForFunction(() => document.querySelector('.scheduled-notice')?.textContent !== 'تراکنش ثبت شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید' && document.querySelector('.sched-add')?.disabled === false);
    assert.equal(failStop, false); assert.ok((await page.locator('.scheduled-notice').innerText()).length > 0);
    assert.equal(await row.isVisible(), true); assert.deepEqual((await api(page, '/transactions')).body, after);
    page.once('dialog', dialog => dialog.accept()); await row.locator('.scheduled-stop').click(); await row.waitFor({ state: 'hidden' });
    const stopped = (await api(page, '/transactions')).body.find(item => item.id === saved.id);
    assert.deepEqual(stopped, { ...saved, repeat: 'none', repeat_end: null, revision: saved.revision + 1 }); await page.context().close();
  });
  await check('recurring workflows missing cached expenses stay blocked and disappearing categories cannot be submitted', async () => {
    const page = await session(), tx = await dueSeed(page, 'Recurring regression: missing saved expense');
    await page.route('**/api/v1/transactions/' + tx.id + '/occurrences', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER', message: 'Acknowledgement interrupted' } }) }));
    const before = (await api(page, '/transactions')).body;
    await openDue(page, tx.note); await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.locator('.tx-occurrence-status').waitFor(); await page.waitForFunction(() => document.querySelector('.tx-save-btn')?.disabled === false);
    const saved = (await api(page, '/transactions')).body.find(row => !before.some(previous => previous.id === row.id));
    assert.equal((await api(page, '/transactions/' + saved.id, 'DELETE')).status, 204);
    await page.reload({ waitUntil: 'domcontentloaded' });
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.locator('.due-item').filter({ hasText: tx.note }).getByRole('button', { name: 'ثبت این نوبت', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('.due-actions button')].every(button => !button.disabled));
      assert.equal(await page.locator('.tx-sheet').count(), 0); assert.deepEqual((await api(page, '/transactions')).body, before);
      assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('khaneyar:pending-occurrence:')).length), 1);
    }
    await page.context().close();
    const settings = await session('full-owner', 'settings/scheduled'), categories = (await api(settings, '/custom-categories')).body;
    const custom = categories.find(category => category.type === 'expense'); assert.ok(custom);
    const sheet = await scheduledForm(settings, 'Recurring regression: disappearing category');
    await sheet.getByRole('combobox', { name: 'دستهٔ تراکنش تکرارشونده', exact: true }).selectOption(custom.id);
    await api(settings, '/custom-categories/' + custom.id, 'DELETE'); await settings.evaluate(() => window.dispatchEvent(new Event('online')));
    await settings.waitForFunction(() => document.querySelector('.scheduled-form-sheet select')?.value === '');
    const transactions = (await api(settings, '/transactions')).body;
    await sheet.locator('button[type=submit]').click(); await sheet.getByText('دسته را انتخاب کنید', { exact: true }).waitFor();
    assert.deepEqual((await api(settings, '/transactions')).body, transactions); assert.equal(await sheet.locator('.num-input').inputValue(), '۱,۲۰۰'); await settings.context().close();
  });
  await check('notification windows all dated sources show today and tomorrow and the next Tehran day updates without writes', async () => {
    const page = await session('empty-owner'), actor = (await api(page, '/auth/session')).body.member;
    const currentIso = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date()));
    const date = offset => { const value = new Date(currentIso + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };
    const domains = ['recurring', 'bills', 'event', 'tasks', 'documents', 'equipment', 'vehicles', 'goals', 'activities'];
    for (const offset of [-1, 0, 1, 2]) {
      for (const domain of domains) {
        const title = 'Reminder window ' + domain + ' ' + offset;
        const path = domain === 'recurring' ? '/transactions' : domain === 'event' ? '/events' : '/' + domain;
        const body = domain === 'recurring' ? { member_id: actor.id, type: 'expense', amount: 1250.25, category: 'bills', account_id: null,
          note: title, date: date(offset - 28), repeat: 'weekly', repeat_end: date(60) }
          : domain === 'bills' ? { title, kind: 'electricity', amount: 2000, due_date: date(offset) }
          : domain === 'event' ? { title, date: date(offset), kind: 'event', member_id: actor.id }
          : domain === 'tasks' ? { title, due_date: date(offset), assignee_id: actor.id }
          : domain === 'documents' ? { title, expiry_date: date(offset), visibility: 'shared', owner_id: actor.id, reminder_enabled: true }
          : domain === 'equipment' ? { title, service_due_date: date(offset), warranty_until: date(offset), service_reminder_enabled: true }
          : domain === 'vehicles' ? { title, service_due_date: date(offset), insurance_until: date(offset), inspection_until: date(offset),
            odometer: 100, service_due_odometer: null, service_reminder_enabled: true }
          : domain === 'goals' ? { title, target_date: date(offset), owner_id: actor.id, status: 'active', reminder_enabled: true }
          : { title, date: date(offset), status: 'planned', reminder_enabled: true };
        assert.equal((await api(page, path, 'POST', body)).status, 201, title);
      }
    }
    await api(page, '/notifications/prefs', 'PATCH', { lead_days: Object.fromEntries(domains.map(domain => [domain, domain === 'tasks' ? 0 : 60])) });
    const transactions = (await api(page, '/transactions')).body, bills = (await api(page, '/bills')).body;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.due-item').filter({ hasText: 'Reminder window recurring 1' }).waitFor();
    assert.equal(await page.locator('.due-item').filter({ hasText: 'Reminder window recurring -1' }).count(), 0);
    assert.equal(await page.locator('.due-item').filter({ hasText: 'Reminder window recurring 2' }).count(), 0);
    await navigate(page, 'hub'); await page.locator('.hub-bell').click();
    await page.locator('.notif-item').filter({ hasText: 'Reminder window activities 1' }).waitFor();
    for (const domain of domains) {
      for (const offset of [-1, 0, 1, 2]) {
        const count = await page.locator('.notif-item').filter({ hasText: 'Reminder window ' + domain + ' ' + offset }).count();
        assert.equal(count > 0, offset === 0 || offset === 1, domain + ' date ' + offset);
      }
    }
    assert.equal(numeric(await page.locator('.hub-bell-dot').innerText()), await page.locator('.notif-item').count());
    assert.equal(await page.locator('.notif-item.sev-overdue').count(), 0);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await shot(page, 'notification-window-' + theme, false);
    }
    await page.locator('.notif-item').filter({ hasText: 'Reminder window recurring 1' }).click(); await page.locator('.tx-sheet').waitFor();
    await page.waitForFunction(() => document.querySelector('.tx-fields')?.disabled === false);
    assert.equal(await page.locator('.tx-desc-input').inputValue(), 'Reminder window recurring 1');
    await page.getByRole('button', { name: 'بستن', exact: true }).click();
    await navigate(page, 'hub'); await page.locator('.hub-overview').waitFor();
    for (const button of await page.locator('.hub-overview-more').all()) await button.click();
    for (const domain of domains.filter(domain => !['documents', 'recurring'].includes(domain))) {
      assert.equal(await page.locator('.hub-overview-row').filter({ hasText: 'Reminder window ' + domain + ' -1' }).count(), 0);
      assert.equal(await page.locator('.hub-overview-row').filter({ hasText: 'Reminder window ' + domain + ' 2' }).count(), 0);
    }
    await page.locator('.hub-overview').getByText('فردا', { exact: true }).waitFor();
    await page.locator('.hub-bell').click();
    await page.locator('.notif-item').filter({ hasText: 'Reminder window activities 1' }).waitFor();
    await page.clock.setFixedTime(new Date(date(1) + 'T09:00:00+03:30'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('.notif-item').filter({ hasText: 'Reminder window activities 2' }).waitFor();
    for (const domain of domains) {
      assert.equal(await page.locator('.notif-item').filter({ hasText: 'Reminder window ' + domain + ' 0' }).count(), 0);
      assert.ok(await page.locator('.notif-item').filter({ hasText: 'Reminder window ' + domain + ' 1' }).count());
      assert.ok(await page.locator('.notif-item').filter({ hasText: 'Reminder window ' + domain + ' 2' }).count());
    }
    assert.deepEqual((await api(page, '/transactions')).body, transactions); assert.deepEqual((await api(page, '/bills')).body, bills);
    await page.context().close();
  });
  await check('notification windows settings and empty copy stay editable while domain controls preserve legacy stored values', async () => {
    const page = await session('full-owner', 'hub');
    await navigate(page, 'settings'); await page.evaluate(() => window.dispatchEvent(new CustomEvent('copy-workbench:settings', { detail: { section: 'notifications' } })));
    await page.getByText('در حال خواندن تنظیمات…', { exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: 'زمان یادآوری', exact: true }).waitFor();
    assert.equal(await page.locator('.set-stepper').count(), 0);
    assert.equal(await page.getByText('چند روز قبل خبر بده', { exact: true }).count(), 0);
    const guidance = catalog.entries.find(entry => entry.file.endsWith('/NotificationSettingsFeature.tsx') && entry.text === 'یادآوری‌های تاریخ‌دار فقط برای امروز و فردا نمایش داده می‌شوند.'); assert.ok(guidance);
    for (const text of ['Dated reminders cover today and tomorrow.', '', 'Dated reminders cover today and tomorrow.']) {
      await page.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), [{ id: guidance.id, original: guidance.text, text, matchingIds: [guidance.id], tokens: [] }]);
      await page.waitForFunction(text => [...document.querySelectorAll('p.set-row-sub')].some(element => element.textContent === text), text);
    }
    const before = (await api(page, '/notifications/prefs')).body;
    await page.getByRole('switch').filter({ hasText: 'سررسید تراکنش‌های تکرارشونده' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[role=switch]')].some(button => button.textContent.includes('سررسید تراکنش‌های تکرارشونده') && button.getAttribute('aria-checked') === 'false'));
    const after = (await api(page, '/notifications/prefs')).body;
    assert.equal(after.domains.recurring, false); assert.deepEqual(after.lead_days, before.lead_days); await page.context().close();
    const empty = await session('empty-owner', 'hub'); await empty.locator('.hub-bell').click(); await empty.getByText('فعلاً یادآوری‌ای ندارید.', { exact: true }).waitFor();
    assert.equal(await empty.locator('.hub-bell-dot').count(), 0);
    const entry = catalog.entries.find(entry => entry.file.endsWith('/NotificationCenterFeature.tsx') && entry.text === 'فعلاً یادآوری‌ای ندارید.'); assert.ok(entry);
    for (const text of ['No reminders right now.', '', 'No reminders right now.']) {
      await empty.evaluate(drafts => window.postMessage({ type: 'copy-drafts', drafts }, location.origin), [{ id: entry.id, original: entry.text, text, matchingIds: [entry.id], tokens: [] }]);
      await empty.waitForFunction(text => [...document.querySelectorAll('.modal-sheet p')].some(element => element.textContent.trim() === text), text);
    }
    await shot(empty, 'notification-window-empty', false); await empty.context().close();
  });
  await check('notification windows undated tasks stock and mileage warnings remain current without historical date labels', async () => {
    const page = await session('empty-owner', 'hub'), actor = (await api(page, '/auth/session')).body.member;
    const past = await page.evaluate(() => { const value = new Date(); value.setDate(value.getDate() - 5); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(value); });
    assert.equal((await api(page, '/tasks', 'POST', { title: 'Undated task remains', assignee_id: actor.id, due_date: null })).status, 201);
    assert.equal((await api(page, '/inventory', 'POST', { title: 'Low stock remains', quantity: 0, threshold: 2 })).status, 201);
    assert.equal((await api(page, '/vehicles', 'POST', { title: 'Mileage remains', service_due_date: past,
      insurance_until: past, inspection_until: past, odometer: 10000, service_due_odometer: 10000, service_reminder_enabled: true })).status, 201);
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('.hub-bell').click();
    await page.locator('.notif-item').filter({ hasText: 'Mileage remains' }).waitFor();
    assert.equal(await page.locator('.notif-item').filter({ hasText: 'Mileage remains' }).count(), 1);
    assert.equal(await page.locator('.notif-item').filter({ hasText: 'Mileage remains' }).locator('p').innerText(), 'موعد سرویس · ۱۰,۰۰۰ کیلومتر');
    assert.equal(await page.locator('.notif-item').filter({ hasText: 'Undated task remains' }).count(), 1);
    assert.equal(await page.locator('.notif-item').filter({ hasText: 'Low stock remains' }).count(), 1);
    await page.context().close();
  });
} finally {
  await Promise.allSettled(contexts.map(context => context.close())); await browser.close();
  await persist(); console.log(JSON.stringify({ checks: results.checks.length, findings: results.findings.length, errors: results.errors, externalRequests: results.externalRequests }));
  if (results.errors.length || results.externalRequests.length) process.exitCode = 1;
}
