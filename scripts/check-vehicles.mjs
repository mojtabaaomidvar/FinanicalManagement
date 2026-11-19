import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = 'http://127.0.0.1:5700';
const marker = 'vehicles-e2e-' + Date.now();
const tokens = [], vehicleIds = [], documentIds = [], taskIds = [], txIds = [];
let browser, context, page, actor, originalPrefs, releaseDeniedReloads, releaseFinanceRead;
const parts = (date, calendar = 'gregory') => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran', calendar, numberingSystem: 'latn', year: 'numeric', month: 'numeric', day: 'numeric',
}).formatToParts(date).filter(part => ['year', 'month', 'day'].includes(part.type)).map(part => [part.type, Number(part.value)]));
const today = parts(new Date());
const todayIso = [today.year, String(today.month).padStart(2, '0'), String(today.day).padStart(2, '0')].join('-');
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
  if (path.startsWith('/vehicles')) assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.status === 204 ? null : response.json();
}
async function loginApi(phone) {
  const result = await api('/auth/login', null, 'POST', { phone, password: 'Test12345!' });
  tokens.push(result.session_token); return result;
}
async function loginUi(target, phone) {
  await target.goto(base, { waitUntil: 'networkidle' });
  if (!(await target.getByPlaceholder('شماره موبایل', { exact: true }).count())) await target.getByRole('button', { name: 'ورود', exact: true }).click();
  await target.getByPlaceholder('شماره موبایل', { exact: true }).first().fill(phone);
  await target.getByPlaceholder('رمز عبور', { exact: true }).fill('Test12345!');
  const login = target.waitForResponse(response => response.url().endsWith('/auth/login'));
  await target.locator('form').filter({ has: target.getByPlaceholder('رمز عبور', { exact: true }) }).locator('button[type=submit]').click();
  tokens.push((await (await login).json()).session_token);
  await target.getByText('خودرو و نگهداری', { exact: true }).waitFor();
}
async function openVehicles(target = page) {
  const deadline = Date.now() + 25000;
  while (!await target.getByRole('heading', { name: 'خودرو و نگهداری', exact: true }).isVisible()) {
    assert.ok(Date.now() < deadline, 'Vehicles navigation unavailable after reconnect');
    await target.getByText('خودرو و نگهداری', { exact: true }).click();
    await target.waitForTimeout(350);
  }
  await target.waitForFunction(() => document.querySelector('.vehicle-page')?.getAttribute('aria-busy') === 'false');
  assert.equal(await target.locator('.vehicle-page > .content [role=alert]').count(), 0, 'Vehicles loading failed');
}
async function openDetail(title, target = page) {
  await target.getByRole('button', { name: 'جزئیات ' + title, exact: true }).click();
  await target.getByRole('button', { name: 'بستن جزئیات', exact: true }).waitFor();
  await target.getByText('در حال دریافت سابقه…', { exact: true }).waitFor({ state: 'hidden' });
}
async function chooseDate(label, iso, target = page) {
  await target.getByRole('group', { name: label, exact: true }).locator('.date-field').click();
  const selected = parts(new Date(iso + 'T12:00:00Z'), 'persian');
  const current = parts(new Date(todayIso + 'T12:00:00Z'), 'persian');
  const difference = (selected.year - current.year) * 12 + selected.month - current.month;
  for (let index = 0; index < Math.abs(difference); index++) await target.getByRole('button', { name: difference > 0 ? 'ماه بعد' : 'ماه قبل', exact: true }).click();
  await target.locator('.dp-box').getByRole('button', { name: fa(selected.day), exact: true }).click();
  await target.locator('.dp-overlay').waitFor({ state: 'hidden' });
}
async function screenshot(name, target = page) {
  assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page overflows');
  for (const sheet of await target.locator('.modal-sheet').all()) assert.ok(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Mobile sheet overflows');
  await target.screenshot({ path: '.local-test/' + name + '.png', fullPage: true });
}
async function openNotifications() {
  await page.reload({ waitUntil: 'networkidle' }); await page.locator('.floating-navigation').getByRole('button', { name: 'اعلان‌ها', exact: true }).click();
  await page.getByRole('heading', { name: 'اعلان‌ها', exact: true }).waitFor();
}
async function createDocument(visibility) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=', 'base64');
  const form = new FormData(); form.append('title', marker + '-' + visibility); form.append('visibility', visibility);
  form.append('file', new Blob([png], { type: 'image/png' }), marker + '.png');
  const response = await fetch(base + '/api/v1/documents', { method: 'POST', headers: { Authorization: 'Bearer ' + actor }, body: form });
  assert.equal(response.status, 201); const result = await response.json(); documentIds.push(result.id); return result;
}

try {
  await mkdir('.local-test', { recursive: true });
  const login = await loginApi('09000000002'); actor = login.session_token;
  const other = (await loginApi('09000000003')).session_token;
  originalPrefs = await api('/notifications/prefs', actor);
  await api('/notifications/prefs', actor, 'PATCH', { enabled: true, domains: { vehicles: true }, lead_days: { vehicles: 7 } });
  const shared = await createDocument('shared'), privateDocument = await createDocument('private');
  const task = await api('/tasks', actor, 'POST', { title: marker + '-task' }); taskIds.push(task.id);
  const transactionsBefore = await api('/transactions', actor), inventoryBefore = await api('/inventory', actor);
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  page = await context.newPage(); await loginUi(page, '09000000002'); await openVehicles();
  await page.getByRole('button', { name: 'ثبت خودروی جدید', exact: true }).click();
  await page.getByLabel('نام خودرو', { exact: true }).fill(marker);
  await page.getByLabel('برند', { exact: true }).fill('برند آزمایشی');
  await page.getByLabel('مدل', { exact: true }).fill('Model 1');
  await page.getByLabel('پلاک', { exact: true }).fill('پلاک آزمایشی');
  await page.getByLabel('کیلومتر فعلی', { exact: true }).fill('1000');
  await page.getByLabel('کیلومتر سرویس بعدی', { exact: true }).fill('1000');
  await chooseDate('تاریخ خرید', todayIso); await chooseDate('پایان بیمه', todayIso);
  await chooseDate('پایان معاینهٔ فنی', todayIso); await chooseDate('موعد سرویس بعدی', todayIso);
  const documentSelect = page.getByLabel('سند مشترک خودرو', { exact: true });
  assert.equal(await documentSelect.locator(`option[value="${privateDocument.id}"]`).count(), 0, 'Private document offered as shared');
  await documentSelect.selectOption(shared.id); await page.getByLabel('کار مرتبط', { exact: true }).selectOption(task.id);
  await screenshot('vehicles-mobile-form');
  const created = page.waitForResponse(response => response.url().endsWith('/vehicles') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'ذخیرهٔ خودرو', exact: true }).click();
  const creation = await created; assert.equal(creation.status(), 201);
  const vehicle = await creation.json(); vehicleIds.push(vehicle.id);
  assert.equal(vehicle.odometer, 1000); assert.equal(vehicle.document_id, shared.id);
  await page.getByRole('button', { name: 'جزئیات ' + marker, exact: true }).waitFor();
  await screenshot('vehicles-mobile-list');
  await openNotifications(); const reminders = page.locator('.notif-item').filter({ hasText: marker });
  await reminders.first().waitFor(); assert.equal(await reminders.count(), 3, 'Date/km service or document expiry reminders missing');
  await reminders.first().click(); await page.getByRole('button', { name: 'بستن جزئیات', exact: true }).waitFor();
  const fileResponse = page.waitForResponse(response => response.url().endsWith(`/documents/${shared.id}/file`));
  await page.getByRole('button', { name: 'مشاهدهٔ سند خودرو', exact: true }).click();
  assert.equal((await fileResponse).status(), 200); await page.locator('.vehicle-preview').waitFor();
  await screenshot('vehicles-mobile-document'); await page.getByRole('button', { name: 'بستن سند', exact: true }).click();
  await page.getByRole('button', { name: 'ثبت سرویس انجام‌شده', exact: true }).click();
  await page.getByLabel('شرح سرویس', { exact: true }).fill(marker + '-service');
  await page.getByLabel('کیلومتر انجام سرویس', { exact: true }).fill('1100');
  await page.getByLabel('کیلومتر سرویس بعدی', { exact: true }).fill('2000');
  await page.getByRole('group', { name: 'هزینهٔ سرویس', exact: true }).locator('input').fill(login.member.currency === 'ریال' ? '500000' : '50000');
  await chooseDate('تاریخ سرویس بعدی', futureIso); await screenshot('vehicles-mobile-service');
  const operationIds = []; let loseResponse = true;
  await page.route(`**/vehicles/${vehicle.id}/services`, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    operationIds.push(route.request().postDataJSON().operation_id);
    if (loseResponse) { loseResponse = false; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'ثبت سرویس و هزینه', exact: true }).click();
  await page.locator('.vehicle-sheet [role=alert]').waitFor();
  let records = await api(`/vehicles/${vehicle.id}/services`, actor); assert.equal(records.length, 1);
  txIds.push(records[0].transaction_id);
  assert.equal(Number(records[0].cost_amount), 50000);
  const replayed = page.waitForResponse(response => response.url().endsWith(`/vehicles/${vehicle.id}/services`) && response.request().method() === 'POST' && response.ok());
  await page.getByRole('button', { name: 'ثبت سرویس و هزینه', exact: true }).click();
  assert.equal((await (await replayed).json()).replayed, true);
  assert.equal(operationIds.length, 2); assert.equal(operationIds[0], operationIds[1]);
  await page.unroute(`**/vehicles/${vehicle.id}/services`);
  await page.locator('.vehicle-history li').waitFor(); assert.equal(await page.locator('.vehicle-history li').count(), 1);
  await screenshot('vehicles-mobile-history');
  let saved = (await api('/vehicles', actor)).vehicles.find(row => row.id === vehicle.id);
  assert.equal(saved.odometer, 1100); assert.equal(saved.service_due_odometer, 2000); assert.equal(saved.service_due_date, futureIso);
  const txs = await api('/transactions', actor), added = txs.filter(tx => !transactionsBefore.some(before => before.id === tx.id));
  assert.equal(added.length, 1); const expense = added[0];
  assert.equal(expense.id, records[0].transaction_id); assert.equal(expense.type, 'expense');
  assert.equal(expense.category, 'transport'); assert.equal(expense.member_id, login.member.id);
  assert.equal(expense.source_kind, 'vehicle_service'); assert.equal(expense.account_id, null);
  assert.deepEqual(await api('/inventory', actor), inventoryBefore);
  assert.equal((await api('/tasks', actor)).find(row => row.id === task.id).completed, false);
  // A Finance response started before an offline cycle cannot reopen sensitive UI.
  let signalFinance, interceptFinance = true;
  const financeRequested = new Promise(resolve => { signalFinance = resolve; });
  const delayedFinance = new Promise(resolve => { releaseFinanceRead = resolve; });
  await page.route('**/api/v1/transactions', async route => {
    if (route.request().method() !== 'GET' || !interceptFinance) { await route.continue(); return; }
    interceptFinance = false; const response = await route.fetch(); signalFinance();
    await delayedFinance; await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'مشاهدهٔ هزینه در مالی', exact: true }).click();
  await financeRequested; await context.setOffline(true); await page.locator('.modal-overlay').waitFor({ state: 'hidden' });
  await context.setOffline(false); releaseFinanceRead(); releaseFinanceRead = undefined;
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.tx-sheet').count(), 0, 'A pre-offline Finance response reopened the form');
  await page.unroute('**/api/v1/transactions'); await openVehicles(); await openDetail(marker);
  await page.getByRole('button', { name: 'مشاهدهٔ هزینه در مالی', exact: true }).click();
  await page.getByText('ویرایش تراکنش', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'درآمد', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'تغییر دسته‌بندی', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'اسکن رسید', exact: true }).count(), 0, 'Unsafe legacy receipt action shown for service cost');
  await screenshot('vehicles-finance-linked'); await page.getByRole('button', { name: 'بستن', exact: true }).click();
  await api('/transactions/' + expense.id, actor, 'PATCH', {
    member_id: expense.member_id, type: expense.type, amount: 60000, category: expense.category,
    date: expense.date, account_id: null, repeat: 'none', note: marker + '-corrected',
  });
  records = await api(`/vehicles/${vehicle.id}/services`, actor); assert.equal(Number(records[0].cost_amount), 60000);
  await page.reload({ waitUntil: 'networkidle' }); await openVehicles(); await openDetail(marker);
  await page.getByRole('button', { name: 'ویرایش خودرو', exact: true }).click();
  await page.getByLabel('برند', { exact: true }).fill('برند به‌روز');
  await page.getByLabel('کیلومتر فعلی', { exact: true }).fill('1200');
  await page.getByRole('button', { name: 'ذخیرهٔ خودرو', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.vehicle-page')?.getAttribute('aria-busy') === 'false');
  saved = (await api('/vehicles', actor)).vehicles.find(row => row.id === vehicle.id);
  assert.equal(saved.brand, 'برند به‌روز'); assert.equal(saved.odometer, 1200);
  await api(`/vehicles/${vehicle.id}`, other, 'PATCH', { title: 'forbidden', odometer: 1200, base_revision: saved.revision }, [403]);
  const otherContext = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  const otherPage = await otherContext.newPage(); await loginUi(otherPage, '09000000003'); await openVehicles(otherPage); await openDetail(marker, otherPage);
  assert.equal(await otherPage.getByRole('button', { name: 'ویرایش خودرو', exact: true }).count(), 0);
  assert.equal(await otherPage.getByRole('button', { name: 'ثبت سرویس انجام‌شده', exact: true }).count(), 0);
  const privateChange = await api('/documents/' + shared.id, actor, 'PATCH', { base_revision: shared.revision, visibility: 'private' });
  const delayed = new Promise(resolve => { releaseDeniedReloads = resolve; });
  for (const endpoint of ['/vehicles', '/documents']) await otherPage.route('**/api/v1' + endpoint, async route => {
    if (route.request().method() === 'GET') await delayed; await route.continue();
  });
  const denied = otherPage.waitForResponse(response => response.url().endsWith(`/documents/${shared.id}/file`));
  await otherPage.getByRole('button', { name: 'مشاهدهٔ سند خودرو', exact: true }).click();
  assert.ok([403, 404].includes((await denied).status()));
  await otherPage.locator('.vehicle-link').filter({ hasText: shared.title }).waitFor({ state: 'hidden' });
  releaseDeniedReloads(); releaseDeniedReloads = undefined; await otherContext.close();
  await api('/documents/' + shared.id, actor, 'PATCH', { base_revision: privateChange.revision, visibility: 'shared' });
  await page.reload({ waitUntil: 'networkidle' }); await openVehicles();
  await page.getByRole('button', { name: 'ثبت خودروی جدید', exact: true }).click();
  await page.getByLabel('نام خودرو', { exact: true }).fill(marker + '-unsaved'); await context.setOffline(true);
  await page.locator('.modal-overlay').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.vehicle-row').count(), 0, 'Offline vehicles retained');
  await context.setOffline(false); await openVehicles(); await page.getByRole('button', { name: 'ثبت خودروی جدید', exact: true }).click();
  assert.equal(await page.getByLabel('نام خودرو', { exact: true }).inputValue(), '', 'Offline draft retained');
  await page.getByRole('button', { name: 'انصراف', exact: true }).click();
  await openDetail(marker); assert.equal(await page.locator('.vehicle-history li').count(), 1);
  await api('/transactions/' + expense.id, actor, 'DELETE');
  records = await api(`/vehicles/${vehicle.id}/services`, actor);
  assert.equal(records[0].transaction_id, null); assert.equal(records[0].cost_status, 'unavailable');
  await page.getByRole('button', { name: 'بستن جزئیات', exact: true }).click();
  // Keep a second service expense to prove that vehicle deletion preserves Finance data.
  saved = (await api('/vehicles', actor)).vehicles.find(row => row.id === vehicle.id);
  const second = await api(`/vehicles/${vehicle.id}/services`, actor, 'POST', {
    operation_id: crypto.randomUUID(), base_revision: saved.revision, performed_on: todayIso,
    performed_odometer: 1200, description: marker + '-second', cost_amount: 70000,
  }); txIds.push(second.record.transaction_id);
  await page.reload({ waitUntil: 'networkidle' }); await openVehicles();
  await page.getByRole('button', { name: 'حذف ' + marker, exact: true }).click();
  await page.getByRole('button', { name: 'حذف خودرو و سابقه', exact: true }).click();
  await page.getByRole('button', { name: 'جزئیات ' + marker, exact: true }).waitFor({ state: 'hidden' });
  assert.ok((await api('/transactions', actor)).some(tx => tx.id === second.record.transaction_id), 'Vehicle deletion removed expense');
  assert.ok((await api('/documents', actor)).some(doc => doc.id === shared.id));
  assert.ok((await api('/tasks', actor)).some(row => row.id === task.id));
  console.log('PASS: vehicles mobile CRUD, Jalali dates, authorized documents, date/km reminders and exact navigation, atomic service + Finance expense, lost-response retry, live Finance amount, permissions, deletion preservation and offline clearing.');
} catch (error) {
  if (page) await page.screenshot({ path: '.local-test/vehicles-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  releaseDeniedReloads?.(); releaseFinanceRead?.(); if (browser) await browser.close();
  if (actor) {
    const vehicles = (await api('/vehicles', actor).catch(() => ({ vehicles: [] }))).vehicles;
    for (const row of vehicles.filter(item => vehicleIds.includes(item.id))) await api(`/vehicles/${row.id}?base_revision=${row.revision}`, actor, 'DELETE').catch(() => {});
    for (const id of txIds) await api('/transactions/' + id, actor, 'DELETE', undefined, [204, 404]).catch(() => {});
    const documents = await api('/documents', actor).catch(() => []);
    for (const row of documents.filter(item => documentIds.includes(item.id))) await api(`/documents/${row.id}?base_revision=${row.revision}`, actor, 'DELETE').catch(() => {});
    const tasks = await api('/tasks', actor).catch(() => []);
    for (const row of tasks.filter(item => taskIds.includes(item.id))) await api(`/tasks/${row.id}?base_revision=${row.revision}`, actor, 'DELETE').catch(() => {});
    if (originalPrefs) await api('/notifications/prefs', actor, 'PATCH', {
      enabled: originalPrefs.enabled, domains: { vehicles: originalPrefs.domains?.vehicles !== false },
      lead_days: { vehicles: originalPrefs.lead_days?.vehicles ?? 7 },
    }).catch(() => {});
  }
  for (const token of tokens) await api('/auth/logout', token, 'POST').catch(() => {});
}
