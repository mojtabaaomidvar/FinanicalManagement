import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = 'http://127.0.0.1:5700';
const suffix = 'documents-e2e-' + Date.now();
const tokens = [];
const originalPrefs = new Map();
const contexts = [];
let browser, context, page, creator, other, owner, admin, releaseDelayed, releaseList;

async function api(path, token, method = 'GET', payload, expected = [200, 201, 204]) {
  const response = await fetch(base + '/api/v1' + path, {
    method,
    headers: { Accept: 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
  assert.ok(expected.includes(response.status), method + ' ' + path + ': ' + response.status);
  return response.status === 204 ? null : response.json();
}

async function loginApi(phone) {
  const result = await api('/auth/login', null, 'POST', { phone, password: 'Test12345!' });
  tokens.push(result.session_token);
  return { token: result.session_token, id: result.member.id };
}

async function enableNotifications(account) {
  const prefs = await api('/notifications/prefs', account.token);
  originalPrefs.set(account, { enabled: prefs.enabled,
    domains: { documents: prefs.domains?.documents !== false },
    lead_days: { documents: prefs.lead_days?.documents ?? 30 } });
  await api('/notifications/prefs', account.token, 'PATCH', {
    enabled: true, domains: { documents: true }, lead_days: { documents: 30 },
  });
}

async function poll(check, message, timeout = 25000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { if (await check()) return; }
    catch (error) {
      if (!/Execution context was destroyed|Cannot find context with specified id|frame was detached/.test(error.message)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  throw new Error(message);
}

async function loginUi(target, phone) {
  await target.goto(base, { waitUntil: 'networkidle' });
  if (!(await target.getByPlaceholder('شماره موبایل', { exact: true }).count())) {
    await target.getByRole('button', { name: 'ورود', exact: true }).click();
  }
  await target.getByPlaceholder('شماره موبایل', { exact: true }).first().fill(phone);
  await target.getByPlaceholder('رمز عبور', { exact: true }).fill('Test12345!');
  const logged = target.waitForResponse(response => response.url().endsWith('/auth/login'));
  await target.locator('form').filter({ has: target.getByPlaceholder('رمز عبور', { exact: true }) })
    .locator('button[type=submit]').click();
  tokens.push((await (await logged).json()).session_token);
  await target.getByText('اسناد خانه', { exact: true }).waitFor();
}

async function openDocuments(target = page, reload = false) {
  if (reload) await target.reload({ waitUntil: 'domcontentloaded' });
  if (!(await target.getByRole('heading', { name: 'اسناد خانه', exact: true }).isVisible())) {
    await target.getByText('اسناد خانه', { exact: true }).click();
  }
  await target.getByRole('heading', { name: 'اسناد خانه', exact: true }).waitFor();
  await poll(async () => !(await target.getByText('در حال دریافت اسناد…', { exact: true }).isVisible()),
    'Document list did not finish loading');
}

const row = (title, target = page) => target.locator('.document-row').filter({ hasText: title });

async function screenshot(name, target = page) {
  assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page overflows mobile width');
  for (const sheet of await target.locator('.modal-sheet').all()) {
    assert.ok(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Document sheet overflows mobile width');
  }
  await target.screenshot({ path: '.local-test/' + name + '.png', fullPage: true });
}

function pdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const content = 'BT /F1 16 Tf 36 320 Td (House document test) Tj ET';
  objects.push('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
  let text = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(offset => { text += String(offset).padStart(10, '0') + ' 00000 n \n'; });
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name: 'document.pdf', mimeType: 'application/pdf', buffer: Buffer.from(text) };
}

async function imageFixture(target = page) {
  const encoded = await target.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 180; canvas.height = 220;
    const painter = canvas.getContext('2d');
    painter.fillStyle = '#f3f7f0'; painter.fillRect(0, 0, 180, 220);
    painter.fillStyle = '#0e6f78'; painter.fillRect(24, 28, 132, 20);
    painter.fillStyle = '#4b5563';
    for (let y = 80; y < 175; y += 20) painter.fillRect(24, y, 120, 4);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return { name: 'document.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') };
}

async function createUi(title, visibility, fixture) {
  await page.getByRole('button', { name: 'ثبت سند جدید', exact: true }).click();
  assert.equal(await page.getByLabel('دسترسی سند', { exact: true }).inputValue(), 'private', 'Documents should default to private');
  await page.getByLabel('عنوان سند', { exact: true }).fill(title);
  await page.getByLabel('دسته‌بندی سند', { exact: true }).fill('ضمانت');
  await page.getByLabel('دسترسی سند', { exact: true }).selectOption(visibility);
  await page.getByRole('button', { name: 'بدون تاریخ اعتبار', exact: true }).click();
  await page.getByRole('button', { name: 'امروز', exact: true }).click();
  await page.getByLabel('فایل سند', { exact: true }).setInputFiles(fixture);
  await screenshot('documents-mobile-form');
  const saved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/documents'));
  await page.getByRole('button', { name: 'ثبت سند', exact: true }).click();
  const response = await saved;
  assert.equal(response.status(), 201);
  assert.match(response.headers()['cache-control'], /no-store/);
  assert.match(response.request().headers()['content-type'], /multipart\/form-data; boundary=/);
  const document = await response.json();
  await poll(async () => !(await page.getByRole('heading', { name: 'سند جدید', exact: true }).isVisible()), 'Document form did not close');
  await row(title).waitFor();
  return document;
}

async function checkNoDocumentCache(target = page) {
  const result = await target.evaluate(async marker => {
    const cacheUrls = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) cacheUrls.push(request.url);
    }
    const persistentTexts = [...Object.values(localStorage), ...Object.values(sessionStorage)];
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mali-man-secure', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const read = key => new Promise((resolve, reject) => {
      const request = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const keys = await new Promise((resolve, reject) => {
      const request = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const cryptoKey = await read('__crypto_key__');
    for (const key of keys) {
      const value = await read(key);
      if (value?.iv && value?.ct && cryptoKey) {
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(value.iv) }, cryptoKey, value.ct);
        persistentTexts.push(new TextDecoder().decode(plaintext));
      }
    }
    db.close();
    return { cachedDocumentRequests: cacheUrls.filter(url => new URL(url).pathname.startsWith('/api/v1/documents')),
      documentMetadataPersisted: persistentTexts.some(text => String(text).includes(marker)),
      documentKeys: keys.filter(key => /document/i.test(String(key))) };
  }, suffix);
  assert.deepEqual(result.cachedDocumentRequests, []);
  assert.deepEqual(result.documentKeys, []);
  assert.equal(result.documentMetadataPersisted, false, 'Document metadata leaked into persistent/offline storage');
}

async function openNotifications(target = page) {
  await target.getByRole('button', { name: /^اعلان‌ها —/ }).click();
  await target.getByRole('heading', { name: 'اعلان‌ها', exact: true }).waitFor();
}

try {
  await mkdir('.local-test', { recursive: true });
  creator = await loginApi('09000000002'); other = await loginApi('09000000003');
  owner = await loginApi('09000000001'); admin = await loginApi('09000000004');
  await enableNotifications(creator); await enableNotifications(other);
  browser = await chromium.launch({ headless: true, channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge' });
  context = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(context);
  await context.addInitScript(() => {
    window.__documentUrls = { created: [], revoked: [] };
    window.__documentTransfers = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const requestedUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const pathname = new URL(requestedUrl, location.href).pathname;
      if (pathname.startsWith('/api/v1/documents/') && pathname.endsWith('/file')) {
        window.__documentTransfers.push({ pathname, status: response.status,
          mime: response.headers.get('content-type'), cache: response.headers.get('cache-control'),
          authorized: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).has('Authorization') });
      }
      return response;
    };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = value => { const url = create(value); window.__documentUrls.created.push(url); return url; };
    URL.revokeObjectURL = url => { window.__documentUrls.revoked.push(url); revoke(url); };
  });
  page = await context.newPage();
  await loginUi(page, '09000000002'); await openDocuments();
  const privateTitle = suffix + ' private', sharedTitle = suffix + ' shared';
  const privateDocument = await createUi(privateTitle, 'private', await imageFixture());
  const sharedDocument = await createUi(sharedTitle, 'shared', pdfFixture());
  await screenshot('documents-mobile-list');
  console.log('PASS: UI uploads PNG/PDF, private default, categories and Jalali expiry; 390px list/form fit.');

  for (const actor of [other, owner, admin]) {
    const visible = await api('/documents', actor.token);
    assert.equal(visible.some(document => document.id === privateDocument.id), false);
    assert.equal(visible.some(document => document.id === sharedDocument.id), true);
    await api('/documents/' + privateDocument.id + '/file', actor.token, 'GET', undefined, [404]);
  }
  await api('/documents/' + sharedDocument.id, other.token, 'PATCH', {
    base_revision: sharedDocument.revision, title: suffix + ' denied',
  }, [403]);
  const adminVisible = (await api('/documents', admin.token)).find(document => document.id === sharedDocument.id);
  assert.equal(adminVisible.can_edit, true); assert.equal(adminVisible.can_delete, true);
  assert.equal(adminVisible.can_change_visibility, false);
  console.log('PASS: private metadata/file exclude peers and both household admins; shared access and capabilities remain scoped.');

  await row(sharedTitle).locator('.document-details').click();
  const rawFile = await fetch(base + '/api/v1/documents/' + sharedDocument.id + '/file', {
    headers: { Authorization: 'Bearer ' + creator.token },
  });
  assert.equal(rawFile.status, 200, 'Direct authenticated file HTTP status');
  await page.getByRole('button', { name: 'دریافت PDF', exact: true }).click();
  await page.locator('.document-pdf-download').waitFor();
  const transfer = await page.evaluate(id => window.__documentTransfers.find(record => record.pathname.endsWith('/' + id + '/file')), sharedDocument.id);
  assert.equal(transfer.status, 200); assert.match(transfer.cache, /no-store/);
  assert.equal(transfer.authorized, true); assert.match(transfer.mime, /^application\/pdf/);
  assert.equal(await page.locator('.document-preview-sheet iframe').count(), 0);
  const source = await page.locator('.document-download').getAttribute('href');
  assert.match(source, /^blob:/);
  const blobSummary = await page.evaluate(async url => {
    const response = await fetch(url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { size: bytes.length, prefix: String.fromCharCode(...bytes.subarray(0, 5)) };
  }, source);
  assert.ok(blobSummary.size > 5); assert.equal(blobSummary.prefix, '%PDF-');
  const browserDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'دانلود فایل', exact: true }).click();
  const actualDownload = await browserDownload;
  assert.equal(actualDownload.suggestedFilename(), sharedDocument.file_name);
  assert.equal(await actualDownload.failure(), null, 'Browser download did not complete');
  await screenshot('documents-mobile-pdf');
  await page.getByRole('button', { name: 'بستن فایل', exact: true }).click();
  const urlsClosed = await page.evaluate(() => window.__documentUrls.created.every(url => window.__documentUrls.revoked.includes(url)));
  assert.equal(urlsClosed, true, 'Closing the viewer retained its Blob URL');
  await page.getByLabel('دسته‌بندی سند', { exact: true }).fill('قرارداد');
  await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
  await poll(async () => !(await page.getByRole('heading', { name: 'ویرایش سند', exact: true }).isVisible()), 'Metadata edit did not close');
  const changed = (await api('/documents', creator.token)).find(document => document.id === sharedDocument.id);
  assert.equal(changed.category, 'قرارداد'); assert.equal(changed.revision, sharedDocument.revision + 1);
  assert.equal(changed.mime_type, 'application/pdf');
  console.log('PASS: authenticated no-store file download, valid Blob bytes, safe PDF download/revocation and revisioned metadata edit.');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openNotifications();
  await page.locator('.notif-item').filter({ hasText: privateTitle }).waitFor();
  await page.locator('.notif-item').filter({ hasText: sharedTitle }).waitFor();
  await page.locator('.notif-item').filter({ hasText: sharedTitle }).click();
  await openDocuments();
  await row(privateTitle).locator('.document-details').click();
  await page.getByLabel('یادآور پایان اعتبار', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
  await poll(async () => !(await page.getByRole('heading', { name: 'ویرایش سند', exact: true }).isVisible()), 'Reminder edit did not close');
  await page.reload({ waitUntil: 'domcontentloaded' }); await openNotifications();
  await page.locator('.notif-item').filter({ hasText: sharedTitle }).waitFor();
  assert.equal(await page.locator('.notif-item').filter({ hasText: privateTitle }).count(), 0);
  await page.keyboard.press('Escape'); await openDocuments();
  console.log('PASS: authorized expiry reminders navigate to documents, and a disabled per-document reminder disappears.');

  await checkNoDocumentCache();
  await row(privateTitle).locator('.document-details').click();
  await page.getByRole('button', { name: 'مشاهدهٔ فایل', exact: true }).click();
  const image = page.getByAltText(privateTitle, { exact: true });
  await image.waitFor();
  await poll(async () => image.evaluate(element => element.complete && element.naturalWidth > 0), 'Image preview did not load');
  await screenshot('documents-mobile-image');
  await context.setOffline(true);
  await poll(async () => (await page.locator('.documents-page').count()) === 0 &&
    (await page.locator('.document-preview-sheet').count()) === 0, 'Disconnect retained document page or preview');
  assert.equal(await page.evaluate(() => window.__documentUrls.created.every(url => window.__documentUrls.revoked.includes(url))), true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('اتصال اینترنت نیست', { exact: true }).waitFor();
  assert.equal(await page.getByText(privateTitle, { exact: true }).count(), 0);
  assert.equal(await page.getByText(sharedTitle, { exact: true }).count(), 0);
  await checkNoDocumentCache();
  await context.setOffline(false); await openDocuments(page, true);
  console.log('PASS: documents and previews unmount/revoke offline; app cache and encrypted offline records contain no document metadata/files.');

  // Deliver an old authorized list after logout and a different login.
  let held = false, heldReady;
  const heldPromise = new Promise(resolve => { heldReady = resolve; });
  const gate = new Promise(resolve => { releaseDelayed = resolve; });
  await context.route('**/api/v1/documents', async route => {
    if (held || route.request().method() !== 'GET') { await route.continue(); return; }
    held = true;
    const response = await route.fetch(); heldReady();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.reload({ waitUntil: 'domcontentloaded' }); await heldPromise;
  await page.getByRole('button', { name: 'پروفایل و تنظیمات', exact: true }).click();
  await page.getByText('خروج از حساب', { exact: true }).click();
  await page.getByPlaceholder('شماره موبایل', { exact: true }).first().waitFor();
  await loginUi(page, '09000000003');
  releaseDelayed(); releaseDelayed = null;
  await context.unrouteAll({ behavior: 'wait' });
  await openDocuments();
  await row(sharedTitle).waitFor(); assert.equal(await row(privateTitle).count(), 0);
  await row(sharedTitle).locator('.document-details').click();
  assert.equal(await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).count(), 0);
  assert.equal(await page.getByLabel('دسترسی سند', { exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'بستن', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' }); await openNotifications();
  await page.locator('.notif-item').filter({ hasText: sharedTitle }).waitFor();
  assert.equal(await page.locator('.notif-item').filter({ hasText: privateTitle }).count(), 0);
  await checkNoDocumentCache();
  console.log('PASS: delayed response across logout/login cannot restore private metadata or reminders; another member has read-only shared details.');

  const deletionContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(deletionContext);
  const deletionPage = await deletionContext.newPage();
  await loginUi(deletionPage, '09000000002'); await openDocuments(deletionPage);
  // A conflicting edit starts a page reload. Hold its pre-delete list snapshot.
  await row(sharedTitle, deletionPage).locator('.document-details').click();
  const beforeConflict = (await api('/documents', creator.token)).find(document => document.id === sharedDocument.id);
  await api('/documents/' + sharedDocument.id, creator.token, 'PATCH', {
    base_revision: beforeConflict.revision, category: 'تغییر هم‌زمان',
  });
  let listHeld = false, listReady;
  const listHeldPromise = new Promise(resolve => { listReady = resolve; });
  const listGate = new Promise(resolve => { releaseList = resolve; });
  await deletionContext.route('**/api/v1/documents', async route => {
    if (listHeld || route.request().method() !== 'GET') { await route.continue(); return; }
    listHeld = true;
    const response = await route.fetch(); listReady();
    await listGate;
    await route.fulfill({ response }).catch(() => {});
  });
  const conflictResponse = deletionPage.waitForResponse(response => response.request().method() === 'PATCH' &&
    response.url().endsWith('/documents/' + sharedDocument.id));
  await deletionPage.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
  assert.equal((await conflictResponse).status(), 409);
  await listHeldPromise;
  await deletionPage.getByRole('button', { name: 'بستن', exact: true }).click();
  await deletionPage.evaluate(() => {
    const create = URL.createObjectURL.bind(URL);
    window.__delayedFileUrlCalls = 0;
    URL.createObjectURL = value => { window.__delayedFileUrlCalls += 1; return create(value); };
  });
  let delayedFileReady;
  const delayedFileHeld = new Promise(resolve => { delayedFileReady = resolve; });
  const delayedFileGate = new Promise(resolve => { releaseDelayed = resolve; });
  await deletionContext.route('**/api/v1/documents/' + privateDocument.id + '/file', async route => {
    const response = await route.fetch(); delayedFileReady();
    await delayedFileGate;
    await route.fulfill({ response }).catch(() => {});
  });
  await row(privateTitle, deletionPage).locator('.document-details').click();
  await deletionPage.getByRole('button', { name: 'مشاهدهٔ فایل', exact: true }).click();
  await delayedFileHeld;
  await deletionPage.getByRole('button', { name: 'بستن', exact: true }).click();
  await row(privateTitle, deletionPage).getByRole('button', { name: 'حذف ' + privateTitle, exact: true }).click();
  await deletionPage.getByRole('button', { name: 'انصراف', exact: true }).click();
  assert.equal((await api('/documents', creator.token)).some(document => document.id === privateDocument.id), true);
  await row(privateTitle, deletionPage).getByRole('button', { name: 'حذف ' + privateTitle, exact: true }).click();
  await deletionPage.getByRole('button', { name: 'حذف سند', exact: true }).click();
  await poll(async () => !(await row(privateTitle, deletionPage).count()), 'Deleted document remained visible');
  await api('/documents/' + privateDocument.id + '/file', creator.token, 'GET', undefined, [404]);
  const delayedDelivered = deletionPage.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith('/documents/' + privateDocument.id + '/file'));
  releaseDelayed(); releaseDelayed = null;
  await (await delayedDelivered).finished();
  const listDelivered = deletionPage.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith('/documents'));
  releaseList(); releaseList = null;
  await (await listDelivered).finished();
  await deletionContext.unrouteAll({ behavior: 'wait' });
  await deletionPage.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await deletionPage.locator('.document-preview-sheet').count(), 0, 'A delayed file reopened after closing/deleting its document');
  assert.equal(await deletionPage.evaluate(() => window.__delayedFileUrlCalls), 0, 'Stale file contents received a Blob URL');
  assert.equal(await row(privateTitle, deletionPage).count(), 0, 'A pre-delete list response restored the deleted row');
  console.log('PASS: delete confirmation/cancel, file access removal, and delayed file/list responses cannot reopen or restore a deleted document.');
} catch (error) {
  if (page) await page.screenshot({ path: '.local-test/documents-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  releaseDelayed?.();
  releaseList?.();
  for (const target of contexts) await target.setOffline(false).catch(() => {});
  if (browser) await browser.close();
  if (creator) {
    const fixtures = await api('/documents', creator.token).catch(() => []);
    for (const document of fixtures.filter(document => document.title.includes(suffix))) {
      await api('/documents/' + document.id + '?base_revision=' + document.revision, creator.token, 'DELETE').catch(() => {});
    }
  }
  for (const [account, prefs] of originalPrefs) await api('/notifications/prefs', account.token, 'PATCH', prefs).catch(() => {});
  for (const token of tokens) await api('/auth/logout', token, 'POST').catch(() => {});
}
