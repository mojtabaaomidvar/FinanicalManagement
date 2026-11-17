import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:5701', directory = '.local-test/copy-workbench/source-picker-check';
const checks = [], errors = [], writes = [], originals = new Map();
let browser, context, page, failure;
const frame = () => page.frameLocator('#copy-preview');
async function poll(test, message, timeout = 35000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await test()) return; await page.waitForTimeout(100); }
  throw new Error(message);
}
async function ready() {
  await poll(async () => await page.locator('#preview-state').innerText() === 'آماده', 'Preview must become ready');
}
async function selectedFile() { return await page.locator('#copy-source').textContent(); }
async function sendDrafts(drafts) {
  await page.evaluate(values => document.querySelector('#copy-preview').contentWindow.postMessage({ type: 'copy-drafts', drafts: values }, location.origin), drafts);
}
async function check(name, test) { await test(); checks.push(name); }
try {
  await mkdir(directory, { recursive: true });
  for (const file of ['src/pages/SettingsPage/SettingsPage.tsx', 'src/pages/SettingsPage/ProfileCard.tsx']) originals.set(file, await readFile(file));
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  for (const path of ['/__copy/apply', '/__copy/undo']) await page.route(base + path, async route => { writes.push(path); await route.abort(); });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 }); await ready();
  await page.locator('#preview-route').selectOption('settings/profile'); await ready();
  const outer = frame().locator('.app-header h1'), inner = frame().locator('.card-head h3').first();
  await outer.waitFor(); await inner.waitFor();
  const originalOuter = await outer.innerText(), originalInner = await inner.innerText();
  const outerDraft = 'عنوان بیرونی آزمایشی', innerDraft = 'عنوان کارت آزمایشی';
  let outerId, innerId;
  await check('clicking the outer profile header resolves its SettingsPage source', async () => {
    await page.locator('#pick-text').click(); await outer.click();
    await poll(async () => (await selectedFile()).includes('SettingsPage.tsx'), 'Outer heading selected another source');
    outerId = await page.locator('[data-copy-id][aria-current="true"]').getAttribute('data-copy-id');
    assert.ok(outerId); assert.equal(await page.locator('#copy-original').innerText(), originalOuter);
  });
  await check('an outer-title draft updates only the outer header', async () => {
    await page.locator('#copy-edit').fill(outerDraft);
    await poll(async () => await outer.innerText() === outerDraft, 'Outer draft did not preview');
    assert.equal(await inner.innerText(), originalInner);
  });
  await check('clicking the inner card header resolves the distinct ProfileCard source', async () => {
    await inner.click();
    await poll(async () => (await selectedFile()).includes('ProfileCard.tsx'), 'Inner heading selected another source');
    innerId = await page.locator('[data-copy-id][aria-current="true"]').getAttribute('data-copy-id');
    assert.ok(innerId); assert.notEqual(innerId, outerId); assert.equal(await page.locator('#copy-original').innerText(), originalInner);
    await page.locator('#copy-edit').fill(innerDraft);
    await poll(async () => await inner.innerText() === innerDraft, 'Inner draft did not preview');
    assert.equal(await outer.innerText(), outerDraft);
  });
  await check('ambiguous uninstrumented values are not globally changed by a location draft', async () => {
    await frame().locator('body').evaluate((body, text) => { const probe = document.createElement('p'); probe.id = 'copy-ambiguous-probe'; probe.textContent = text; body.append(probe); }, originalOuter);
    await sendDrafts([{ id: outerId, original: originalOuter, text: outerDraft, matchingIds: [outerId, innerId], tokens: [] }]);
    await page.waitForTimeout(200);
    assert.equal(await frame().locator('#copy-ambiguous-probe').innerText(), originalOuter);
  });
  await check('confirmed literal fallbacks win over coincidentally identical user values', async () => {
    const memberName = await frame().locator('body').evaluate(async body => {
      const members = await (await fetch('/api/v1/auth/members')).json();
      const name = (Array.isArray(members) ? members : members.items)[0].name;
      for (const active of [true, false]) {
        const wrapper = document.createElement('div'); wrapper.className = 'hub-id';
        const heading = document.createElement('h1'); heading.id = active ? 'copy-known-fallback' : 'copy-user-value'; heading.textContent = name;
        heading.setAttribute('data-copy-sources', JSON.stringify([{ id: 'probe.fallback', text: name, active }])); wrapper.append(heading); body.append(wrapper);
      }
      return name;
    });
    await page.waitForTimeout(150);
    await sendDrafts([{ id: 'probe.fallback', original: memberName, text: 'پیام ثابت آزمایشی', matchingIds: ['probe.fallback'], tokens: [] }]);
    await poll(async () => await frame().locator('#copy-known-fallback').innerText() === 'پیام ثابت آزمایشی', 'Literal fallback was protected as user data');
    assert.equal(await frame().locator('#copy-user-value').innerText(), memberName);
  });
  await check('a newly registered empty body slot can preview restored words', async () => {
    await frame().locator('body').evaluate(body => { const probe = document.createElement('p'); probe.id = 'copy-empty-probe'; probe.setAttribute('data-copy-sources', JSON.stringify([{ id: 'future.empty', text: '' }])); body.append(probe); });
    await sendDrafts([{ id: 'future.empty', original: '', text: 'راهنمای بازگردانده‌شده', matchingIds: ['future.empty'], tokens: [] }]);
    await poll(async () => await frame().locator('#copy-empty-probe').innerText() === 'راهنمای بازگردانده‌شده', 'Empty slot could not preview restoration');
    await page.locator('#reset-all').click();
    await poll(async () => await outer.innerText() === originalOuter && await inner.innerText() === originalInner
      && await frame().locator('#copy-empty-probe').innerText() === '', 'Reset did not restore original profile labels and empty slot');
    assert.equal(await frame().locator('#copy-empty-probe').innerText(), '');
  });
  await check('source picking leaves application source files unchanged', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    for (const [file, bytes] of originals) assert.deepEqual(await readFile(file), bytes);
  });
  await page.screenshot({ path: directory + '/profile.png', fullPage: true });
} catch (error) { failure = error.stack ?? String(error); }
finally { await browser?.close(); }
const result = { passed: !failure, checks, errors, writes, failure };
await writeFile(directory + '/results.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2)); if (failure) process.exitCode = 1;
