import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// This suite visits the standalone static preview in fresh, disposable contexts.
// It sends real mouse input and trusted Chromium touch input, never calls an API,
// and never modifies the user's browser preferences or application data.
const previewUrl = process.env.KHANEYAR_PROTOTYPE_URL
  || 'http://localhost:5700/prototypes/home-groups/index.html';
const preview = new URL(previewUrl);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(preview.hostname), 'Use a local static preview');
assert.ok(preview.pathname.endsWith('/prototypes/home-groups/index.html'), 'Open only the static prototype');
const artifactDir = resolve('.local-test/home-prototype-drag');
const expectedModules = [
  'finance', 'transactions', 'accounts', 'budgets', 'bills', 'calendar',
  'shopping', 'inventory', 'market', 'chores', 'reports', 'docs', 'meals',
  'equipment', 'vehicles', 'goals', 'activities', 'children', 'pets',
];
const expectedGroups = ['money', 'daily', 'belongings', 'family'];
const defaultGrouped = {
  money: ['finance', 'transactions', 'accounts', 'budgets', 'bills', 'market', 'reports'],
  daily: ['chores', 'shopping', 'inventory', 'meals'],
  belongings: ['equipment', 'vehicles', 'docs'],
  family: ['calendar', 'activities', 'children', 'pets', 'goals'],
};
const checks = [], pageErrors = [], rejectedRequests = [], requests = [], screenshots = [];
const contexts = [];
let browser, lastPage, failureMessage, failureState;

const tile = (page, id) => page.locator('#modules [data-module-id="' + id + '"]');
const shortcut = (page, id) => page.locator('#quick-access [data-shortcut-id="' + id + '"]');
const group = (page, id) => page.locator('details[data-prototype-group="' + id + '"]');
const pinHandle = (page, id) => shortcut(page, id).locator('[data-drag-pin="' + id + '"]');
const tileHandle = (page, id) => tile(page, id).locator('[data-drag-module="' + id + '"]');
const groupHandle = (page, id) => group(page, id).locator('summary [data-drag-group="' + id + '"]');
const pinIds = page => page.locator('#quick-access [data-shortcut-id]').evaluateAll(
  elements => elements.map(element => element.dataset.shortcutId),
);
const tileIds = page => page.locator('#modules [data-module-id]').evaluateAll(
  elements => elements.map(element => element.dataset.moduleId),
);
const groupIds = page => page.locator('details[data-prototype-group]').evaluateAll(
  elements => elements.map(element => element.dataset.prototypeGroup),
);
const inGroup = (page, id) => group(page, id).locator('[data-module-id]').evaluateAll(
  elements => elements.map(element => element.dataset.moduleId),
);
const savedPreferences = page => page.evaluate(() => Object.fromEntries(
  Object.entries(localStorage).filter(([key]) => key.startsWith('khaneyar:prototype:home-groups:')),
));

async function check(name, run) {
  await run();
  checks.push(name);
  console.log('PASS ' + name);
}

async function newPage(options = {}, initialPreferences) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1,
    timezoneId: 'Asia/Tehran', serviceWorkers: 'block', colorScheme: 'light',
    reducedMotion: 'reduce', ...options,
  });
  contexts.push(context);
  if (initialPreferences) await context.addInitScript(preferences => {
    if (location.origin === 'null') return;
    for (const [key, value] of Object.entries(preferences)) {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value));
    }
  }, initialPreferences);
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    const safe = url.origin === preview.origin && url.pathname.startsWith('/prototypes/home-groups/')
      && ['GET', 'HEAD'].includes(request.method());
    requests.push({ url: request.url(), method: request.method() });
    if (!safe) {
      rejectedRequests.push({ url: request.url(), method: request.method() });
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const page = await context.newPage();
  lastPage = page;
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(previewUrl, { waitUntil: 'networkidle' });
  await page.locator('#modules').waitFor();
  return page;
}

async function catalogIntact(page) {
  const ids = await tileIds(page);
  assert.deepEqual([...ids].sort(), [...expectedModules].sort(), 'The original catalog changed');
  assert.equal(new Set(ids).size, 19, 'A module is duplicated or missing');
  assert.equal(await page.locator('button button').count(), 0, 'Controls must not contain nested buttons');
  assert.equal(await page.locator('#modules [data-pin-module]').count(), 19);
  assert.equal(await page.locator('#modules [data-open-module]').count(), 19);
}

async function capture(page, name, fullPage = false) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(size.document <= size.viewport + 1, name + ': page overflows horizontally');
  const path = resolve(artifactDir, name + '.png');
  await page.screenshot({ path, fullPage });
  screenshots.push(path);
}

async function assertSettled(page) {
  assert.equal(await page.locator('#module-sheet[open]').count(), 0, 'Dragging accidentally opened a module');
  assert.equal(await page.locator('.drag-ghost').count(), 0, 'A drag preview remains after the gesture');
  assert.equal(await page.locator('.is-dragging').count(), 0, 'Drag styling remains after the gesture');
  assert.equal(await page.locator('.drop-target').count(), 0, 'A highlighted drop target remains after the gesture');
  assert.equal(await page.locator('#drop-indicator:visible').count(), 0, 'The insertion marker remains after the gesture');
  await catalogIntact(page);
}

async function setGroup(page, id, open) {
  const element = group(page, id);
  assert.equal(await element.count(), 1, 'Missing group ' + id);
  if ((await element.getAttribute('open') !== null) !== open) await element.locator('summary .group-copy').click();
  assert.equal(await element.getAttribute('open') !== null, open, 'Group did not toggle ' + id);
}

async function collapseGroups(page) {
  for (const id of await groupIds(page)) await setGroup(page, id, false);
}

async function revealTile(page, id) {
  const ancestor = await tile(page, id).evaluate(element =>
    element.closest('details[data-prototype-group]')?.dataset.prototypeGroup,
  );
  if (ancestor) await setGroup(page, ancestor, true);
  await tile(page, id).waitFor({ state: 'visible' });
}

async function rect(locator) {
  const box = await locator.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, 'A drag element is not visible');
  return box;
}

function point(box, edge = 'center') {
  return {
    x: edge === 'before' ? box.x + box.width - Math.min(12, box.width / 4)
      : edge === 'after' ? box.x + Math.min(12, box.width / 4) : box.x + box.width / 2,
    y: edge === 'top' ? box.y + Math.min(10, box.height / 4)
      : edge === 'bottom' ? box.y + box.height - Math.min(10, box.height / 4) : box.y + box.height / 2,
  };
}

async function alignPair(page, source, target) {
  // Scroll only before the gesture. The drag itself uses trusted input, and any
  // subsequent scrolling is performed by the prototype's edge autoscroll.
  const bounds = await Promise.all([rect(source), rect(target)]);
  const top = Math.min(...bounds.map(box => box.y));
  const bottom = Math.max(...bounds.map(box => box.y + box.height));
  const height = page.viewportSize().height;
  if (bottom - top <= height - 80) {
    await page.evaluate(({ offset }) => scrollBy({ top: offset, behavior: 'instant' }), { offset: top - 80 });
  } else {
    await source.scrollIntoViewIfNeeded();
  }
}

async function reachTarget(page, target, edge, move) {
  const height = page.viewportSize().height, width = page.viewportSize().width;
  for (let attempt = 0; attempt < 90; attempt++) {
    const finish = point(await rect(target), edge);
    if (finish.y >= 40 && finish.y <= height - 40) return finish;
    await move({ x: Math.max(20, Math.min(width - 20, finish.x)), y: finish.y < 40 ? 8 : height - 8 });
    await page.waitForTimeout(60);
  }
  assert.fail('Edge scrolling did not bring the drop target into view');
}

async function mouseDrag(page, source, target, { edge = 'center', captureName, cancel, outside } = {}) {
  await alignPair(page, source, target);
  const start = point(await rect(source));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 9, start.y + 4, { steps: 3 });
  await page.locator('.drag-ghost').waitFor({ state: 'visible' });
  const finish = outside || await reachTarget(page, target, edge, p => page.mouse.move(p.x, p.y, { steps: 8 }));
  await page.mouse.move(finish.x, finish.y, { steps: 16 });
  await page.waitForTimeout(120);
  if (captureName) await capture(page, captureName);
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(400);
  await assertSettled(page);
}

async function touchEvent(session, type, p) {
  await session.send('Input.dispatchTouchEvent', {
    type, touchPoints: p ? [{ x: p.x, y: p.y, radiusX: 5, radiusY: 5, force: 1, id: 1 }] : [],
  });
}

async function touchDrag(page, session, source, target, { edge = 'center', captureName, cancel } = {}) {
  await alignPair(page, source, target);
  const start = point(await rect(source));
  await touchEvent(session, 'touchStart', start);
  await touchEvent(session, 'touchMove', { x: start.x + 10, y: start.y + 4 });
  await page.locator('.drag-ghost').waitFor({ state: 'visible' });
  const finish = await reachTarget(page, target, edge, p => touchEvent(session, 'touchMove', p));
  for (let step = 1; step <= 16; step++) {
    await touchEvent(session, 'touchMove', {
      x: start.x + (finish.x - start.x) * step / 16,
      y: start.y + (finish.y - start.y) * step / 16,
    });
    await page.waitForTimeout(12);
  }
  await page.waitForTimeout(120);
  if (captureName) await capture(page, captureName);
  await touchEvent(session, cancel ? 'touchCancel' : 'touchEnd');
  await page.waitForTimeout(400);
  await assertSettled(page);
}

async function groupedSnapshot(page) {
  return {
    pins: await pinIds(page), groups: await groupIds(page),
    modules: Object.fromEntries(await Promise.all(expectedGroups.map(async id => [id, await inGroup(page, id)]))),
  };
}

try {
  await mkdir(artifactDir, { recursive: true });
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });

  await check('existing v1 pin and expansion preferences migrate without losing the catalog', async () => {
    const prefix = 'khaneyar:prototype:home-groups:v1:';
    const legacy = await newPage({}, {
      [prefix + 'view']: { profile: 'owner', layout: 'grouped', theme: 'light' },
      [prefix + 'owner']: { pins: ['finance', 'calendar', 'shopping'], openGroups: ['money', 'belongings'] },
    });
    await catalogIntact(legacy);
    assert.deepEqual(await pinIds(legacy), ['finance', 'calendar', 'shopping']);
    assert.deepEqual(await legacy.locator('[data-prototype-group][open]').evaluateAll(
      elements => elements.map(element => element.dataset.prototypeGroup),
    ), ['money', 'belongings']);
    assert.deepEqual(await groupIds(legacy), expectedGroups);
    for (const id of expectedGroups) assert.deepEqual(await inGroup(legacy, id), defaultGrouped[id]);
    await mouseDrag(legacy, pinHandle(legacy, 'shopping'), shortcut(legacy, 'finance'), { edge: 'before' });
    await legacy.reload({ waitUntil: 'networkidle' });
    assert.deepEqual(await pinIds(legacy), ['shopping', 'finance', 'calendar']);
    assert.deepEqual(await legacy.locator('[data-prototype-group][open]').evaluateAll(
      elements => elements.map(element => element.dataset.prototypeGroup),
    ), ['money', 'belongings']);
    const saved = await legacy.evaluate(key => JSON.parse(localStorage.getItem(key)), prefix + 'owner');
    assert.deepEqual(saved.groupOrder, expectedGroups);
    assert.deepEqual(saved.groupModules, defaultGrouped);
    assert.deepEqual(saved.flatOrder, expectedModules);
  });

  const page = await newPage();

  await check('dedicated handles preserve all 19 modules and independent controls', async () => {
    await catalogIntact(page);
    assert.deepEqual(await groupIds(page), expectedGroups);
    assert.deepEqual(await pinIds(page), ['chores', 'shopping', 'calendar']);
    assert.equal(await page.locator('#modules [data-drag-module]').count(), 19);
    assert.equal(await page.locator('#modules [data-drag-group]').count(), 4);
    assert.ok(await page.locator('[data-drag-pin], [data-drag-module], [data-drag-group]').evaluateAll(elements => elements.every(element =>
      element.tagName === 'BUTTON' && getComputedStyle(element).touchAction === 'none'
        && Boolean(element.getAttribute('aria-label')),
    )), 'Drag handles need accessible labels and independent touch handling');
  });

  await check('mouse reorders personal pins without opening a module', async () => {
    await mouseDrag(page, pinHandle(page, 'calendar'), shortcut(page, 'chores'), { edge: 'before' });
    assert.deepEqual(await pinIds(page), ['calendar', 'chores', 'shopping']);
    await mouseDrag(page, pinHandle(page, 'calendar'), shortcut(page, 'shopping'), { edge: 'after' });
    assert.deepEqual(await pinIds(page), ['chores', 'shopping', 'calendar']);
    await mouseDrag(page, pinHandle(page, 'calendar'), shortcut(page, 'chores'), { edge: 'before' });
    assert.deepEqual(await pinIds(page), ['calendar', 'chores', 'shopping']);
  });

  await check('mouse reorders collapsed groups', async () => {
    await collapseGroups(page);
    await mouseDrag(page, groupHandle(page, 'family'), group(page, 'money').locator('summary'), { edge: 'top' });
    assert.deepEqual(await groupIds(page), ['family', 'money', 'daily', 'belongings']);
  });

  await check('mouse reorders module tiles within a group', async () => {
    await revealTile(page, 'transactions');
    await mouseDrag(page, tileHandle(page, 'transactions'), tile(page, 'finance'), { edge: 'before' });
    assert.deepEqual(await inGroup(page, 'money'), ['transactions', 'finance', 'accounts', 'budgets', 'bills', 'market', 'reports']);
  });

  await check('a module can move into a collapsed group', async () => {
    await setGroup(page, 'family', false);
    await mouseDrag(page, tileHandle(page, 'finance'), group(page, 'family').locator('summary'));
    assert.equal((await inGroup(page, 'money')).includes('finance'), false);
    assert.equal((await inGroup(page, 'family')).includes('finance'), true);
    await catalogIntact(page);
  });

  await check('empty groups remain valid module drop targets', async () => {
    await collapseGroups(page);
    for (const id of ['equipment', 'vehicles', 'docs']) {
      await revealTile(page, id);
      await setGroup(page, 'daily', false);
      await mouseDrag(page, tileHandle(page, id), group(page, 'daily').locator('summary'));
    }
    assert.deepEqual(await inGroup(page, 'belongings'), []);
    await setGroup(page, 'belongings', true);
    await revealTile(page, 'docs');
    await mouseDrag(page, tileHandle(page, 'docs'), group(page, 'belongings').locator('.group-grid'));
    assert.deepEqual(await inGroup(page, 'belongings'), ['docs']);
    assert.equal((await inGroup(page, 'daily')).includes('docs'), false);
  });

  await check('dropping a module into quick access creates one personal pin', async () => {
    await collapseGroups(page);
    await revealTile(page, 'finance');
    const before = await pinIds(page);
    await mouseDrag(page, tileHandle(page, 'finance'), page.locator('#quick-access'));
    assert.equal((await pinIds(page)).filter(id => id === 'finance').length, 1);
    assert.equal((await pinIds(page)).length, before.length + 1);
    assert.equal((await inGroup(page, 'family')).includes('finance'), true, 'Quick pinning removed a catalog module');
  });

  await check('flat mode supports an independent saved tile order', async () => {
    await page.locator('#layout-mode').selectOption('flat');
    const before = await tileIds(page);
    await mouseDrag(page, tileHandle(page, 'transactions'), tile(page, 'finance'), { edge: 'before' });
    const after = [...before];
    after.splice(after.indexOf('transactions'), 1);
    after.splice(after.indexOf('finance'), 0, 'transactions');
    assert.deepEqual(await tileIds(page), after);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('#layout-mode').inputValue(), 'flat');
    assert.deepEqual(await tileIds(page), after);
  });

  await check('Escape and dropping outside valid targets preserve the arrangement', async () => {
    const before = { pins: await pinIds(page), modules: await tileIds(page) };
    const saved = await savedPreferences(page);
    await mouseDrag(page, pinHandle(page, 'shopping'), shortcut(page, 'calendar'), { edge: 'before', cancel: true });
    assert.deepEqual(await pinIds(page), before.pins);
    assert.deepEqual(await savedPreferences(page), saved, 'Canceled drag wrote preferences');
    await mouseDrag(page, pinHandle(page, 'shopping'), page.locator('.demo-bar'), { outside: { x: 20, y: 20 } });
    assert.deepEqual(await pinIds(page), before.pins);
    assert.deepEqual(await tileIds(page), before.modules);
    assert.deepEqual(await savedPreferences(page), saved, 'Outside drop wrote preferences');
    await mouseDrag(page, pinHandle(page, 'shopping'), tile(page, 'finance'));
    assert.deepEqual(await pinIds(page), before.pins, 'Dropping a pin on the catalog changed personal pins');
    assert.deepEqual(await tileIds(page), before.modules, 'Dropping a pin on the catalog changed module order');
    assert.deepEqual(await savedPreferences(page), saved, 'An incompatible drop target wrote preferences');
  });

  await check('dragging near the viewport edge scrolls the catalog and can be canceled', async () => {
    await tileHandle(page, 'transactions').scrollIntoViewIfNeeded();
    const beforeOrder = await tileIds(page), start = point(await rect(tileHandle(page, 'transactions')));
    const beforeScroll = await page.evaluate(() => scrollY);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 10, start.y + 8, { steps: 3 });
    await page.mouse.move(start.x, page.viewportSize().height - 8, { steps: 20 });
    await page.waitForTimeout(750);
    assert.ok(await page.evaluate(() => scrollY) > beforeScroll + 40, 'The drag does not scroll near the viewport edge');
    await capture(page, 'desktop-edge-drag');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await assertSettled(page);
    assert.deepEqual(await tileIds(page), beforeOrder, 'Canceled autoscroll drag changed the order');
  });

  await check('pins, group order, membership, and flat order survive reload and stay personal', async () => {
    const ownerFlat = await tileIds(page);
    await page.locator('#layout-mode').selectOption('grouped');
    const owner = await groupedSnapshot(page);
    await page.reload({ waitUntil: 'networkidle' });
    assert.deepEqual(await groupedSnapshot(page), owner);
    await page.locator('#demo-profile').selectOption('member');
    assert.deepEqual(await pinIds(page), ['goals', 'activities']);
    assert.deepEqual(await groupIds(page), expectedGroups);
    for (const id of expectedGroups) assert.deepEqual(await inGroup(page, id), defaultGrouped[id]);
    await mouseDrag(page, pinHandle(page, 'activities'), shortcut(page, 'goals'), { edge: 'before' });
    await collapseGroups(page);
    await mouseDrag(page, groupHandle(page, 'daily'), group(page, 'money').locator('summary'), { edge: 'top' });
    await page.locator('#layout-mode').selectOption('flat');
    assert.deepEqual(await tileIds(page), expectedModules);
    await mouseDrag(page, tileHandle(page, 'transactions'), tile(page, 'finance'), { edge: 'before' });
    const memberFlat = await tileIds(page);
    await page.locator('#layout-mode').selectOption('grouped');
    const member = await groupedSnapshot(page);
    await page.locator('#demo-profile').selectOption('owner');
    assert.deepEqual(await groupedSnapshot(page), owner);
    await page.locator('#layout-mode').selectOption('flat');
    assert.deepEqual(await tileIds(page), ownerFlat);
    await page.locator('#demo-profile').selectOption('member');
    assert.deepEqual(await tileIds(page), memberFlat);
    await page.locator('#layout-mode').selectOption('grouped');
    assert.deepEqual(await groupedSnapshot(page), member);
    await page.locator('#demo-profile').selectOption('owner');
    await capture(page, 'desktop-drop-results', true);
  });

  const mobile = await newPage({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });
  const touch = await mobile.context().newCDPSession(mobile);
  await mobile.evaluate(() => {
    window.__prototypeTouchEvents = [];
    document.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') window.__prototypeTouchEvents.push({ trusted: event.isTrusted, type: event.pointerType });
    }, true);
  });

  await check('trusted touch reorders pins at 360px with visible drag feedback', async () => {
    await touchDrag(mobile, touch, pinHandle(mobile, 'calendar'), shortcut(mobile, 'chores'), {
      edge: 'before', captureName: 'mobile-pin-drag',
    });
    assert.deepEqual(await pinIds(mobile), ['calendar', 'chores', 'shopping']);
    await capture(mobile, 'mobile-pin-drop');
    const input = await mobile.evaluate(() => window.__prototypeTouchEvents);
    assert.ok(input.length && input.every(event => event.trusted && event.type === 'touch'), 'Touch input is not trusted browser input');
  });

  await check('trusted touch reorders groups and moves modules into collapsed groups', async () => {
    await collapseGroups(mobile);
    await touchDrag(mobile, touch, groupHandle(mobile, 'family'), group(mobile, 'money').locator('summary'), { edge: 'top' });
    assert.deepEqual(await groupIds(mobile), ['family', 'money', 'daily', 'belongings']);
    await revealTile(mobile, 'transactions');
    await touchDrag(mobile, touch, tileHandle(mobile, 'transactions'), group(mobile, 'family').locator('summary'), {
      captureName: 'mobile-module-drag',
    });
    assert.equal((await inGroup(mobile, 'money')).includes('transactions'), false);
    assert.equal((await inGroup(mobile, 'family')).includes('transactions'), true);
    await capture(mobile, 'mobile-group-drop', true);
  });

  await check('touch cancellation preserves pins and normal swipes scroll outside handles', async () => {
    const beforePins = await pinIds(mobile);
    const saved = await savedPreferences(mobile);
    await touchDrag(mobile, touch, pinHandle(mobile, 'shopping'), shortcut(mobile, 'calendar'), { edge: 'before', cancel: true });
    assert.deepEqual(await pinIds(mobile), beforePins);
    assert.deepEqual(await savedPreferences(mobile), saved, 'Canceled touch drag wrote preferences');
    await mobile.locator('#layout-mode').selectOption('flat');
    await tile(mobile, 'finance').scrollIntoViewIfNeeded();
    const main = await rect(tile(mobile, 'finance').locator('[data-open-module]'));
    const start = { x: main.x + main.width / 2, y: Math.min(main.y + 35, 650) };
    const beforeScroll = await mobile.evaluate(() => scrollY);
    const beforeOrder = await tileIds(mobile);
    await touchEvent(touch, 'touchStart', start);
    for (let step = 1; step <= 12; step++) {
      await touchEvent(touch, 'touchMove', { x: start.x, y: start.y - step * 12 });
      await mobile.waitForTimeout(16);
    }
    await touchEvent(touch, 'touchEnd');
    await mobile.waitForTimeout(250);
    assert.ok(await mobile.evaluate(() => scrollY) > beforeScroll + 30, 'Swiping tile content does not scroll the page');
    assert.deepEqual(await tileIds(mobile), beforeOrder, 'An ordinary swipe changed tile ordering');
    await assertSettled(mobile);
    await capture(mobile, 'mobile-flat-after-scroll');
  });

  const lifecycle = await newPage();
  await lifecycle.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.__prototypeSetItems = [];
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('khaneyar:prototype:home-groups:')) window.__prototypeSetItems.push(key);
      return original.call(this, key, value);
    };
  });

  await check('canceling with noncanonical expansion order performs zero preference writes', async () => {
    await setGroup(lifecycle, 'belongings', true);
    await setGroup(lifecycle, 'money', true);
    await lifecycle.waitForTimeout(80);
    const before = await savedPreferences(lifecycle);
    await lifecycle.evaluate(() => { window.__prototypeSetItems = []; });
    await mouseDrag(lifecycle, pinHandle(lifecycle, 'shopping'), shortcut(lifecycle, 'chores'), {
      edge: 'before', cancel: true,
    });
    assert.deepEqual(await lifecycle.evaluate(() => window.__prototypeSetItems), [], 'Canceled drag rerender wrote preferences');
    assert.deepEqual(await savedPreferences(lifecycle), before, 'Canceled drag changed saved expansion ordering');
    await mouseDrag(lifecycle, pinHandle(lifecycle, 'shopping'), lifecycle.locator('.demo-bar'), {
      outside: { x: 20, y: 20 },
    });
    assert.deepEqual(await lifecycle.evaluate(() => window.__prototypeSetItems), [], 'Outside drop rerender wrote preferences');
    assert.deepEqual(await savedPreferences(lifecycle), before);
  });

  await check('Enter and Space during a held pointer drag preserve cancellation and clean up the ghost', async () => {
    const before = await savedPreferences(lifecycle), beforePins = await pinIds(lifecycle);
    for (const key of ['Enter', 'Space']) {
      await alignPair(lifecycle, pinHandle(lifecycle, 'shopping'), shortcut(lifecycle, 'chores'));
      const start = point(await rect(pinHandle(lifecycle, 'shopping')));
      const finish = point(await rect(shortcut(lifecycle, 'chores')), 'before');
      await lifecycle.mouse.move(start.x, start.y);
      await lifecycle.mouse.down();
      await lifecycle.mouse.move(start.x + 10, start.y + 4, { steps: 3 });
      await lifecycle.locator('.drag-ghost').waitFor({ state: 'visible' });
      await lifecycle.mouse.move(finish.x, finish.y, { steps: 12 });
      await lifecycle.keyboard.press(key);
      assert.deepEqual(await pinIds(lifecycle), beforePins, key + ' committed a held pointer drag');
      await lifecycle.keyboard.press('Escape');
      await lifecycle.mouse.up();
      await lifecycle.waitForTimeout(400);
      await assertSettled(lifecycle);
      assert.deepEqual(await pinIds(lifecycle), beforePins);
      assert.deepEqual(await savedPreferences(lifecycle), before, key + ' caused canceled pointer preferences to change');
    }
  });

  await check('a pointer can take over a keyboard draft and cancel without writes or orphaned nodes', async () => {
    const before = await savedPreferences(lifecycle), beforePins = await pinIds(lifecycle);
    await lifecycle.evaluate(() => { window.__prototypeSetItems = []; });
    await pinHandle(lifecycle, 'calendar').focus();
    await lifecycle.keyboard.press('Space');
    await lifecycle.keyboard.press('ArrowUp');
    assert.deepEqual(await pinIds(lifecycle), ['chores', 'calendar', 'shopping']);
    await mouseDrag(lifecycle, pinHandle(lifecycle, 'calendar'), shortcut(lifecycle, 'chores'), {
      edge: 'before', cancel: true,
    });
    assert.deepEqual(await pinIds(lifecycle), beforePins);
    assert.deepEqual(await savedPreferences(lifecycle), before);
    assert.deepEqual(await lifecycle.evaluate(() => window.__prototypeSetItems), [], 'Input takeover or cancellation wrote preferences');
  });

  const fallback = await newPage({ viewport: { width: 360, height: 800 } });
  await check('keyboard group reordering and Ctrl-arrow module transfers commit and survive reload', async () => {
    await groupHandle(fallback, 'money').focus();
    await fallback.keyboard.press('Space');
    await fallback.keyboard.press('ArrowDown');
    await fallback.keyboard.press('Enter');
    await fallback.waitForTimeout(400);
    await assertSettled(fallback);
    assert.deepEqual(await groupIds(fallback), ['daily', 'money', 'belongings', 'family']);
    await fallback.reload({ waitUntil: 'networkidle' });
    assert.deepEqual(await groupIds(fallback), ['daily', 'money', 'belongings', 'family']);
    await revealTile(fallback, 'finance');
    await tileHandle(fallback, 'finance').focus();
    await fallback.keyboard.press('Space');
    await fallback.keyboard.press('Control+ArrowDown');
    await fallback.keyboard.press('Enter');
    await fallback.waitForTimeout(400);
    await assertSettled(fallback);
    assert.equal((await inGroup(fallback, 'money')).includes('finance'), false);
    assert.deepEqual(await inGroup(fallback, 'belongings'), ['equipment', 'vehicles', 'docs', 'finance']);
    await fallback.reload({ waitUntil: 'networkidle' });
    assert.deepEqual(await groupIds(fallback), ['daily', 'money', 'belongings', 'family']);
    assert.deepEqual(await inGroup(fallback, 'belongings'), ['equipment', 'vehicles', 'docs', 'finance']);
  });

  await check('arrangement dialog refreshes transfer boundaries, saves movement, and restores focus', async () => {
    await revealTile(fallback, 'equipment');
    await tile(fallback, 'equipment').locator('[data-arrange-module="equipment"]').click();
    await fallback.locator('#module-sheet[open]').waitFor();
    const previous = fallback.locator('[data-arrange-step="module"][data-arrange-id="equipment"][data-direction="-1"]');
    const next = fallback.locator('[data-arrange-step="module"][data-arrange-id="equipment"][data-direction="1"]');
    assert.equal(await previous.isDisabled(), true, 'The first tile can move before its group');
    assert.equal(await next.isEnabled(), true);
    await fallback.locator('#transfer-group').selectOption('money');
    assert.equal(await fallback.locator('#transfer-group').inputValue(), 'money');
    assert.equal(await previous.isEnabled(), true, 'Transfer kept the old first-position boundary');
    assert.equal(await next.isDisabled(), true, 'Transfer did not apply the destination last-position boundary');
    assert.equal(await fallback.evaluate(() => document.activeElement?.id), 'transfer-group', 'Transfer lost focus when refreshing the dialog');
    assert.equal((await inGroup(fallback, 'belongings')).includes('equipment'), false);
    assert.equal((await inGroup(fallback, 'money')).at(-1), 'equipment');
    await capture(fallback, 'mobile-arrangement-transfer');
    await previous.click();
    assert.deepEqual((await inGroup(fallback, 'money')).slice(-2), ['equipment', 'reports']);
    assert.equal(await next.isEnabled(), true, 'Moving back did not refresh the last-position boundary');
    await fallback.keyboard.press('Escape');
    await fallback.locator('#module-sheet').waitFor({ state: 'hidden' });
    assert.equal(await tile(fallback, 'equipment').locator('[data-arrange-module="equipment"]').evaluate(
      element => element === document.activeElement,
    ), true, 'Closing arrangement did not restore focus to its current tile');
    const savedMoney = await inGroup(fallback, 'money');
    await fallback.reload({ waitUntil: 'networkidle' });
    assert.deepEqual(await inGroup(fallback, 'money'), savedMoney);
    await assertSettled(fallback);
  });

  await check('drag suite uses only local read requests and has no JavaScript errors', async () => {
    assert.deepEqual(rejectedRequests, []);
    assert.deepEqual(pageErrors, []);
    assert.ok(requests.every(request => ['GET', 'HEAD'].includes(request.method)));
  });

  console.log(JSON.stringify({ status: 'passed', checks, screenshots, requests }, null, 2));
} catch (error) {
  failureMessage = error.message;
  if (lastPage && !lastPage.isClosed()) {
    failureState = await lastPage.evaluate(() => ({
      scrollY, viewport: { width: innerWidth, height: innerHeight },
      pins: [...document.querySelectorAll('[data-shortcut-id]')].map(element => element.dataset.shortcutId),
      groups: [...document.querySelectorAll('[data-prototype-group]')].map(element => ({
        id: element.dataset.prototypeGroup, open: element.open,
        modules: [...element.querySelectorAll('[data-module-id]')].map(tile => tile.dataset.moduleId),
      })),
      ghost: Boolean(document.querySelector('.drag-ghost')),
    })).catch(() => null);
    const path = resolve(artifactDir, 'failure.png');
    await lastPage.screenshot({ path, fullPage: true }).then(() => screenshots.push(path)).catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(resolve(artifactDir, 'results.json'), JSON.stringify({
    status: process.exitCode ? 'failed' : 'passed', previewUrl, failureMessage, failureState,
    checks, screenshots, pageErrors, rejectedRequests, requests,
  }, null, 2));
  for (const context of contexts) await context.close();
  await browser?.close();
}
