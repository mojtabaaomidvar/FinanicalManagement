import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';

const base = 'http://127.0.0.1:5701';
const out = fileURLToPath(new URL('../.local-test/inventory-catalog/', import.meta.url));
await mkdir(out, { recursive:true });
const html = await (await fetch(base)).text();
const { csrfToken } = JSON.parse(html.match(/window\.__COPY_WORKBENCH__=(\{[^;]+\});/)[1]);
const browser = await chromium.launch({ channel:'chrome' });
const passed = [];

async function open(scenarioId = 'empty-owner', route = 'inventory', width = 360) {
  const created = await fetch(base + '/__copy/preview', { method:'POST',
    headers:{ Origin:base, 'Content-Type':'application/json', 'X-Copy-Workbench-Token':csrfToken },
    body:JSON.stringify({ scenarioId, route }) });
  assert.equal(created.status, 200);
  const page = await browser.newPage({ viewport:{ width, height:880 }, hasTouch:true, isMobile:width < 700, serviceWorkers:'block' });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', request => new URL(request.request().url()).origin === base ? request.continue() : request.abort());
  await page.goto(base + (await created.json()).url);
  await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
  const button = (name, root = page) => root.getByRole('button', { name, exact:true });
  const field = name => page.getByLabel(name, { exact:true });
  const api = path => page.evaluate(async path => (await fetch('/api/v1/' + path)).json(), path);
  const form = page.locator('.inv-edit-sheet');
  async function screenshot(name) {
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.screenshot({ path:`${out}/${name}-${width}.png`, fullPage:true, animations:'disabled' });
  }
  return { page, button, field, api, form, errors, screenshot };
}

try {
  const touch = await open();
  const { page, button, field, api, form } = touch;
  await button('افزودن قلم به انبار').tap();
  const name = page.getByRole('combobox', { name:'نام قلم انبار' });
  await name.fill('تخم');
  await page.getByRole('option', { name:'تخم‌مرغ', exact:true }).tap();
  await expect(name).toHaveValue('تخم‌مرغ');
  await expect(field('دستهٔ قلم انبار')).toHaveValue('refrigerated');
  await expect(field('واحد قلم انبار')).toHaveValue('عدد');
  assert.deepEqual(await api('inventory'), []);
  await button('افزودن', form).tap();
  await expect.poll(() => api('inventory')).toHaveLength(1);
  await expect(page.locator('.inv-body b')).toHaveText('تخم‌مرغ');
  await button('افزودن قلم به انبار').tap();
  await name.fill('آب');
  await expect(field('دستهٔ قلم انبار')).toHaveValue('drinks');
  await expect(field('واحد قلم انبار')).toHaveValue('بطری');
  await name.fill('پنیر');
  await expect(field('دستهٔ قلم انبار')).toHaveValue('refrigerated');
  await expect(field('واحد قلم انبار')).toHaveValue('بسته');
  const longTitle = 'قلم سفارشی با نام کامل و بسیار بلند برای بررسی نمایش در فهرست انبار خانه';
  await name.fill(longTitle); await name.press('Enter');
  await expect(form).toBeVisible();
  await expect(field('دستهٔ قلم انبار')).toHaveValue('');
  await expect(field('واحد قلم انبار')).toHaveValue('');
  await button('افزودن', form).tap();
  await expect(form.getByRole('alert')).toHaveText('دستهٔ این قلم را انتخاب کنید.');
  await field('دستهٔ قلم انبار').selectOption('cleaning');
  await button('افزودن', form).tap();
  await expect(form.getByRole('alert')).toHaveText('واحد این قلم را انتخاب کنید یا بنویسید.');
  await button('پاکت', form).tap();
  await button('افزودن', form).tap();
  await expect.poll(() => api('inventory')).toHaveLength(2);
  const row = page.locator('.inv-body').filter({ hasText:longTitle });
  await expect(row.locator('b')).toHaveText(longTitle);
  const box = await row.locator('b').evaluate(el => ({ width:el.clientWidth, scroll:el.scrollWidth,
    height:el.clientHeight, scrollHeight:el.scrollHeight, overflow:getComputedStyle(el).overflow,
    whiteSpace:getComputedStyle(el).whiteSpace }));
  assert.equal(box.overflow, 'visible'); assert.equal(box.whiteSpace, 'normal');
  assert.ok(box.scroll <= box.width + 1 && box.scrollHeight <= box.height + 1);
  assert.ok(await page.locator('.inventory-page').evaluate(el => el.scrollWidth <= el.clientWidth));
  await row.scrollIntoViewIfNeeded();
  await row.screenshot({ path:`${out}/complete-item-name-360.png`, animations:'disabled' });
  await touch.screenshot('touch-full-names');
  assert.deepEqual(touch.errors, []);
  assert.deepEqual(await api('transactions'), []);
  await page.close();
  passed.push('Native touch selection, exact names/aliases, category and unit defaults, unknown-item validation, complete wrapped names at 360px.');

  const published = await open('full-owner');
  const added = await published.page.evaluate(async () => {
    const proposals = await (await fetch('/api/v1/support/catalog')).json();
    const body = { id:proposals.items[0].id, status:'approved', title:'نمونه: کالای منتشرشده', category:'personal_care', unit:'پاکت' };
    const response = await fetch('/api/v1/support/catalog/review', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    if (!response.ok) throw new Error('Fixture approval failed');
    return body;
  });
  await published.button('افزودن قلم به انبار').tap();
  await expect(published.page.getByText('در حال دریافت فهرست کالاها…', { exact:true })).toHaveCount(0);
  const dynamicName = published.page.getByRole('combobox', { name:'نام قلم انبار' });
  await dynamicName.fill('منتشرشده');
  await published.page.getByRole('option', { name:added.title, exact:true }).tap();
  await expect(dynamicName).toHaveValue(added.title);
  await expect(published.field('دستهٔ قلم انبار')).toHaveValue(added.category);
  await expect(published.field('واحد قلم انبار')).toHaveValue(added.unit);
  await published.screenshot('published-suggestion');
  assert.deepEqual(published.errors, []); await published.page.close();
  passed.push('An approved dynamic item is searchable and supplies metadata without rebuilding the app.');

  const failed = await open();
  await failed.page.evaluate(() => {
    const previous = window.fetch;
    window.fetch = (input, init) => String(typeof input === 'string' ? input : input.url).includes('/inventory/catalog')
      ? Promise.resolve(new Response(JSON.stringify({error:{code:'SERVER',message:'fixture failure'}}), {status:503,headers:{'Content-Type':'application/json'}}))
      : previous(input, init);
  });
  await failed.button('افزودن قلم به انبار').tap();
  await expect(failed.page.getByRole('button', { name:'دریافت دوبارهٔ فهرست کالاها', exact:true })).toBeVisible();
  await failed.page.getByRole('combobox', { name:'نام قلم انبار' }).fill('آب');
  await expect(failed.field('واحد قلم انبار')).toHaveValue('بطری');
  await failed.screenshot('catalog-fallback');
  assert.deepEqual(failed.errors, []); await failed.page.close();
  passed.push('A catalog refresh failure keeps packaged suggestions and editable inventory available.');

  const support = await open('full-owner', 'support', 360);
  await support.button('بررسی کالاهای تازه').tap();
  await support.button('ویرایش پیشنهاد').tap();
  await support.field('نام پیشنهادی کالا').fill('نمونه: شویندهٔ اصلاح‌شده');
  await support.field('دستهٔ پیشنهادی کالا').selectOption('personal_care');
  await support.field('واحد پیشنهادی کالا').fill('پاکت');
  await support.screenshot('operator-edit');
  await support.button('ذخیره و انتشار قلم').tap();
  await expect(support.page.getByText('قلم تأیید شد و در فهرست عمومی کالاها در دسترس است.', {exact:true})).toBeVisible();
  await expect(support.page.getByText('پیشنهادی با این وضعیت وجود ندارد.', {exact:true})).toBeVisible();
  const publicEntries = await support.api('inventory/catalog');
  assert.equal(publicEntries.length, 1);
  assert.deepEqual(Object.keys(publicEntries[0]).sort(), ['aliases','common','group','id','title','unit']);
  assert.equal(publicEntries[0].title, 'نمونه: شویندهٔ اصلاح‌شده');
  assert.equal(publicEntries[0].group, 'personal_care'); assert.equal(publicEntries[0].unit, 'پاکت');
  await support.field('وضعیت بررسی پیشنهاد کالا').selectOption('approved');
  await expect(support.page.locator('.support-catalog-list li')).toHaveCount(2);
  await expect(support.page.getByText('تأیید قدیمی؛ هنوز منتشر نشده', {exact:true})).toBeVisible();
  await support.button('رد پیشنهاد').tap();
  await support.field('وضعیت بررسی پیشنهاد کالا').selectOption('rejected');
  await expect(support.page.locator('.support-catalog-list li')).toHaveCount(1);
  assert.equal((await support.api('inventory/catalog')).length, 1);
  assert.deepEqual(support.errors, []); await support.page.close();
  passed.push('Operator edits and publishes name/group/unit, distinguishes legacy unpublished approvals, and rejects without publication.');
  await writeFile(`${out}/result.json`, JSON.stringify({ passed, fixtureOnly:true, manualDataUsed:false }, null, 2));
  for (const result of passed) console.log('PASS ' + result);
} finally { await browser.close(); }
