import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';

const base = 'http://127.0.0.1:5701';
const out = fileURLToPath(new URL('../.local-test/inventory-categories/', import.meta.url));
await mkdir(out, { recursive:true });
const browser = await chromium.launch({ channel: 'chrome' });
const html = await (await fetch(base)).text();
const { csrfToken } = JSON.parse(html.match(/window\.__COPY_WORKBENCH__=(\{[^;]+\});/)[1]);

async function openPreview(width, height, scenarioId = 'empty-owner', route = 'inventory') {
  const response = await fetch(base + '/__copy/preview', {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Copy-Workbench-Token': csrfToken },
    body: JSON.stringify({ scenarioId, route }),
  });
  assert.equal(response.status, 200);
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  page.setDefaultTimeout(18000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.INVENTORY_DEBUG) page.on('response', async response => {
    if (/\/api\/v1\/(inventory|shopping\/offline)/.test(response.url())) console.log(response.url(), response.status(), response.request().headers()['x-copy-preview-session'], (await response.text()).slice(0,500));
  });
  await page.route('**/*', request => new URL(request.request().url()).origin === base ? request.continue() : request.abort());
  await page.goto(base + (await response.json()).url);
  await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
  const button = (name, root = page) => root.getByRole('button', { name, exact: true });
  const field = name => page.getByLabel(name, { exact: true });
  const api = name => page.evaluate(async name => (await fetch('/api/v1/' + name)).json(), name);
  const sheet = page.locator('.inv-edit-sheet');
  const open = () => button('افزودن قلم به انبار').click();
  async function waitForStock(count) {
    await expect.poll(() => api('inventory'), { timeout:18000 }).toHaveLength(count);
  }
  async function shot(name, target = page.locator('.inventory-page')) {
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.screenshot({ path: `${out}/${name}-${width}.png`, animations: 'disabled', fullPage: name === 'inventory-support' });
    assert.equal(await target.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  }
  return { page, button, field, api, sheet, open, waitForStock, shot, errors };
}

try {
  const { page, button, field, api, sheet, open, waitForStock, shot, errors } = await openPreview(360, 800);
  const tiles = page.locator('.inv-category-tiles');
  assert.equal(await tiles.getByRole('button').count(), 10);
  await shot('inventory-categories');
  await open();
  const name = page.getByRole('combobox', { name: 'نام قلم انبار' });
  const category = field('دستهٔ قلم انبار');
  const list = page.getByRole('listbox', { name: 'پیشنهادهای نام کالا' });
  const options = list.getByRole('option');
  assert.equal(await sheet.locator('select').count(), 1);
  assert.equal(await category.locator('optgroup').count(), 10);
  assert.equal(await category.locator('option').count(), 30);
  assert.equal(await sheet.getByLabel('آستانهٔ کمبود انبار').count(), 0);
  assert.equal(await list.count(), 0);
  await page.evaluate(async () => { await document.fonts.ready; });
  await shot('inventory-form', sheet);
  const bounds = await name.boundingBox(), categoryBounds = await category.boundingBox();
  assert.ok(Math.abs(bounds.y - categoryBounds.y) < 3 && categoryBounds.x < bounds.x);
  await name.pressSequentially('گ');
  await list.waitFor();
  const first = await options.allTextContents();
  assert.ok(first.some(t => t.includes('گوجه‌فرنگی')));
  assert.ok(await options.count() > 4);
  const source = JSON.parse(await sheet.locator('.inv-lookup [role=status]').getAttribute('data-copy-sources'));
  assert.ok(source.some(record => record.id === 'inventory.suggestions_count'));
  const geometry = await list.evaluate(el => ({ left:el.getBoundingClientRect().left, width:el.getBoundingClientRect().width,
    tops:[...el.querySelectorAll('[role=option]')].map(item=>item.getBoundingClientRect().top), font:getComputedStyle(el.querySelector('button')).fontSize,
    display:getComputedStyle(el).display, wrap:getComputedStyle(el).flexWrap }));
  assert.ok(Math.abs(geometry.left - bounds.x) < 3 && geometry.width <= bounds.width);
  assert.equal(geometry.display, 'flex'); assert.equal(geometry.wrap, 'wrap'); assert.equal(geometry.font, '13px');
  assert.ok(new Set(geometry.tops).size < geometry.tops.length, 'suggestions wrap side by side');
  await name.pressSequentially('وجه');
  assert.match(await options.first().textContent(), /گوجه‌فرنگی/);
  await shot('inventory-live', sheet);
  await name.press('Escape'); assert.equal(await list.count(), 0);
  assert.equal(await name.inputValue(), 'گوجه');
  await name.press('ArrowDown'); await name.press('ArrowDown');
  assert.ok(await name.getAttribute('aria-activedescendant'));
  await name.press('Enter');
  assert.equal(await name.inputValue(), 'گوجه‌فرنگی');
  assert.equal(await category.inputValue(), 'vegetables');
  assert.equal(await field('واحد قلم انبار').inputValue(), 'کیلو');
  assert.deepEqual(await api('inventory'), []);
  await category.selectOption('repairs');
  await name.fill('چسب تفلون');
  await list.getByRole('option', { name: /نوار تفلون/ }).click();
  assert.equal(await name.inputValue(), 'نوار تفلون');
  assert.equal(await category.inputValue(), 'plumbing');
  assert.equal(await field('واحد قلم انبار').inputValue(), 'رول');
  await field('موجودی فعلی انبار').fill('2');
  assert.deepEqual(await api('inventory'), []);
  await button('افزودن').click(); await waitForStock(1);
  const [saved] = await api('inventory');
  assert.deepEqual([saved.title, saved.unit, saved.category, Number(saved.quantity)], ['نوار تفلون', 'رول', 'plumbing', 2]);
  await open(); await category.selectOption('cleaning');
  const catalog = await (await fetch(base + '/__copy/catalog')).json();
  assert.ok(catalog.entries.some(entry => entry.file === 'src/domain/inventory/inventory.labels.ts' && entry.text === 'نظافت و شوینده'));
  await name.fill('قلم سفارشی آزمون'); await field('واحد قلم انبار').fill('عدد');
  await name.focus(); await name.press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-label="نام قلم انبار"]')?.getAttribute('aria-expanded') === 'false');
  assert.equal(await sheet.isVisible(), true, 'Enter in the name must not save custom stock');
  assert.equal((await api('inventory')).length, 1);
  await button('افزودن').click(); await waitForStock(2);
  assert.ok((await api('inventory')).some(item => item.title === 'قلم سفارشی آزمون' && item.category === 'cleaning'));
  await tiles.getByRole('button', { name:/تعمیر و نگهداری/ }).click();
  const groups = page.getByRole('group', { name:'زیرگروه‌های موجودی' });
  await groups.getByRole('button', { name:/لوله‌کشی و شیرآلات/ }).click();
  assert.equal(await page.locator('.inv-item').count(), 1);
  assert.ok((await page.locator('.inv-list').textContent()).includes('نوار تفلون'));
  assert.ok(!(await page.locator('.inv-list').textContent()).includes('قلم سفارشی آزمون'));
  await shot('inventory-subgroup');
  await button('همهٔ دسته‌ها').click();
  assert.equal(await page.locator('.inv-item').count(), 2);
  await page.reload(); await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
  assert.equal((await api('inventory')).find(item=>item.title==='قلم سفارشی آزمون').category, 'cleaning');
  assert.deepEqual(await api('transactions'), []); assert.deepEqual(errors, []);
  console.log('PASS 360px: dropdown beside name, compact wrapping suggestions, keyboard selection, explicit save, custom category, subgroup filters and reload.');
  await page.close();

  const desktop = await openPreview(1440, 960);
  await desktop.shot('inventory-categories'); await desktop.open();
  await desktop.page.getByRole('combobox', { name:'نام قلم انبار' }).fill('تخم');
  await desktop.page.getByRole('listbox', { name:'پیشنهادهای نام کالا' }).getByRole('option', { name:/تخم‌مرغ/ }).waitFor();
  await desktop.shot('inventory-live', desktop.sheet);
  assert.deepEqual(desktop.errors, []); await desktop.page.close();
  console.log('PASS 1440px: main category tiles, native dropdown and compact suggestions.');

  const support = await openPreview(360, 800, 'full-owner', 'support');
  await support.button('بررسی کالاهای تازه').click();
  await support.page.locator('.support-catalog-list').waitFor();
  await support.shot('inventory-support', support.page.locator('.support-catalog'));
  await support.button('تأیید برای بازبینی').click();
  await support.page.getByText('پیشنهادی با این وضعیت وجود ندارد.', { exact:true }).waitFor();
  await support.field('وضعیت بررسی پیشنهاد کالا').selectOption('approved');
  await support.page.locator('.support-catalog-list').waitFor();
  const downloadEvent = support.page.waitForEvent('download');
  await support.button('دریافت تأییدشده‌های این صفحه').click();
  const download = await downloadEvent;
  const stream = await download.createReadStream(); let exported = '';
  for await (const chunk of stream) exported += chunk.toString();
  const rows = JSON.parse(exported);
  assert.equal(rows.length, 2); assert.deepEqual(Object.keys(rows[0]).sort(), ['category','title','unit']);
  assert.deepEqual(support.errors, []); await support.page.close();
  for (const [scenario, text] of [['empty-owner','پیشنهادی با این وضعیت وجود ندارد.'], ['errors','دریافت اطلاعات پشتیبانی انجام نشد.'], ['loading','در حال دریافت پیشنهادهای کالا…']]) {
    const state = await openPreview(1440, 960, scenario, 'support');
    await state.button('بررسی کالاهای تازه').click();
    if (scenario === 'errors') await state.page.locator('.support-catalog [role=alert]').waitFor();
    else await state.page.getByText(text, { exact:true }).waitFor();
    assert.deepEqual(state.errors, []); await state.page.close();
  }
  console.log('PASS support: independent review UI, approved-page export without private fields, empty/error/loading states.');
} finally { await browser.close(); }
