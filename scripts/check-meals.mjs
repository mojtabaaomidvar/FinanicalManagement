import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = 'http://127.0.0.1:5700';
const marker = 'meals-e2e-' + Date.now();
const tokens = [];
let browser, context, page, actor, destination, retryList, week;
const createdEntries = [];
const createdDishes = [];
const createdLists = [];

async function api(path, token, method = 'GET', body, expected = [200, 201, 204]) {
  const response = await fetch(base + '/api/v1' + path, {
    method, headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(expected.includes(response.status), method + ' ' + path + ': ' + response.status);
  return response.status === 204 ? null : response.json();
}

async function loginApi(phone) {
  const result = await api('/auth/login', null, 'POST', { phone, password: 'Test12345!' });
  tokens.push(result.session_token);
  return result.session_token;
}

async function loginUi(target, phone) {
  await target.goto(base, { waitUntil: 'networkidle' });
  if (!(await target.getByPlaceholder('شماره موبایل', { exact: true }).count())) {
    await target.getByRole('button', { name: 'ورود', exact: true }).click();
  }
  await target.getByPlaceholder('شماره موبایل', { exact: true }).first().fill(phone);
  await target.getByPlaceholder('رمز عبور', { exact: true }).fill('Test12345!');
  const login = target.waitForResponse(response => response.url().endsWith('/auth/login'));
  await target.locator('form').filter({ has: target.getByPlaceholder('رمز عبور', { exact: true }) })
    .locator('button[type=submit]').click();
  tokens.push((await (await login).json()).session_token);
  await target.getByText('برنامهٔ غذایی', { exact: true }).waitFor();
}

async function openMeals(target = page) {
  if (!(await target.getByRole('heading', { name: 'برنامهٔ غذایی', exact: true }).isVisible())) {
    await target.getByText('برنامهٔ غذایی', { exact: true }).click();
  }
  await target.getByRole('heading', { name: 'برنامهٔ غذایی', exact: true }).waitFor();
  await target.getByRole('button', { name: 'غذای جدید', exact: true }).waitFor({ state: 'visible' });
  await target.waitForFunction(() => document.querySelector('.meals-page')?.getAttribute('aria-busy') === 'false');
  assert.equal(await target.locator('.meals-page [role=alert]').count(), 0, 'Meal loading failed');
}

async function screenshot(name, target = page) {
  assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page overflows');
  for (const sheet of await target.locator('.modal-sheet').all()) {
    assert.ok(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Mobile sheet overflows');
  }
  await target.screenshot({ path: '.local-test/' + name + '.png', fullPage: true });
}

async function assign(day, mealType, dish) {
  const card = page.locator('.meals-days > .card').nth(day);
  const slot = card.locator('.meal-slot').nth(mealType);
  assert.equal(await slot.locator('input[type=checkbox]').count(), 0, 'Refusing to modify an existing manual slot');
  await slot.getByRole('button').click();
  await page.getByLabel('غذای وعده', { exact: true }).selectOption(dish.id);
  const saved = page.waitForResponse(response => response.url().endsWith('/meals/plan') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'ذخیرهٔ وعده', exact: true }).click();
  const response = await saved;
  assert.equal(response.status(), 201);
  const entry = await response.json();
  createdEntries.push(entry);
  await page.waitForFunction(() => !document.querySelector('.modal-overlay') && document.querySelector('.meals-page')?.getAttribute('aria-busy') === 'false');
  return entry;
}

async function openImport(list) {
  await page.getByRole('button', { name: /^مواد لازم برای خرید/ }).click();
  await page.getByLabel('لیست خرید مقصد', { exact: true }).selectOption(list.id);
}

try {
  await mkdir('.local-test', { recursive: true });
  actor = await loginApi('09000000002');
  const other = await loginApi('09000000003');
  destination = await api('/shopping/lists', actor, 'POST', { title: marker + '-shopping' });
  retryList = await api('/shopping/lists', actor, 'POST', { title: marker + '-retry' });
  createdLists.push(destination, retryList);
  const riceTitle = marker + '-rice', lentilTitle = marker + '-lentil';
  const existingRice = await api('/shopping/lists/' + destination.id + '/items', actor, 'POST', {
    title: riceTitle, qty: 9, unit: 'پیمانه', price: 12345,
  });
  const inventoryBefore = await api('/inventory', actor);
  const transactionsBefore = await api('/transactions', actor);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  page = await context.newPage();
  await loginUi(page, '09000000002');
  await openMeals();
  assert.equal(await page.locator('.meal-slot').count(), 21);
  assert.match(await page.locator('.meal-day-title').first().innerText(), /^شنبه/);
  assert.match(await page.locator('.meal-day-title').last().innerText(), /^جمعه/);
  const weekLabel = await page.locator('.meals-week-label').innerText();
  await page.getByRole('button', { name: 'هفتهٔ بعد', exact: true }).click();
  await page.waitForFunction(label => document.querySelector('.meals-week-label')?.textContent !== label, weekLabel);
  await openMeals();
  await page.getByRole('button', { name: 'هفتهٔ جاری', exact: true }).click();
  await openMeals();
  assert.equal(await page.locator('.meals-week-label').innerText(), weekLabel);
  await page.getByRole('button', { name: 'غذای جدید', exact: true }).click();
  await page.getByLabel('نام غذا', { exact: true }).fill(marker + '-dish');
  for (const [index, title, qty] of [[1, riceTitle, '۱٫۵'], [2, lentilTitle, '۱']]) {
    await page.getByRole('button', { name: 'افزودن مادهٔ لازم', exact: true }).click();
    const digit = String(index).replace(/\d/g, number => '۰۱۲۳۴۵۶۷۸۹'[Number(number)]);
    await page.getByLabel('نام مادهٔ ' + digit, { exact: true }).fill(title);
    await page.getByLabel('مقدار مادهٔ ' + digit, { exact: true }).fill(qty);
    await page.getByLabel('واحد مادهٔ ' + digit, { exact: true }).fill('پیمانه');
  }
  await screenshot('meals-mobile-form');
  const savedDish = page.waitForResponse(response => response.url().endsWith('/meals/dishes') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'ذخیرهٔ غذا', exact: true }).click();
  const dishResponse = await savedDish;
  assert.equal(dishResponse.status(), 201);
  const dish = await dishResponse.json();
  createdDishes.push(dish);
  assert.equal(Number(dish.ingredients[0].qty), 1.5, 'Persian decimal was misread');
  await page.waitForFunction(() => !document.querySelector('.modal-overlay') && document.querySelector('.meals-page')?.getAttribute('aria-busy') === 'false');
  // Find empty slots so existing manual test plans remain intact.
  const slots = await page.locator('.meal-slot').evaluateAll(rows => rows.map((row, index) => row.querySelector('input') ? null : index).filter(index => index !== null));
  assert.ok(slots.length >= 2, 'Two empty meal slots are needed for this check');
  const first = await assign(Math.floor(slots[0] / 3), slots[0] % 3, dish);
  await assign(Math.floor(slots[1] / 3), slots[1] % 3, dish);
  const firstDate = new Date(first.date + 'T12:00:00Z');
  firstDate.setUTCDate(firstDate.getUTCDate() - ((firstDate.getUTCDay() + 1) % 7));
  week = firstDate.toISOString().slice(0, 10);
  // Choose only this check's slots if there is an existing manual plan.
  for (const input of await page.locator('.meal-slot input[type=checkbox]').all()) {
    const row = input.locator('..').locator('..');
    await input.setChecked((await row.innerText()).includes(marker));
  }
  await screenshot('meals-mobile-week');
  await openImport(destination);
  assert.equal(await page.getByLabel('مقدار ' + riceTitle + ' ۱', { exact: true }).inputValue(), '۳');
  assert.equal(await page.getByLabel('مقدار ' + lentilTitle + ' ۲', { exact: true }).inputValue(), '۲');
  await page.getByLabel('مقدار ' + lentilTitle + ' ۲', { exact: true }).fill('۲٫۵');
  await screenshot('meals-mobile-shopping');
  const imported = page.waitForResponse(response => response.url().endsWith('/ensure-missing'));
  await page.getByRole('button', { name: 'افزودن ۲ ماده به خرید', exact: true }).click();
  const importResponse = await imported;
  assert.equal(importResponse.status(), 200);
  const result = await importResponse.json();
  assert.equal(result.added_count, 1); assert.equal(result.skipped_count, 1);
  await page.getByText('۱ ماده به لیست خرید اضافه شد.', { exact: true }).waitFor();
  await screenshot('meals-mobile-result');
  const changedList = (await api('/shopping/lists', actor)).find(list => list.id === destination.id);
  assert.deepEqual(changedList.items.find(item => item.id === existingRice.id), existingRice, 'Existing shopping item changed');
  assert.equal(Number(changedList.items.find(item => item.title === lentilTitle).qty), 2.5);
  assert.deepEqual(await api('/inventory', actor), inventoryBefore, 'Meal import changed inventory');
  assert.deepEqual(await api('/transactions', actor), transactionsBefore, 'Meal import changed transactions');
  await page.getByRole('button', { name: 'بستن', exact: true }).click();
  // Commit the operation while losing its response, then retry the unchanged form.
  await openImport(retryList);
  const operationIds = [];
  let loseResponse = true;
  await page.route('**/ensure-missing', async route => {
    operationIds.push(route.request().postDataJSON().operation_id);
    if (loseResponse) {
      loseResponse = false;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'افزودن ۲ ماده به خرید', exact: true }).click();
  await page.locator('.meals-sheet [role=alert]').waitFor();
  assert.equal((await api('/shopping/lists', actor)).find(list => list.id === retryList.id).items.length, 2);
  const replayed = page.waitForResponse(response => response.url().endsWith('/ensure-missing') && response.ok());
  await page.getByRole('button', { name: 'افزودن ۲ ماده به خرید', exact: true }).click();
  assert.equal((await (await replayed).json()).replayed, true);
  await page.getByText('۲ ماده به لیست خرید اضافه شد.', { exact: true }).waitFor();
  assert.equal(operationIds.length, 2); assert.equal(operationIds[0], operationIds[1]);
  assert.equal((await api('/shopping/lists', actor)).find(list => list.id === retryList.id).items.length, 2);
  await page.unroute('**/ensure-missing');
  await page.getByRole('button', { name: 'بستن', exact: true }).click();
  // Another ordinary member can read shared meals but cannot edit their creator's records.
  await api('/meals/dishes/' + dish.id, other, 'PATCH', { title: 'forbidden', ingredients: [], base_revision: dish.revision }, [403]);
  const otherContext = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran' });
  const otherPage = await otherContext.newPage();
  await loginUi(otherPage, '09000000003'); await openMeals(otherPage);
  await otherPage.getByRole('button', { name: 'فهرست غذاها', exact: true }).click();
  await otherPage.getByRole('button', { name: 'جزئیات ' + dish.title, exact: true }).click();
  assert.equal(await otherPage.getByLabel('نام غذا', { exact: true }).isDisabled(), true);
  assert.equal(await otherPage.getByRole('button', { name: 'ذخیرهٔ غذا', exact: true }).count(), 0);
  await otherContext.close();
  await page.getByRole('button', { name: 'غذای جدید', exact: true }).click();
  await page.getByLabel('نام غذا', { exact: true }).fill(marker + '-unsaved');
  await context.setOffline(true);
  await page.getByText('مشاهده و مدیریت برنامهٔ غذایی به اتصال اینترنت و ورود معتبر نیاز دارد.', { exact: true }).waitFor();
  assert.equal(await page.locator('.modal-overlay').count(), 0, 'Offline form retained');
  assert.equal(await page.locator('.meal-slot').count(), 0, 'Offline meal data retained');
  await context.setOffline(false); await openMeals();
  await page.getByRole('button', { name: 'غذای جدید', exact: true }).click();
  assert.equal(await page.getByLabel('نام غذا', { exact: true }).inputValue(), '', 'Offline draft leaked after reconnect');
  await page.keyboard.press('Escape');
  // Edit/delete through the same UI with fresh revisions.
  await page.getByRole('button', { name: 'فهرست غذاها', exact: true }).click();
  await page.getByRole('button', { name: 'جزئیات ' + dish.title, exact: true }).click();
  await page.getByLabel('نام غذا', { exact: true }).fill(marker + '-edited');
  await page.getByRole('button', { name: 'ذخیرهٔ غذا', exact: true }).click();
  await page.getByRole('button', { name: 'جزئیات ' + marker + '-edited', exact: true }).waitFor();
  await page.getByRole('button', { name: 'برنامهٔ هفته', exact: true }).click();
  for (const entry of createdEntries) {
    const card = page.locator('.meals-days > .card').filter({ has: page.locator('.meal-slot-dish', { hasText: marker + '-edited' }) });
    await card.locator('.meal-slot-dish').filter({ hasText: marker + '-edited' }).first().click();
    await page.getByRole('button', { name: 'برداشتن این وعده از برنامه', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.modal-overlay') && document.querySelector('.meals-page')?.getAttribute('aria-busy') === 'false');
  }
  await page.getByRole('button', { name: 'فهرست غذاها', exact: true }).click();
  await page.getByRole('button', { name: 'حذف ' + marker + '-edited', exact: true }).click();
  await page.getByRole('button', { name: 'حذف غذا', exact: true }).click();
  await page.getByRole('button', { name: 'جزئیات ' + marker + '-edited', exact: true }).waitFor({ state: 'hidden' });
  console.log('PASS: mobile meals CRUD, Jalali weeks, permissions, ingredients, shopping preservation, lost-response retry, offline clearing.');
} catch (error) {
  if (page) await page.screenshot({ path: '.local-test/meals-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  if (browser) await browser.close();
  if (actor && week) {
    const plan = await api('/meals/plan?week_start=' + week, actor).catch(() => ({ entries: [] }));
    for (const entry of plan.entries.filter(entry => createdEntries.some(created => created.id === entry.id))) {
      await api('/meals/plan/' + entry.id + '?base_revision=' + entry.revision, actor, 'DELETE').catch(() => {});
    }
  }
  if (actor) {
    const dishes = await api('/meals/dishes', actor).catch(() => []);
    for (const dish of dishes.filter(dish => createdDishes.some(created => created.id === dish.id))) {
      await api('/meals/dishes/' + dish.id + '?base_revision=' + dish.revision, actor, 'DELETE').catch(() => {});
    }
    for (const list of createdLists) await api('/shopping/lists/' + list.id, actor, 'DELETE').catch(() => {});
  }
  for (const token of tokens) await api('/auth/logout', token, 'POST').catch(() => {});
}
