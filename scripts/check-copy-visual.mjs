import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:5701', directory = '.local-test/copy-workbench/visual-check';
const checks = [], errors = [], writes = [], originals = new Map();
let browser, context, page, failure;
const frame = () => page.frameLocator('#copy-preview');
const visual = id => frame().locator('[data-copy-visual*=' + JSON.stringify(id) + ']').first();
const selectedId = () => page.locator('[data-copy-id][aria-current="true"]').getAttribute('data-copy-id');
async function poll(test, message, timeout = 40000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await test()) return; await page.waitForTimeout(100); }
  throw new Error(message);
}
async function ready() { await poll(async () => await page.locator('#preview-state').innerText() === 'آماده', 'Preview must become ready'); }
async function check(name, test) { await test(); checks.push(name); }
async function hidden(locator) { return await locator.evaluate(element => getComputedStyle(element).display === 'none'); }
async function storedVisualDraft(id) {
  return page.evaluate(value => JSON.parse(localStorage.getItem('khaneyar:copy-workbench:drafts:v1') ?? 'null')?.visualDrafts?.find(draft => draft.id === value), id);
}
try {
  await mkdir(directory, { recursive: true });
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  for (const path of ['/__copy/apply', '/__copy/undo']) await page.route(base + path, async route => { writes.push(path); await route.abort(); });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 }); await ready();
  const catalog = await (await context.request.get(base + '/__copy/catalog')).json();
  assert.ok(catalog.visualEntries.length); assert.ok(catalog.iconOptions.length);
  for (const file of new Set(catalog.visualEntries.map(entry => entry.file))) originals.set(file, await readFile(file));
  const quickTitle = frame().locator('.home-keyboard-instructions'), originalTitle = await quickTitle.innerText();
  let titleId, titleVisualId, iconId, originalIcon;
  await check('visual picker connects static helper text to its exact text and element sources', async () => {
    await page.locator('#pick-text').click(); await quickTitle.click();
    await poll(async () => await page.locator('#editor-content').isVisible(), 'Text editor was not selected');
    titleId = await selectedId(); titleVisualId = await page.locator('#text-element-target').inputValue();
    const entry = catalog.visualEntries.find(value => value.id === titleVisualId);
    assert.equal(entry.kind, 'text-element'); assert.ok(entry.textEntryIds.includes(titleId));
    assert.ok(entry.file.includes('HomeModules.tsx')); assert.equal(await page.locator('#copy-original').innerText(), originalTitle);
  });
  await check('a text deletion draft removes its preview space, survives reload and cancels without a source write', async () => {
    assert.ok((await page.locator('#text-hide-element').innerText()).includes('حذف'));
    await page.locator('#text-hide-element').click();
    await poll(async () => await hidden(quickTitle), 'Deleted heading element remained in preview');
    assert.equal((await storedVisualDraft(titleVisualId)).deleted, true);
    assert.equal((await storedVisualDraft(titleVisualId)).visible, true);
    assert.ok(await page.locator('#text-show-element').isEnabled());
    assert.equal(await page.locator('#apply-count').innerText(), '۱');
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
    await poll(async () => await hidden(quickTitle), 'Stored text deletion did not survive reload');
    assert.equal((await storedVisualDraft(titleVisualId)).deleted, true);
    await page.locator('#copy-search').fill(originalTitle); await page.locator('[data-copy-id=' + JSON.stringify(titleId) + ']').click();
    await page.locator('#text-element-target').selectOption(titleVisualId);
    await page.locator('#reload-catalog').click();
    await poll(async () => await page.locator('#catalog-list').getAttribute('aria-busy') === 'false', 'Catalog did not reload');
    assert.equal(await page.locator('#apply-count').innerText(), '۱');
    await page.locator('#text-show-element').click();
    await poll(async () => !(await hidden(quickTitle)), 'Cancelling the deletion did not restore the heading');
    assert.equal(await storedVisualDraft(titleVisualId), undefined);
    assert.equal(await quickTitle.innerText(), originalTitle);
    assert.equal(await page.locator('#apply-count').innerText(), '۰');
  });
  await check('text edits and element deletion drafts coexist without overwriting each other', async () => {
    await page.locator('#copy-edit').fill('دسترسی آزمایشی');
    await poll(async () => await quickTitle.innerText() === 'دسترسی آزمایشی', 'Text draft did not preview');
    await page.locator('#text-hide-element').click();
    await poll(async () => await hidden(quickTitle), 'Text draft element deletion did not preview');
    assert.equal(await page.locator('#apply-count').innerText(), '۲');
    await page.locator('#text-show-element').click();
    await poll(async () => !(await hidden(quickTitle)), 'Text draft element did not restore');
    assert.equal(await quickTitle.innerText(), 'دسترسی آزمایشی');
    assert.equal(await page.locator('#apply-count').innerText(), '۱');
    await page.locator('#reset-entry').click();
    await poll(async () => await quickTitle.innerText() === originalTitle, 'Text reset lost original copy');
  });
  await check('picking a rendered icon opens its exact source and the real icon palette', async () => {
    if (await page.locator('#pick-text').getAttribute('aria-pressed') !== 'true') await page.locator('#pick-text').click();
    const ids = catalog.visualEntries.filter(entry => entry.kind === 'icon' && entry.visible).map(entry => entry.id);
    iconId = await frame().locator('[data-copy-visual]').evaluateAll((elements, validIds) => {
      for (const element of elements) {
        if (!element.getBoundingClientRect().width || !element.getBoundingClientRect().height) continue;
        let records; try { records = JSON.parse(element.getAttribute('data-copy-visual')); } catch { continue; }
        if (!Array.isArray(records)) records = [records];
        const match = records.find(record => validIds.includes(record.id));
        if (match) return match.id;
      }
      return null;
    }, ids);
    assert.ok(iconId, 'No visible instrumented icon'); originalIcon = catalog.visualEntries.find(entry => entry.id === iconId).icon;
    await visual(iconId).click();
    await poll(async () => await page.locator('#visual-editor-content').isVisible() && await selectedId() === iconId, 'Icon picked another source');
    assert.equal(await page.locator('#icon-choice').isVisible(), true);
    assert.equal(await page.locator('#icon-palette .icon-choice').count(), catalog.iconOptions.length + (catalog.visualEntries.find(entry => entry.id === iconId).nativeIcon ? 1 : 0));
    const box = await page.locator('#icon-palette').boundingBox(); assert.ok(box.height <= 320);
  });
  const replacementIcon = catalog.iconOptions.find(icon => icon.id !== originalIcon).id;
  await check('icon replacement previews only that source and deletion can be cancelled', async () => {
    await page.locator('#icon-palette [data-icon-id=' + JSON.stringify(replacementIcon) + ']').click();
    await poll(async () => await visual(iconId).locator('use').first().getAttribute('href') === '#' + replacementIcon, 'Replacement icon was not rendered');
    assert.equal(await page.locator('#icon-palette [data-icon-id=' + JSON.stringify(replacementIcon) + ']').getAttribute('aria-pressed'), 'true');
    await page.locator('#visual-hide').click();
    await poll(async () => await hidden(visual(iconId)), 'Deleted icon remained in preview');
    assert.equal((await storedVisualDraft(iconId)).deleted, true);
    assert.equal(await page.locator('[data-visual-id=' + JSON.stringify(iconId) + '] .hidden-tag').innerText(), 'حذف از کد');
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
    await poll(async () => await hidden(visual(iconId)), 'Stored icon deletion did not survive reload');
    await page.locator('#copy-kind').selectOption('icon'); await page.locator('#draft-only').check();
    await page.locator('[data-visual-id=' + JSON.stringify(iconId) + ']').click();
    assert.equal(await page.locator('[data-visual-id=' + JSON.stringify(iconId) + '] .hidden-tag').innerText(), 'حذف از کد');
    await page.locator('#visual-show').click();
    await poll(async () => !(await hidden(visual(iconId))), 'Cancelling icon deletion did not restore it');
    assert.equal((await storedVisualDraft(iconId)).deleted, false);
    assert.equal(await visual(iconId).locator('use').first().getAttribute('href'), '#' + replacementIcon);
  });
  await check('visual drafts survive reopening the page and catalog refresh', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
    await poll(async () => await visual(iconId).locator('use').first().getAttribute('href') === '#' + replacementIcon, 'Stored icon draft did not survive reload');
    assert.equal(await page.locator('#apply-count').innerText(), '۱');
    await page.locator('#copy-kind').selectOption('icon'); await page.locator('#draft-only').check();
    await page.locator('[data-visual-id=' + JSON.stringify(iconId) + ']').click();
    await page.locator('#icon-search').fill('impossible-icon-search');
    assert.equal(await page.locator('#icon-empty').isVisible(), true);
    await page.locator('#icon-search').fill('');
    await page.screenshot({ path: directory + '/desktop.png', fullPage: true });
  });
  await check('mobile visual controls remain usable without page overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#visual-editor-content').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const button = await page.locator('#visual-hide').boundingBox(); assert.ok(button.width >= 120 && button.height >= 40);
    await page.screenshot({ path: directory + '/mobile.png', fullPage: true });
  });
  await check('reset restores original rendering and all source files remain byte-identical', async () => {
    await page.locator('#reset-all').click();
    await poll(async () => await page.locator('#apply-count').innerText() === '۰', 'Reset left visual drafts behind');
    if (originalIcon) await poll(async () => await visual(iconId).locator('use').first().getAttribute('href') === '#' + originalIcon, 'Original icon did not restore');
    assert.equal(await quickTitle.innerText(), originalTitle);
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    for (const [file, bytes] of originals) assert.deepEqual(await readFile(file), bytes, file + ' changed');
  });
} catch (error) { failure = error.stack ?? String(error); }
finally { await browser?.close(); }
const result = { passed: !failure, checks, errors, writes, failure };
await writeFile(directory + '/results.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2)); if (failure) process.exitCode = 1;
