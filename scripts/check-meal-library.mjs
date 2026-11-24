import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { expect as baseExpect } from 'playwright/test';

const expect = baseExpect.configure({ timeout: 25000 });

const reviewUrl = process.env.KHANEYAR_MEALS_PREVIEW_URL || (await readFile(new URL('../../preview-url.txt', import.meta.url), 'utf8')).trim();
const base = new URL(reviewUrl).origin;
assert.equal(new URL(base).hostname, '127.0.0.1');
assert(!['5700', '5701'].includes(new URL(base).port), 'Use the isolated meals preview, not the manual sandbox or primary copy editor');
const browserName = process.env.KHANEYAR_TEST_BROWSER || 'chrome';
const out = process.env.KHANEYAR_MEALS_REPORT || fileURLToPath(new URL('../../browser-report/' + browserName + '/', import.meta.url));
await mkdir(out, { recursive: true });
const html = await (await fetch(base)).text();
const { csrfToken } = JSON.parse(html.match(/window\.__COPY_WORKBENCH__=(\{[^;]+\});/)[1]);
const index = await (await fetch(base + '/meal-library/index.json')).json();
const dataDirectory = new URL('../public/meal-library/', import.meta.url);
const shardFiles = (await readdir(dataDirectory)).filter(name => name.startsWith('details-'));
const details = (await Promise.all(shardFiles.map(async file => JSON.parse(await readFile(new URL(file, dataDirectory), 'utf8'))))).flat();
assert.equal(index.foodCount, 4583); assert.equal(index.variantCount, 5832);
const browser = browserName === 'firefox' ? await firefox.launch() : await chromium.launch({ channel: browserName });
const errors = [], checks = [], layouts = [];
let activePage;
async function open(width = 360, scenarioId = 'full-owner', setup, pageOptions = {}) {
  const response = await fetch(base + '/__copy/preview', { method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', 'X-Copy-Workbench-Token': csrfToken },
    body: JSON.stringify({ scenarioId, route: 'meals' }) });
  assert.equal(response.status, 200);
  const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block', ...pageOptions });
  activePage = page;
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  if (setup) await setup(page);
  await page.goto(base + (await response.json()).url);
  await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
  await expect(page.locator('.meals-page')).toBeVisible();
  await expect(page.getByText('در حال دریافت برنامهٔ غذایی…', { exact: true })).toHaveCount(0);
  return page;
}
async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' overflows');
  const layout = await page.evaluate(() => {
    const width = selector => document.querySelector(selector)?.getBoundingClientRect().width ?? 0;
    const columns = selector => {
      const node = document.querySelector(selector);
      return node ? getComputedStyle(node).gridTemplateColumns.split(' ').length : 1;
    };
    return { content: width('.meals-content'), sheet: width('.meals-sheet'),
      libraryColumns: columns('.meal-library-grid'), weekColumns: columns('.meals-days.full-week') };
  });
  assert(layout.content <= 520 + 1, name + ' must retain the standard mobile app column');
  assert(layout.sheet <= 552 + 1, name + ' must retain the standard app sheet width');
  assert.equal(layout.libraryColumns, 1, name + ' library must remain single-column');
  assert.equal(layout.weekColumns, 1, name + ' full week must remain single-column');
  layouts.push({ name, viewport: page.viewportSize().width, ...layout });
  await page.screenshot({ path: out + '/' + name + '.png', fullPage: false, animations: 'disabled' });
}
const tab = (page, name) => page.locator('.meals-tabs').getByRole('button', { name, exact: true }).click();
const close = page => page.getByRole('button', { name: 'بستن پنجرهٔ غذا', exact: true }).click();
try {
  for (const width of [320, 360, 390, 430, 768, 1440]) {
    // Isolate viewport cases; reduced motion keeps size assertions independent
    // from transient route/sheet entrance transforms.
    const responsive = await open(width, 'full-owner', undefined, { reducedMotion: 'reduce' });
    await shot(responsive, 'responsive-day-' + width);
    await responsive.getByRole('button', { name: 'نمای کامل هفته', exact: true }).click();
    await expect(responsive.locator('.meal-slot')).toHaveCount(21);
    await shot(responsive, 'responsive-week-' + width);
    await responsive.locator('.meal-day-button').first().click();
    await tab(responsive, 'کتابخانهٔ غذاها');
    await expect(responsive.locator('.meal-food-tile')).toHaveCount(24);
    await shot(responsive, 'responsive-library-' + width);
    await responsive.locator('.meal-food-tile').first().click();
    await expect(responsive.locator('.meal-name-ingredient')).not.toHaveCount(0);
    await shot(responsive, 'responsive-detail-' + width);
    await close(responsive);
    await expect(responsive.getByRole('dialog')).toHaveCount(0);
    await responsive.close();
  }
  checks.push('Standard app column and sheet widths at 320/360/390/430/768/1440 px; single-column library/full-week; no page overflow');
  const page = await open();
  await expect(page.locator('.meal-day-button').first().locator('span').first()).toHaveText('شنبه');
  await expect(page.locator('.meal-slot')).toHaveCount(3);
  await shot(page, 'day-360');
  await page.getByRole('button', { name: 'نمای کامل هفته', exact: true }).click();
  await expect(page.locator('.meal-slot')).toHaveCount(21);
  await page.locator('.meal-day-button').nth(0).click();
  await expect(page.locator('.meal-slot')).toHaveCount(3);
  await tab(page, 'کتابخانهٔ غذاها');
  await expect(page.locator('.meal-food-tile')).toHaveCount(24);
  await shot(page, 'library-360');
  for (const tag of index.meals) {
    await page.locator('.meal-category-strip').getByRole('button', { name: tag.label, exact: true }).click();
    await expect(page.locator('.meal-food-tile')).toHaveCount(Math.min(24, index.foods.filter(food => food.meals.includes(tag.id)).length));
  }
  await page.locator('.meal-category-strip').getByRole('button', { name: 'همهٔ غذاها', exact: true }).click();
  for (const tag of index.categories) {
    await page.getByRole('combobox', { name: 'نوع غذا در کتابخانه' }).selectOption(tag.id);
    await expect(page.locator('.meal-food-tile')).toHaveCount(Math.min(24, index.foods.filter(food => food.categories.includes(tag.id)).length));
  }
  await page.getByRole('combobox', { name: 'نوع غذا در کتابخانه' }).selectOption('');
  await page.getByRole('searchbox', { name: 'جست‌وجو در کتابخانهٔ غذاها' }).fill('یک غذای کاملاً ناموجود ۹۸۷۶۵۴');
  await expect(page.getByText('غذایی با این انتخاب پیدا نشد.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'پاک‌کردن جست‌وجو و فیلترها' }).click();
  const food = index.foods.find(row => row.title === 'عدس پلو') ?? index.foods.find(row => row.variantCount > 1);
  await page.getByRole('searchbox', { name: 'جست‌وجو در کتابخانهٔ غذاها' }).fill(food.title);
  await page.getByRole('button', { name: 'مواد اولیهٔ ' + food.title, exact: true }).click();
  await expect(page.locator('.meal-name-ingredient')).not.toHaveCount(0);
  await expect(page.getByRole('button', { name: 'افزودن به غذاهای خانواده', exact: true })).toBeVisible();
  await shot(page, 'detail-360');
  if (food.variantCount > 1) {
    await page.getByRole('combobox', { name: 'ترکیب مواد اولیه', exact: true }).selectOption('1');
    const details = await (await fetch(base + '/meal-library/' + food.detailFile)).json();
    const variant = details.find(row => row.id === food.id).variants[1];
    await expect(page.locator('.meal-name-ingredient')).toHaveCount(variant.items.filter(item => item.kind !== 'equipment').length);
  }
  await page.getByRole('textbox', { name: 'نام غذا در فهرست خانواده' }).fill('تست کتابخانه بدون مقدار');
  const submitted = page.waitForRequest(request => request.url().endsWith('/meals/dishes') && request.method() === 'POST');
  await page.getByRole('button', { name: 'افزودن به غذاهای خانواده', exact: true }).click();
  const payload = (await submitted).postDataJSON();
  assert(payload.ingredients.every(row => row.qty === null && row.unit === null));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await tab(page, 'غذاهای خانواده');
  await expect(page.getByRole('button', { name: 'جزئیات تست کتابخانه بدون مقدار', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'جزئیات نمونه: غذای هفته', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'جزئیات نمونه: غذای هفته', exact: true }).click();
  await page.getByRole('button', { name: 'نمایش مقادیر ثبت‌شده', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'مقدار مادهٔ ۱', exact: true })).toHaveValue('۲');
  await page.getByRole('button', { name: 'بستن مقادیر ثبت‌شده', exact: true }).click();
  const edited = page.waitForRequest(request => /\/meals\/dishes\/[^/]+$/.test(new URL(request.url()).pathname) && request.method() === 'PATCH');
  await page.getByRole('button', { name: 'ذخیرهٔ غذا', exact: true }).click();
  const oldIngredients = (await edited).postDataJSON().ingredients;
  assert.deepEqual(oldIngredients.map(row => [row.qty, row.unit]), [[2, 'پیمانه'], [1, 'کیلوگرم']]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await tab(page, 'برنامهٔ هفته');
  await page.locator('.meal-slot-dish').first().click();
  await expect(page.getByRole('searchbox', { name: 'جست‌وجوی غذای وعده' })).toBeVisible();
  assert(await page.evaluate(() => document.activeElement.closest('[role="dialog"]') !== null));
  await shot(page, 'chooser-360');
  await page.getByRole('radio', { name: /تست کتابخانه بدون مقدار/ }).check();
  await page.getByRole('button', { name: 'ذخیرهٔ وعده', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await shot(page, 'assigned-360');
  await page.locator('.meal-shopping-panel summary').click();
  await page.getByRole('button', { name: /^مواد لازم برای خرید \(/ }).click();
  await expect(page.getByText('مقدار دستور غذا مشخص نیست؛ مقدار خرید را خودتان وارد کنید.').first()).toBeVisible();
  await page.getByRole('button', { name: /^افزودن .* ماده به خرید$/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'خودتان وارد کنید' })).toBeVisible();
  await close(page);
  checks.push('Day/full-week planner, every source tag and category, search/empty/reset, variants, null persistence, old numeric dishes, chooser and shopping unknown-quantity validation');
  await page.close();

  const desktop = await open(1440);
  await shot(desktop, 'day-1440');
  await tab(desktop, 'کتابخانهٔ غذاها');
  await expect(desktop.locator('.meal-food-tile')).toHaveCount(24);
  await shot(desktop, 'library-1440');
  await desktop.locator('.meal-food-tile').first().click();
  await expect(desktop.locator('.meal-name-ingredient')).not.toHaveCount(0);
  await shot(desktop, 'detail-1440');
  await close(desktop);
  await desktop.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await shot(desktop, 'library-dark-1440');
  await desktop.close();

  const failure = await open(360, 'empty-owner');
  let block = true;
  await failure.route('**/meal-library/index.json', route => block ? route.fulfill({ status: 503, body: '{}' }) : route.continue());
  await tab(failure, 'کتابخانهٔ غذاها');
  await expect(failure.getByText('فهرست غذاها دریافت نشد.', { exact: true })).toBeVisible();
  block = false;
  await failure.getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
  await expect(failure.locator('.meal-food-tile')).toHaveCount(24);
  await tab(failure, 'برنامهٔ هفته');
  await failure.locator('.meal-slot-dish').first().click();
  await expect(failure.locator('.meal-food-tile')).toHaveCount(24);
  await failure.locator('.meal-food-tile').first().click();
  await expect(failure.locator('.meal-name-ingredient')).not.toHaveCount(0);
  await failure.route('**/meals/plan', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'SYNC_CONFLICT', message: 'وعده هم‌زمان تغییر کرده است.' }) }) : route.continue());
  await failure.getByRole('textbox', { name: 'نام غذا در فهرست خانواده' }).fill('غذای حفظ‌شده پس از تعارض');
  await failure.getByRole('button', { name: 'ذخیرهٔ غذا و انتخاب برای وعده', exact: true }).click();
  await expect(failure.getByRole('alert').filter({ hasText: 'غذا در فهرست خانواده ذخیره شد' })).toBeVisible();
  await expect(failure.getByRole('radio', { name: /غذای حفظ‌شده پس از تعارض/ })).toBeChecked();
  await close(failure);
  await tab(failure, 'غذاهای خانواده');
  await expect(failure.getByRole('button', { name: 'جزئیات غذای حفظ‌شده پس از تعارض', exact: true })).toBeVisible();
  await failure.getByRole('button', { name: 'جزئیات غذای حفظ‌شده پس از تعارض', exact: true }).click();
  await failure.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
  await expect(failure.getByRole('dialog')).toHaveCount(0);
  await expect(failure.locator('.meal-dish-details')).toHaveCount(0);
  await failure.close();
  checks.push('Desktop/dark layouts, catalogue failure/retry, empty household direct-library chooser, preserved family save after slot conflict, offline private-data/form clearing');

  const choices = await open();
  await tab(choices, 'کتابخانهٔ غذاها');
  await expect(choices.locator('.meal-food-tile')).toHaveCount(24);
  for (const kind of ['choice', 'open_choice', 'equipment', 'unresolved']) {
    const detail = details.find(row => row.variants[0].items.some(item => item.kind === kind));
    assert(detail, 'Missing test case: ' + kind);
    const food = index.foods.find(row => row.id === detail.id);
    await choices.getByRole('searchbox', { name: 'جست‌وجو در کتابخانهٔ غذاها' }).fill(food.title);
    await choices.getByRole('button', { name: 'مواد اولیهٔ ' + food.title, exact: true }).click();
    await expect(choices.locator('.meal-name-ingredient')).not.toHaveCount(0);
    const included = detail.variants[0].items.filter(item => item.kind !== 'equipment');
    if (included.some(item => item.required && item.kind !== 'ingredient')) {
      await choices.getByRole('button', { name: 'افزودن به غذاهای خانواده', exact: true }).click();
      await expect(choices.getByRole('alert').filter({ hasText: 'یک گزینه یا نام مشخص' })).toBeVisible();
    }
    for (let n = 0; n < included.length; n++) {
      const item = included[n];
      if (!item.required || item.kind === 'ingredient') continue;
      const row = choices.locator('.meal-name-ingredient').nth(n);
      if (item.kind === 'choice' && !item.allowCustom) await row.getByRole('combobox').selectOption(item.options[0]);
      else if (item.kind === 'unresolved') await row.getByRole('checkbox').uncheck();
      else await row.getByRole('textbox').fill('جعفری انتخابی');
    }
    await shot(choices, kind + '-360');
    await choices.getByRole('textbox', { name: 'نام غذا در فهرست خانواده' }).fill('تست انتخاب ' + kind);
    const submission = choices.waitForRequest(request => request.url().endsWith('/meals/dishes') && request.method() === 'POST');
    await choices.getByRole('button', { name: 'افزودن به غذاهای خانواده', exact: true }).click();
    const payload = (await submission).postDataJSON();
    assert(payload.ingredients.every(row => row.qty === null));
    for (const equipment of detail.variants[0].items.filter(item => item.kind === 'equipment')) assert(!payload.ingredients.some(row => row.title === equipment.name));
    await expect(choices.getByRole('dialog')).toHaveCount(0);
  }
  await tab(choices, 'غذاهای خانواده');
  await choices.getByRole('button', { name: 'جزئیات نمونه: غذای هفته', exact: true }).click();
  await choices.route('**/meals/dishes/*', route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'MEAL_FORBIDDEN', message: 'اجازهٔ تغییر این غذا را ندارید.' }) }) : route.continue());
  await choices.getByRole('button', { name: 'ذخیرهٔ غذا', exact: true }).click();
  await expect(choices.getByRole('dialog')).toHaveCount(0);
  await expect(choices.locator('.meal-dish-details')).toHaveCount(0);
  await choices.close();
  checks.push('Required alternatives/custom choices validate before writes; explicit unresolved omission; equipment exclusion; scoped dialog focus; forbidden writes clear private data');

  const states = await open(360, 'empty-owner');
  let releaseIndex, indexStarted;
  const indexRequested = new Promise(resolve => { indexStarted = resolve; });
  await states.route('**/meal-library/index.json', async route => {
    await new Promise(resolve => { releaseIndex = resolve; indexStarted(); }); await route.continue();
  });
  await tab(states, 'کتابخانهٔ غذاها');
  await expect(states.getByText('در حال آماده‌کردن کتابخانهٔ غذاها…', { exact: true })).toBeVisible();
  await indexRequested;
  releaseIndex();
  await expect(states.locator('.meal-food-tile')).toHaveCount(24);
  let failDetail = true, releaseDetail, detailStarted;
  const detailRequested = new Promise(resolve => { detailStarted = resolve; });
  await states.route('**/meal-library/details-*.json', async route => {
    if (failDetail) await route.fulfill({ status: 503, body: '{}' });
    else { await new Promise(resolve => { releaseDetail = resolve; detailStarted(); }); await route.continue(); }
  });
  await states.locator('.meal-food-tile').first().click();
  await expect(states.getByText('مواد اولیهٔ این غذا دریافت نشد.', { exact: true })).toBeVisible();
  failDetail = false;
  await states.getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
  await expect(states.getByText('در حال دریافت مواد اولیه…', { exact: true })).toBeVisible();
  await detailRequested;
  releaseDetail();
  await expect(states.locator('.meal-name-ingredient')).not.toHaveCount(0);
  const firstControl = states.getByRole('button', { name: 'بستن پنجرهٔ غذا', exact: true });
  const lastControl = states.getByRole('button', { name: 'افزودن به غذاهای خانواده', exact: true });
  await lastControl.focus(); await lastControl.press('Tab'); await expect(firstControl).toBeFocused();
  await firstControl.press('Shift+Tab'); await expect(lastControl).toBeFocused();
  await lastControl.press('Escape'); await expect(states.getByRole('dialog')).toHaveCount(0);
  await states.close();
  // Fixture dishes belong to the current actor by default. Model another creator
  // explicitly rather than treating a member's own editable dish as forbidden.
  const member = await open(360, 'full-member', async page => {
    await page.route('**/meals/dishes', async route => {
      const response = await route.fetch();
      const rows = await response.json();
      rows[0] = { ...rows[0], created_by: '00000000-0000-4000-8000-000000000001', can_edit: false, can_delete: false };
      await route.fulfill({ response, json: rows });
    });
  });
  await tab(member, 'غذاهای خانواده');
  await member.getByRole('button', { name: 'جزئیات نمونه: غذای هفته', exact: true }).click();
  await expect(member.getByRole('textbox', { name: 'نام غذا', exact: true })).toBeDisabled();
  await expect(member.getByRole('button', { name: 'ذخیرهٔ غذا', exact: true })).toHaveCount(0);
  await close(member);
  await member.getByRole('button', { name: 'جزئیات نمونه: صبحانه', exact: true }).click();
  await expect(member.getByRole('textbox', { name: 'نام غذا', exact: true })).toBeEnabled();
  await expect(member.getByRole('button', { name: 'ذخیرهٔ غذا', exact: true })).toBeVisible();
  await close(member);
  await member.close();
  checks.push('Library and detail loading states, detail failure/retry, complete Tab/Shift+Tab trap and Escape, read-only member dish controls, preserved hidden numeric amounts on save');
  assert.deepEqual(errors, []);
  await writeFile(out + '/result.json', JSON.stringify({ passed: true, sourceMeals: index.meals.length, sourceCategories: index.categories.length, checks, layouts, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, out, checks, errors }, null, 2));
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: out + '/failure.png', timeout: 5000 }).catch(() => {});
    console.error((await activePage.locator('body').innerText({ timeout: 5000 }).catch(() => '')).slice(0, 2200));
  }
  await writeFile(out + '/result.json', JSON.stringify({ passed: false, checks, layouts, errors, failure: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
