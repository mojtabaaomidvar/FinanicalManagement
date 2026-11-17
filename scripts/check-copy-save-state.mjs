import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createWorkbench } from './copy-workbench/server.mjs';
import { collectCatalog } from './copy-workbench/catalog.mjs';
import { collectVisualCatalog } from './copy-workbench/visual-catalog.mjs';
import { createPortablePackage } from './copy-workbench/portable-package.mjs';

// All real source writes in this UI integration probe are confined to a new temporary fixture.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = await mkdtemp(join(tmpdir(), 'copy-save-ui-'));
const outputDirectory = join(projectRoot, '.local-test/copy-workbench/save-state-check');
const checks = [], errors = [], applyResponses = [];
let workbench, browser, page, failure, releaseCatalog;
let failureState;
async function poll(test, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await test()) return; await new Promise(done => setTimeout(done, 50)); }
  throw new Error(message);
}
async function select(id, text) { await page.locator('#copy-search').fill(text); await page.locator('[data-copy-id="' + id + '"]').click(); }
async function previewMessage(data) {
  const frame = page.frames().find(value => value.url().includes('/preview/'));
  assert.ok(frame); await frame.evaluate(message => window.parent.postMessage({ ...message, session: new URLSearchParams(location.search).get('session') }, location.origin), data);
}
async function ready() { await poll(async () => await page.locator('#preview-state').innerText() === 'آماده', 'Preview did not report readiness'); }
async function check(name, callback) { await callback(); checks.push(name); }

try {
  await mkdir(join(fixtureRoot, 'src'), { recursive: true });
  await mkdir(join(fixtureRoot, 'tools/copy-workbench'), { recursive: true });
  const fontDirectory = join(fixtureRoot, 'node_modules/vazirmatn/fonts/webfonts'); await mkdir(fontDirectory, { recursive: true });
  await copyFile(join(projectRoot, 'node_modules/vazirmatn/fonts/webfonts/Vazirmatn[wght].woff2'), join(fontDirectory, 'Vazirmatn[wght].woff2'));
  for (const file of ['index.html', 'style.css', 'app.js', 'preview-bridge.js', 'transfer.js', 'portable.html']) await copyFile(join(projectRoot, 'tools/copy-workbench', file), join(fixtureRoot, 'tools/copy-workbench', file));
  const sourcePath = join(fixtureRoot, 'src/sample.ts');
  await writeFile(sourcePath, 'export const title = "عنوان نمونه";\nexport const duplicateTitle = "عنوان نمونه";\nexport const hint = "راهنمای نمونه";\n');
  const iconSourcePath = join(fixtureRoot, 'src/icons.tsx');
  await writeFile(iconSourcePath, 'export const view = <span className="glyph"><Icon name="i-home"/></span>;\n');
  const templateSourcePath = join(fixtureRoot, 'src/template.ts');
  await writeFile(templateSourcePath, 'export const message = `سلام ${name}`;\n');
  const deletableSourcePath = join(fixtureRoot, 'src/portable.tsx');
  await writeFile(deletableSourcePath, 'export const view = <main><p>راهنمای قابل حذف</p></main>;\n');
  await writeFile(join(fixtureRoot, 'index.html'), '<svg><symbol id="i-home"><path d="M1 1"/></symbol><symbol id="i-cart"><path d="M2 2"/></symbol></svg>');
  workbench = await createWorkbench({ root: fixtureRoot, port: 0, build: async target => {
    const catalog = await collectCatalog(fixtureRoot), labels = catalog.entries.filter(value => value.file === 'src/sample.ts').map(value => value.text);
    await mkdir(join(target, 'assets'), { recursive: true });
    await writeFile(join(target, 'index.html'), '<html><title>محیط تست محلی</title><script type="module" src="/assets/app.js"></script><body><main></main></body></html>');
    await writeFile(join(target, 'assets/app.js'), `const labels=${JSON.stringify(labels)};const main=document.querySelector('main');labels.forEach((text,index)=>{const node=document.createElement(index?'h2':'h1');node.textContent=text;main.append(node)});window.__stubReady=()=>parent.postMessage({type:'copy-preview-ready',session:new URLSearchParams(location.search).get('session')},location.origin);if(!parent.__HOLD_PREVIEW_READY__)setTimeout(window.__stubReady,50);`);
  } }); await workbench.initialized;
  const base = workbench.origin, initial = await (await fetch(base + '/__copy/catalog')).json();
  const titles = initial.entries.filter(value => value.text === 'عنوان نمونه'); assert.equal(titles.length, 2);
  const hint = initial.entries.find(value => value.text === 'راهنمای نمونه'); assert.ok(hint);
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => {
    if (new URL(response.url()).pathname !== '/__copy/apply') return;
    try { applyResponses.push({ status: response.status(), request: response.request().postDataJSON(), result: await response.json() }); }
    catch { /* A network failure is described by the owner UI diagnostics. */ }
  });
  let failCatalog = false, failPreview = false, busyApply = false, heldCatalog = null;
  await page.route(base + '/__copy/catalog', async route => { if (heldCatalog) { const gate = heldCatalog, response = await route.fetch(); await gate; await route.fulfill({ response }); return; } if (failCatalog) { failCatalog = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'خطای دریافت فهرست نمونه' }) }); } else await route.continue(); });
  await page.route(base + '/__copy/preview', async route => { if (failPreview) { failPreview = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'خطای بازکردن پیش‌نمایش نمونه' }) }); } else await route.continue(); });
  await page.route(base + '/__copy/apply', async route => { if (busyApply) { busyApply = false; await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'BUSY', message: 'عملیات قبلی هنوز تمام نشده است.' }) }); } else await route.continue(); });
  await page.goto(base, { waitUntil: 'networkidle' }); await ready();

  await check('draft projection help is independent of source save and preview readiness', async () => {
    const saved = await page.locator('#save-status').innerText();
    await previewMessage({ type: 'copy-preview-draft-status', message: 'محل نمایش برخی پیش‌نویس‌ها دقیقاً مشخص نیست؛ نتیجهٔ آن‌ها پس از اعمال در کد دیده می‌شود.', entryIds: [titles[0].id] });
    await poll(async () => await page.locator('#preview-draft-status').isVisible(), 'Draft projection help was not shown');
    assert.equal(await page.locator('#preview-state').innerText(), 'آماده'); assert.equal(await page.locator('#save-status').innerText(), saved);
    await previewMessage({ type: 'copy-preview-draft-status', message: '', entryIds: [] });
    await poll(async () => !(await page.locator('#preview-draft-status').isVisible()), 'Resolved draft projection help was not cleared');
  });

  await check('ambiguous identical copy requires an explicit occurrence choice', async () => {
    await previewMessage({ type: 'copy-pick', text: 'عنوان نمونه', entryIds: [] });
    await poll(async () => await page.locator('#catalog-list [data-copy-id]').count() === 2, 'Ambiguous locations were not listed');
    assert.equal(await page.locator('#editor-content').isVisible(), false);
    assert.equal(await page.locator('#catalog-list [aria-current="true"]').count(), 0);
    assert.ok((await page.locator('#notice').innerText()).includes('۲ محل'));
    assert.equal(await page.locator('.copy-item-source').count(), 2);
  });
  await check('an exact source ID selects the clicked occurrence', async () => {
    await previewMessage({ type: 'copy-pick', text: 'عنوان نمونه', entryIds: [titles[1].id], source: { file: titles[1].file, line: titles[1].line, context: titles[1].context } });
    await poll(async () => await page.locator('[data-copy-id="' + titles[1].id + '"]').getAttribute('aria-current') === 'true', 'Exact source ID did not select its occurrence');
    assert.equal(await page.locator('#editor-content').isVisible(), true);
  });
  await check('BUSY keeps drafts and is never mislabeled as a source conflict', async () => {
    await page.locator('#clear-pick').click(); await select(hint.id, hint.text); await page.locator('#copy-edit').fill('راهنمای تازه');
    const before = await readFile(sourcePath, 'utf8'); busyApply = true; await page.locator('#apply-changes').click();
    await poll(async () => (await page.locator('#notice').innerText()).includes('عملیات قبلی'), 'Busy state was not identified');
    assert.ok(!(await page.locator('#notice').innerText()).includes('کد پروژه از زمان'));
    assert.equal(await page.locator('#copy-edit').inputValue(), 'راهنمای تازه'); assert.equal(await readFile(sourcePath, 'utf8'), before);
    await page.locator('#reset-all').click();
  });
  await check('all drafts and their use locations are visible before a real save', async () => {
    await select(titles[0].id, 'عنوان نمونه'); await page.locator('#copy-edit').fill('عنوان تازه');
    await select(hint.id, 'راهنمای نمونه'); await page.locator('#copy-edit').fill('راهنمای تازه');
    assert.equal(await page.locator('#draft-summary-count').innerText(), '۲');
    await page.locator('#draft-summary').evaluate(node => { node.open = true; });
    assert.equal(await page.locator('#draft-summary-list .saved-change').count(), 2);
    assert.ok((await page.locator('#draft-summary-list').innerText()).includes('src/sample.ts'));
  });
  await check('real source save stays successful when catalogue refresh fails and readiness is pending', async () => {
    await page.evaluate(() => { window.__HOLD_PREVIEW_READY__ = true; }); failCatalog = true;
    await page.locator('#apply-changes').click();
    await poll(async () => (await page.locator('#save-status').innerText()).includes('۲ نوشته در فایل‌های پروژه ذخیره شد'), 'Saved source fact was lost');
    await poll(async () => (await page.locator('#notice').innerText()).includes('دریافت فهرست جدید کامل نشد'), 'Catalogue refresh failure was hidden');
    assert.match(await readFile(sourcePath, 'utf8'), /عنوان تازه/); assert.match(await readFile(sourcePath, 'utf8'), /راهنمای تازه/);
    assert.notEqual(await page.locator('#preview-state').innerText(), 'آماده');
    assert.ok(!(await page.locator('#notice').innerText()).includes('پیش‌نمایش جدید آماده است'));
    await previewMessage({ type: 'copy-preview-ready' }); await ready();
    assert.ok((await page.locator('#notice').innerText()).includes('دریافت فهرست جدید کامل نشد'));
  });
  await check('real source save stays successful when opening the new preview fails', async () => {
    await page.locator('#reload-catalog').click();
    await poll(async () => !(await page.locator('#apply-changes').isEnabled()), 'Reload did not settle');
    await select(titles[0].id, 'عنوان تازه'); await page.locator('#copy-edit').fill('عنوان نهایی'); failPreview = true;
    await page.locator('#apply-changes').click();
    await poll(async () => (await page.locator('#notice').innerText()).includes('بازکردن پیش‌نمایش کامل نشد'), 'Preview failure was overwritten');
    assert.ok((await page.locator('#save-status').innerText()).includes('در فایل‌های پروژه ذخیره شد'));
    assert.equal(await page.locator('#preview-state').innerText(), 'پیش‌نمایش آماده نشد'); assert.match(await readFile(sourcePath, 'utf8'), /عنوان نهایی/);
  });
  await check('saved batch history and Undo are recovered in a new browser context', async () => {
    const fresh = await browser.newContext({ serviceWorkers: 'block' }), next = await fresh.newPage(); next.on('pageerror', error => errors.push(error.message));
    await next.goto(base, { waitUntil: 'networkidle' });
    await poll(async () => (await next.locator('#save-status').innerText()).includes('آخرین اعمال: ۱ نوشته'), 'Server history did not restore save state');
    assert.equal(await next.locator('#undo-batch').isEnabled(), true);
    await next.locator('#saved-history').evaluate(node => { node.open = true; });
    assert.equal(await next.locator('.saved-batch').count(), 2); assert.ok((await next.locator('#saved-batches').innerText()).includes('src/sample.ts'));
    await fresh.close();
  });
  await check('a saved Apply unlocks editing while read-only catalogue refresh is delayed and preserves the next draft', async () => {
    await select(titles[0].id, 'عنوان نهایی'); await page.locator('#copy-edit').fill('عنوان نوبت سوم');
    heldCatalog = new Promise(done => { releaseCatalog = done; });
    await page.locator('#apply-changes').click();
    await poll(async () => (await readFile(sourcePath, 'utf8')).includes('عنوان نوبت سوم'), 'Third source save did not finish');
    await poll(async () => await page.locator('#copy-edit').isEnabled(), 'Saved Apply left editing locked behind a read-only refresh', 1200);
    assert.equal(await page.locator('#apply-changes').getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('#apply-changes').isEnabled(), false);
    await page.locator('#copy-edit').fill('عنوان نوبت چهارم');
    assert.equal(await page.locator('#apply-changes').isEnabled(), true);
    heldCatalog = null; releaseCatalog(); releaseCatalog = null;
    await poll(async () => await page.locator('#catalog-list').getAttribute('aria-busy') === 'false', 'Delayed catalogue refresh did not finish');
    assert.equal(await page.locator('#copy-edit').inputValue(), 'عنوان نوبت چهارم');
    assert.equal(await page.locator('#apply-changes').isEnabled(), true);
    await page.locator('#apply-changes').click();
    await poll(async () => (await readFile(sourcePath, 'utf8')).includes('عنوان نوبت چهارم'), 'Fourth source save did not finish');
    await poll(async () => await page.locator('#copy-edit').isEnabled(), 'Fourth Apply left editing disabled');
  });
  await check('successive icon Applies restore palette controls and create fresh visual drafts', async () => {
    const catalog = await (await fetch(base + '/__copy/catalog')).json();
    const icon = catalog.visualEntries.find(entry => entry.file === 'src/icons.tsx'); assert.ok(icon);
    await select(icon.id, 'i-home');
    await page.locator('#icon-palette [data-icon-id="i-cart"]').click();
    await page.locator('#apply-changes').click();
    await poll(async () => (await readFile(iconSourcePath, 'utf8')).includes('name="i-cart"'), 'First icon save did not finish');
    await poll(async () => await page.locator('#icon-palette [data-icon-id="i-home"]').isEnabled(), 'First icon save left palette disabled');
    await page.locator('#icon-palette [data-icon-id="i-home"]').click();
    assert.equal(await page.locator('#apply-changes').isEnabled(), true);
    await page.locator('#apply-changes').click();
    await poll(async () => (await readFile(iconSourcePath, 'utf8')).includes('name="i-home"'), 'Second icon save did not finish');
    await poll(async () => await page.locator('#icon-palette [data-icon-id="i-cart"]').isEnabled(), 'Second icon save left palette disabled');
    assert.equal(await page.locator('#apply-changes').getAttribute('aria-busy'), 'false');
  });
  await check('a second Apply uses the acknowledged revision while an older catalogue response is still pending', async () => {
    await select(titles[0].id, 'عنوان نوبت چهارم'); await page.locator('#copy-edit').fill('ذخیرهٔ سریع اول');
    heldCatalog = new Promise(done => { releaseCatalog = done; });
    await page.locator('#apply-changes').click();
    await poll(async () => (await readFile(sourcePath, 'utf8')).includes('ذخیرهٔ سریع اول'), 'First rapid save did not finish');
    await poll(async () => await page.locator('#copy-edit').isEnabled(), 'First rapid save did not unlock editing');
    await page.locator('#copy-edit').fill('ذخیرهٔ سریع دوم'); await page.locator('#apply-changes').click();
    await poll(async () => (await readFile(sourcePath, 'utf8')).includes('ذخیرهٔ سریع دوم'), 'Second rapid save used a stale source revision');
    await poll(async () => await page.locator('#copy-edit').isEnabled(), 'Second rapid save did not unlock editing');
    heldCatalog = null; releaseCatalog(); releaseCatalog = null;
    await poll(async () => await page.locator('#catalog-list').getAttribute('aria-busy') === 'false', 'Rapid-save catalogue refresh did not finish');
    assert.equal(await page.locator('#copy-edit').inputValue(), 'ذخیرهٔ سریع دوم');
    assert.equal(await page.locator('#apply-count').innerText(), '۰');
    await page.locator('#copy-edit').fill('پیش‌نویس پس از ذخیرهٔ سریع');
    assert.equal(await page.locator('#apply-changes').isEnabled(), true);
    await page.locator('#reset-all').click();
  });
  await check('an invalid template draft does not lock valid edits and remains recoverable after their save', async () => {
    const catalog = await (await fetch(base + '/__copy/catalog')).json();
    const template = catalog.entries.find(value => value.file === 'src/template.ts' && value.tokens?.length);
    assert.ok(template);
    const before = await readFile(templateSourcePath, 'utf8');
    await select(template.id, template.text); await page.locator('#copy-edit').fill('متن بدون مقدار متغیر');
    assert.equal(await page.locator('#apply-changes').isEnabled(), false);
    assert.equal(await page.locator('#apply-help').isVisible(), true);
    assert.ok((await page.locator('#apply-help').innerText()).includes('۱ پیش‌نویس دارای خطا'));
    await select(titles[0].id, 'ذخیرهٔ سریع دوم'); await page.locator('#copy-edit').fill('ذخیره با پیش‌نویس نامعتبر');
    assert.equal(await page.locator('#apply-changes').isEnabled(), true, 'An unrelated invalid draft locked a valid source edit');
    assert.equal(await page.locator('#apply-count').innerText(), '۱');
    assert.ok((await page.locator('#apply-help').innerText()).includes('۱ ویرایش معتبر'));
    await page.locator('#apply-changes').click();
    await poll(async () => (await readFile(sourcePath, 'utf8')).includes('ذخیره با پیش‌نویس نامعتبر'), 'The valid edit was not saved');
    await poll(async () => await page.locator('#copy-edit').isEnabled(), 'The valid save left editing locked');
    assert.equal(await readFile(templateSourcePath, 'utf8'), before, 'An invalid template was applied to source');
    await page.reload({ waitUntil: 'networkidle' }); await ready();
    await select(template.id, 'متن بدون مقدار متغیر');
    assert.equal(await page.locator('#copy-edit').inputValue(), 'متن بدون مقدار متغیر');
    assert.equal(await page.locator('#copy-edit').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#apply-changes').isEnabled(), false);
    await page.locator('#copy-edit').fill('Hello ' + template.tokens.map(value => typeof value === 'string' ? value : value.token).join(' '));
    assert.equal(await page.locator('#apply-changes').isEnabled(), true);
    await page.locator('#reset-all').click();
  });
  await check('returned v2 text, icon and deletion edits are reviewed, staged, saved and undone through the owner UI', async () => {
    const textCatalog = await collectCatalog(fixtureRoot), visualCatalog = await collectVisualCatalog(fixtureRoot, textCatalog);
    const bundle = await createPortablePackage(fixtureRoot, textCatalog, { interactive: true, visualCatalog });
    const title = textCatalog.entries.find(value => value.id === titles[0].id);
    const publicTitle = bundle.entries.find(value => value.text === title.text);
    const sourceIcon = visualCatalog.entries.find(value => value.file === 'src/icons.tsx' && value.kind === 'icon');
    const sourceDeletion = visualCatalog.entries.find(value => value.file === 'src/portable.tsx' && value.kind === 'text-element');
    const manifest = JSON.parse(await readFile(join(fixtureRoot, '.local-test/copy-workbench/portable-packages', bundle.packageId + '.json'), 'utf8'));
    const publicIcon = manifest.visualEntries.find(value => value.sourceId === sourceIcon.id);
    const publicDeletion = manifest.visualEntries.find(value => value.sourceId === sourceDeletion.id);
    assert.ok(publicTitle && publicIcon && publicDeletion);
    const originals = new Map(await Promise.all([sourcePath, iconSourcePath, deletableSourcePath].map(async file => [file, await readFile(file)])));
    const returned = { format: 'khaneyar-copy-edits', version: 2, packageId: bundle.packageId,
      changes: [{ id: publicTitle.id, text: 'Reviewed portable title' }],
      visualChanges: [{ id: publicIcon.id, visible: sourceIcon.visible, icon: 'i-cart' }, { id: publicDeletion.id, visible: sourceDeletion.visible, deleted: true }] };
    await page.locator('#import-package').setInputFiles({ name: 'reviewed-edits.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(returned)) });
    await poll(async () => await page.locator('#transfer-review').isVisible(), 'Returned v2 edits were not presented for review');
    assert.equal(await page.locator('#transfer-count').innerText(), '۳');
    assert.ok((await page.locator('#transfer-changes').innerText()).includes('حذف عنصر از کد'));
    assert.equal(await page.locator('#transfer-changes input:checked').count(), 3);
    for (const [file, bytes] of originals) assert.deepEqual(await readFile(file), bytes, 'Import changed source before owner staging');
    await page.locator('#stage-package').click();
    await poll(async () => await page.locator('#apply-changes').isEnabled() && await page.locator('#apply-count').innerText() === '۳', 'Returned visual edits did not reach owner drafts');
    for (const [file, bytes] of originals) assert.deepEqual(await readFile(file), bytes, 'Staging wrote source before owner Apply');
    await page.locator('#apply-changes').click();
    await poll(async () => (await readFile(sourcePath, 'utf8')).includes('Reviewed portable title'), 'Owner Apply did not save returned text');
    await poll(async () => await page.locator('#copy-edit').isEnabled(), 'Owner v2 Apply did not settle');
    assert.match(await readFile(iconSourcePath, 'utf8'), /name="i-cart"/);
    const deleted = await readFile(deletableSourcePath, 'utf8');
    assert.ok(!deleted.includes('راهنمای قابل حذف') && !deleted.includes('<p>'), 'Source node was hidden instead of deleted');
    assert.ok(!deleted.includes('false &&'), 'Deletion left a hidden JSX wrapper');
    const fresh = await (await fetch(base + '/__copy/catalog')).json();
    assert.ok(!fresh.visualEntries.some(value => value.id === sourceDeletion.id));
    assert.ok(!fresh.entries.some(value => value.text === 'راهنمای قابل حذف'));
    assert.equal(await page.locator('#undo-batch').isEnabled(), true);
    await page.locator('#undo-batch').click();
    await poll(async () => (await page.locator('#save-status').innerText()).includes('بازگردانده شد'), 'Owner Undo did not complete');
    await poll(async () => await page.locator('#copy-edit').isEnabled(), 'Owner Undo did not unlock editing');
    for (const [file, bytes] of originals) assert.deepEqual(await readFile(file), bytes, 'Undo failed to restore exact original bytes');
  });
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error.stack ?? String(error);
  if (page && !page.isClosed()) failureState = await page.evaluate(() => ({
    notice: document.querySelector('#notice')?.textContent, save: document.querySelector('#save-status')?.textContent,
    apply: { enabled: !document.querySelector('#apply-changes')?.disabled, reason: document.querySelector('#apply-changes')?.title },
    stored: localStorage.getItem('khaneyar:copy-workbench:drafts:v1'), editor: document.querySelector('#copy-edit')?.value,
  }));
  if (workbench) failureState = { ...failureState, server: workbench.status(), applyResponses };
}
finally {
  releaseCatalog?.();
  await browser?.close(); await workbench?.close();
  assert.equal(dirname(resolve(fixtureRoot)), resolve(tmpdir())); assert.ok(fixtureRoot.split(/[\\/]/).at(-1).startsWith('copy-save-ui-'));
  await rm(fixtureRoot, { recursive: true, force: true }); await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, 'results.json'), JSON.stringify({ passed: !failure, checks, errors, mainSourceWrites: 0, failure, failureState }, null, 2));
}
console.log(JSON.stringify({ passed: !failure, checks, errors, mainSourceWrites: 0, failure, failureState }, null, 2));
if (failure) process.exitCode = 1;
