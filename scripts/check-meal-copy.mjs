import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect as baseExpect } from 'playwright/test';

const expect = baseExpect.configure({ timeout: 25000 });

// Draft/picker checks only: never Apply, Undo or write actual application source.
const reviewUrl = process.env.KHANEYAR_MEALS_PREVIEW_URL || (await readFile(new URL('../../preview-url.txt', import.meta.url), 'utf8')).trim();
const base = new URL(reviewUrl).origin;
assert.equal(new URL(base).hostname, '127.0.0.1');
assert(!['5700', '5701'].includes(new URL(base).port), 'Use the isolated meals preview');
const out = fileURLToPath(new URL('../../browser-report/copy/', import.meta.url));
await mkdir(out, { recursive: true });
const catalog = await (await fetch(base + '/__copy/catalog')).json();
const mealEntries = catalog.entries.filter(entry => /(?:features\/meals\/|pages\/MealsPage\/|domain\/meal\/)/.test(entry.file));
for (const text of ['امروز چی بخوریم؟', 'در حال آماده‌کردن کتابخانهٔ غذاها…', 'فهرست غذاها دریافت نشد.',
  'در حال دریافت مواد اولیه…', 'مواد اولیهٔ این غذا دریافت نشد.', 'یکی را انتخاب کنید',
  'برای مواد انتخاب‌شده، یک گزینه یا نام مشخص وارد کنید.', 'بستن پنجرهٔ غذا',
  'جای غذاهای محبوب خانه اینجاست.', 'غذایی با این انتخاب پیدا نشد.', 'در حال ذخیره…']) {
  assert(mealEntries.some(entry => entry.text === text), 'Missing editable text: ' + text);
}
assert(catalog.entries.some(entry => entry.id === 'meals.library.slot-save-failed'));
const entry = mealEntries.find(entry => entry.text === 'امروز چی بخوریم؟');
const digest = value => createHash('sha256').update(value).digest('hex');
const sourceDigests = new Map(await Promise.all([...new Set(mealEntries.map(value => value.file))].map(async file => [file, digest(await readFile(file))])));
const browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'chrome' });
const errors = [], unexpectedWrites = [], checks = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(25000);
await page.route(/\/__copy\/(?:apply|undo)(?:\?|$)/, async route => { unexpectedWrites.push(route.request().url()); await route.abort(); });
// No source writes occur in this test. Reuse the freshly read real catalogue so
// repeated whole-workspace scans on a busy Windows host do not hit the editor's
// 20-second request deadline. Picker metadata and the bridge remain real.
await page.route('**/__copy/catalog', route => route.fulfill({ json: catalog }));
await page.route('**/__copy/status', async route => {
  const response = await route.fetch({ url: base + '/__copy/status?quick=1' });
  await route.fulfill({ response });
});
const frame = () => page.frameLocator('#copy-preview');
const ready = async () => { await expect(page.locator('#preview-state')).toHaveText('آماده', { timeout: 60000 }); };
const select = async (target = entry) => {
  await page.locator('#copy-search').fill(target.text);
  await page.locator('#catalog-list [data-copy-id="' + target.id + '"]').click();
  await expect(page.locator('#copy-original')).toHaveText(target.text);
};
try {
  await page.goto(base);
  await ready();
  await page.locator('#preview-route').selectOption('meals');
  await ready();
  await expect(frame().locator('.meal-hero-copy h2')).toHaveText(entry.text);
  await page.locator('#copy-search').fill('');
  await page.locator('#pick-text').click();
  await frame().locator('.meal-hero-copy h2').click();
  await expect(page.locator('#picked-note')).toBeVisible();
  await expect(page.locator('#copy-original')).toHaveText(entry.text);
  await page.locator('#pick-text').click();
  await page.locator('#clear-pick').click();
  checks.push('Static meals text picks the actual source identity');

  const fallback = mealEntries.find(value => value.text === 'برای این وعده غذا انتخاب کنیم');
  assert(fallback);
  const slotText = frame().locator('.meal-slot-dish:not(.assigned) > span').first();
  await expect(slotText).toHaveText(fallback.text);
  await select(fallback);
  await page.locator('#copy-edit').fill('Choose a meal');
  await expect(slotText).toHaveText('Choose a meal');
  await page.locator('#copy-edit').fill('');
  await expect(slotText).toHaveText('');
  await page.locator('#copy-edit').fill('Choose again');
  await expect(slotText).toHaveText('Choose again');
  await page.locator('#reset-all').click();
  await expect(slotText).toHaveText(fallback.text);
  checks.push('Display fallbacks inside protected meal surfaces remain editable after English and empty drafts');

  await frame().locator('.meals-tabs').getByRole('button', { name: 'کتابخانهٔ غذاها', exact: true }).click();
  await expect(frame().locator('.meal-food-tile')).toHaveCount(24);
  // A deliberate collision checks that dataset text cannot inherit a literal's identity.
  await frame().locator('.meal-food-copy b').first().evaluate((node, text) => { node.textContent = text; }, entry.text);
  await frame().locator('.meal-category-strip [data-meal-content]').first().evaluate((node, text) => { node.textContent = text; }, entry.text);
  await select();
  await page.locator('#copy-edit').fill('What shall we cook today?');
  await expect(frame().locator('.meal-hero-copy h2')).toHaveText('What shall we cook today?');
  await expect(frame().locator('.meal-food-copy b').first()).toHaveText(entry.text);
  await expect(frame().locator('.meal-category-strip [data-meal-content]').first()).toHaveText(entry.text);
  const selectedBefore = await page.locator('#copy-original').textContent();
  await page.locator('#pick-text').click();
  await frame().locator('.meal-food-copy b').first().click();
  await expect(page.locator('#preview-state')).toContainText('اطلاعات نمونهٔ کاربر');
  assert.equal(await page.locator('#copy-original').textContent(), selectedBefore);
  await frame().locator('.meal-category-strip [data-meal-content]').first().click();
  await expect(page.locator('#preview-state')).toContainText('اطلاعات نمونهٔ کاربر');
  await page.locator('#pick-text').click();
  checks.push('Library titles and source categories cannot be picked or changed by colliding fixed-copy drafts');

  await page.locator('#copy-edit').fill('');
  await expect(frame().locator('.meal-hero-copy h2')).toHaveText('');
  await select();
  await page.locator('#copy-edit').fill('A second English edit');
  await expect(frame().locator('.meal-hero-copy h2')).toHaveText('A second English edit');
  await page.locator('#reset-all').click();
  await expect(frame().locator('.meal-hero-copy h2')).toHaveText(entry.text);
  await expect(page.locator('#apply-changes')).toBeDisabled();
  checks.push('English, empty and repeated edits stay selectable and reset to the original without source writes');

  await frame().locator('.meal-food-tile').first().click();
  await expect(frame().locator('.meal-name-ingredient')).not.toHaveCount(0);
  await frame().getByRole('textbox', { name: 'نام غذا در فهرست خانواده' }).fill(entry.text);
  await select();
  await page.locator('#copy-edit').fill('Unrelated fixed copy');
  await expect(frame().locator('.meal-hero-copy h2')).toHaveText('Unrelated fixed copy');
  await expect(frame().getByRole('textbox', { name: 'نام غذا در فهرست خانواده' })).toHaveValue(entry.text);
  await page.locator('#reset-all').click();
  checks.push('Dish input values remain user data during fixed-copy editing');
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedWrites, []);
  for (const [file, hash] of sourceDigests) assert.equal(digest(await readFile(file)), hash, file);
  await writeFile(out + '/result.json', JSON.stringify({ passed: true, mealEditableTexts: mealEntries.length, checks, errors, sourceUnchanged: true, catalogSnapshot: true }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, sourceUnchanged: true }, null, 2));
} catch (error) {
  await page.screenshot({ path: out + '/failure.png', timeout: 5000 }).catch(() => {});
  await writeFile(out + '/result.json', JSON.stringify({ passed: false, checks, errors, unexpectedWrites, failure: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
