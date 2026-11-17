import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Standalone static-preview check. A fresh browser context isolates all localStorage
// preferences. Requests to APIs, other origins, or mutating methods are blocked.
const previewUrl = process.env.KHANEYAR_PROTOTYPE_URL
  || 'http://localhost:5700/prototypes/home-groups/index.html';
const preview = new URL(previewUrl);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(preview.hostname), 'Use a local static preview');
assert.ok(preview.pathname.endsWith('/prototypes/home-groups/index.html'), 'Open only the static prototype');
const artifactDir = resolve('.local-test/home-prototype');
const expectedModules = [
  'finance', 'transactions', 'accounts', 'budgets', 'bills', 'calendar',
  'shopping', 'inventory', 'market', 'chores', 'reports', 'docs', 'meals',
  'equipment', 'vehicles', 'goals', 'activities', 'children', 'pets',
];
const expectedGroups = ['money', 'daily', 'belongings', 'family'];
const checks = [], pageErrors = [], rejectedRequests = [], requests = [], screenshots = [];
let browser, context, failureMessage;

const tile = (page, id) => page.locator('#modules [data-module-id="' + id + '"]');
const shortcut = (page, id) => page.locator('#quick-access [data-shortcut-id="' + id + '"]');
const group = (page, id) => page.locator('details[data-prototype-group="' + id + '"]');
const pinIds = page => page.locator('#quick-access [data-shortcut-id]').evaluateAll(
  elements => elements.map(element => element.dataset.shortcutId),
);
const openIds = page => page.locator('details[data-prototype-group][open]').evaluateAll(
  elements => elements.map(element => element.dataset.prototypeGroup).sort(),
);

async function check(name, run) {
  await run();
  checks.push(name);
  console.log('PASS ' + name);
}

async function layoutFits(page, label) {
  const measurements = await page.evaluate(() => ({
    viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    sheets: [...document.querySelectorAll('dialog[open]')].map(element => ({
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    })),
  }));
  assert.ok(measurements.documentWidth <= measurements.viewport + 1, label + ': document overflows');
  assert.ok(measurements.bodyWidth <= measurements.viewport + 1, label + ': body overflows');
  for (const sheet of measurements.sheets) {
    assert.ok(sheet.scrollWidth <= sheet.clientWidth + 1, label + ': sheet content overflows');
    assert.ok(sheet.left >= -1 && sheet.right <= measurements.viewport + 1, label + ': sheet exceeds viewport');
  }
}

async function capture(page, name, fullPage = false) {
  await layoutFits(page, name);
  const path = resolve(artifactDir, name + '.png');
  await page.screenshot({ path, fullPage });
  screenshots.push(path);
}

async function setGroup(page, id, open) {
  const element = group(page, id);
  assert.equal(await element.count(), 1, 'Missing group ' + id);
  if ((await element.getAttribute('open') !== null) !== open) await element.locator('summary').click();
  assert.equal(await element.getAttribute('open') !== null, open, 'Group did not toggle ' + id);
}

async function revealTile(page, id) {
  const ancestor = await tile(page, id).evaluate(element =>
    element.closest('details[data-prototype-group]')?.dataset.prototypeGroup,
  );
  if (ancestor) await setGroup(page, ancestor, true);
  await tile(page, id).waitFor({ state: 'visible' });
}

async function sheetOpensAndCloses(page, opener, id) {
  const expectedTitle = await tile(page, id).locator('[data-open-module="' + id + '"] b').textContent();
  await opener.click();
  await page.locator('#module-sheet[open]').waitFor();
  assert.ok((await page.locator('#sheet-title').innerText()).trim().length, 'Sheet has no title');
  assert.equal((await page.locator('#sheet-title').innerText()).trim(), expectedTitle.trim(),
    'Sheet title does not identify its module');
  assert.equal(await page.evaluate(() => document.querySelector('#module-sheet').contains(document.activeElement)), true,
    'Opening a dialog does not move focus into it');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.querySelector('#module-sheet').contains(document.activeElement)), true,
    'Tab escapes the modal dialog');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.querySelector('#module-sheet').contains(document.activeElement)), true,
    'Shift+Tab escapes the modal dialog');
  await layoutFits(page, 'module sheet ' + id);
  await page.keyboard.press('Escape');
  await page.locator('#module-sheet').waitFor({ state: 'hidden' });
  assert.equal(await opener.evaluate(element => element === document.activeElement), true,
    'Escape does not restore focus to the shortcut');
}

try {
  await mkdir(artifactDir, { recursive: true });
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  context = await browser.newContext({
    viewport: { width: 360, height: 800 }, deviceScaleFactor: 1,
    timezoneId: 'Asia/Tehran', serviceWorkers: 'block', colorScheme: 'light',
  });
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
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(previewUrl, { waitUntil: 'networkidle' });
  await page.locator('#modules').waitFor();

  await check('four groups, all 19 original modules exactly once, independent pin buttons', async () => {
    assert.deepEqual((await page.locator('details[data-prototype-group]').evaluateAll(
      elements => elements.map(element => element.dataset.prototypeGroup))).sort(), [...expectedGroups].sort());
    const ids = await page.locator('#modules [data-module-id]').evaluateAll(
      elements => elements.map(element => element.dataset.moduleId),
    );
    assert.deepEqual([...ids].sort(), [...expectedModules].sort());
    assert.equal(new Set(ids).size, 19);
    assert.equal(await page.locator('button button').count(), 0, 'Nested buttons remain');
    assert.equal(await page.locator('#modules [data-pin-module]').count(), 19);
    assert.equal(await page.locator('#modules [data-open-module]').count(), 19);
    assert.ok(await page.locator('#modules [data-module-id]').evaluateAll(elements => elements.every(element => {
      const open = element.querySelector('[data-open-module]');
      const pin = element.querySelector('[data-pin-module]');
      return element.tagName !== 'BUTTON' && open?.tagName === 'BUTTON' && pin?.tagName === 'BUTTON'
        && !open.contains(pin) && !pin.contains(open);
    })), 'Module navigation and pin controls must be independent buttons within a non-button tile');
    assert.equal(await page.locator('#layout-mode').inputValue(), 'grouped');
    assert.deepEqual(await openIds(page), [], 'Initial home is not compact');
  });

  await check('360px compact initial and expanded group fit the viewport', async () => {
    assert.deepEqual(await pinIds(page), ['chores', 'shopping', 'calendar']);
    const positions = await page.evaluate(() => ({
      quick: document.querySelector('#quick-access').getBoundingClientRect().top,
      modules: document.querySelector('#modules').getBoundingClientRect().top,
    }));
    assert.ok(positions.quick < positions.modules, 'Personal shortcuts are not above the module groups');
    await capture(page, 'mobile-compact');
    await setGroup(page, 'money', true);
    await capture(page, 'mobile-open-group', true);
  });

  await check('pin and unpin from a group update shortcuts without hiding catalog modules', async () => {
    await revealTile(page, 'finance');
    const pin = tile(page, 'finance').locator('[data-pin-module="finance"]');
    assert.equal(await pin.getAttribute('aria-pressed'), 'false');
    await pin.click();
    assert.equal(await pin.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await pinIds(page), ['chores', 'shopping', 'calendar', 'finance']);
    assert.equal(await tile(page, 'finance').count(), 1);
    await pin.click();
    assert.equal(await pin.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await pinIds(page), ['chores', 'shopping', 'calendar']);
    assert.equal(await tile(page, 'finance').count(), 1);
    await pin.click();
  });

  await check('pinned shortcut opens a direct preview dialog; Escape returns focus', async () => {
    await sheetOpensAndCloses(page, shortcut(page, 'finance').locator('[data-open-module="finance"]'), 'finance');
  });

  let savedOrder;
  await check('keyboard-accessible move controls reorder personal shortcuts and survive reload', async () => {
    await page.locator('#edit-pins').click();
    assert.equal(await page.locator('[data-move-pin="chores"][data-direction="-1"]').isDisabled(), true,
      'First shortcut can move before the list boundary');
    assert.equal(await page.locator('[data-move-pin="finance"][data-direction="1"]').isDisabled(), true,
      'Last shortcut can move past the list boundary');
    const move = page.locator('[data-move-pin="finance"][data-direction="-1"]');
    assert.equal(await move.isEnabled(), true);
    assert.ok((await move.getAttribute('aria-label') || await move.innerText()).includes('جابه‌جایی'),
      'Move control has no accessible movement label');
    await move.focus();
    await page.keyboard.press('Enter');
    assert.deepEqual(await pinIds(page), ['chores', 'shopping', 'finance', 'calendar']);
    savedOrder = await pinIds(page);
    await page.reload({ waitUntil: 'networkidle' });
    assert.deepEqual(await pinIds(page), savedOrder);
  });

  await check('profile switch keeps independent pin lists and returns to saved owner order', async () => {
    await page.locator('#demo-profile').selectOption('member');
    assert.deepEqual(await pinIds(page), ['goals', 'activities']);
    await revealTile(page, 'pets');
    await tile(page, 'pets').locator('[data-pin-module="pets"]').click();
    assert.deepEqual(await pinIds(page), ['goals', 'activities', 'pets']);
    await page.locator('#demo-profile').selectOption('owner');
    assert.deepEqual(await pinIds(page), savedOrder);
    await page.locator('#demo-profile').selectOption('member');
    assert.deepEqual(await pinIds(page), ['goals', 'activities', 'pets']);
    await page.locator('#demo-profile').selectOption('owner');
  });

  await check('flat and grouped modes retain every catalog module and the same personal pin order', async () => {
    await page.locator('#layout-mode').selectOption('flat');
    assert.deepEqual(await pinIds(page), savedOrder);
    assert.deepEqual((await page.locator('#modules [data-module-id]').evaluateAll(
      elements => elements.map(element => element.dataset.moduleId))).sort(), [...expectedModules].sort());
    for (const id of expectedModules) assert.equal(await tile(page, id).isVisible(), true, 'Flat mode hides ' + id);
    await layoutFits(page, 'flat mobile mode');
    await page.locator('#layout-mode').selectOption('grouped');
    assert.deepEqual(await pinIds(page), savedOrder);
    assert.equal(await page.locator('details[data-prototype-group]').count(), 4);
  });

  await check('group expansion is saved across reload and isolated by profile', async () => {
    for (const id of expectedGroups) await setGroup(page, id, id === 'daily');
    assert.deepEqual(await openIds(page), ['daily']);
    await page.reload({ waitUntil: 'networkidle' });
    assert.deepEqual(await openIds(page), ['daily']);
    await page.locator('#demo-profile').selectOption('member');
    assert.equal((await openIds(page)).includes('family'), true, 'Member expansion was lost');
    await page.locator('#demo-profile').selectOption('owner');
    assert.deepEqual(await openIds(page), ['daily']);
  });

  await check('light and dark mobile layouts, and desktop groups and shortcuts fit', async () => {
    const before = await page.locator('html').getAttribute('data-theme');
    await page.locator('#theme-toggle').click();
    const after = await page.locator('html').getAttribute('data-theme');
    assert.ok(before !== after && ['light', 'dark'].includes(after), 'Theme toggle does not change theme');
    await capture(page, 'mobile-dark');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), after, 'Theme did not survive reload');
    await page.locator('#theme-toggle').click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await capture(page, 'desktop', true);
    await sheetOpensAndCloses(page, shortcut(page, 'finance').locator('[data-open-module="finance"]'), 'finance');
    assert.equal(await page.locator('button button').count(), 0);
  });

  await check('static prototype performs only local read requests and produces no JavaScript errors', async () => {
    assert.deepEqual(rejectedRequests, []);
    assert.deepEqual(pageErrors, []);
    assert.ok(requests.every(request => ['GET', 'HEAD'].includes(request.method)));
  });

  console.log(JSON.stringify({ status: 'passed', checks, screenshots, requests }, null, 2));
} catch (error) {
  failureMessage = error.message;
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(resolve(artifactDir, 'results.json'), JSON.stringify({
    status: process.exitCode ? 'failed' : 'passed', previewUrl, failureMessage, checks, screenshots, pageErrors, rejectedRequests, requests,
  }, null, 2));
  await context?.close();
  await browser?.close();
}
