import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:5701';
const bridge = await readFile(new URL('../../tools/copy-workbench/preview-bridge.js', import.meta.url), 'utf8');
const nativeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" stroke-width="2"></circle></svg>';
const records = {
  help: { id: 'visual.help', kind: 'text-element', visible: true, textEntryIds: ['help'], file: 'src/Test.tsx', line: 1 },
  hidden: { id: 'visual.hidden', kind: 'text-element', visible: false, textEntryIds: ['hidden'], file: 'src/Test.tsx', line: 2 },
  native: { id: 'visual.native', kind: 'icon', visible: true, icon: null, nativeIcon: true, nativeSvg, file: 'src/Test.tsx', line: 3 },
  forwarded: { id: 'visual.forwarded', kind: 'icon', visible: true, icon: 'i-star', file: 'src/Test.tsx', line: 4 },
};
const visual = value => "data-copy-visual='" + JSON.stringify([value]) + "'";
const text = (id, value) => "data-copy-sources='" + JSON.stringify([{ id, text: value, file: 'src/Test.tsx', line: 1 }]) + "'";

async function fixture(t, { appliedNative = false } = {}) {
  const browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route(origin + '/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/bridge-test.js') return route.fulfill({ contentType: 'text/javascript', body: bridge });
    if (url.pathname.startsWith('/preview')) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
      <main>
        <svg style="display:none"><symbol id="i-star" viewBox="0 0 24 24"><path d="M1 1L20 20"></path></symbol><symbol id="i-money" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle></symbol><symbol id="i-arrow-l" viewBox="0 0 24 24"><path d="M20 12H4"></path></symbol></svg>
        <p id="help" ${visual(records.help)} ${text('help', 'Static help')}>Static help</p>
        <button id="same-text">Static help</button>
        <p id="hidden" ${visual(records.hidden)} ${text('hidden', 'Hidden help')}>Hidden help</p>
        <p id="user" class="task-title">Static help</p>
        <div data-meal-content><b id="food-data">Static help</b></div>
        <span id="native" ${visual(appliedNative ? { ...records.native, icon: 'i-star' } : records.native)}><svg width="48" height="48" viewBox="${appliedNative ? '0 0 24 24' : '0 0 48 48'}">${appliedNative ? '<use href="#i-star"></use>' : '<circle cx="24" cy="24" r="20" stroke-width="2"></circle>'}</svg></span>
        <button id="row">Row <span id="forwarded-wrap"><svg id="forwarded" width="24" height="24" viewBox="0 0 24 24"><use href="#i-star"></use></svg></span><svg id="arrow" width="24" height="24" viewBox="0 0 24 24"><use href="#i-arrow-l"></use></svg></button>
      </main>
      <script>window.__COPY_PREVIEW__={session:'bridge-test',scenario:{mode:'auth'},route:'auth'};
      const identity={'data-copy-visual':${JSON.stringify(JSON.stringify([records.forwarded]))}};
      for(const id of ['forwarded','arrow']) document.getElementById(id).__reactFiber$test={memoizedProps:{},return:{memoizedProps:identity,type:()=>{}}};</script>
      <script src="/bridge-test.js"></script></body></html>` });
    return route.fulfill({ contentType: 'text/html', body: '<script>window.messages=[];window.addEventListener("message",event=>messages.push(event.data));</script><iframe id="preview" src="/preview/bridge-test?session=bridge-test" width="700" height="500"></iframe>' });
  });
  await page.goto(origin + '/bridge-parent');
  await page.waitForFunction(() => window.messages.some(value => value.type === 'copy-preview-ready'));
  const frame = page.frameLocator('#preview');
  const send = data => page.evaluate(value => document.querySelector('#preview').contentWindow.postMessage(value, location.origin), data);
  return { page, frame, send };
}

test('visual drafts hide and restore only their source elements and preserve native SVG geometry', async t => {
  const { frame, send } = await fixture(t);
  assert.equal(await frame.locator('#hidden').isVisible(), false);
  assert.equal(await frame.locator('#hidden').textContent(), 'Hidden help');
  await send({ type: 'copy-visual-drafts', drafts: [{ id: 'visual.hidden', visible: true }, { id: 'visual.native', visible: true, icon: 'i-money' }] });
  await frame.locator('#hidden').waitFor({ state: 'visible' });
  await frame.locator('#native use[href="#i-money"]').waitFor();
  assert.equal(await frame.locator('#native svg').getAttribute('viewBox'), '0 0 24 24');
  assert.equal(await frame.locator('#row').isVisible(), true);
  await send({ type: 'copy-visual-drafts', drafts: [{ id: 'visual.native', visible: false, icon: 'i-money' }] });
  await frame.locator('#native').waitFor({ state: 'hidden' });
  await send({ type: 'copy-visual-drafts', drafts: [] });
  await frame.locator('#native').waitFor({ state: 'visible' });
  await frame.locator('#native circle').waitFor();
  assert.equal(await frame.locator('#native svg').getAttribute('viewBox'), '0 0 48 48');
  assert.equal(await frame.locator('#hidden').isVisible(), false);
  assert.equal(await frame.locator('#user').textContent(), 'Static help');
  assert.equal(await frame.locator('#food-data').textContent(), 'Static help');
});

test('forwarded icon metadata selects and changes the matching glyph without its row or navigation arrow', async t => {
  const { page, frame, send } = await fixture(t);
  await send({ type: 'copy-visual-drafts', drafts: [{ id: 'visual.forwarded', visible: true, icon: 'i-money' }] });
  await frame.locator('#forwarded use[href="#i-money"]').waitFor();
  assert.equal(await frame.locator('#arrow use').getAttribute('href'), '#i-arrow-l');
  await send({ type: 'copy-pick-mode', enabled: true });
  await frame.locator('#forwarded').click();
  await page.waitForFunction(() => window.messages.some(value => value.type === 'copy-pick'));
  const picked = await page.evaluate(() => window.messages.find(value => value.type === 'copy-pick'));
  assert.deepEqual(picked.visualEntryIds, ['visual.forwarded']);
  await send({ type: 'copy-visual-drafts', drafts: [{ id: 'visual.forwarded', visible: false }] });
  await frame.locator('#forwarded').waitFor({ state: 'hidden' });
  assert.equal(await frame.locator('#forwarded-wrap').isVisible(), false);
  assert.equal(await frame.locator('#row').isVisible(), true);
  assert.equal(await frame.locator('#arrow').isVisible(), true);
});

test('an already-applied native icon replacement previews restoration from its original source geometry', async t => {
  const { frame, send } = await fixture(t, { appliedNative: true });
  await frame.locator('#native use[href="#i-star"]').waitFor();
  await send({ type: 'copy-visual-drafts', drafts: [{ id: 'visual.native', visible: true, icon: null }] });
  await frame.locator('#native circle').waitFor();
  assert.equal(await frame.locator('#native svg').getAttribute('viewBox'), '0 0 48 48');
  assert.equal(await frame.locator('#native circle').getAttribute('stroke-width'), '2');
  await send({ type: 'copy-visual-drafts', drafts: [] });
  await frame.locator('#native use[href="#i-star"]').waitFor();
  assert.equal(await frame.locator('#native svg').getAttribute('viewBox'), '0 0 24 24');
});

test('text selection includes its visual source while mixed text and visibility drafts preserve identical user values', async t => {
  const { page, frame, send } = await fixture(t);
  await send({ type: 'copy-pick-mode', enabled: true });
  await frame.locator('#help').click();
  await page.waitForFunction(() => window.messages.some(value => value.type === 'copy-pick'));
  const picked = await page.evaluate(() => window.messages.find(value => value.type === 'copy-pick'));
  assert.deepEqual(picked.entryIds, ['help']); assert.deepEqual(picked.visualEntryIds, ['visual.help']);
  await send({ type: 'copy-drafts', drafts: [{ id: 'help', original: 'Static help', text: 'Edited help', matchingIds: ['help'], tokens: [] }] });
  await frame.locator('#help').filter({ hasText: 'Edited help' }).waitFor();
  await send({ type: 'copy-visual-drafts', drafts: [{ id: 'visual.help', visible: false }] });
  await frame.locator('#help').waitFor({ state: 'hidden' });
  await send({ type: 'copy-visual-drafts', drafts: [] });
  await frame.locator('#help').waitFor({ state: 'visible' });
  assert.equal(await frame.locator('#help').textContent(), 'Edited help');
  assert.equal(await frame.locator('#user').textContent(), 'Static help');
  await send({ type: 'copy-drafts', drafts: [] });
  await page.waitForFunction(() => document.querySelector('#preview').contentDocument.querySelector('#help').textContent === 'Static help');
});
