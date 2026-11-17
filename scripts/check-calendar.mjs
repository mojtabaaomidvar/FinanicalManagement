import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { backupHomePreferences } from './sandbox-home-preferences.mjs';

// The real API probe is confined to the isolated local sandbox and its own fixtures.
const base = 'http://127.0.0.1:5700';
const marker = 'calendar-e2e-' + Date.now();
const tokens = [], records = [], savedPrefs = [], checks = [], pageErrors = [], cleanupErrors = [];
let browser, ownerContext, memberContext, ownerPage, memberPage, owner, member, releaseSummary, releaseFresh, homePrefsBackup;
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran', calendar: 'gregory', numberingSystem: 'latn',
  year: 'numeric', month: 'numeric', day: 'numeric',
}).formatToParts(new Date()).filter(part => ['year', 'month', 'day'].includes(part.type))
  .map(part => [part.type, Number(part.value)]));
const todayIso = [parts.year, String(parts.month).padStart(2, '0'), String(parts.day).padStart(2, '0')].join('-');
const day = offset => new Date(Date.parse(todayIso + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
const focusDay = day(2);
const rows = (result, kind) => Array.isArray(result) ? result : result[kind];
const row = (page, id, list = 'day') => page.locator('[data-calendar-list="' + list + '"] [data-calendar-ref-id="' + id + '"]');

async function api(path, token, method = 'GET', body, expected = [200, 201, 204]) {
  const response = await fetch(base + '/api/v1' + path, {
    method, headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(expected.includes(response.status), `${method} ${path}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function loginApi(phone) {
  const account = await api('/auth/login', null, 'POST', { phone, password: 'Test12345!' });
  tokens.push(account.session_token);
  return { token: account.session_token, id: account.member.id };
}
async function create(kind, body, account = owner) {
  const created = await api('/' + kind, account.token, 'POST', body);
  records.push({ kind, id: created.id, token: account.token });
  return created;
}
async function disableReminders(account) {
  const original = await api('/notifications/prefs', account.token);
  savedPrefs.push({ token: account.token, original });
  await api('/notifications/prefs', account.token, 'PATCH', { enabled: false });
}
async function poll(check, message, page = ownerPage) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await page.waitForTimeout(120);
  }
  throw new Error(message);
}
async function loginUi(page, phone) {
  await page.goto(base, { waitUntil: 'networkidle' });
  if (!(await page.getByPlaceholder('شماره موبایل', { exact: true }).count())) {
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
  }
  await page.getByPlaceholder('شماره موبایل', { exact: true }).first().fill(phone);
  await page.getByPlaceholder('رمز عبور', { exact: true }).fill('Test12345!');
  const response = page.waitForResponse(result => result.url().endsWith('/auth/login'));
  await page.locator('form').filter({ has: page.getByPlaceholder('رمز عبور', { exact: true }) })
    .locator('button[type=submit]').click();
  tokens.push((await (await response).json()).session_token);
  await page.locator('.hub-overview').waitFor();
}
async function openCalendar(page = ownerPage, wait = true) {
  if (!(await page.locator('.household-calendar').count())) {
    await page.locator('.hub-overview').waitFor();
    const tile = page.locator('[data-home-module="calendar"]');
    if (!(await tile.isVisible())) await tile.locator('xpath=ancestor::details').locator('summary').click();
    await tile.click();
  }
  await page.locator('.household-calendar').waitFor();
  if (wait) await poll(async () => (await page.locator('.household-calendar').getAttribute('aria-busy')) !== 'true',
    'Calendar did not finish loading', page);
}
async function selectDay(iso, page = ownerPage) {
  let target = page.locator('[data-calendar-date="' + iso + '"]');
  for (let attempts = 0; !(await target.count()) && attempts < 4; attempts += 1) {
    const current = await page.locator('[data-calendar-date]').first().getAttribute('data-calendar-date');
    await page.getByRole('button', { name: iso < current ? 'ماه قبل' : 'ماه بعد', exact: true }).click();
    target = page.locator('[data-calendar-date="' + iso + '"]');
  }
  await target.click();
}
async function expandUpcoming(page = ownerPage) {
  const expand = page.locator('[data-calendar-list="upcoming"]').getByRole('button', { name: /^نمایش همه/ });
  if (await expand.count() && await expand.isVisible()) await expand.click();
}
async function calendar(page = ownerPage, selected = focusDay) {
  await page.reload({ waitUntil: 'networkidle' });
  await openCalendar(page);
  await selectDay(selected, page);
  await expandUpcoming(page);
}
async function screenshot(name, page = ownerPage) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(100);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  if (!fits) await writeFile('.local-test/calendar-overflow.json', JSON.stringify(await page.evaluate(() =>
    [...document.querySelectorAll('body *')].map(element => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName, class: element.className, left: rect.left, right: rect.right, width: rect.width };
    }).filter(value => value.width > 0 && (value.left < -1 || value.right > innerWidth + 1)).slice(0, 40)), null, 2));
  assert.ok(fits, 'Calendar overflows at 360px');
  for (const sheet of await page.locator('.modal-sheet').all()) {
    assert.ok(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Detail sheet overflows');
  }
  await page.screenshot({ path: '.local-test/' + name + '.png', fullPage: true });
}
async function openExact(entity) {
  await calendar();
  await row(ownerPage, entity.id).first().locator('.calendar-entry-main').click();
  await ownerPage.getByRole('heading', { name: entity.title, exact: true }).waitFor();
  await screenshot('calendar-target-' + entity.id);
}
async function current(kind, entity) {
  return rows(await api('/' + kind, owner.token), kind).find(value => value.id === entity.id);
}

try {
  homePrefsBackup = await backupHomePreferences('calendar');
  await mkdir('.local-test', { recursive: true });
  owner = await loginApi('09000000001'); member = await loginApi('09000000002');
  await disableReminders(owner); await disableReminders(member);
  const task = await create('tasks', { title: marker + '-task', description: marker + '-task-description',
    assignee_id: member.id, due_date: focusDay });
  const undatedTask = await create('tasks', { title: marker + '-undated-task', due_date: null });
  const event = await create('events', { title: marker + '-event', date: focusDay });
  const activity = await create('activities', { title: marker + '-activity', note: marker + '-activity-note', date: focusDay,
    participant_ids: [owner.id, member.id], reminder_enabled: false });
  const bill = await create('bills', { title: marker + '-bill', kind: 'internet', amount: 1234, due_date: focusDay });
  const equipment = await create('equipment', { title: (marker + '-وسیلهٔ بلند ' + 'خانه '.repeat(17)).slice(0, 120),
    service_due_date: focusDay, warranty_until: focusDay, service_reminder_enabled: false });
  const vehicle = await create('vehicles', { title: marker + '-vehicle', odometer: 1000,
    service_due_date: focusDay, insurance_until: focusDay, inspection_until: focusDay, service_reminder_enabled: false });
  const mileageOnly = await create('vehicles', { title: marker + '-mileage-only', odometer: 1001,
    service_due_odometer: 1000, service_due_date: null, service_reminder_enabled: false });
  const lastUpcoming = await create('tasks', { title: marker + '-30day', due_date: day(30) });
  const outsideUpcoming = await create('tasks', { title: marker + '-31day', due_date: day(31) });
  const privateGoal = await create('goals', { title: marker + '-private-goal', target_date: focusDay, reminder_enabled: false });

  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  ownerContext = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  ownerPage = await ownerContext.newPage(); ownerPage.on('pageerror', error => pageErrors.push(error.message));
  await loginUi(ownerPage, '09000000001');
  await openCalendar(); await selectDay(focusDay); await expandUpcoming();
  for (const entity of [task, event, activity, bill, equipment, vehicle]) {
    await poll(async () => await row(ownerPage, entity.id).count() > 0, 'Fixture missing from selected calendar day');
  }
  assert.equal(await row(ownerPage, activity.id).count(), 1, 'Activity and calendar source appear twice');
  assert.ok((await row(ownerPage, activity.id).innerText()).includes(activity.note), 'Existing authorized activity note disappeared');
  assert.equal(await ownerPage.locator('.household-calendar').getByText(task.description, { exact: true }).count(), 0,
    'Task description was copied into the calendar deadline projection');
  assert.equal(await row(ownerPage, equipment.id).count(), 2, 'Equipment service and warranty should remain distinct');
  assert.equal(await row(ownerPage, vehicle.id).count(), 3, 'Vehicle service, insurance and inspection should remain distinct');
  assert.ok(await row(ownerPage, equipment.id).filter({ hasText: 'سرویس' }).count(), 'Service source label missing');
  assert.ok(await row(ownerPage, equipment.id).filter({ hasText: 'گارانتی' }).count(), 'Warranty source label missing');
  const selectedEntries = await ownerPage.locator('[data-calendar-list="day"] [data-calendar-entry-id]').count();
  const count = Number(await ownerPage.locator('[data-calendar-date="' + focusDay + '"]').getAttribute('data-calendar-count'));
  assert.equal(count, selectedEntries, 'Month marker count does not match the selected-day list');
  assert.ok(count >= 9, 'Some canonical deadlines are missing from the monthly calendar count');
  assert.equal(await row(ownerPage, undatedTask.id, 'upcoming').count(), 0, 'Undated task was assigned a fake calendar day');
  assert.equal(await row(ownerPage, mileageOnly.id, 'upcoming').count(), 0, 'Mileage-only service was assigned a fake calendar day');
  assert.equal(await ownerPage.locator('.household-calendar').getByText(privateGoal.title, { exact: true }).count(), 0,
    'Private goal was added to the shared calendar');
  assert.equal(await row(ownerPage, lastUpcoming.id, 'upcoming').count(), 1, '30-day boundary missing');
  assert.equal(await row(ownerPage, outsideUpcoming.id, 'upcoming').count(), 0, '31-day entry escaped the 30-day horizon');
  checks.push('all canonical sources, same-day month count, single activity, multiple reason labels, 30/31-day boundary and no invented dates');

  // Preserve the existing ordinary-event editing flow alongside the new deadline rows.
  await ownerPage.getByRole('button', { name: '+ افزودن', exact: true }).click();
  await ownerPage.getByRole('heading', { name: 'رویداد جدید', exact: true }).waitFor();
  await ownerPage.locator('.modal-sheet').getByRole('textbox').first().fill(marker + '-ui-event');
  const addedResponse = ownerPage.waitForResponse(response => response.url().endsWith('/api/v1/events')
    && response.request().method() === 'POST');
  await ownerPage.locator('.modal-sheet').getByRole('button', { name: 'ثبت', exact: true }).click();
  const addedEvent = await (await addedResponse).json();
  records.push({ kind: 'events', id: addedEvent.id, token: owner.token });
  await poll(async () => await row(ownerPage, addedEvent.id).count() === 1, 'New event did not appear on its selected calendar day');
  ownerPage.once('dialog', dialog => { void dialog.accept(); });
  await row(ownerPage, addedEvent.id).getByRole('button', { name: /^حذف رویداد/ }).click();
  await poll(async () => await row(ownerPage, addedEvent.id).count() === 0, 'Ordinary event could not be deleted from the calendar');
  await poll(async () => (await ownerPage.locator('.household-calendar').getAttribute('aria-busy')) !== 'true',
    'Calendar did not finish refreshing after the event deletion');
  checks.push('existing event form creates and deletes one canonical record on the selected Jalali day');

  await screenshot('calendar-mobile-light');
  await ownerPage.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await screenshot('calendar-mobile-dark');
  await ownerPage.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  for (const entity of [equipment, vehicle, activity]) await openExact(entity);
  await calendar(); await row(ownerPage, task.id).locator('.calendar-entry-main').click();
  await ownerPage.getByRole('heading', { name: 'کارهای خانه', exact: true }).waitFor();
  await ownerPage.getByText(task.title, { exact: true }).first().waitFor();
  await calendar(); await row(ownerPage, bill.id).locator('.calendar-entry-main').click();
  await ownerPage.getByRole('heading', { name: 'قبوض و شارژ', exact: true }).waitFor();
  await ownerPage.getByText(bill.title, { exact: true }).first().waitFor();
  checks.push('360px long-title light/dark layout and exact equipment, vehicle, activity, task and bill destinations');

  const taskBefore = await current('tasks', task);
  await api('/tasks/' + task.id + '/complete', owner.token, 'POST', { completed: true, base_revision: taskBefore.revision });
  await api('/bills/' + bill.id + '/pay', owner.token, 'POST', { date: todayIso });
  const activityBefore = await current('activities', activity);
  await api('/activities/' + activity.id, owner.token, 'PATCH', { title: activityBefore.title, note: activityBefore.note,
    date: activityBefore.date, location: activityBefore.location, status: 'done', participant_ids: activityBefore.participant_ids,
    reminder_enabled: activityBefore.reminder_enabled, base_revision: activityBefore.revision });
  const equipmentBefore = await current('equipment', equipment);
  await api('/equipment/' + equipment.id + '/services', owner.token, 'POST', { operation_id: randomUUID(),
    base_revision: equipmentBefore.revision, performed_on: todayIso, description: marker + '-service', next_due_date: day(5) });
  await calendar();
  for (const entity of [task, bill]) assert.equal(await row(ownerPage, entity.id).count(), 0,
    'Completed or paid deadline stayed on its old calendar day');
  assert.equal(await row(ownerPage, activity.id).count(), 1, 'Existing activity calendar history was removed or duplicated');
  assert.ok((await row(ownerPage, activity.id).innerText()).includes('انجام‌شده'), 'Finished activity has no historical status label');
  assert.equal(await row(ownerPage, equipment.id).count(), 1, 'Old service deadline stayed after completed service');
  assert.ok(await row(ownerPage, equipment.id).first().innerText().then(value => value.includes('گارانتی')),
    'Independent warranty deadline was removed by service completion');
  await selectDay(day(5));
  assert.equal(await row(ownerPage, equipment.id).count(), 1, 'New service deadline did not move to its canonical date');
  checks.push('task completion, bill payment and completed service update deadlines while completed activity history remains labeled');

  // Verify truthful partial loading through the real repository path.
  let requested = false;
  const delayed = new Promise(resolve => { releaseSummary = resolve; });
  const failEquipment = async route => {
    requested = true; await delayed;
    await route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ detail: 'Local calendar probe unavailable' }) });
  };
  await ownerPage.route('**/api/v1/equipment', failEquipment);
  await ownerPage.reload({ waitUntil: 'domcontentloaded' });
  await openCalendar(ownerPage, false);
  await poll(async () => requested, 'Delayed equipment request did not start');
  assert.equal(await ownerPage.locator('.household-calendar').getAttribute('aria-busy'), 'true', 'Calendar loading state missing');
  await screenshot('calendar-mobile-loading');
  releaseSummary(); releaseSummary = null;
  await poll(async () => (await ownerPage.locator('.household-calendar').getAttribute('aria-busy')) !== 'true', 'Calendar loading did not settle');
  await ownerPage.getByText(/بخشی از اطلاعات دریافت نشد/).waitFor();
  assert.equal(await ownerPage.locator('.household-calendar [data-calendar-ref-id="' + equipment.id + '"]').count(), 0,
    'Failed source retained its old calendar rows');
  await screenshot('calendar-mobile-partial-error');
  await ownerPage.unroute('**/api/v1/equipment', failEquipment);
  await ownerPage.getByRole('button', { name: 'بازخوانی تقویم', exact: true }).click();
  await poll(async () => (await ownerPage.locator('.household-calendar').getAttribute('aria-busy')) !== 'true'
    && !(await ownerPage.getByText(/بخشی از اطلاعات دریافت نشد/).count()), 'Retry did not recover calendar source');
  await selectDay(focusDay);
  assert.equal(await row(ownerPage, equipment.id).count(), 1, 'Recovered warranty deadline did not return');
  checks.push('delayed loading, cleared failed-source rows and successful retry with truthful partial state');

  let generation = 0;
  const oldSummary = new Promise(resolve => { releaseSummary = resolve; });
  const freshSummary = new Promise(resolve => { releaseFresh = resolve; });
  const equipmentBody = await api('/equipment', owner.token);
  const delayedValidEquipment = async route => {
    const requestGeneration = ++generation;
    await (requestGeneration === 1 ? oldSummary : freshSummary);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(equipmentBody) }).catch(() => {});
  };
  await ownerPage.route('**/api/v1/equipment', delayedValidEquipment);
  await ownerPage.reload({ waitUntil: 'domcontentloaded' });
  await openCalendar(ownerPage, false);
  await poll(async () => generation >= 1, 'Old summary request did not start');
  await ownerContext.setOffline(true);
  await poll(async () => !(await ownerPage.locator('.household-calendar').count()), 'Calendar stayed open after disconnect');
  await ownerContext.setOffline(false);
  await poll(async () => generation >= 2, 'Reconnection did not request a fresh summary');
  releaseSummary(); releaseSummary = null;
  await ownerPage.waitForTimeout(200);
  await openCalendar(ownerPage, false); await selectDay(focusDay);
  assert.equal(await row(ownerPage, equipment.id).count(), 0, 'Old valid response restored pre-disconnect calendar rows');
  assert.equal(await ownerPage.locator('.household-calendar').getAttribute('aria-busy'), 'true', 'Fresh summary loading state was lost');
  await screenshot('calendar-mobile-late-response');
  releaseFresh(); releaseFresh = null;
  await poll(async () => await row(ownerPage, equipment.id).count() === 1, 'Fresh authorized deadline did not return');
  await ownerPage.unroute('**/api/v1/equipment', delayedValidEquipment);
  checks.push('pre-disconnect valid response cannot restore calendar rows while fresh connection data is pending');

  memberContext = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  memberPage = await memberContext.newPage(); memberPage.on('pageerror', error => pageErrors.push(error.message));
  await loginUi(memberPage, '09000000002'); await openCalendar(memberPage); await selectDay(focusDay, memberPage);
  assert.equal(await row(memberPage, equipment.id).count(), 1, 'Family member cannot view the shared calendar deadline');
  await memberPage.getByRole('button', { name: '+ افزودن', exact: true }).click();
  await memberPage.getByRole('heading', { name: 'رویداد جدید', exact: true }).waitFor();
  await memberContext.setOffline(true);
  await poll(async () => !(await memberPage.locator('.household-calendar').count())
    && !(await memberPage.getByRole('heading', { name: 'رویداد جدید', exact: true }).count()), 'Offline calendar or draft was not cleared', memberPage);
  assert.equal(await memberPage.getByText(equipment.title, { exact: true }).count(), 0, 'Online calendar deadline remained in Home offline');
  await screenshot('calendar-mobile-offline', memberPage);
  await memberContext.setOffline(false);
  await poll(async () => await memberPage.locator('.hub-overview').count() > 0, 'Home did not remain accessible after reconnect', memberPage);
  await openCalendar(memberPage); await selectDay(focusDay, memberPage);
  await poll(async () => await row(memberPage, equipment.id).count() === 1, 'Authorized shared calendar deadline did not return', memberPage);
  checks.push('family-member shared deadlines and online-only calendar/form clearing on disconnect with recovery');
  assert.deepEqual(pageErrors, [], 'Calendar or target page raised a browser error');
  console.log('Unified calendar browser checks passed: ' + checks.length + ' groups.');
} catch (error) {
  if (ownerPage) {
    await ownerPage.screenshot({ path: '.local-test/calendar-failure.png', fullPage: true }).catch(() => {});
    await writeFile('.local-test/calendar-failure.txt', await ownerPage.locator('body').innerText()).catch(() => {});
  }
  throw error;
} finally {
  releaseSummary?.(); releaseFresh?.();
  await memberContext?.setOffline(false).catch(() => {});
  await ownerContext?.setOffline(false).catch(() => {});
  await browser?.close();
  try { await homePrefsBackup?.restore(); } catch { cleanupErrors.push('Could not restore original Home preferences'); }
  for (const record of records.slice().reverse()) {
    try {
      let item = rows(await api('/' + record.kind, record.token), record.kind).find(value => value.id === record.id);
      if (!item) continue;
      if (record.kind === 'bills' && item.state === 'paid') item = await api('/bills/' + item.id + '/unpay', record.token, 'POST');
      const query = ['tasks', 'equipment', 'vehicles', 'goals', 'activities'].includes(record.kind)
        ? '?base_revision=' + item.revision : '';
      await api('/' + record.kind + '/' + item.id + query, record.token, 'DELETE');
    } catch { cleanupErrors.push('Could not remove own ' + record.kind + ' fixture'); }
  }
  for (const { token, original } of savedPrefs) {
    try { await api('/notifications/prefs', token, 'PATCH', { enabled: original.enabled, domains: original.domains, lead_days: original.lead_days }); }
    catch { cleanupErrors.push('Could not restore test notification preferences'); }
  }
  for (const token of tokens) {
    try { await api('/auth/logout', token, 'POST'); }
    catch { cleanupErrors.push('Could not close test session'); }
  }
  await writeFile('.local-test/calendar-check-result.json', JSON.stringify({ todayIso, focusDay, checks, pageErrors, cleanupErrors }, null, 2));
  assert.deepEqual(cleanupErrors, [], 'Probe cleanup must succeed');
}
