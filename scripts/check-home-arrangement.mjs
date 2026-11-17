import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { backupHomePreferences } from './sandbox-home-preferences.mjs';
import { chromium } from 'playwright';

// Real browser input against the isolated local app. Only personal navigation
// preferences of two named fake accounts are mutated. A durable backup restores
// their exact JSON/null and revisions; no household/profile records are edited.
const base = 'http://127.0.0.1:5700';
const artifactDir = resolve('.local-test/home-arrangement');
const preferencePath = '/members/me/home-preferences';
const groupIdsExpected = ['money', 'daily', 'belongings', 'family'];
const modulesExpected = ['finance', 'transactions', 'accounts', 'budgets', 'bills', 'market', 'reports',
  'chores', 'shopping', 'inventory', 'meals', 'equipment', 'vehicles', 'docs', 'calendar', 'activities', 'children', 'pets', 'goals'];
const defaults = () => ({ version: 1, layout: 'grouped', pins: ['chores', 'shopping', 'calendar'],
  openGroups: [], groupOrder: [...groupIdsExpected],
  groupModules: { money: modulesExpected.slice(0, 7), daily: modulesExpected.slice(7, 11),
    belongings: modulesExpected.slice(11, 14), family: modulesExpected.slice(14) }, flatOrder: [...modulesExpected] });
const checks = [], contexts = [], tokens = [], pageErrors = [], blockedRequests = [], cleanupErrors = [], screenshots = [];
let browser, owner, member, page, lastPage, fixtureBackup, backedUp = false, failure;
const pins = p => p.locator('.home-quick-access [data-shortcut-id]').evaluateAll(nodes => nodes.map(n => n.dataset.shortcutId));
const tiles = p => p.locator('.home-catalog [data-module-id]').evaluateAll(nodes => nodes.map(n => n.dataset.moduleId));
const groups = p => p.locator('details[data-home-group]').evaluateAll(nodes => nodes.map(n => n.dataset.homeGroup));
const group = (p, id) => p.locator('details[data-home-group="' + id + '"]');
const tile = (p, id) => p.locator('.home-catalog [data-module-id="' + id + '"]');
const shortcut = (p, id) => p.locator('[data-shortcut-id="' + id + '"]');
const handle = (p, kind, id) => p.locator('.home-modules [data-drag-' + kind + '="' + id + '"]');
const inGroup = (p, id) => group(p, id).locator('[data-module-id]').evaluateAll(nodes => nodes.map(n => n.dataset.moduleId));
const cacheKey = account => 'khaneyar:home:v1:' + encodeURIComponent(account.family_id) + ':' + encodeURIComponent(account.id);

async function api(path, token, method = 'GET', body, expected = [200, 201, 204]) {
  const response = await fetch(base + '/api/v1' + path, { method,
    headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(expected.includes(response.status), method + ' ' + path + ': HTTP ' + response.status);
  return response.status === 204 ? null : response.json();
}
async function loginApi(phone) {
  const data = await api('/auth/login', null, 'POST', { phone, password: 'Test12345!' });
  tokens.push(data.session_token);
  return { ...data.member, token: data.session_token, phone };
}
async function setRemote(account, preferences) {
  const remote = await api(preferencePath, account.token);
  return api(preferencePath, account.token, 'PATCH', { revision: remote.revision, preferences });
}
async function poll(test, message, p = page) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) { if (await test()) return; await p.waitForTimeout(100); }
  throw new Error(message);
}
async function ready(p = page) {
  await p.locator('.home-catalog').waitFor();
  await poll(async () => !(await p.locator('.home-quick-access .home-section-head > button').isDisabled()), 'Home preferences did not become ready', p);
}
async function settled(p = page, account = owner) {
  await ready(p);
  await poll(async () => p.evaluate(key => {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null'); return saved && !saved.pending;
  }, cacheKey(account)), 'The personal arrangement did not finish saving', p);
  assert.equal(await p.locator('.home-preferences-status[role="alert"]').count(), 0, 'An unexpected preference error is visible');
}
async function newPage(phone, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
    timezoneId: 'Asia/Tehran', serviceWorkers: 'block', reducedMotion: 'reduce', ...options });
  contexts.push(context);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) { blockedRequests.push({ origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  const p = await context.newPage(); lastPage = p;
  p.__homePatches = 0;
  p.on('pageerror', error => pageErrors.push(error.message));
  p.on('request', request => { if (request.method() === 'PATCH' && request.url().endsWith(preferencePath)) p.__homePatches++; });
  await p.goto(base, { waitUntil: 'networkidle' });
  assert.ok((await p.title()).includes('محیط تست محلی'), 'The page must be the isolated local sandbox');
  // Mobile first-run installation guidance precedes the sign-in screen.
  const understood = p.getByRole('button', { name: 'متوجه شدم', exact: true });
  await poll(async () => await understood.isVisible() || await p.getByPlaceholder('شماره موبایل', { exact: true }).count()
    || await p.getByRole('button', { name: 'ورود', exact: true }).isVisible(), 'The sign-in screen did not finish booting', p);
  if (await understood.isVisible()) await understood.click();
  await poll(async () => await p.getByPlaceholder('شماره موبایل', { exact: true }).count()
    || await p.getByRole('button', { name: 'ورود', exact: true }).isVisible(), 'The sign-in form is unavailable', p);
  if (!(await p.getByPlaceholder('شماره موبایل', { exact: true }).count())) await p.getByRole('button', { name: 'ورود', exact: true }).click();
  await p.getByPlaceholder('شماره موبایل', { exact: true }).first().fill(phone);
  await p.getByPlaceholder('رمز عبور', { exact: true }).fill('Test12345!');
  const login = p.waitForResponse(response => response.url().endsWith('/auth/login'));
  await p.locator('form').filter({ has: p.getByPlaceholder('رمز عبور', { exact: true }) }).locator('button[type=submit]').click();
  tokens.push((await (await login).json()).session_token);
  await ready(p); return p;
}
async function catalogIntact(p = page) {
  const ids = await tiles(p);
  assert.deepEqual([...ids].sort(), [...modulesExpected].sort());
  assert.equal(new Set(ids).size, 19);
  assert.equal(await p.locator('button button').count(), 0);
  assert.equal(await p.locator('.home-catalog [data-home-module]').count(), 19);
  assert.equal(await p.locator('.home-catalog [data-pin-module]').count(), 19);
}
async function noDrag(p = page) {
  assert.equal(await p.locator('.home-drag-ghost,.home-is-dragging,.home-drop-target,.home-drop-indicator:visible').count(), 0);
  assert.equal(await p.locator('body[data-home-dragging]').count(), 0);
  assert.equal(await p.locator('.home-arrange-dialog[open]').count(), 0);
  await catalogIntact(p);
}
async function setGroup(p, id, open) {
  if ((await group(p, id).getAttribute('open') !== null) !== open) await group(p, id).locator('summary .home-group-copy').click();
  await poll(async () => (await group(p, id).getAttribute('open') !== null) === open, 'Group open state did not settle', p);
  assert.ok(await p.locator('details[data-home-group][open]').count() <= 1, 'Only one Home group may be open');
}
async function collapse(p = page) { for (const id of await groups(p)) await setGroup(p, id, false); await settled(p); }
async function reveal(p, id) {
  const parent = await tile(p, id).evaluate(node => node.closest('details')?.dataset.homeGroup);
  if (parent) await setGroup(p, parent, true);
  await tile(p, id).waitFor({ state: 'visible' });
}
async function rect(locator) { const box = await locator.boundingBox(); assert.ok(box && box.width > 0 && box.height > 0, 'The drag control is not visible'); return box; }
const point = (box, edge = 'center') => ({
  x: edge === 'before' ? box.x + box.width - 12 : edge === 'after' ? box.x + 12 : box.x + box.width / 2,
  y: edge === 'top' ? box.y + 10 : edge === 'bottom' ? box.y + box.height - 10 : box.y + box.height / 2,
});
async function alignPair(p, source, target) {
  const boxes = await Promise.all([rect(source), rect(target)]);
  const top = Math.min(...boxes.map(box => box.y)), bottom = Math.max(...boxes.map(box => box.y + box.height));
  if (bottom - top <= p.viewportSize().height - 80) await p.evaluate(offset => scrollBy({ top: offset, behavior: 'instant' }), top - 80);
  else await source.scrollIntoViewIfNeeded();
}
async function reachTarget(p, target, edge, move) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const finish = point(await rect(target), edge), { height, width } = p.viewportSize();
    if (finish.y >= 40 && finish.y <= height - 40) return finish;
    await move({ x: Math.max(20, Math.min(width - 20, finish.x)), y: finish.y < 40 ? 8 : height - 8 });
    await p.waitForTimeout(60);
  }
  throw new Error('Drag edge scrolling did not reveal the target');
}
async function mouseDrag(p, source, target, { edge = 'center', cancel = false, invalid = false, hover = 120 } = {}) {
  await alignPair(p, source, target);
  const start = point(await rect(source));
  await p.mouse.move(start.x, start.y); await p.mouse.down();
  await p.mouse.move(start.x + 10, start.y + 4, { steps: 3 });
  await p.locator('.home-drag-ghost').waitFor({ state: 'visible' });
  const finish = invalid ? { x: 2, y: 2 } : await reachTarget(p, target, edge, value => p.mouse.move(value.x, value.y, { steps: 8 }));
  await p.mouse.move(finish.x, finish.y, { steps: 16 }); await p.waitForTimeout(hover);
  if (cancel) await p.keyboard.press('Escape');
  await p.mouse.up(); await p.waitForTimeout(400); await noDrag(p);
}
async function keyboardMove(p, kind, id, keys, commit = true) {
  const control = handle(p, kind, id); await control.scrollIntoViewIfNeeded(); await control.focus();
  await p.keyboard.press('Space');
  for (const key of keys) { await p.keyboard.press(key); await p.waitForTimeout(40); }
  await p.keyboard.press(commit ? 'Enter' : 'Escape'); await p.waitForTimeout(400); await noDrag(p);
}
async function layout(p, value) {
  await p.locator('.home-quick-access .home-section-head > button').click();
  await p.locator('#home-layout').selectOption(value);
  await p.getByRole('button', { name: 'بستن تنظیم چیدمان', exact: true }).click(); await settled(p);
}
async function screen(p, name, theme) {
  await p.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Home overflows at360px');
  const path = resolve(artifactDir, name + '.png'); await p.screenshot({ path, fullPage: true }); screenshots.push(path);
}
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }

try {
  await mkdir(artifactDir, { recursive: true });
  fixtureBackup = await backupHomePreferences('arrangement'); backedUp = true;
  owner = await loginApi('09000000001'); member = await loginApi('09000000002');
  const originalProfiles = [await api('/auth/members', owner.token), await api('/auth/members', member.token)];
  await setRemote(owner, defaults()); await setRemote(member, { ...defaults(), pins: ['goals', 'activities'] });
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  page = await newPage(owner.phone); await settled();

  await check('real grouped Home retains all19 modules, header settings, agenda and independent grips', async () => {
    await catalogIntact(); assert.deepEqual(await groups(page), groupIdsExpected);
    assert.deepEqual(await pins(page), ['chores', 'shopping', 'calendar']);
    assert.equal(await page.locator('details[data-home-group][open]').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'پروفایل و تنظیمات', exact: true }).count(), 1);
    assert.equal(await page.locator('.hub-overview').count(), 1);
    assert.ok(await page.locator('[data-home-drag]').evaluateAll(nodes => nodes.every(node => node.tagName === 'BUTTON'
      && getComputedStyle(node).touchAction === 'none' && node.getAttribute('aria-label'))));
  });
  await check('opening another Home group closes the previous group and reload retains only the selected group', async () => {
    await setGroup(page, 'money', true); await settled();
    await setGroup(page, 'daily', true); await settled();
    assert.equal(await group(page, 'money').getAttribute('open'), null);
    assert.deepEqual((await api(preferencePath, owner.token)).preferences.openGroups, ['daily']);
    await page.reload({ waitUntil: 'networkidle' }); await settled();
    assert.equal(await group(page, 'daily').getAttribute('open') !== null, true);
    assert.equal(await page.locator('details[data-home-group][open]').count(), 1);
    await page.evaluate(() => {
      for (const id of ['money', 'family', 'belongings', 'daily']) {
        document.querySelector('details[data-home-group="' + id + '"] > summary .home-group-copy').click();
      }
    });
    await settled();
    assert.deepEqual((await api(preferencePath, owner.token)).preferences.openGroups, ['daily']);
    assert.equal(await page.locator('details[data-home-group][open]').count(), 1);
    await setGroup(page, 'daily', false); await settled();
    assert.deepEqual((await api(preferencePath, owner.token)).preferences.openGroups, []);
  });
  await check('mouse reorders pins and collapsed groups and stores the real account', async () => {
    await mouseDrag(page, handle(page, 'pin', 'calendar'), shortcut(page, 'chores'), { edge: 'before' });
    assert.deepEqual(await pins(page), ['calendar', 'chores', 'shopping']); await settled();
    await collapse(); await mouseDrag(page, handle(page, 'group', 'family'), group(page, 'money').locator('summary'), { edge: 'top' });
    assert.deepEqual(await groups(page), ['family', 'money', 'daily', 'belongings']); await settled();
    const remote = await api(preferencePath, owner.token);
    assert.deepEqual(remote.preferences.pins, await pins(page)); assert.deepEqual(remote.preferences.groupOrder, await groups(page));
  });
  await check('mouse reorders a group and transfers into a collapsed group', async () => {
    await reveal(page, 'transactions'); await settled();
    await mouseDrag(page, handle(page, 'module', 'transactions'), tile(page, 'finance'), { edge: 'before' });
    assert.equal((await inGroup(page, 'money'))[0], 'transactions'); await settled();
    await mouseDrag(page, handle(page, 'module', 'finance'), group(page, 'family').locator('summary'));
    assert.ok((await inGroup(page, 'family')).includes('finance')); assert.ok(!(await inGroup(page, 'money')).includes('finance')); await settled();
    if (await group(page, 'family').getAttribute('open') === null) {
      assert.deepEqual(await page.evaluate(() => ({ tag: document.activeElement?.tagName,
        group: document.activeElement?.closest('details[data-home-group]')?.dataset.homeGroup })),
        { tag: 'SUMMARY', group: 'family' }, 'A fast collapsed drop must return focus to its visible group summary');
    }
  });
  await check('position controls transfer modules and an empty group accepts a mouse drop', async () => {
    for (const id of ['equipment', 'vehicles', 'docs']) {
      await reveal(page, id); await settled();
      await tile(page, id).locator('[data-home-arrange="module"]').click();
      await page.locator('#home-transfer-group').selectOption('daily');
      assert.equal(await page.locator('#home-transfer-group').inputValue(), 'daily');
      await page.getByRole('button', { name: 'بستن تنظیم چیدمان', exact: true }).click(); await settled();
    }
    assert.deepEqual(await inGroup(page, 'belongings'), []);
    await reveal(page, 'docs'); await settled();
    await mouseDrag(page, handle(page, 'module', 'docs'), group(page, 'belongings').locator('summary'), { hover: 850 });
    assert.deepEqual(await inGroup(page, 'belongings'), ['docs']); await settled();
    assert.equal(await page.locator('details[data-home-group][open]').count(), 1);
    assert.deepEqual((await api(preferencePath, owner.token)).preferences.openGroups, ['belongings']);
  });
  await check('catalog drag pins a shortcut without removing or duplicating its module', async () => {
    await collapse(); await reveal(page, 'finance'); await settled();
    await mouseDrag(page, handle(page, 'module', 'finance'), page.locator('[data-drop-pins]'));
    assert.equal((await pins(page)).filter(id => id === 'finance').length, 1);
    assert.ok((await inGroup(page, 'family')).includes('finance')); await settled();
    await shortcut(page, 'finance').locator('[data-pin-module]').click(); await settled();
    assert.ok(!(await pins(page)).includes('finance'));
  });
  await check('keyboard previews reorder and transfer on Enter; Escape changes no saved arrangement', async () => {
    await keyboardMove(page, 'pin', 'shopping', ['ArrowRight']); await settled();
    assert.deepEqual(await pins(page), ['calendar', 'shopping', 'chores']);
    await reveal(page, 'finance'); await settled();
    await keyboardMove(page, 'module', 'finance', ['Control+ArrowLeft']); await settled();
    assert.ok((await inGroup(page, 'money')).includes('finance'));
    assert.deepEqual((await api(preferencePath, owner.token)).preferences.openGroups, ['money']);
    const before = await api(preferencePath, owner.token), patchCount = page.__homePatches;
    const stored = await page.evaluate(key => localStorage.getItem(key), cacheKey(owner));
    await keyboardMove(page, 'pin', 'chores', ['ArrowRight'], false);
    assert.equal(page.__homePatches, patchCount); assert.deepEqual(await api(preferencePath, owner.token), before);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), cacheKey(owner)), stored);
  });
  await check('pointer cancellation, invalid drop and temporary group opening perform zero PATCH', async () => {
    await collapse(); await reveal(page, 'finance'); await settled();
    const before = await api(preferencePath, owner.token), patchCount = page.__homePatches;
    const stored = await page.evaluate(key => localStorage.getItem(key), cacheKey(owner));
    await mouseDrag(page, handle(page, 'module', 'finance'), group(page, 'belongings').locator('summary'), { cancel: true, hover: 850 });
    assert.equal(await group(page, 'belongings').getAttribute('open'), null);
    await mouseDrag(page, handle(page, 'pin', 'chores'), shortcut(page, 'calendar'), { invalid: true });
    // Agenda groups also carry data-home-group; they must be rejected as catalog targets.
    const agenda = page.locator('.hub-overview [data-home-group]').first();
    if (await agenda.count()) await mouseDrag(page, handle(page, 'group', 'money'), agenda);
    assert.equal(page.__homePatches, patchCount); assert.deepEqual(await api(preferencePath, owner.token), before);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), cacheKey(owner)), stored);
  });
  await check('flat order saves independently from custom group membership and survives reload', async () => {
    const before = (await api(preferencePath, owner.token)).preferences.groupModules;
    await layout(page, 'flat');
    await mouseDrag(page, handle(page, 'module', 'transactions'), tile(page, 'finance'), { edge: 'before' }); await settled();
    assert.deepEqual((await tiles(page)).slice(0, 2), ['transactions', 'finance']);
    await page.reload({ waitUntil: 'networkidle' }); await settled();
    assert.deepEqual((await tiles(page)).slice(0, 2), ['transactions', 'finance']);
    await layout(page, 'grouped');
    assert.deepEqual((await api(preferencePath, owner.token)).preferences.groupModules, before);
  });
  await check('a new browser session restores preferences and a second real user remains independent', async () => {
    const saved = (await api(preferencePath, owner.token)).preferences;
    const fresh = await newPage(owner.phone); await settled(fresh);
    assert.deepEqual(await pins(fresh), saved.pins); assert.deepEqual(await groups(fresh), saved.groupOrder);
    for (const id of groupIdsExpected) assert.deepEqual(await inGroup(fresh, id), saved.groupModules[id]);
    const other = await newPage(member.phone); await settled(other, member);
    assert.deepEqual(await pins(other), ['goals', 'activities']);
    await keyboardMove(other, 'pin', 'activities', ['ArrowRight']); await settled(other, member);
    assert.deepEqual(await pins(other), ['activities', 'goals']);
    assert.deepEqual((await api(preferencePath, owner.token)).preferences, saved);
    await fresh.context().close(); await other.context().close();
  });
  await check('shortcuts and catalog controls open their actual task and shopping pages', async () => {
    await page.locator('[data-home-shortcut="chores"]').click();
    await page.getByRole('heading', { name: 'کارهای خانه', exact: true }).waitFor();
    await page.reload({ waitUntil: 'networkidle' }); await settled();
    await reveal(page, 'shopping'); await settled();
    await page.locator('[data-home-module="shopping"]').click(); await page.getByRole('heading', { name: 'لیست خرید', exact: true }).waitFor();
    await page.reload({ waitUntil: 'networkidle' }); await settled();
  });
  await check('offline rearrangement persists locally, online-only navigation is guarded, and reconnect synchronizes', async () => {
    const before = await api(preferencePath, owner.token), patchCount = page.__homePatches;
    await page.context().setOffline(true);
    await poll(async () => (await page.locator('[data-home-module="finance"]').textContent()) !== null, 'Offline Home disappeared');
    await keyboardMove(page, 'pin', 'chores', ['ArrowRight']);
    await poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.pending === true, cacheKey(owner)), 'Offline arrangement was not cached');
    assert.equal(page.__homePatches, patchCount); assert.deepEqual(await api(preferencePath, owner.token), before);
    await reveal(page, 'finance');
    await page.locator('[data-home-module="finance"]').click();
    assert.equal(await page.locator('.home-catalog').count(), 1);
    await page.context().setOffline(false); await settled();
    assert.deepEqual((await api(preferencePath, owner.token)).preferences.pins, await pins(page));
    assert.ok((await api(preferencePath, owner.token)).revision > before.revision);
  });
  await check('cross-session revision conflict is visible and overwrites only after explicit retry', async () => {
    const before = await api(preferencePath, owner.token);
    const external = { ...before.preferences, pins: ['goals'] };
    await setRemote(owner, external);
    await keyboardMove(page, 'pin', 'calendar', ['ArrowLeft']);
    await page.getByRole('button', { name: 'ذخیرهٔ چیدمان من', exact: true }).waitFor();
    assert.deepEqual((await api(preferencePath, owner.token)).preferences.pins, ['goals']);
    const local = await pins(page);
    await page.getByRole('button', { name: 'ذخیرهٔ چیدمان من', exact: true }).click(); await settled();
    assert.deepEqual((await api(preferencePath, owner.token)).preferences.pins, local);
  });

  // The desktop context stays idle from here; mobile uses a new real session.
  await page.context().close(); await setRemote(owner, defaults());
  const mobile = await newPage(owner.phone, { viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });
  page = mobile; await settled();
  await screen(mobile, 'mobile-default-light', 'light'); await screen(mobile, 'mobile-default-dark', 'dark');
  await mobile.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  const cdp = await mobile.context().newCDPSession(mobile);
  const touch = async (type, value) => cdp.send('Input.dispatchTouchEvent', { type,
    touchPoints: value ? [{ x: value.x, y: value.y, radiusX: 5, radiusY: 5, force: 1, id: 1 }] : [] });
  await mobile.evaluate(() => { window.__homeTrustedTouches = []; document.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') window.__homeTrustedTouches.push(event.isTrusted);
  }, true); });
  async function touchDrag(source, target, edge = 'center', cancel = false) {
    await alignPair(mobile, source, target); const start = point(await rect(source));
    await touch('touchStart', start); await touch('touchMove', { x: start.x + 10, y: start.y + 4 });
    await mobile.locator('.home-drag-ghost').waitFor({ state: 'visible' });
    const finish = await reachTarget(mobile, target, edge, value => touch('touchMove', value));
    for (let step = 1; step <= 16; step++) { await touch('touchMove', { x: start.x + (finish.x - start.x) * step / 16,
      y: start.y + (finish.y - start.y) * step / 16 }); await mobile.waitForTimeout(12); }
    await mobile.waitForTimeout(120); await touch(cancel ? 'touchCancel' : 'touchEnd'); await mobile.waitForTimeout(400); await noDrag(mobile);
  }
  await check('trusted Chromium touch reorders pins and collapsed groups at360px', async () => {
    await touchDrag(handle(mobile, 'pin', 'calendar'), shortcut(mobile, 'chores'), 'before'); await settled();
    assert.deepEqual(await pins(mobile), ['calendar', 'chores', 'shopping']);
    await collapse(); await touchDrag(handle(mobile, 'group', 'family'), group(mobile, 'money').locator('summary'), 'top'); await settled();
    assert.deepEqual(await groups(mobile), ['family', 'money', 'daily', 'belongings']);
    const trusted = await mobile.evaluate(() => window.__homeTrustedTouches); assert.ok(trusted.length >= 2 && trusted.every(Boolean));
  });
  await check('trusted touch transfers across groups and cancellation leaves no saved change', async () => {
    await reveal(mobile, 'transactions'); await settled();
    await touchDrag(handle(mobile, 'module', 'transactions'), group(mobile, 'family').locator('summary')); await settled();
    assert.ok((await inGroup(mobile, 'family')).includes('transactions'));
    const before = await api(preferencePath, owner.token), patchCount = mobile.__homePatches;
    await touchDrag(handle(mobile, 'pin', 'shopping'), shortcut(mobile, 'calendar'), 'before', true);
    assert.equal(mobile.__homePatches, patchCount); assert.deepEqual(await api(preferencePath, owner.token), before);
  });
  await check('360px light and dark Home retain legible controls without horizontal overflow', async () => {
    for (const id of await groups(mobile)) await setGroup(mobile, id, true); await settled();
    await screen(mobile, 'mobile-light', 'light'); await screen(mobile, 'mobile-dark', 'dark');
    assert.ok(await mobile.locator('.home-drag-handle:visible').evaluateAll(nodes => nodes.every(node => {
      const box = node.getBoundingClientRect(); return box.width >= 32 && box.height >= 40
        && box.left >= 0 && box.right <= innerWidth + 1;
    })), 'Drag targets are too small at360px');
  });
  await check('trusted touch on ordinary tile content scrolls without rearranging or navigating', async () => {
    await reveal(mobile, 'finance'); await settled();
    const content = mobile.locator('.home-catalog [data-home-module]:visible').nth(2);
    await content.scrollIntoViewIfNeeded();
    const start = point(await rect(content)), beforeScroll = await mobile.evaluate(() => scrollY);
    const before = await api(preferencePath, owner.token), patchCount = mobile.__homePatches;
    await touch('touchStart', start);
    for (let step = 1; step <= 16; step++) {
      await touch('touchMove', { x: start.x, y: start.y - Math.min(220, start.y - 25) * step / 16 });
      await mobile.waitForTimeout(12);
    }
    await touch('touchEnd'); await mobile.waitForTimeout(350);
    assert.ok(await mobile.evaluate(() => scrollY) > beforeScroll + 40, 'Normal page scrolling was blocked by drag handling');
    await noDrag(mobile); assert.equal(mobile.__homePatches, patchCount);
    assert.deepEqual(await api(preferencePath, owner.token), before);
  });
  await check('real users retain their original profile and household member data', async () => {
    assert.deepEqual(await api('/auth/members', owner.token), originalProfiles[0]);
    assert.deepEqual(await api('/auth/members', member.token), originalProfiles[1]);
    assert.deepEqual(pageErrors, []); assert.deepEqual(blockedRequests, []);
  });
} catch (error) {
  failure = error.message;
  if (lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: resolve(artifactDir, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  for (const context of contexts) await context.close().catch(error => cleanupErrors.push(error.message));
  await browser?.close().catch(error => cleanupErrors.push(error.message));
  if (backedUp) {
    try { await fixtureBackup.restore(); }
    catch (error) { cleanupErrors.push('Exact preference restoration failed: ' + error.message); }
  }
  for (const token of tokens) await api('/auth/logout', token, 'POST', undefined, [200, 204, 401]).catch(error => cleanupErrors.push(error.message));
  await writeFile(resolve(artifactDir, 'results.json'), JSON.stringify({ passed: !failure && !cleanupErrors.length,
    checks, failure, pageErrors, blockedRequests, cleanupErrors, screenshots, exactPreferencesRestored: backedUp && !cleanupErrors.length }, null, 2));
  if (failure || cleanupErrors.length) { console.error(failure || cleanupErrors.join('\n')); process.exitCode = 1; }
  else console.log('All ' + checks.length + ' Home arrangement browser checks passed; fake-account preferences restored exactly.');
}
