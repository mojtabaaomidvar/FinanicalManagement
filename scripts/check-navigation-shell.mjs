import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createWorkbench } from './copy-workbench/server.mjs';

// Uses the isolated in-memory fixture launcher, never the production proxy.
const output = resolve('.local-test/navigation-shell');
await mkdir(output, { recursive: true });
const workbench = await createWorkbench({ port: 0 }); await workbench.initialized;
assert.equal(workbench.status().ready, true, workbench.status().message);
const base = workbench.origin, browser = await chromium.launch({ channel: 'msedge', headless: true });
const contexts = [], result = { checks: [], errors: [], externalRequests: [], screenshots: [], writes: [] };
const editor = await browser.newPage(); await editor.goto(base);
const token = await editor.evaluate(() => window.__COPY_WORKBENCH__.csrfToken); await editor.close();
let lastPage;
async function session(route = 'hub', scenario = 'full-owner', width = 390, direct = false) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: 'Asia/Tehran', isMobile: true, hasTouch: true }); contexts.push(context);
  await context.route('**/*', async interception => {
    const url = new URL(interception.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
      result.externalRequests.push(url.origin + url.pathname); await interception.abort();
    } else await interception.continue();
  });
  await context.route('**/__copy/ui/preview-bridge.js', async interception => {
    const response = await interception.fetch(), source = await response.text();
    assert.ok(source.includes("location.port !== '5701'"));
    let body = source.replace("location.port !== '5701'", `location.port !== '${new URL(base).port}'`);
    if (direct) {
      assert.ok(body.includes('navigate({ route: baseRoute, override: null });'));
      body = body.replace('navigate({ route: baseRoute, override: null });', '')
        .replace("await poll(() => document.querySelector('.hub-page'));", "await poll(() => document.querySelector('.page-visit:not([hidden])'));");
    }
    await interception.fulfill({ response, body });
  });
  const response = await context.request.post(base + '/__copy/preview', {
    headers: { Origin: base, 'X-Copy-Workbench-Token': token }, data: { route, scenarioId: scenario },
  }); assert.equal(response.status(), 200);
  const page = await context.newPage(); lastPage = page; page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    window.navigationTrace = [];
    for (const method of ['pushState', 'replaceState', 'back']) {
      const original = history[method].bind(history);
      history[method] = (...args) => { window.navigationTrace.push({ method, state: args[0] ?? history.state }); return original(...args); };
    }
    window.addEventListener('popstate', event => window.navigationTrace.push({ method: 'popstate', state: event.state }));
  });
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('request', request => { if (['POST', 'PATCH', 'DELETE'].includes(request.method()) && request.url().includes('/api/v1/')) result.writes.push(new URL(request.url()).pathname); });
  await page.goto(base + (await response.json()).url + (direct ? '#/' + route : ''));
  await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
  await current(page, route); return page;
}
function visit(page) { return page.locator('.page-visit:not([hidden])'); }
async function current(page, route) { await page.locator(`.page-visit[data-route="${route}"]:not([hidden])`).waitFor(); }
async function navigate(page, route) {
  await page.evaluate(route => window.dispatchEvent(new CustomEvent('copy-workbench:navigate', { detail: { route } })), route); await current(page, route);
}
async function back(page, expected, native = false) {
  if (native) await page.evaluate(() => history.back()); else await visit(page).locator('.shared-page-back:visible').click();
  await current(page, expected);
}
async function capture(page, name) {
  const path = resolve(output, name + '.png'); await page.screenshot({ path, animations: 'disabled' }); result.screenshots.push(path);
}
async function check(name, run) {
  if (process.env.NAV_CHECK && !name.includes(process.env.NAV_CHECK)) return;
  try { await run(); result.checks.push(name); console.log('PASS ' + name); }
  catch (error) {
    result.errors.push(name + ': ' + error.stack); console.error('FAIL ' + name + ': ' + error.message);
    if (lastPage && !lastPage.isClosed()) {
      const details = await lastPage.evaluate(() => {
        const calendar = document.querySelector('.household-calendar') ?? document.querySelector('.page-visit:not([hidden]) .shared-app-page');
        const fiberKey = calendar && Object.keys(calendar).find(key => key.startsWith('__reactFiber'));
        const components = [];
        const walk = fiber => {
          if (!fiber) return;
          const name = fiber.type?.name;
          if (typeof fiber.type === 'function') {
            const state = []; for (let hook = fiber.memoizedState; hook; hook = hook.next) {
              if (typeof hook.memoizedState === 'boolean' || typeof hook.memoizedState === 'string') state.push(hook.memoizedState);
              if (hook.memoizedState && typeof hook.memoizedState === 'object' && ['boolean', 'number'].includes(typeof hook.memoizedState.current)) state.push({ ref: hook.memoizedState.current });
            }
            const contexts = []; for (let dep = fiber.dependencies?.firstContext; dep; dep = dep.next) {
              if (typeof dep.memoizedValue === 'boolean') contexts.push(dep.memoizedValue);
            }
            components.push({ name, open: fiber.memoizedProps?.open, title: typeof fiber.memoizedProps?.title === 'string' ? fiber.memoizedProps.title : undefined,
              state, contexts, child: Boolean(fiber.child), alternateChild: Boolean(fiber.alternate?.child) });
          }
          walk(fiber.child); walk(fiber.sibling);
        };
        walk(fiberKey ? calendar[fiberKey].return : null);
        return { trace: window.navigationTrace, route: document.querySelector('.page-visit:not([hidden])')?.dataset.route,
          modals: document.querySelectorAll('.modal-overlay').length, datePickers: document.querySelectorAll('.dp-overlay').length, components, settingsScrollTrace: window.settingsScrollTrace, writes: [] };
      });
      details.writes = result.writes;
      await writeFile(resolve(output, 'failure-' + result.errors.length + '.json'), JSON.stringify(details, null, 2));
      await capture(lastPage, 'failure-' + result.errors.length);
    }
  }
}
try {
  await check('actual internal and browser Back/Forward across modules', async () => {
    const page = await session();
    await page.locator('.floating-navigation button').nth(1).click(); await current(page, 'sections');
    await navigate(page, 'vehicles'); await navigate(page, 'documents');
    await back(page, 'vehicles'); await back(page, 'sections', true);
    await page.evaluate(() => history.forward()); await current(page, 'vehicles');
    await page.locator('.floating-navigation button').first().click(); await current(page, 'hub');
    await back(page, 'vehicles'); await page.context().close();
  });
  await check('transaction search and content scroll survive return', async () => {
    const page = await session('transactions');
    const search = visit(page).locator('input[type=search], .list-toolbar input, .search-input').first();
    await search.fill('خرید'); await search.blur();
    await navigate(page, 'calendar'); await back(page, 'transactions'); assert.equal(await search.inputValue(), 'خرید');
    await search.fill(''); await search.blur();
    const scroll = visit(page).locator('.page-scroll');
    await scroll.evaluate(element => { element.scrollTop = 250; });
    const position = await scroll.evaluate(element => element.scrollTop); assert.ok(position > 0);
    await navigate(page, 'accounts'); await back(page, 'transactions');
    await page.waitForFunction(expected => document.querySelector('.page-visit:not([hidden]) .page-scroll').scrollTop === expected, position);
    await capture(page, 'transactions-restored'); await page.context().close();
  });
  await check('all 24 route headers stationary with one main scroll area', async () => {
    const page = await session('sections', 'full-owner', 360);
    for (const route of ['hub', 'sections', 'notifications', 'sms', 'dashboard', 'transactions', 'reports', 'accounts', 'budgets', 'bills', 'calendar', 'shopping', 'inventory', 'tasks', 'documents', 'meals', 'equipment', 'vehicles', 'goals', 'activities', 'children', 'pets', 'market', 'settings']) {
      await navigate(page, route);
      const header = visit(page).locator('.shared-page-header'); await header.waitFor();
      const before = await header.boundingBox();
      await visit(page).locator('.page-scroll').evaluate(element => { element.scrollTop = 400; });
      const after = await header.boundingBox(); assert.equal(after.y, before.y, route);
      assert.equal(await visit(page).locator('.page-scroll').count(), 1, route);
      const geometry = await visit(page).evaluate(element => {
        const h = element.querySelector('.shared-page-header').getBoundingClientRect(), s = element.querySelector('.page-scroll').getBoundingClientRect();
        return { headerBottom: h.bottom, contentTop: s.top, bodyScroll: document.scrollingElement.scrollTop, width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth };
      });
      assert.ok(geometry.contentTop >= geometry.headerBottom - 1, route); assert.equal(geometry.bodyScroll, 0, route); assert.equal(geometry.width, geometry.scrollWidth, route);
      await capture(page, 'module-' + route);
    } await page.context().close();
  });
  await check('calendar month selection survives leaving and returning', async () => {
    const page = await session('calendar'); await visit(page).getByRole('button', { name: 'ماه بعد', exact: true }).click();
    const month = await visit(page).locator('.cal-month').innerText();
    await navigate(page, 'children'); await back(page, 'calendar'); assert.equal(await visit(page).locator('.cal-month').innerText(), month); await page.context().close();
  });
  await check('family subpage Back closes subpage, next Back returns to previous module', async () => {
    const page = await session('children'); await navigate(page, 'settings');
    await visit(page).getByRole('button', { name: 'اعضای خانواده' }).click(); await visit(page).locator('h1').filter({ hasText: 'خانواده' }).waitFor();
    await visit(page).locator('.shared-page-back:visible').click(); await visit(page).locator('h1:visible').filter({ hasText: 'تنظیمات' }).waitFor();
    await back(page, 'children'); await page.context().close();
  });
  await check('assistant input reopens empty without implicit analysis', async () => {
    const page = await session('hub', 'assistant-bread-zero'); await page.locator('.floating-assistant').click();
    await page.locator('.household-assistant textarea').fill('گفت‌وگوی نیمه‌کاره');
    await page.locator('.household-assistant').getByRole('button', { name: 'بستن دستیار', exact: true }).click();
    await page.locator('.floating-assistant').click(); assert.equal(await page.locator('.household-assistant textarea').inputValue(), '');
    assert.equal(result.writes.filter(path => path.endsWith('/assistant/report')).length, 0); await page.context().close();
  });
  await check('settings profile draft and main-list scroll survive subpage and route Back', async () => {
    const page = await session('settings');
    const mainScroll = visit(page).locator('.page-scroll:visible');
    await mainScroll.evaluate(element => {
      window.settingsScrollTrace = [];
      const record = event => window.settingsScrollTrace.push({ type: event.type, value: element.scrollTop, hidden: Boolean(element.closest('[hidden]')) });
      element.addEventListener('scroll', record);
      document.addEventListener('click', record, true);
    });
    // The profile row is at the top: clicking it resets scroll to reveal/focus
    // it. Use an in-view lower row for the nonzero subpage-scroll assertion.
    await mainScroll.evaluate(element => { element.scrollTop = 180; });
    await visit(page).getByRole('button', { name: 'اعضای خانواده' }).click();
    await visit(page).locator('h1:visible').filter({ hasText: 'خانواده' }).waitFor();
    const position = await page.evaluate(() => window.settingsScrollTrace.find(event => event.type === 'click').value); assert.ok(position > 0);
    await visit(page).locator('.shared-page-back:visible').click();
    await visit(page).locator('h1:visible').filter({ hasText: 'تنظیمات' }).waitFor();
    assert.equal(await mainScroll.evaluate(element => element.scrollTop), position);
    await mainScroll.evaluate(element => { element.scrollTop = 0; });
    await visit(page).locator('.set-row-profile').click();
    const name = visit(page).locator('input[placeholder="نام شما"]'); await name.fill('نام ناتمام'); await name.blur();
    const writes = result.writes.filter(path => path !== '/api/v1/usage/open').length;
    await visit(page).locator('.shared-page-back:visible').click();
    await visit(page).locator('h1:visible').filter({ hasText: 'تنظیمات' }).waitFor();
    assert.equal(await mainScroll.evaluate(element => element.scrollTop), 0);
    await visit(page).locator('.set-row-profile').click(); assert.equal(await name.inputValue(), 'نام ناتمام');
    await navigate(page, 'children'); assert.equal(await page.locator('.modal-overlay').count(), 0);
    await back(page, 'settings'); assert.equal(await name.inputValue(), 'نام ناتمام');
    await visit(page).locator('.shared-page-back:visible').click();
    await visit(page).locator('h1:visible').filter({ hasText: 'تنظیمات' }).waitFor();
    assert.equal(result.writes.filter(path => path !== '/api/v1/usage/open').length, writes); await page.context().close();
  });
  await check('rapid scroll and navigation preserve position before a queued scroll event', async () => {
    const page = await session('settings');
    for (const position of [120, 240, 180]) {
      await page.evaluate(position => {
        document.querySelector('.page-visit:not([hidden]) .page-scroll').scrollTop = position;
        window.dispatchEvent(new CustomEvent('copy-workbench:navigate', { detail: { route: 'calendar' } }));
      }, position);
      await current(page, 'calendar'); await back(page, 'settings');
      assert.equal(await visit(page).locator('.page-scroll:visible').evaluate(element => element.scrollTop), position);
    }
    await page.context().close();
  });
  await check('inactive calendar form owns no portal or Back guard and returns with its draft', async () => {
    const page = await session('calendar'); await visit(page).getByRole('button', { name: '+ افزودن', exact: true }).click();
    const input = page.locator('.modal-sheet input[type="text"]').first(); await input.fill('رویداد ناتمام'); await input.blur();
    const writes = result.writes.filter(path => path !== '/api/v1/usage/open').length;
    await navigate(page, 'children'); assert.equal(await page.locator('.modal-overlay').count(), 0);
    assert.equal(await page.locator('.page-visit[data-route="calendar"]').getAttribute('inert'), '');
    await back(page, 'calendar'); await page.locator('.modal-sheet').waitFor(); assert.equal(await input.inputValue(), 'رویداد ناتمام');
    await page.evaluate(() => history.back()); await page.locator('.modal-sheet').waitFor({ state: 'hidden' }); await current(page, 'calendar');
    assert.equal(result.writes.filter(path => path !== '/api/v1/usage/open').length, writes); await page.context().close();
  });
  await check('direct hash entry uses logical parent after anonymous boot', async () => {
    const page = await session('vehicles', 'full-owner', 390, true);
    await back(page, 'sections'); await page.context().close();
  });
  await check('nested date picker is hidden with its cached form and Back closes only the top layer', async () => {
    const page = await session('calendar'); await visit(page).getByRole('button', { name: '+ افزودن', exact: true }).click();
    await page.locator('.modal-sheet .date-field').click(); await page.locator('.dp-overlay').waitFor();
    await page.locator('.dp-overlay').getByRole('button', { name: 'ماه بعد', exact: true }).click();
    const month = await page.locator('.dp-overlay .dp-title-btn').innerText();
    const writes = result.writes.filter(path => path !== '/api/v1/usage/open').length;
    await navigate(page, 'children'); assert.equal(await page.locator('.modal-overlay, .dp-overlay').count(), 0);
    await back(page, 'calendar'); await page.locator('.dp-overlay').waitFor(); await page.locator('.modal-sheet').waitFor();
    assert.equal(await page.locator('.dp-overlay .dp-title-btn').innerText(), month);
    await capture(page, 'nested-calendar-restored');
    await page.evaluate(() => history.back()); await page.locator('.dp-overlay').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.modal-sheet').isVisible(), true);
    await page.evaluate(() => history.back()); await page.locator('.modal-sheet').waitFor({ state: 'hidden' }); await current(page, 'calendar');
    assert.equal(result.writes.filter(path => path !== '/api/v1/usage/open').length, writes);
    await page.context().close();
  });
  await check('cached financial pages are evicted on offline transition', async () => {
    const page = await session('transactions'); await navigate(page, 'vehicles');
    await page.context().setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline'))); await current(page, 'hub');
    assert.equal(await page.locator('.page-visit[data-route="transactions"], .page-visit[data-route="vehicles"]').count(), 0);
    await page.evaluate(() => history.back()); await current(page, 'hub'); await page.context().close();
  });
  await check('overlapping vehicle sheets restore pointer order and Escape closes only the upper form', async () => {
    const page = await session('vehicles'); await visit(page).locator('.vehicle-details').first().click();
    const detail = page.locator('.vehicle-detail-body'); await detail.waitFor();
    await detail.getByRole('button', { name: 'ویرایش خودرو', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'نام خودرو', exact: true }); await input.fill('خودروی ناتمام'); await input.blur();
    assert.equal(await page.locator('.modal-overlay').count(), 2);
    const writes = result.writes.filter(path => path !== '/api/v1/usage/open').length;
    await navigate(page, 'calendar'); assert.equal(await page.locator('.modal-overlay').count(), 0);
    await back(page, 'vehicles'); await input.waitFor(); assert.equal(await input.inputValue(), 'خودروی ناتمام');
    await input.click(); await input.blur(); // Real hit testing, not a forced click through another sheet.
    await capture(page, 'vehicle-sheets-restored');
    await page.keyboard.press('Escape'); await input.waitFor({ state: 'hidden' }); assert.equal(await detail.isVisible(), true);
    await page.waitForFunction(() => history.state?.k === 1);
    await page.evaluate(() => history.back()); await detail.waitFor({ state: 'hidden' }); await current(page, 'vehicles');
    assert.equal(result.writes.filter(path => path !== '/api/v1/usage/open').length, writes); await page.context().close();
  });
  await check('SMS entry reopens empty but inbox remains intact', async () => {
    const page = await session('sms', 'sms-pending'); const count = await visit(page).locator('[data-sms-id]').count(); assert.ok(count > 0);
    await visit(page).getByRole('button', { name: 'ورود پیامک', exact: true }).click(); await page.locator('#sms-import-text').fill('متن واردنشده');
    await page.locator('.modal-sheet').getByRole('button', { name: 'انصراف', exact: true }).click();
    await visit(page).getByRole('button', { name: 'ورود پیامک', exact: true }).click(); assert.equal(await page.locator('#sms-import-text').inputValue(), '');
    await page.locator('.modal-sheet').getByRole('button', { name: 'انصراف', exact: true }).click(); assert.equal(await visit(page).locator('[data-sms-id]').count(), count);
    await page.context().close();
  });
  await check('keyboard viewport keeps form inside available height and hides floating bar', async () => {
    const page = await session('sms', 'sms-pending'); await visit(page).getByRole('button', { name: 'ورود پیامک', exact: true }).click();
    await page.locator('#sms-import-text').focus();
    await page.evaluate(() => {
      const viewport = window.visualViewport;
      Object.defineProperty(viewport, 'height', { configurable: true, value: 430 }); viewport.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(() => document.querySelector('.application-shell').classList.contains('keyboard-open'));
    await page.waitForFunction(() => {
      const box = document.querySelector('.modal-sheet').getBoundingClientRect();
      return box.y >= 0 && box.bottom <= 431;
    });
    const box = await page.locator('.modal-sheet').boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= 431, JSON.stringify(box));
    await capture(page, 'keyboard-sms'); await page.context().close();
  });
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close(); await workbench.close(); await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2));
}
assert.deepEqual(result.externalRequests, []); assert.deepEqual(result.errors, []);
console.log('PASS navigation shell: ' + result.checks.length + ' isolated browser checks');
