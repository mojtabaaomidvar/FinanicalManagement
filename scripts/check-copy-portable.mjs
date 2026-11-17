import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createWorkbench } from './copy-workbench/server.mjs';
import { collectCatalog } from './copy-workbench/catalog.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = await mkdtemp(join(tmpdir(), 'copy-portable-browser-'));
const directory = join(projectRoot, '.local-test/copy-workbench/portable-check');
const sourceFile = 'src/pages/HubPage/HubPage.tsx', sourcePath = join(fixtureRoot, sourceFile);
const injection = 'نمونه </script><script>window.__portableInjected = true</script> $&';
const changesText = 'English <script>$&';
const checks = [], errors = [], externalRequests = [];
let browser, workbench, page, offline, failure;
const poll = async (test, message, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await test()) return; await new Promise(done => setTimeout(done, 60)); }
  throw new Error(message);
};
async function check(name, callback) { await callback(); checks.push(name); }
const ready = async target => poll(async () => await target.locator('#preview-state').innerText() === 'آماده', 'Local preview did not become ready');
const selectLocal = async (id, text) => { await page.locator('#copy-search').fill(text); await page.locator('#catalog-list [data-copy-id="' + id + '"]').click(); };
const selectRemote = async id => { await offline.locator('#search').fill(''); await offline.locator('#entries [data-entry-id="' + id + '"]').click(); };
try {
  await mkdir(directory, { recursive: true }); await mkdir(dirname(sourcePath), { recursive: true });
  await mkdir(join(fixtureRoot, 'tools/copy-workbench'), { recursive: true });
  const font = 'node_modules/vazirmatn/fonts/webfonts/Vazirmatn[wght].woff2'; await mkdir(dirname(join(fixtureRoot, font)), { recursive: true });
  await copyFile(join(projectRoot, font), join(fixtureRoot, font));
  for (const file of ['index.html', 'app.js', 'style.css', 'preview-bridge.js', 'transfer.js', 'portable.html']) await copyFile(join(projectRoot, 'tools/copy-workbench', file), join(fixtureRoot, 'tools/copy-workbench', file));
  const source = `// DO_NOT_EXPORT_SOURCE_SECRET_2026\nconst privateCalculation = () => 729 * 815;\nexport function Screen({user}) { return <section><h1>{/* @copy-text fixture.heading */ "عنوان واگذاری"}</h1><p>{/* @copy-text fixture.helper.one */ "راهنمای تکراری"}</p><aside><p>{/* @copy-text fixture.helper.two */ "راهنمای تکراری"}</p></aside><p>{/* @copy-text fixture.greeting */ \`سلام \${user.name}\`}</p><small>{/* @copy-text fixture.payload */ ${JSON.stringify(injection)}}</small></section>; }\n`;
  await writeFile(sourcePath, source); const original = await readFile(sourcePath);
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  const screenshotPage = await browser.newPage({ viewport: { width: 390, height: 500 } });
  await screenshotPage.setContent('<html lang="fa" dir="rtl"><body style="margin:24px;font-family:Tahoma"><main></main></body></html>');
  await screenshotPage.evaluate(() => { for (const [tag, id, text] of [['h1', 'heading', 'عنوان واگذاری'], ['p', 'helper', 'راهنمای تکراری'], ['p', 'greeting', 'سلام نمونه']]) { const node = document.createElement(tag); node.id = id; node.textContent = text; document.querySelector('main').append(node); } });
  const image = await screenshotPage.screenshot(), rectangles = await screenshotPage.evaluate(() => Object.fromEntries(['heading', 'helper', 'greeting'].map(id => { const rect = document.getElementById(id).getBoundingClientRect(); return [id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }]; })));
  await screenshotPage.close();
  workbench = await createWorkbench({ root: fixtureRoot, port: 0, captureScreenshots: async ({ catalog }) => [{ id: 'home-sample', label: 'خانهٔ نمونه', section: 'خانه', dataUrl: 'data:image/png;base64,' + image.toString('base64'), regions: [['heading', 'fixture.heading'], ['helper', 'fixture.helper.one'], ['greeting', 'fixture.greeting']].map(([key, sourceId]) => ({ sourceIds: [catalog.entries.find(entry => entry.id === sourceId).id], rect: rectangles[key] })) }], build: async target => {
    const catalog = await collectCatalog(fixtureRoot), labels = catalog.entries.filter(entry => entry.file === sourceFile).map(entry => ({ id: entry.id, text: entry.text }));
    await mkdir(join(target, 'assets'), { recursive: true });
    await writeFile(join(target, 'index.html'), '<html><title>محیط تست محلی</title><script type="module" src="/assets/app.js"></script><body><main></main></body></html>');
    await writeFile(join(target, 'assets/app.js'), `const labels=${JSON.stringify(labels)};for(const item of labels){const node=document.createElement('p');node.textContent=item.text;node.setAttribute('data-copy-sources',JSON.stringify([{id:item.id,text:item.text}]));document.querySelector('main').append(node)};parent.postMessage({type:'copy-preview-ready',session:new URLSearchParams(location.search).get('session')},location.origin);`);
  } }); await workbench.initialized; assert.equal(workbench.status().ready, true);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(workbench.origin, { waitUntil: 'networkidle' }); await ready(page);
  let bundle, returned, publicHeading, publicHelper, publicGreeting;
  const packagePath = join(directory, 'exported-editor.html'), returnedPath = join(directory, 'returned-changes.json');
  await check('HTML export contains only display texts, opaque IDs, raster screenshots and an embedded font', async () => {
    const downloadEvent = page.waitForEvent('download'); await page.locator('#export-package').click(); await (await downloadEvent).saveAs(packagePath);
    const html = await readFile(packagePath, 'utf8'); bundle = JSON.parse(html.match(/<script id="copy-package" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(bundle.format, 'khaneyar-copy-package'); assert.equal(bundle.version, 1); assert.equal(bundle.images.length, 1);
    assert.ok(bundle.fontDataUrl.startsWith('data:font/woff2;base64,'));
    const allowed = new Set(['id', 'text', 'section', 'kind', 'label', 'tokens', 'imageIds']);
    for (const entry of bundle.entries) { assert.match(entry.id, /^[a-f0-9]{32}$/); assert.ok(Object.keys(entry).every(key => allowed.has(key))); }
    for (const sourceId of ['fixture.heading', 'fixture.helper.one', 'fixture.helper.two', 'fixture.greeting', 'fixture.payload']) assert.ok(!html.includes(sourceId));
    for (const secret of [sourceFile, 'privateCalculation', 'DO_NOT_EXPORT_SOURCE_SECRET_2026', 'user.name', 'csrfToken', 'sourceStart', 'nodeStart']) assert.ok(!html.includes(secret), secret + ' leaked into exported HTML');
    assert.ok(!/<script\b[^>]*src=/i.test(html)); assert.ok(!/\bfetch\s*\(/.test(html)); assert.ok(html.includes("connect-src 'none'"));
    assert.equal(bundle.entries.find(entry => entry.text === injection).text, injection);
    publicHeading = bundle.entries.find(entry => entry.text === 'عنوان واگذاری').id;
    publicHelper = bundle.entries.find(entry => entry.text === 'راهنمای تکراری').id;
    publicGreeting = bundle.entries.find(entry => entry.tokens.length).id;
    assert.equal(bundle.entries.filter(entry => entry.text === 'راهنمای تکراری').length, 2);
    assert.deepEqual(await readFile(sourcePath), original);
  });
  const remoteContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, offline: true, serviceWorkers: 'block', acceptDownloads: true });
  remoteContext.on('request', request => { if (/^https?:/i.test(request.url())) externalRequests.push(request.url()); });
  await remoteContext.route(/^https?:\/\//, route => route.abort());
  offline = await remoteContext.newPage(); offline.on('pageerror', error => errors.push(error.message)); await offline.goto(pathToFileURL(packagePath).href, { waitUntil: 'load' });
  await check('standalone file works offline and screenshot selection uses the exact opaque text ID', async () => {
    await offline.locator('#regions [data-entry-id="' + publicHeading + '"]').click();
    assert.equal(await offline.locator('#entries [aria-current="true"]').getAttribute('data-entry-id'), publicHeading);
    assert.equal(await offline.locator('#text').inputValue(), 'عنوان واگذاری'); assert.equal(await offline.evaluate(() => window.__portableInjected), undefined);
    assert.deepEqual(externalRequests, []);
  });
  await check('English, empty and template edits preserve separate occurrences and protected placeholders', async () => {
    await offline.locator('#text').fill(changesText); assert.equal(await offline.locator('#picture-text').innerText(), changesText);
    await selectRemote(publicHelper); await offline.locator('#text').fill('');
    assert.equal(await offline.locator('#draft-count').innerText(), '۲');
    await selectRemote(publicGreeting); await offline.locator('#text').fill('Welcome');
    assert.equal(await offline.locator('#download-changes').isEnabled(), false); assert.equal(await offline.locator('#validation').isVisible(), true);
    await offline.locator('#text').fill('Welcome {slot1}'); assert.equal(await offline.locator('#download-changes').isEnabled(), true);
    const untouched = bundle.entries.filter(entry => entry.text === 'راهنمای تکراری').find(entry => entry.id !== publicHelper);
    assert.equal(await offline.locator('#entries [data-entry-id="' + untouched.id + '"] .entry-text').innerText(), 'راهنمای تکراری');
    assert.equal(await offline.locator('#draft-count').innerText(), '۳');
    await offline.screenshot({ path: join(directory, 'desktop.png'), fullPage: true });
    await offline.setViewportSize({ width: 390, height: 844 });
    assert.ok(await offline.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await offline.screenshot({ path: join(directory, 'mobile.png'), fullPage: true });
  });
  await check('offline drafts survive reload and download a strict data-only return file', async () => {
    await offline.reload({ waitUntil: 'load' }); assert.equal(await offline.locator('#draft-count').innerText(), '۳');
    await selectRemote(publicHeading); assert.equal(await offline.locator('#text').inputValue(), changesText);
    const downloadEvent = offline.waitForEvent('download'); await offline.locator('#download-changes').click(); await (await downloadEvent).saveAs(returnedPath);
    returned = JSON.parse(await readFile(returnedPath, 'utf8')); assert.deepEqual(Object.keys(returned).sort(), ['changes', 'format', 'packageId', 'version']);
    assert.equal(returned.format, 'khaneyar-copy-edits'); assert.equal(returned.packageId, bundle.packageId); assert.equal(returned.changes.length, 3);
    for (const change of returned.changes) { assert.deepEqual(Object.keys(change).sort(), ['id', 'text']); assert.match(change.id, /^[a-f0-9]{32}$/); }
    assert.equal(returned.changes.find(change => change.id === publicHeading).text, changesText);
    assert.equal(returned.changes.find(change => change.id === publicHelper).text, '');
    assert.deepEqual(externalRequests, []);
  });
  await check('a new offline browser can resume from the returned file', async () => {
    const fresh = await browser.newContext({ offline: true, serviceWorkers: 'block' }), next = await fresh.newPage(); next.on('pageerror', error => errors.push(error.message));
    fresh.on('request', request => { if (/^https?:/i.test(request.url())) externalRequests.push(request.url()); });
    await next.goto(pathToFileURL(packagePath).href, { waitUntil: 'load' }); assert.equal(await next.locator('#draft-count').innerText(), '۰');
    await next.locator('#load-changes').setInputFiles(returnedPath); await poll(async () => await next.locator('#draft-count').innerText() === '۳', 'Offline return-file resume failed');
    await fresh.close();
  });
  await check('local review and staging preserve existing drafts and do not write application source', async () => {
    await selectLocal('fixture.heading', 'عنوان واگذاری'); await page.locator('#copy-edit').fill('پیش‌نویس محلی حفظ شود');
    await page.locator('#import-package').setInputFiles(returnedPath);
    await poll(async () => await page.locator('#transfer-changes .transfer-change').count() === 3, 'Returned changes did not appear for review');
    assert.deepEqual(await readFile(sourcePath), original);
    await page.locator('#stage-package').click();
    await poll(async () => (await page.locator('#transfer-status').innerText()).includes('۱ مورد با متن یا پیش‌نویس'), 'Conflicting local draft was not protected');
    await selectLocal('fixture.heading', 'عنوان واگذاری'); assert.equal(await page.locator('#copy-edit').inputValue(), 'پیش‌نویس محلی حفظ شود');
    assert.equal(await page.locator('#apply-count').innerText(), '۳'); assert.deepEqual(await readFile(sourcePath), original);
    await page.screenshot({ path: join(directory, 'local-review.png'), fullPage: true }); await page.locator('#reset-all').click();
  });
  await check('reviewed returned texts Apply safely and another Apply remains usable', async () => {
    await page.locator('#import-package').setInputFiles(returnedPath);
    await poll(async () => (await page.locator('#transfer-status').innerText()).includes('۳ نوشتهٔ آمادهٔ ورود'), 'Second return-file review failed');
    await page.locator('#stage-package').click(); await poll(async () => await page.locator('#apply-count').innerText() === '۳', 'Returned changes did not stage');
    assert.deepEqual(await readFile(sourcePath), original);
    await page.locator('#apply-changes').click();
    await poll(async () => (await readFile(sourcePath, 'utf8')).includes('Welcome '), 'Reviewed changes were not applied');
    await poll(async () => await page.locator('#copy-edit').isEnabled(), 'Apply did not unlock local editor');
    const after = await collectCatalog(fixtureRoot); assert.equal(after.entries.find(entry => entry.id === 'fixture.heading').text, changesText); assert.equal(after.entries.find(entry => entry.id === 'fixture.helper.one').text, '');
    assert.equal(after.entries.find(entry => entry.id === 'fixture.helper.two').text, 'راهنمای تکراری'); assert.equal(after.entries.find(entry => entry.id === 'fixture.greeting').text, 'Welcome {slot1}');
    assert.match(await readFile(sourcePath, 'utf8'), /user\.name/);
    await selectLocal('fixture.heading', changesText); await page.locator('#copy-edit').fill('Second imported title');
    assert.equal(await page.locator('#apply-changes').isEnabled(), true); await page.locator('#apply-changes').click();
    await poll(async () => (await readFile(sourcePath, 'utf8')).includes('Second imported title'), 'Successive Apply was blocked');
    await poll(async () => await page.locator('#copy-edit').isEnabled(), 'Successive Apply did not unlock local editor');
  });
  await check('changed local source becomes a review conflict and forged fields or placeholders are rejected', async () => {
    const before = await readFile(sourcePath); await page.locator('#import-package').setInputFiles(returnedPath);
    await poll(async () => (await page.locator('#transfer-status').innerText()).includes('۱ مورد نیازمند بررسی'), 'Changed source was not flagged as a review conflict');
    assert.equal(await page.locator('#transfer-changes input:disabled').count(), 1); assert.deepEqual(await readFile(sourcePath), before);
    const config = await page.evaluate(() => window.__COPY_WORKBENCH__), headers = { Origin: workbench.origin, 'X-Copy-Workbench-Token': config.csrfToken };
    const extra = await context.request.post(workbench.origin + '/__copy/package/import', { headers, data: { ...returned, source: 'forged.tsx' } }); assert.equal(extra.status(), 400);
    const invalid = { ...returned, changes: [{ id: publicGreeting, text: 'Missing placeholder' }] };
    const tokenResponse = await context.request.post(workbench.origin + '/__copy/package/import', { headers, data: invalid }); assert.equal(tokenResponse.status(), 400); assert.equal((await tokenResponse.json()).error, 'TEMPLATE_TOKENS');
    assert.deepEqual(await readFile(sourcePath), before); assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  });
} catch (error) { failure = error.stack ?? String(error); }
finally {
  await browser?.close(); await workbench?.close();
  assert.equal(dirname(resolve(fixtureRoot)), resolve(tmpdir())); assert.ok(fixtureRoot.split(/[\\/]/).at(-1).startsWith('copy-portable-browser-'));
  await rm(fixtureRoot, { recursive: true, force: true }); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'results.json'), JSON.stringify({ passed: !failure, checks, errors, externalRequests, mainSourceWrites: 0, failure }, null, 2));
}
console.log(JSON.stringify({ passed: !failure, checks, errors, externalRequests, mainSourceWrites: 0, failure }, null, 2));
if (failure) process.exitCode = 1;
