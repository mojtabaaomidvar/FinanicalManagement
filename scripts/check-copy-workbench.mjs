import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

// UI checks only. The one Apply request is intercepted with a failure response;
// this probe never sends source changes to the workbench server.
const base = 'http://127.0.0.1:5701';
const artifactDir = '.local-test/copy-workbench/ui-check';
const checks = [], pageErrors = [], applyRequests = [], unexpectedWrites = [];
let browser, context, page, catalog, entry, originalFile, failure;
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const digest = value => createHash('sha256').update(value).digest('hex');
const frame = () => page.frameLocator('#copy-preview');
const draftText = 'دسترسی‌های سریع خانه';
async function poll(test, message, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await test()) return; await page.waitForTimeout(100); }
  throw new Error(message);
}
async function ready() {
  await page.locator('#catalog-list [data-copy-id]').first().waitFor();
  await poll(async () => await page.locator('#preview-state').innerText() === 'آماده', 'Preview did not become ready');
}
async function select(id, search) {
  await page.locator('#copy-search').fill(search);
  await page.locator('#catalog-list [data-copy-id="' + id + '"]').click();
  assert.equal(await page.locator('#editor-content').isVisible(), true);
}
async function reset() {
  if (!(await page.locator('#reset-all').isDisabled())) await page.locator('#reset-all').click();
  await poll(async () => await page.locator('#apply-changes').isDisabled(), 'Draft reset did not disable Apply');
}
async function check(name, test) { await test(); checks.push(name); }

try {
  await mkdir(artifactDir, { recursive: true });
  const response = await fetch(base + '/__copy/catalog'); assert.equal(response.status, 200); catalog = await response.json();
  entry = catalog.entries.find(value => value.file.endsWith('/HomeModules.tsx') && clean(value.text) === 'دسترسی سریع');
  assert.ok(entry, 'The real quick-access heading must be editable'); originalFile = await readFile(entry.file);
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
  await page.route(base + '/__copy/apply', async route => {
    const request = route.request(), body = request.postDataJSON();
    assert.ok(request.headers()['x-copy-workbench-token']?.length >= 32, 'Apply must include the scoped token');
    applyRequests.push({ changes: body.changes, revision: body.revision });
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'خطای آزمایشی در اعمال؛ پیش‌نویس باید باقی بماند.' }) });
  });
  await page.route(base + '/__copy/undo', async route => { unexpectedWrites.push('undo'); await route.abort(); });
  await page.goto(base, { waitUntil: 'networkidle' }); await ready();

  await check('the real catalog and populated app preview load without browser errors', async () => {
    assert.ok(catalog.entries.length >= 3000);
    assert.equal(await frame().locator('.hub-page').count(), 1);
    assert.equal(await frame().locator('[data-home-module]').count(), 19);
    assert.ok(await frame().locator('.hub-overview [data-home-ref-id]').count() > 0);
    const firstId = await page.locator('#catalog-list [data-copy-id]').first().getAttribute('data-copy-id');
    assert.ok(catalog.entries.find(value => value.id === firstId)?.file.includes('/pages/HubPage/'));
    assert.ok(await page.locator('#catalog-list [data-copy-id]').first().innerText().then(text => !text.includes('توکن نشست')));
  });
  await check('search selects an exact source location and shows original copy', async () => {
    await select(entry.id, 'دسترسی سریع');
    assert.equal(await page.locator('#copy-original').innerText(), entry.text);
    assert.ok((await page.locator('#copy-source').textContent()).includes('HomeModules.tsx'));
  });
  await check('a draft updates the real static heading and remains unapplied', async () => {
    await page.locator('#copy-edit').fill(draftText);
    await poll(async () => await frame().locator('#home-quick-title').innerText() === draftText, 'Live copy preview did not change');
    assert.equal(await page.locator('#apply-changes').isDisabled(), false);
    assert.ok((await page.locator('#entry-draft-state').innerText()).includes('هنوز'));
    assert.equal(applyRequests.length, 0);
  });
  await check('an intercepted failed apply keeps the complete draft and a truthful error', async () => {
    await page.locator('#apply-changes').click();
    await poll(async () => (await page.locator('#notice').innerText()).includes('خطای آزمایشی'), 'Apply failure was not visible');
    assert.equal(await page.locator('#copy-edit').inputValue(), draftText);
    assert.equal(await page.locator('#apply-changes').isDisabled(), false);
    assert.equal(applyRequests.length, 1);
    assert.deepEqual(applyRequests[0].changes, [{ id: entry.id, text: draftText, expectedText: entry.text }]);
  });
  await check('drafts survive workbench reload and continue in the live preview', async () => {
    await page.reload({ waitUntil: 'networkidle' }); await ready();
    await select(entry.id, 'دسترسی سریع');
    assert.equal(await page.locator('#copy-edit').inputValue(), draftText);
    await poll(async () => await frame().locator('#home-quick-title').innerText() === draftText, 'Reload lost the visible draft');
  });
  await check('reset restores the original preview without a source write', async () => {
    await reset(); await poll(async () => await frame().locator('#home-quick-title').innerText() === entry.text, 'Reset did not restore the heading');
    assert.equal(await page.locator('#copy-edit').inputValue(), entry.text);
  });
  await check('template placeholders remain protected and prevent invalid apply', async () => {
    const template = catalog.entries.find(value => value.tokens?.length && value.file.startsWith('src/') && value.text.length < 500);
    assert.ok(template); await select(template.id, template.text);
    await page.locator('#copy-edit').fill('متن بدون مقدارهای لازم');
    assert.equal(await page.locator('#copy-edit').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#apply-changes').isDisabled(), true);
    assert.equal(await page.locator('#copy-validation').isVisible(), true);
    await reset();
  });
  await check('the picker finds a static heading and lists its source locations', async () => {
    await page.locator('#copy-search').fill(''); await page.locator('#pick-text').click();
    await frame().locator('#home-quick-title').click();
    await poll(async () => await page.locator('#picked-note').isVisible(), 'Static text picker did not find source locations');
    assert.equal(await page.locator('#copy-original').innerText(), entry.text);
    await page.locator('#pick-text').click(); await page.locator('#clear-pick').click();
  });
  await check('record titles and form input values are protected from literal copy drafts', async () => {
    await select(entry.id, 'دسترسی سریع'); await page.locator('#copy-edit').fill(draftText);
    await page.locator('#preview-route').selectOption('tasks'); await ready();
    await frame().locator('.shop-body > b').first().waitFor();
    await frame().locator('.shop-body > b').first().evaluate((node, value) => { node.textContent = value; }, entry.text);
    await page.waitForTimeout(200);
    assert.equal(await frame().locator('.shop-body > b').first().innerText(), entry.text);
    await frame().getByRole('button', { name: 'ثبت کار جدید', exact: true }).click();
    await frame().getByRole('textbox', { name: 'عنوان کار', exact: true }).fill(entry.text);
    await page.waitForTimeout(200);
    assert.equal(await frame().getByRole('textbox', { name: 'عنوان کار', exact: true }).inputValue(), entry.text);
    await page.locator('#copy-preview').evaluate(node => node.scrollIntoView({ block: 'end' }));
    await frame().getByRole('button', { name: 'انصراف', exact: true }).click();
    await reset();
  });
  await check('rapid preview switches ignore old responses and stale iframe readiness messages', async () => {
    const oldSession = new URL(await page.locator('#copy-preview').getAttribute('src'), base).searchParams.get('session');
    const held = [];
    const holdPreview = async route => {
      const item = { route: route.request().postDataJSON().route, completed: false, release: null };
      await new Promise(resolve => { item.release = resolve; held.push(item); });
      const response = await route.fetch(); await route.fulfill({ response }); item.completed = true;
    };
    await page.route(base + '/__copy/preview', holdPreview);
    await page.locator('#preview-route').evaluate(select => {
      for (const value of ['documents', 'meals']) {
        select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await poll(async () => held.length === 2, 'The two rapid route requests were not issued');
    await frame().locator('body').evaluate((_body, session) => {
      parent.postMessage({ type: 'copy-preview-ready', session, route: 'tasks' }, location.origin);
    }, oldSession);
    await page.waitForTimeout(100);
    assert.notEqual(await page.locator('#preview-state').innerText(), 'آماده', 'Old iframe readiness completed a pending new preview');
    held.find(item => item.route === 'meals').release();
    await poll(async () => await page.locator('#copy-preview').evaluate(iframe => {
      const view = iframe.contentWindow;
      return view?.__COPY_PREVIEW__?.route === 'meals' && view.__COPY_PREVIEW_OBSERVED__ === true;
    }) && await page.locator('#preview-state').innerText() === 'آماده', 'The latest requested route did not become genuinely ready');
    const latestUrl = await page.locator('#copy-preview').getAttribute('src');
    assert.notEqual(new URL(latestUrl, base).searchParams.get('session'), oldSession);
    const notice = await page.locator('#notice').textContent();
    await frame().locator('body').evaluate((_body, session) => {
      parent.postMessage({ type: 'copy-preview-status', session, message: 'stale-preview-status' }, location.origin);
      parent.postMessage({ type: 'copy-preview-error', session, message: 'stale-preview-error' }, location.origin);
    }, oldSession);
    held.find(item => item.route === 'documents').release();
    await poll(async () => held.every(item => item.completed), 'The old response did not complete');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#copy-preview').getAttribute('src'), latestUrl, 'An old response replaced the latest preview');
    assert.equal(await page.locator('#preview-state').innerText(), 'آماده');
    assert.equal(await page.locator('#notice').textContent(), notice);
    assert.equal(await frame().getByRole('heading', { name: 'برنامهٔ غذایی', exact: true }).count(), 1);
    await page.unroute(base + '/__copy/preview', holdPreview);
  });
  await check('a changed source retains incompatible drafts for review without overwrite', async () => {
    await select(entry.id, 'دسترسی سریع'); await page.locator('#copy-edit').fill(draftText);
    const changed = structuredClone(catalog); changed.revision = 'simulated-new-source';
    changed.entries = changed.entries.map(value => value.id === entry.id ? { ...value, text: 'دسترسی سریع در نسخهٔ دیگر' } : value);
    await page.route(base + '/__copy/catalog', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(changed) });
    }, { times: 1 });
    await page.locator('#reload-catalog').click();
    await poll(async () => await page.locator('#draft-conflicts').isVisible(), 'Incompatible draft was lost instead of retained');
    await page.locator('#draft-conflicts summary').click();
    assert.ok((await page.locator('#conflict-list').innerText()).includes(draftText));
    await page.locator('#clear-conflicts').click(); await page.locator('#reload-catalog').click();
    await poll(async () => !(await page.locator('#draft-conflicts').isVisible())
      && await page.locator('#copy-original').innerText() === entry.text, 'The real source catalog did not reload after clearing conflicts');
  });
  await check('desktop and mobile layouts keep controls inside the viewport', async () => {
    await page.locator('#preview-route').selectOption('hub'); await ready(); await select(entry.id, 'دسترسی سریع');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: artifactDir + '/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#copy-edit').isVisible(), true);
    await page.screenshot({ path: artifactDir + '/mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check('all UI interactions leave actual source bytes unchanged', async () => {
    assert.equal(digest(await readFile(entry.file)), digest(originalFile));
    assert.deepEqual(unexpectedWrites, []);
    assert.deepEqual(pageErrors, []);
  });
  console.log('Copy workbench UI checks passed: ' + checks.length + '. No source changes were sent.');
} catch (error) {
  failure = error.message;
  if (page) await page.screenshot({ path: artifactDir + '/failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await writeFile(artifactDir + '/results.json', JSON.stringify({ passed: !failure, checks, failure, pageErrors,
    interceptedApplyRequests: applyRequests.length, unexpectedWrites, sourceUnchanged: entry && originalFile ? digest(await readFile(entry.file)) === digest(originalFile) : null }, null, 2));
}
