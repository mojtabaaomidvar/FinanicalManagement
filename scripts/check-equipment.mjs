import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = 'http://127.0.0.1:5700';
const marker = 'equipment-e2e-' + Date.now();
const tokens = [], createdItems = [], createdDocuments = [], createdTasks = [];
let browser, context, page, actor, originalPrefs, releaseDeniedReloads;
const parts = (date, calendar = 'gregory') => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran', calendar, numberingSystem: 'latn', year: 'numeric', month: 'numeric', day: 'numeric',
}).formatToParts(date).filter(part => ['year', 'month', 'day'].includes(part.type)).map(part => [part.type, Number(part.value)]));
const todayParts = parts(new Date());
const todayIso = [todayParts.year, String(todayParts.month).padStart(2, '0'), String(todayParts.day).padStart(2, '0')].join('-');
const future = new Date(todayIso + 'T12:00:00Z'); future.setUTCDate(future.getUTCDate() + 30);
const futureIso = future.toISOString().slice(0, 10);
const fa = value => String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);

async function api(path, token, method = 'GET', body, expected = [200, 201, 204]) {
  const response = await fetch(base + '/api/v1' + path, {
    method, headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(expected.includes(response.status), `${method} ${path}: ${response.status}`);
  if (path.startsWith('/equipment')) assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.status === 204 ? null : response.json();
}
async function loginApi(phone) {
  const result = await api('/auth/login', null, 'POST', { phone, password: 'Test12345!' });
  tokens.push(result.session_token); return result.session_token;
}
async function loginUi(target, phone) {
  await target.goto(base, { waitUntil: 'networkidle' });
  if (!(await target.getByPlaceholder('شماره موبایل', { exact: true }).count())) await target.getByRole('button', { name: 'ورود', exact: true }).click();
  await target.getByPlaceholder('شماره موبایل', { exact: true }).first().fill(phone);
  await target.getByPlaceholder('رمز عبور', { exact: true }).fill('Test12345!');
  const login = target.waitForResponse(response => response.url().endsWith('/auth/login'));
  await target.locator('form').filter({ has: target.getByPlaceholder('رمز عبور', { exact: true }) }).locator('button[type=submit]').click();
  tokens.push((await (await login).json()).session_token);
  await target.getByText('وسایل خانه', { exact: true }).waitFor();
}
async function openEquipment(target = page) {
  const deadline = Date.now() + 25000;
  while (!await target.getByRole('heading', { name: 'وسایل خانه', exact: true }).isVisible()) {
    assert.ok(Date.now() < deadline, 'Equipment navigation did not become available after reconnect');
    await target.getByText('وسایل خانه', { exact: true }).click();
    await target.waitForTimeout(350);
  }
  await target.getByRole('heading', { name: 'وسایل خانه', exact: true }).waitFor();
  await target.waitForFunction(() => document.querySelector('.equipment-page')?.getAttribute('aria-busy') === 'false');
  assert.equal(await target.locator('.equipment-page > .content [role=alert]').count(), 0, 'Equipment loading failed');
}
async function openDetail(title, target = page) {
  if (await target.getByRole('button', { name: 'بستن جزئیات', exact: true }).isVisible()) return;
  await target.getByRole('button', { name: 'جزئیات ' + title, exact: true }).click();
  await target.getByRole('button', { name: 'بستن جزئیات', exact: true }).waitFor();
  await target.getByText('در حال دریافت سابقه…', { exact: true }).waitFor({ state: 'hidden' });
}
async function chooseDate(label, iso, target = page) {
  const group = target.getByRole('group', { name: label, exact: true });
  await group.locator('.date-field').click();
  const selectedParts = parts(new Date(iso + 'T12:00:00Z'), 'persian');
  const currentParts = parts(new Date(todayIso + 'T12:00:00Z'), 'persian');
  const difference = (selectedParts.year - currentParts.year) * 12 + selectedParts.month - currentParts.month;
  // This helper selects initially empty dates, whose picker starts in the current month.
  for (let index = 0; index < Math.abs(difference); index++) await target.getByRole('button', { name: difference > 0 ? 'ماه بعد' : 'ماه قبل', exact: true }).click();
  await target.locator('.dp-box').getByRole('button', { name: fa(selectedParts.day), exact: true }).click();
  await target.locator('.dp-overlay').waitFor({ state: 'hidden' });
}
async function screenshot(name, target = page) {
  assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page overflows');
  for (const sheet of await target.locator('.modal-sheet').all()) assert.ok(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Mobile sheet overflows');
  await target.screenshot({ path: '.local-test/' + name + '.png', fullPage: true });
}
async function home() {
  if (!await page.locator('.hub-bell').isVisible()) await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.hub-bell').waitFor();
}
async function openNotifications() {
  await home(); await page.locator('.hub-bell').click();
  await page.getByRole('heading', { name: 'اعلان‌ها', exact: true }).waitFor();
  await page.waitForTimeout(300);
}
async function createDocument(visibility) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=', 'base64');
  const form = new FormData(); form.append('title', marker + '-' + visibility); form.append('visibility', visibility);
  form.append('file', new Blob([png], { type: 'image/png' }), marker + '.png');
  const response = await fetch(base + '/api/v1/documents', { method: 'POST', headers: { Authorization: 'Bearer ' + actor }, body: form });
  assert.equal(response.status, 201, 'Document fixture was not created');
  const document = await response.json(); createdDocuments.push(document); return document;
}

try {
  await mkdir('.local-test', { recursive: true });
  actor = await loginApi('09000000002'); const other = await loginApi('09000000003');
  originalPrefs = await api('/notifications/prefs', actor);
  await api('/notifications/prefs', actor, 'PATCH', { enabled: true, domains: { equipment: true }, lead_days: { equipment: 7 } });
  const shared = await createDocument('shared'), privateDocument = await createDocument('private');
  const task = await api('/tasks', actor, 'POST', { title: marker + '-task' }); createdTasks.push(task);
  const inventoryBefore = await api('/inventory', actor), transactionsBefore = await api('/transactions', actor);
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  page = await context.newPage(); await loginUi(page, '09000000002'); await openEquipment();
  await page.getByRole('button', { name: 'ثبت وسیلهٔ جدید', exact: true }).click();
  await page.getByLabel('نام وسیله', { exact: true }).fill(marker);
  await page.getByLabel('برند', { exact: true }).fill('برند آزمایشی'); await page.getByLabel('مدل', { exact: true }).fill('Model 1');
  await chooseDate('تاریخ خرید', todayIso); await chooseDate('پایان گارانتی', todayIso); await chooseDate('موعد سرویس بعدی', todayIso);
  const documentSelect = page.getByLabel('سند گارانتی مشترک', { exact: true });
  assert.equal(await documentSelect.locator(`option[value="${privateDocument.id}"]`).count(), 0, 'Private document offered as a shared link');
  await documentSelect.selectOption(shared.id); await page.getByLabel('کار مرتبط', { exact: true }).selectOption(task.id);
  await screenshot('equipment-mobile-form');
  const created = page.waitForResponse(response => response.url().endsWith('/equipment') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'ذخیرهٔ وسیله', exact: true }).click();
  const creationResponse = await created; assert.equal(creationResponse.status(), 201);
  const item = await creationResponse.json(); createdItems.push(item);
  assert.equal(item.purchase_date, todayIso); assert.equal(item.warranty_until, todayIso); assert.equal(item.service_due_date, todayIso);
  assert.equal(item.warranty_document_id, shared.id); assert.equal(item.service_task_id, task.id);
  await page.getByRole('button', { name: 'جزئیات ' + marker, exact: true }).waitFor();
  await screenshot('equipment-mobile-list');
  await openNotifications();
  const reminders = page.locator('.notif-item').filter({ hasText: marker }); await reminders.first().waitFor();
  assert.equal(await reminders.count(), 2, 'Service and warranty reminders missing');
  await reminders.first().click(); await page.getByRole('button', { name: 'بستن جزئیات', exact: true }).waitFor();
  await page.getByText('در حال دریافت سابقه…', { exact: true }).waitFor({ state: 'hidden' });
  const fileResponse = page.waitForResponse(response => response.url().endsWith(`/documents/${shared.id}/file`));
  await page.getByRole('button', { name: 'مشاهدهٔ سند گارانتی', exact: true }).click();
  const file = await fileResponse; assert.equal(file.status(), 200);
  assert.equal(file.headers()['cache-control'], 'no-store');
  await page.locator('.equipment-preview').waitFor();
  await page.waitForFunction(() => { const image = document.querySelector('.equipment-preview'); return image?.complete && image.naturalWidth > 0; });
  await screenshot('equipment-mobile-document');
  await page.getByRole('button', { name: 'بستن سند', exact: true }).click();
  await page.getByRole('button', { name: 'ثبت سرویس انجام‌شده', exact: true }).click();
  await page.getByLabel('شرح سرویس', { exact: true }).fill(marker + '-service');
  await chooseDate('موعد بعدی پس از سرویس', futureIso);
  await screenshot('equipment-mobile-service');
  const operationIds = []; let loseResponse = true;
  await page.route(`**/equipment/${item.id}/services`, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    operationIds.push(route.request().postDataJSON().operation_id);
    if (loseResponse) { loseResponse = false; const result = await route.fetch(); assert.equal(result.status(), 200); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'ثبت سرویس', exact: true }).click();
  await page.locator('.equipment-sheet [role=alert]').waitFor();
  assert.equal((await api(`/equipment/${item.id}/services`, actor)).length, 1);
  const replayed = page.waitForResponse(response => response.url().endsWith(`/equipment/${item.id}/services`) && response.request().method() === 'POST' && response.ok());
  await page.getByRole('button', { name: 'ثبت سرویس', exact: true }).click();
  assert.equal((await (await replayed).json()).replayed, true);
  assert.equal(operationIds.length, 2); assert.equal(operationIds[0], operationIds[1], 'Unchanged retry lost its operation id');
  await page.unroute(`**/equipment/${item.id}/services`);
  await page.getByRole('button', { name: 'بستن جزئیات', exact: true }).waitFor();
  await page.locator('.equipment-history li').waitFor(); assert.equal(await page.locator('.equipment-history li').count(), 1);
  await screenshot('equipment-mobile-history');
  const saved = (await api('/equipment', actor)).find(row => row.id === item.id);
  assert.equal(saved.service_due_date, futureIso);
  assert.equal((await api('/tasks', actor)).find(row => row.id === task.id).completed, false, 'Service implicitly completed its task');
  assert.deepEqual(await api('/inventory', actor), inventoryBefore, 'Service changed inventory');
  assert.deepEqual(await api('/transactions', actor), transactionsBefore, 'Service created financial data');
  await api('/equipment/' + item.id, other, 'PATCH', { title: 'forbidden', base_revision: saved.revision }, [403]);
  const otherContext = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran' });
  const otherPage = await otherContext.newPage(); await loginUi(otherPage, '09000000003'); await openEquipment(otherPage); await openDetail(marker, otherPage);
  assert.equal(await otherPage.getByRole('button', { name: 'ویرایش وسیله', exact: true }).count(), 0);
  assert.equal(await otherPage.getByRole('button', { name: 'ثبت سرویس انجام‌شده', exact: true }).count(), 0);
  assert.equal(await otherPage.locator('.equipment-history li').count(), 1);
  // A document that becomes private must disappear immediately when file access is denied,
  // even if the following metadata refresh has not returned yet.
  const privateChange = await api('/documents/' + shared.id, actor, 'PATCH', { base_revision: shared.revision, visibility: 'private' });
  const delayedRefresh = new Promise(resolve => { releaseDeniedReloads = resolve; });
  for (const endpoint of ['/equipment', '/documents']) await otherPage.route('**/api/v1' + endpoint, async route => {
    if (route.request().method() === 'GET') await delayedRefresh;
    await route.continue();
  });
  const deniedFile = otherPage.waitForResponse(response => response.url().endsWith(`/documents/${shared.id}/file`));
  await otherPage.getByRole('button', { name: 'مشاهدهٔ سند گارانتی', exact: true }).click();
  assert.ok([403, 404].includes((await deniedFile).status()));
  await otherPage.locator('.equipment-link').filter({ hasText: shared.title }).waitFor({ state: 'hidden' });
  const refreshed = ['/equipment', '/documents'].map(endpoint => otherPage.waitForResponse(response =>
    response.url().endsWith('/api/v1' + endpoint) && response.request().method() === 'GET'));
  releaseDeniedReloads(); releaseDeniedReloads = undefined;
  await Promise.all(refreshed);
  await otherContext.close();
  await api('/documents/' + shared.id, actor, 'PATCH', { base_revision: privateChange.revision, visibility: 'shared' });
  await page.getByRole('button', { name: 'ویرایش وسیله', exact: true }).click();
  await page.getByLabel('نام وسیله', { exact: true }).fill(marker + '-edited');
  await page.getByRole('button', { name: 'پاک‌کردن پایان گارانتی', exact: true }).click();
  await page.getByRole('button', { name: 'ذخیرهٔ وسیله', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.equipment-page')?.getAttribute('aria-busy') === 'false');
  await page.getByRole('button', { name: 'جزئیات ' + marker + '-edited', exact: true }).waitFor();
  await openNotifications(); assert.equal(await page.locator('.notif-item').filter({ hasText: marker }).count(), 0, 'Old reminder survived changed due dates');
  await page.keyboard.press('Escape'); await openEquipment();
  await page.getByRole('button', { name: 'ثبت وسیلهٔ جدید', exact: true }).click();
  await page.getByLabel('نام وسیله', { exact: true }).fill(marker + '-unsaved'); await context.setOffline(true);
  await page.locator('.modal-overlay').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.equipment-row').count(), 0, 'Offline equipment retained');
  await context.setOffline(false); await openEquipment();
  await page.getByRole('button', { name: 'ثبت وسیلهٔ جدید', exact: true }).click();
  assert.equal(await page.getByLabel('نام وسیله', { exact: true }).inputValue(), '', 'Offline draft leaked after reconnect');
  await page.getByRole('button', { name: 'انصراف', exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' }); await openEquipment(); await openDetail(marker + '-edited');
  assert.equal(await page.locator('.equipment-history li').count(), 1, 'History did not persist after reload');
  await page.getByRole('button', { name: 'بستن جزئیات', exact: true }).click();
  await page.getByRole('button', { name: 'حذف ' + marker + '-edited', exact: true }).click();
  await page.getByRole('button', { name: 'انصراف', exact: true }).click();
  await page.getByRole('button', { name: 'جزئیات ' + marker + '-edited', exact: true }).waitFor();
  await page.getByRole('button', { name: 'حذف ' + marker + '-edited', exact: true }).click();
  await page.getByRole('button', { name: 'حذف وسیله و سابقه', exact: true }).click();
  await page.getByRole('button', { name: 'جزئیات ' + marker + '-edited', exact: true }).waitFor({ state: 'hidden' });
  assert.ok((await api('/documents', actor)).some(row => row.id === shared.id), 'Deleting equipment deleted the document');
  assert.ok((await api('/tasks', actor)).some(row => row.id === task.id), 'Deleting equipment deleted the task');
  console.log('PASS: equipment mobile CRUD, Jalali dates, authorized document/task links, reminders, atomic service history, lost-response retry, permissions, offline clearing and persistence.');
} catch (error) {
  if (page) await page.screenshot({ path: '.local-test/equipment-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  releaseDeniedReloads?.();
  if (browser) await browser.close();
  if (actor) {
    const items = await api('/equipment', actor).catch(() => []);
    for (const item of items.filter(row => createdItems.some(created => created.id === row.id))) await api(`/equipment/${item.id}?base_revision=${item.revision}`, actor, 'DELETE').catch(() => {});
    for (const task of createdTasks) {
      const current = (await api('/tasks', actor).catch(() => [])).find(row => row.id === task.id);
      if (current) await api(`/tasks/${current.id}?base_revision=${current.revision}`, actor, 'DELETE').catch(() => {});
    }
    const documents = await api('/documents', actor).catch(() => []);
    for (const document of documents.filter(row => createdDocuments.some(created => created.id === row.id))) await api(`/documents/${document.id}?base_revision=${document.revision}`, actor, 'DELETE').catch(() => {});
    if (originalPrefs) await api('/notifications/prefs', actor, 'PATCH', {
      enabled: originalPrefs.enabled, domains: { equipment: originalPrefs.domains?.equipment !== false },
      lead_days: { equipment: originalPrefs.lead_days?.equipment ?? 7 },
    }).catch(() => {});
  }
  for (const token of tokens) await api('/auth/logout', token, 'POST').catch(() => {});
}
