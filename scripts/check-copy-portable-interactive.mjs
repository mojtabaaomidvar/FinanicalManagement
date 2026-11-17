import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { collectCatalog } from './copy-workbench/catalog.mjs';
import { collectVisualCatalog } from './copy-workbench/visual-catalog.mjs';
import { createPortablePackage } from './copy-workbench/portable-package.mjs';
import { renderInteractivePortable } from './copy-workbench/portable-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, '.local-test/copy-workbench/portable-interactive-check');
const catalog = await collectCatalog(root), visualCatalog = await collectVisualCatalog(root, catalog);
const portable = await createPortablePackage(root, catalog, { interactive: true, visualCatalog,
  fontDataUrl: 'data:font/woff2;base64,' + (await readFile(join(root, 'node_modules/vazirmatn/fonts/webfonts/Vazirmatn[wght].woff2'))).toString('base64') });
await mkdir(directory, { recursive: true });
const html = await renderInteractivePortable(root, portable, { catalog, visualCatalog });
const file = join(directory, 'interactive-editor.html'); await writeFile(file, html);
const browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
const checks = [], errors = [], requests = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, offline: true, acceptDownloads: true, serviceWorkers: 'block' });
context.on('request', request => { if (/^https?:/i.test(request.url())) requests.push(request.url()); });
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
async function poll(test, reason, timeout = 35000) {
  const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(reason);
}
async function ready() { await poll(async () => await page.locator('#preview-state').innerText() === 'آماده', 'Standalone real preview did not become ready: ' + await page.locator('#preview-state').innerText()); }
async function choose(entry) {
  await page.locator('#copy-search').fill(entry.text ?? entry.label); await page.locator('#catalog-list [data-copy-id="' + entry.id + '"]').click();
}
let result;
try {
  assert.ok(!html.includes('sourceMappingURL')); assert.ok(!html.includes('src/pages/HubPage/HubPage.tsx')); assert.ok(html.includes("connect-src 'none'"));
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' }); await ready();
  const frame = page.frameLocator('#copy-preview');
  assert.equal(await frame.locator('.hub-page').count(), 1); assert.equal(await page.locator('.workbench-grid > section').count(), 3);
  assert.equal(await page.locator('#apply-changes').innerText(), 'دریافت فایل تغییرها ۰');
  assert.equal(await page.locator('#undo-batch').isVisible(), false); checks.push('same editor layout and real React preview work offline');
  const visible = await frame.locator('[data-copy-sources]').evaluateAll(elements => elements.flatMap(element => {
    if (!element.getBoundingClientRect().width || !element.getBoundingClientRect().height) return [];
    const records = JSON.parse(element.dataset.copySources ?? '[]');
    return records.filter(record => !record.attribute && !record.tokens?.length && record.text.trim() && element.textContent.trim() === record.text.trim()).map(record => ({ id: record.id, text: record.text }));
  }));
  const entry = portable.entries.find(entry => visible.some(item => item.id === entry.id)); assert.ok(entry, 'Visible source-owned text must be editable');
  await choose(entry); await page.locator('#copy-edit').fill('English preview');
  await poll(async () => await frame.locator('[data-copy-sources]').evaluateAll((elements, id) => elements.filter(element => JSON.parse(element.dataset.copySources ?? '[]').some(source => source.id === id)).some(element => element.textContent.includes('English preview')), entry.id), 'English edit did not update real preview');
  await page.locator('#copy-edit').fill(''); assert.equal(await page.locator('#apply-changes').isEnabled(), true); await page.locator('#copy-edit').fill('English preview');
  const template = portable.entries.find(entry => entry.tokens.length); await choose(template); await page.locator('#copy-edit').fill('Welcome ' + template.tokens.map(token => token.token).join(' '));
  checks.push('English, empty, and template drafts remain editable');
  const visibleIcons = await frame.locator('[data-copy-visual]').evaluateAll(elements => elements.flatMap(element => {
    if (!element.getBoundingClientRect().width || !element.getBoundingClientRect().height) return [];
    return JSON.parse(element.dataset.copyVisual ?? '[]').filter(record => record.kind === 'icon' && !record.nativeIcon && record.visible).map(record => record.id);
  }));
  const icon = portable.visualEntries.find(entry => visibleIcons.includes(entry.id) && entry.kind === 'icon' && entry.visible && !entry.nativeIcon);
  assert.ok(icon); await choose(icon); const replacement = portable.iconOptions.find(item => item.id !== icon.icon);
  await page.locator('#icon-palette [data-icon-id="' + replacement.id + '"]').click();
  await poll(async () => await frame.locator('[data-copy-visual]').evaluateAll((elements, item) => elements.filter(element => JSON.parse(element.dataset.copyVisual ?? '[]').some(source => source.id === item.id)).some(element => element.querySelector('use')?.getAttribute('href') === '#' + item.icon), { id: icon.id, icon: replacement.id }), 'Icon replacement did not update actual standalone preview');
  checks.push('same icon palette changes actual portable preview icon');
  const deletion = portable.visualEntries.find(entry => entry.kind === 'text-element' && entry.deletable !== false && entry.visible);
  assert.ok(deletion); await choose(deletion); await page.locator('#visual-hide').click(); assert.ok((await page.locator('#visual-current').innerText()).includes('حذف'));
  checks.push('real source deletion proposal is carried as visual draft');
  const pending = page.waitForEvent('download'); await page.locator('#apply-changes').click(); const returnedFile = join(directory, 'changes.json'); await (await pending).saveAs(returnedFile);
  const returned = JSON.parse(await readFile(returnedFile, 'utf8')); assert.equal(returned.version, 2); assert.equal(returned.visualChanges.some(change => change.deleted === true), true);
  assert.equal(returned.changes.find(change => change.id === entry.id).text, 'English preview'); assert.equal(returned.visualChanges.find(change => change.id === icon.id).icon, replacement.id);
  await page.reload({ waitUntil: 'load' }); await ready(); assert.equal(await page.locator('#apply-count').innerText(), '۴'); checks.push('download keeps all drafts and reload restores them');
  await page.locator('#preview-route').selectOption('tasks'); await ready(); await frame.locator('.shop-tabs[aria-label="فیلتر کارها"]').waitFor();
  await frame.getByRole('button', { name: 'ثبت کار جدید', exact: true }).click();
  await frame.getByRole('textbox', { name: 'عنوان کار', exact: true }).fill('Standalone sample task');
  await frame.getByRole('button', { name: 'ثبت کار', exact: true }).evaluate(button => button.closest('form').requestSubmit());
  await frame.locator('.shop-body > b').filter({ hasText: 'Standalone sample task' }).waitFor(); checks.push('real route switching and form saves work offline with disposable fixtures');
  await page.screenshot({ path: join(directory, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: join(directory, 'mobile.png'), fullPage: true });
  const newContext = await browser.newContext({ offline: true, serviceWorkers: 'block' });
  const next = await newContext.newPage(); next.on('pageerror', error => errors.push(error.message)); await next.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await poll(async () => await next.locator('#catalog-count').innerText() !== '…', 'Fresh catalog not ready');
  await next.locator('#import-package').setInputFiles(returnedFile); await poll(async () => await next.locator('#apply-count').innerText() === '۴', 'Return file did not restore all text/icon/delete drafts');
  await newContext.close(); checks.push('return JSON resumes all edit types on a new browser');
  assert.deepEqual(requests, []); assert.deepEqual(errors, []); result = { success: true, checks, packagePath: file, requests, errors };
} catch (error) {
  await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => {});
  result = { success: false, checks, error: error.stack, errors, requests }; process.exitCode = 1;
} finally { await browser.close(); await writeFile(join(directory, 'report.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); }
