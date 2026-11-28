import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { createWorkbench } from './copy-workbench/server.mjs';

const output = resolve('.local-test/quick-add-browser');
await mkdir(output, { recursive: true });
const workbench = await createWorkbench({ port: 0 });
await workbench.initialized;
assert.equal(workbench.status().ready, true, workbench.status().message);
const base = workbench.origin;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const result = { checks: [], screenshots: [], errors: [], externalRequests: [], productionWrites: 0, manualWrites: 0 };
const editor = await browser.newPage(); await editor.goto(base);
const token = await editor.evaluate(() => window.__COPY_WORKBENCH__.csrfToken);
await editor.close();
const catalog = await (await fetch(base + '/__copy/catalog')).json();
let lastPage;
async function session(scenario = 'full-owner', width = 360, configure) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: 'Asia/Tehran' });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
      result.externalRequests.push(url.origin + url.pathname); return route.abort();
    }
    if (url.pathname.includes('/__copy/apply')) throw new Error('Source apply is forbidden in this check');
    return route.continue();
  });
  await context.route('**/__copy/ui/preview-bridge.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("location.port !== '5701'", `location.port !== '${new URL(base).port}'`)
      .replaceAll("document.querySelector('.hub-page')", "document.querySelector('.page-visit:not([hidden])')") });
  });
  const response = await context.request.post(base + '/__copy/preview', {
    headers: { Origin: base, 'X-Copy-Workbench-Token': token }, data: { scenarioId: scenario, route: 'hub' },
  });
  assert.equal(response.status(), 200);
  const page = await context.newPage(); lastPage = page; page.setDefaultTimeout(15000);
  page.on('pageerror', error => result.errors.push(error.message));
  if (configure) await configure(page);
  await page.goto(base + (await response.json()).url);
  await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
  await page.getByRole('button', { name: 'افزودن سریع', exact: true }).waitFor();
  return page;
}
async function capture(page, name) {
  const path = resolve(output, name + '.png');
  await page.screenshot({ path, fullPage: true, animations: 'disabled' }); result.screenshots.push(path);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
}
async function check(name, run) {
  if (process.env.QUICK_ADD_CHECK && !name.includes(process.env.QUICK_ADD_CHECK)) return;
  await run(); result.checks.push(name); console.log('PASS ' + name);
}
async function choose(page, label) {
  await page.getByRole('button', { name: 'افزودن سریع', exact: true }).click();
  await page.locator('#quick-add-menu').getByRole('button', { name: label, exact: true }).click();
}
async function finance(page, label) {
  await choose(page, 'تراکنش مالی');
  await page.locator('#quick-add-menu').getByRole('button', { name: label, exact: true }).click();
}
async function api(page, path) {
  return page.evaluate(async path => (await fetch('/api/v1' + path)).json(), path);
}
async function focusInside(page, selector = '.modal-sheet') {
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press(key);
      assert.ok(await page.locator(selector).last().evaluate(node => node.contains(document.activeElement)), key + ' focus escaped');
    }
  }
}
try {
  await check('copy coverage includes quick menu, accessible names and non-success states', async () => {
    for (const text of ['افزودن سریع', 'قلم خرید', 'کار خانه', 'رویداد خانوادگی', 'وعدهٔ غذایی', 'نوع تراکنش مالی',
      'جای خالی در برنامهٔ این هفته نیست؛ می‌توانید وعده‌های ثبت‌شده را بررسی کنید.',
      'این افزودن به اتصال اینترنت نیاز دارد؛ خرید و کار خانه آفلاین در دسترس‌اند.']) {
      assert.ok(catalog.entries.some(entry => entry.text === text), text);
    }
  });
  await check('menu order, keyboard traversal, stacked Escape/back and outside click', async () => {
    const page = await session();
    await page.getByRole('button', { name: 'افزودن سریع', exact: true }).click();
    const menu = page.locator('#quick-add-menu');
    assert.deepEqual(await menu.locator('button').allTextContents(), ['تراکنش مالی', 'قلم خرید', 'کار خانه', 'رویداد خانوادگی', 'وعدهٔ غذایی']);
    await page.keyboard.press('End'); await expect(menu.locator('button').last()).toBeFocused();
    await page.keyboard.press('Home'); await expect(menu.locator('button').first()).toBeFocused();
    await page.keyboard.press('Enter'); await expect(menu.getByRole('button', { name: 'هزینه', exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(menu.getByRole('button', { name: 'قلم خرید', exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'افزودن سریع', exact: true })).toBeFocused();
    await choose(page, 'تراکنش مالی'); await page.evaluate(() => history.back());
    await expect(menu.getByRole('button', { name: 'قلم خرید', exact: true })).toBeVisible();
    await page.evaluate(() => history.back()); await expect(menu).toHaveCount(0);
    await page.getByRole('button', { name: 'افزودن سریع', exact: true }).click();
    await page.locator('.home-header, .hub-head').first().click({ position: { x: 10, y: 10 } });
    await expect(menu).toHaveCount(0);
    await page.context().close();
  });
  for (const width of [320, 360, 390, 1440]) await check('layout and fullscreen at ' + width, async () => {
    const page = await session('full-owner', width);
    await page.getByRole('button', { name: 'افزودن سریع', exact: true }).click();
    const nav = await page.locator('.floating-navigation').boundingBox(), fab = await page.locator('.floating-quick-add').boundingBox();
    assert.ok(fab.y + fab.height <= nav.y, 'FAB above navigation');
    assert.ok(await page.locator('#quick-add-menu button').evaluateAll(items => items.every(node => node.getBoundingClientRect().height >= 44)));
    await capture(page, 'menu-' + width);
    await page.locator('#quick-add-menu').getByRole('button', { name: 'کار خانه', exact: true }).click();
    await page.getByRole('dialog', { name: 'کار جدید', exact: true }).waitFor();
    const sheet = await page.locator('.modal-sheet.is-mobile-fullscreen').boundingBox();
    if (width < 640) assert.ok(Math.abs(sheet.height - 844) <= 2, 'fullscreen viewport');
    await capture(page, 'task-' + width);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'افزودن سریع', exact: true }).waitFor();
    await expect(page.getByRole('button', { name: 'افزودن سریع', exact: true })).toBeFocused();
    await page.context().close();
  });
  await check('existing financial forms, exact types, focus isolation and child calendar', async () => {
    const page = await session();
    const before = await api(page, '/transactions');
    for (const label of ['هزینه', 'درآمد', 'انتقال']) {
      await finance(page, label);
      await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.page-visit:not([hidden])')).toHaveAttribute('data-route', 'transactions');
      assert.equal(await page.locator('#root').evaluate(node => node.inert), true);
      await focusInside(page);
      await page.keyboard.press('Escape'); await expect(page.locator('.modal-overlay')).toHaveCount(0);
    }
    await finance(page, 'هزینه');
    await page.locator('.tx-simple-details > summary').click();
    await page.locator('.tx-simple .date-field').first().click();
    await page.getByRole('dialog', { name: 'انتخاب تاریخ', exact: true }).waitFor();
    await focusInside(page, '.dp-box');
    await page.keyboard.press('Escape'); await expect(page.locator('.dp-overlay')).toHaveCount(0);
    await expect(page.locator('.tx-simple')).toBeVisible();
    await page.keyboard.press('Escape');
    assert.deepEqual(await api(page, '/transactions'), before);
    assert.equal(await page.locator('#root').evaluate(node => node.inert), false);
    await page.context().close();
  });
  await check('shopping without a list continues to the existing item form once', async () => {
    const page = await session('empty-owner'); const before = await api(page, '/transactions');
    await choose(page, 'قلم خرید');
    await page.getByRole('dialog', { name: 'لیست جدید', exact: true }).waitFor();
    await page.getByPlaceholder('مثلاً سوپرمارکت', { exact: true }).fill('لیست آزمایشی');
    await page.getByRole('button', { name: 'ساختنِ لیست', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'افزودن قلم', exact: true }); await dialog.waitFor();
    await dialog.getByPlaceholder('مثلاً شیر', { exact: true }).fill('قلم آزمایشی');
    await dialog.getByRole('button', { name: 'افزودن', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const lists = await api(page, '/shopping/lists');
    assert.equal(lists.length, 1); assert.equal(lists[0].items.length, 1); assert.equal(lists[0].items[0].title, 'قلم آزمایشی');
    assert.deepEqual(await api(page, '/transactions'), before);
    await page.context().close();
  });
  await check('task validation preserves the draft and focus', async () => {
    const page = await session('save-errors');
    await choose(page, 'کار خانه'); const dialog = page.getByRole('dialog', { name: 'کار جدید', exact: true });
    await dialog.waitFor(); await dialog.getByLabel('عنوان کار', { exact: true }).fill('');
    await dialog.getByRole('button', { name: 'ثبت کار', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByLabel('عنوان کار', { exact: true }).fill('پیش‌نویس حفظ شود');
    await expect(dialog.getByLabel('عنوان کار', { exact: true })).toHaveValue('پیش‌نویس حفظ شود');
    await focusInside(page); await capture(page, 'task-validation-error');
    await page.keyboard.press('Escape'); await page.context().close();
  });
  await check('online activity save failure retains its draft and destination', async () => {
    const page = await session('save-errors');
    await choose(page, 'رویداد خانوادگی');
    const dialog = page.getByRole('dialog', { name: 'برنامهٔ جدید', exact: true }); await dialog.waitFor();
    await dialog.getByLabel('عنوان برنامه', { exact: true }).fill('برنامهٔ ذخیره‌نشده');
    await dialog.getByRole('button', { name: 'ذخیرهٔ برنامه', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByLabel('عنوان برنامه', { exact: true })).toHaveValue('برنامهٔ ذخیره‌نشده');
    await capture(page, 'activity-save-error'); await page.keyboard.press('Escape'); await page.context().close();
  });
  await check('family event uses the existing activity form and calendar source', async () => {
    const page = await session();
    const before = await api(page, '/activities');
    await choose(page, 'رویداد خانوادگی');
    const dialog = page.getByRole('dialog', { name: 'برنامهٔ جدید', exact: true }); await dialog.waitFor();
    await dialog.getByLabel('عنوان برنامه', { exact: true }).fill('برنامهٔ آزمایشی جدید');
    await dialog.getByRole('button', { name: 'ذخیرهٔ برنامه', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const after = await api(page, '/activities'); assert.equal(after.activities.length, before.activities.length + 1);
    await page.context().close();
  });
  await check('meal without dishes creates a dish then continues to the same empty slot', async () => {
    const page = await session('empty-owner'); const before = await api(page, '/transactions');
    await choose(page, 'وعدهٔ غذایی');
    await page.getByRole('dialog', { name: 'غذای جدید', exact: true }).waitFor();
    await page.getByLabel('نام غذا', { exact: true }).fill('غذای آزمایشی');
    await page.getByRole('button', { name: 'ذخیرهٔ غذا', exact: true }).click();
    await page.getByRole('dialog', { name: 'انتخاب غذای وعده', exact: true }).waitFor();
    await page.getByRole('button', { name: 'ذخیرهٔ وعده', exact: true }).click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    assert.deepEqual(await api(page, '/transactions'), before);
    await page.context().close();
  });
  await check('reduced motion and dark layout', async () => {
    const page = await session();
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await page.getByRole('button', { name: 'افزودن سریع', exact: true }).click();
    await capture(page, 'menu-dark-reduced-motion');
    assert.ok(await page.locator('.floating-quick-add').evaluate(node => parseFloat(getComputedStyle(node).transitionDuration) < 0.001));
    await page.context().close();
  });
  await check('scroll collapses the FAB inside the retained page scroller', async () => {
    const page = await session();
    await page.locator('.page-visit:not([hidden]) .page-scroll').evaluate(node => { node.scrollTop = 200; });
    await expect(page.locator('.floating-quick-add')).toHaveClass(/is-collapsed/);
    await page.getByRole('button', { name: 'افزودن سریع', exact: true }).click();
    await capture(page, 'collapsed-menu');
    await page.locator('.page-visit:not([hidden]) .page-scroll').evaluate(node => { node.scrollTop = 0; });
    await expect(page.locator('.floating-quick-add')).not.toHaveClass(/is-collapsed/);
    await page.context().close();
  });
  await check('English and empty quick-add copy keeps its source slot and action', async () => {
    const page = await session(), entry = catalog.entries.find(entry => entry.file.endsWith('/FloatingNavigation.tsx') && entry.text === 'قلم خرید');
    assert.ok(entry);
    for (const text of ['Shopping item', '', 'Shopping item']) {
      await page.evaluate(draft => window.postMessage({ type: 'copy-drafts', drafts: [draft] }, location.origin),
        { id: entry.id, original: entry.text, text, matchingIds: [entry.id], tokens: [] });
      await page.getByRole('button', { name: 'افزودن سریع', exact: true }).click();
      const item = page.locator('#quick-add-menu .quick-add-item').nth(1);
      await expect(item.locator('span')).toHaveText(text);
      await item.click(); await page.getByRole('dialog', { name: 'افزودن قلم', exact: true }).waitFor();
      await page.keyboard.press('Escape');
    }
    await page.context().close();
  });
  await check('ordinary members retain the existing activity access and task form', async () => {
    const page = await session('full-member');
    await choose(page, 'کار خانه');
    await page.getByRole('dialog', { name: 'کار جدید', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await choose(page, 'رویداد خانوادگی');
    await page.getByRole('dialog', { name: 'برنامهٔ جدید', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await page.context().close();
  });
  await check('offline keeps permitted task and shopping paths and blocks online forms', async () => {
    const page = await session('offline');
    await choose(page, 'تراکنش مالی');
    await page.locator('#quick-add-menu').getByRole('button', { name: 'هزینه', exact: true }).click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await choose(page, 'کار خانه');
    const dialog = page.getByRole('dialog', { name: 'کار جدید', exact: true }); await dialog.waitFor();
    await expect(dialog.getByText('در حالت آفلاین', { exact: false })).toBeVisible();
    await page.keyboard.press('Escape'); await choose(page, 'قلم خرید');
    await page.getByRole('dialog', { name: 'افزودن قلم', exact: true }).waitFor();
    await expect(page.getByText('قیمت‌ها در حالت آفلاین نمایش داده یا تغییر داده نمی‌شوند.', { exact: false })).toBeVisible();
    await page.context().close();
  });
  await check('meal read failure remains a retry state and never invents an empty slot', async () => {
    let fail = true;
    const page = await session('full-owner', 360, async page => {
      await page.route('**/api/v1/meals/dishes', route => fail
        ? route.fulfill({ status: 503, json: { error: { code: 'SERVER', message: 'خطای آزمایشی دریافت غذا' } } }) : route.continue());
    });
    await choose(page, 'وعدهٔ غذایی');
    await page.locator('.meals-page [role="alert"]').waitFor();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await capture(page, 'meal-load-error');
    fail = false;
    await page.locator('.meals-page').getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
    await page.getByRole('dialog', { name: 'انتخاب غذای وعده', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await page.context().close();
  });
  await check('full current week shows a reason and creates no replacement meal', async () => {
    const page = await session('full-owner', 360, async page => {
      await page.route('**/api/v1/meals/plan?*', async route => {
        const response = await route.fetch(), data = await response.json();
        const start = new URL(route.request().url()).searchParams.get('week_start');
        const sample = data.entries[0]; assert.ok(sample);
        const entries = Array.from({ length: 7 }, (_, day) => {
          const date = new Date(start + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + day);
          return ['breakfast', 'lunch', 'dinner', 'snack'].map((meal_type, index) => ({ ...sample,
            id: `${sample.id}-${day}-${index}`, date: date.toISOString().slice(0, 10), meal_type }));
        }).flat();
        await route.fulfill({ json: { ...data, entries } });
      });
    });
    await choose(page, 'وعدهٔ غذایی');
    await page.getByText('جای خالی در برنامهٔ این هفته نیست؛ می‌توانید وعده‌های ثبت‌شده را بررسی کنید.', { exact: true }).waitFor();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await capture(page, 'meal-week-full'); await page.context().close();
  });
  assert.deepEqual(result.errors, []); assert.deepEqual(result.externalRequests, []);
} catch (error) {
  result.failure = error.stack;
  if (lastPage && !lastPage.isClosed()) await capture(lastPage, 'failure').catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  await browser.close(); workbench.close();
}
