import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = 'http://127.0.0.1:5700';
const marker = 'activities-e2e-' + Date.now();
const tokens = [], created = [], legacyEvents = [], introduced = [];
let browser, context, page, actor, owner, originalPrefs, releaseLate, releaseCalendar;
const parts = (date, calendar = 'gregory') => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran', calendar, numberingSystem: 'latn', year: 'numeric', month: 'numeric', day: 'numeric',
}).formatToParts(date).filter(part => ['year', 'month', 'day'].includes(part.type)).map(part => [part.type, Number(part.value)]));
const currentDay = parts(new Date());
const todayIso = [currentDay.year, String(currentDay.month).padStart(2, '0'), String(currentDay.day).padStart(2, '0')].join('-');
const fa = value => String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
async function api(path, token, method = 'GET', body, expected = [200, 201, 204]) {
  const response = await fetch(base + '/api/v1' + path, {
    method, headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(expected.includes(response.status), `${method} ${path}: ${response.status}`);
  if (path.startsWith('/activities') || path.startsWith('/events')) assert.equal(response.headers.get('cache-control'), 'no-store');
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
  const response = target.waitForResponse(item => item.url().endsWith('/auth/login'));
  await target.locator('form').filter({ has: target.getByPlaceholder('رمز عبور', { exact: true }) }).locator('button[type=submit]').click();
  tokens.push((await (await response).json()).session_token);
  await target.getByText('تفریح و برنامه‌های خانوادگی', { exact: true }).waitFor();
}
async function openActivities(target = page) {
  const deadline = Date.now() + 25000;
  while (!(await target.locator('.activities-page').isVisible())) {
    assert.ok(Date.now() < deadline, 'Activities navigation unavailable');
    await target.getByText('تفریح و برنامه‌های خانوادگی', { exact: true }).click();
    await target.waitForTimeout(250);
  }
  await target.waitForFunction(() => document.querySelector('.activities-page')?.getAttribute('aria-busy') === 'false');
}
async function idle() {
  await page.waitForFunction(() => document.querySelector('.activities-page')?.getAttribute('aria-busy') === 'false');
}
async function chooseDate(iso) {
  await page.getByRole('group', { name: 'تاریخ برنامه', exact: true }).locator('.date-field').click();
  const selected = parts(new Date(iso + 'T12:00:00Z'), 'persian');
  const current = parts(new Date(todayIso + 'T12:00:00Z'), 'persian');
  const difference = (selected.year - current.year) * 12 + selected.month - current.month;
  for (let index = 0; index < Math.abs(difference); index++) await page.getByRole('button', { name: difference > 0 ? 'ماه بعد' : 'ماه قبل', exact: true }).click();
  await page.locator('.dp-box').getByRole('button', { name: fa(selected.day), exact: true }).click();
  await page.locator('.dp-overlay').waitFor({ state: 'hidden' });
}
async function saveProgram() {
  const response = page.waitForResponse(item => item.url().includes('/api/v1/activities') && ['POST', 'PATCH'].includes(item.request().method()));
  await page.getByRole('button', { name: 'ذخیرهٔ برنامه', exact: true }).click();
  const saved = await response;
  assert.ok([200, 201].includes(saved.status()), 'Saving activity failed');
  const result = await saved.json();
  if (!created.includes(result.id)) created.push(result.id);
  await page.getByRole('button', { name: 'ذخیرهٔ برنامه', exact: true }).waitFor({ state: 'hidden' });
  await idle(); return result;
}
async function detail(title, target = page) {
  await target.getByRole('button', { name: 'جزئیات ' + title, exact: true }).click();
  await target.getByRole('heading', { name: title, exact: true }).waitFor();
}
async function screenshot(name) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page overflows');
  for (const sheet of await page.locator('.modal-sheet').all()) assert.ok(await sheet.evaluate(item => item.scrollWidth <= item.clientWidth + 1), 'Mobile sheet overflows');
  await page.screenshot({ path: '.local-test/' + name + '.png', fullPage: true });
}
async function notifications() {
  await page.reload({ waitUntil: 'networkidle' }); await page.locator('.floating-navigation').getByRole('button', { name: 'اعلان‌ها', exact: true }).click();
  await page.getByRole('heading', { name: 'اعلان‌ها', exact: true }).waitFor();
  await page.waitForTimeout(300);
}
const write = (row, patch = {}) => ({
  title: row.title, note: row.note, date: row.date, location: row.location, status: row.status,
  participant_ids: row.participant_ids, reminder_enabled: row.reminder_enabled, ...patch,
});
try {
  await mkdir('.local-test', { recursive: true });
  actor = await loginApi('09000000002');
  const other = await loginApi('09000000003');
  owner = await loginApi('09000000001');
  const admin = await loginApi('09000000004');
  const actorInfo = (await api('/auth/session', actor)).member;
  const otherInfo = (await api('/auth/session', other)).member;
  originalPrefs = await api('/notifications/prefs', actor);
  await api('/notifications/prefs', actor, 'PATCH', {
    enabled: true, domains: { activities: true, event: true }, lead_days: { activities: 7, event: 7 },
  });
  const beforeFinance = await api('/transactions', actor), beforeCalendar = await api('/events', actor);
  const oldEvent = await api('/events', actor, 'POST', { title: marker + '-legacy', date: todayIso });
  legacyEvents.push(oldEvent.id);
  const child = await api('/auth/members', owner, 'POST', {
    name: marker + '-child', phone: '091' + String(Date.now()).slice(-8), relation: 'فرزند',
  });
  introduced.push(child.id);
  assert.equal(child.status, 'pending'); assert.equal(child.membership_state, 'active');
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  page = await context.newPage(); await loginUi(page, '09000000002'); await openActivities();
  await page.getByRole('button', { name: 'ثبت برنامهٔ جدید', exact: true }).click();
  await page.getByRole('textbox', { name: 'عنوان برنامه', exact: true }).fill(marker);
  await page.getByRole('textbox', { name: 'توضیح', exact: true }).fill('برنامهٔ خانوادگی\nخط دوم توضیح');
  await page.getByRole('textbox', { name: 'مکان', exact: true }).fill('پارک آزمایشی');
  await chooseDate(todayIso);
  await page.getByRole('group', { name: 'شرکت‌کنندگان', exact: true }).getByRole('checkbox', { name: otherInfo.name, exact: true }).check();
  await page.getByRole('group', { name: 'شرکت‌کنندگان', exact: true }).getByRole('checkbox', { name: child.name, exact: true }).check();
  await screenshot('activities-create-mobile');
  let activity = await saveProgram();
  assert.equal(activity.created_by, actorInfo.id); assert.equal(activity.date, todayIso);
  assert.equal(activity.status, 'planned'); assert.equal(activity.location, 'پارک آزمایشی');
  assert.deepEqual(new Set(activity.participant_ids), new Set([otherInfo.id, child.id]));
  const calendarRow = (await api('/events', actor)).find(row => row.id === activity.id);
  assert.ok(calendarRow); assert.equal(calendarRow.kind, 'activity'); assert.equal(calendarRow.date, activity.date);
  await api('/events/' + activity.id, actor, 'DELETE', undefined, [403, 409]);
  assert.equal((await api('/activities/' + activity.id, actor)).id, activity.id);
  assert.equal((await api('/activities/' + activity.id, other)).can_edit, false);
  await api('/activities/' + activity.id, other, 'PATCH', { ...write(activity), base_revision: activity.revision }, [403, 404]);
  await api(`/activities/${activity.id}?base_revision=${activity.revision}`, other, 'DELETE', undefined, [403, 404]);
  for (const token of [owner, admin]) assert.equal((await api('/activities/' + activity.id, token)).can_edit, true);

  await notifications();
  const reminder = page.locator('.notif-item').filter({ hasText: marker }).filter({ hasNotText: marker + '-legacy' });
  await reminder.waitFor(); assert.equal(await reminder.count(), 1, 'Activity duplicated as an old event reminder');
  assert.equal(await reminder.getByRole('button', { name: /نادیده/ }).count(), 0);
  await reminder.click(); await page.getByRole('heading', { name: marker, exact: true }).waitFor();
  await screenshot('activities-reminder-detail-mobile');
  await page.getByRole('button', { name: 'ویرایش برنامه', exact: true }).click();
  await page.getByRole('textbox', { name: 'عنوان برنامه', exact: true }).fill(marker + '-edited');
  activity = await saveProgram(); assert.equal(activity.id, calendarRow.id);
  await api('/activities/' + activity.id, actor, 'PATCH', {
    ...write(activity, { title: marker + '-stale' }), base_revision: calendarRow.revision,
  }, [409]);
  assert.equal((await api('/activities/' + activity.id, actor)).title, marker + '-edited');
  await page.getByRole('button', { name: 'ثبت انجام‌شدن', exact: true }).click(); await idle();
  assert.equal((await api('/activities/' + activity.id, actor)).status, 'done');
  await notifications(); assert.equal(await page.locator('.notif-item').filter({ hasText: marker + '-edited' }).count(), 0);
  await page.reload({ waitUntil: 'networkidle' }); await openActivities();
  await page.getByRole('group', { name: 'فیلتر وضعیت', exact: true }).getByRole('button', { name: 'برنامه‌ریزی‌شده', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'جزئیات ' + marker + '-edited', exact: true }).count(), 0);
  await page.getByRole('group', { name: 'فیلتر وضعیت', exact: true }).getByRole('button', { name: 'انجام‌شده', exact: true }).click();
  await detail(marker + '-edited');
  await page.getByRole('button', { name: 'برنامه‌ریزی دوباره', exact: true }).click(); await idle();
  await page.getByRole('button', { name: 'لغو برنامه', exact: true }).click(); await idle();
  assert.equal((await api('/activities/' + activity.id, actor)).status, 'cancelled');
  await page.getByRole('button', { name: 'برنامه‌ریزی دوباره', exact: true }).click(); await idle();
  assert.equal((await api('/activities/' + activity.id, actor)).status, 'planned');
  await page.getByRole('button', { name: 'ویرایش برنامه', exact: true }).click();
  await page.getByRole('checkbox', { name: 'یادآور این برنامه', exact: true }).uncheck();
  activity = await saveProgram(); assert.equal(activity.reminder_enabled, false);
  await notifications(); assert.equal(await page.locator('.notif-item').filter({ hasText: marker + '-edited' }).count(), 0);
  await page.reload({ waitUntil: 'networkidle' }); await openActivities(); await detail(marker + '-edited');
  await page.getByRole('button', { name: 'ویرایش برنامه', exact: true }).click();
  await page.getByRole('checkbox', { name: 'یادآور این برنامه', exact: true }).check();
  activity = await saveProgram(); assert.equal(activity.reminder_enabled, true);
  await page.getByRole('button', { name: 'حذف برنامه', exact: true }).click();
  await page.getByRole('button', { name: 'انصراف', exact: true }).click();
  assert.equal((await api('/activities/' + activity.id, actor)).id, activity.id);
  await page.getByRole('button', { name: 'بستن جزئیات', exact: true }).click();

  // Calendar opens the same record through a fresh authorized activity GET.
  await page.reload({ waitUntil: 'networkidle' }); await page.getByText('تقویم و مناسبت‌ها', { exact: true }).click();
  const calendarGet = page.waitForResponse(item => item.url().endsWith('/activities/' + activity.id) && item.request().method() === 'GET');
  await page.getByRole('button', { name: 'جزئیات برنامه ' + marker + '-edited', exact: true }).first().click();
  const fromCalendar = await (await calendarGet).json(); assert.equal(fromCalendar.id, activity.id); assert.equal(fromCalendar.date, todayIso);
  await page.getByRole('heading', { name: marker + '-edited', exact: true }).waitFor();
  await screenshot('activities-calendar-detail-mobile');
  await page.getByRole('button', { name: 'بستن جزئیات', exact: true }).click();

  const memberContext = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  const memberPage = await memberContext.newPage(); await loginUi(memberPage, '09000000003'); await openActivities(memberPage); await detail(marker + '-edited', memberPage);
  assert.equal(await memberPage.getByRole('button', { name: 'ویرایش برنامه', exact: true }).count(), 0);
  assert.equal(await memberPage.getByRole('button', { name: 'حذف برنامه', exact: true }).count(), 0);
  await memberContext.close();

  // A response from before a raw offline/online cycle must never restore data.
  let held = false;
  const gate = new Promise(resolve => { releaseLate = resolve; });
  const detailPath = '**/api/v1/activities/' + activity.id;
  await context.route(detailPath, async route => {
    if (route.request().method() !== 'GET' || held) return route.continue();
    held = true; const response = await route.fetch(); const body = await response.json();
    await gate;
    await route.fulfill({ response, json: { ...body, title: marker + '-late-response' } }).catch(() => {});
  });
  await page.getByRole('button', { name: 'جزئیات ' + marker + '-edited', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.activities-page')?.getAttribute('aria-busy') === 'true');
  await context.setOffline(true); await page.getByText('تفریح و برنامه‌های خانوادگی', { exact: true }).waitFor();
  assert.equal(await page.locator('.activities-sheet').count(), 0);
  await context.setOffline(false); await openActivities(); releaseLate(); releaseLate = undefined;
  await page.waitForTimeout(300); assert.equal(await page.getByText(marker + '-late-response', { exact: true }).count(), 0);
  await context.unroute(detailPath);

  // A canonical calendar response started before disconnect cannot revive its payload.
  let heldCalendar = false;
  const calendarGate = new Promise(resolve => { releaseCalendar = resolve; });
  await context.route('**/api/v1/events', async route => {
    if (route.request().method() !== 'GET' || heldCalendar) return route.continue();
    heldCalendar = true; const response = await route.fetch(); const rows = await response.json();
    await calendarGate;
    await route.fulfill({ response, json: rows.map(row => row.id === activity.id
      ? { ...row, title: marker + '-late-calendar' } : row) }).catch(() => {});
  });
  await detail(marker + '-edited'); await page.getByRole('button', { name: 'ویرایش برنامه', exact: true }).click();
  await page.getByRole('textbox', { name: 'مکان', exact: true }).fill('مکان ویرایش‌شده');
  activity = await saveProgram();
  const heldDeadline = Date.now() + 15000;
  while (!heldCalendar) { assert.ok(Date.now() < heldDeadline, 'Activity edit did not refresh calendar'); await page.waitForTimeout(50); }
  await context.setOffline(true); await page.getByText('تفریح و برنامه‌های خانوادگی', { exact: true }).waitFor();
  await context.setOffline(false);
  await page.getByText('تقویم و مناسبت‌ها', { exact: true }).click();
  await page.getByRole('button', { name: 'جزئیات برنامه ' + marker + '-edited', exact: true }).first().waitFor();
  releaseCalendar(); releaseCalendar = undefined; await page.waitForTimeout(300);
  assert.equal(await page.getByRole('button', { name: 'جزئیات برنامه ' + marker + '-late-calendar', exact: true }).count(), 0,
    'Pre-offline events response revived an activity in Calendar');
  assert.ok(!(await page.locator('body').innerText()).includes(marker + '-late-calendar'));
  await context.unroute('**/api/v1/events');
  await page.getByRole('button', { name: 'جزئیات برنامه ' + marker + '-edited', exact: true }).first().click();
  await page.getByRole('heading', { name: marker + '-edited', exact: true }).waitFor();
  await page.getByRole('button', { name: 'بستن جزئیات', exact: true }).click();
  await detail(marker + '-edited'); await page.getByRole('button', { name: 'ویرایش برنامه', exact: true }).click();
  await page.getByRole('textbox', { name: 'عنوان برنامه', exact: true }).fill(marker + '-unsaved');
  await context.setOffline(true); await page.getByText('تفریح و برنامه‌های خانوادگی', { exact: true }).waitFor();
  assert.equal(await page.locator('.activities-sheet').count(), 0);
  assert.ok(!(await page.locator('body').innerText()).includes(marker + '-unsaved'));
  await context.setOffline(false); await openActivities();
  await page.getByRole('button', { name: 'ثبت برنامهٔ جدید', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'عنوان برنامه', exact: true }).inputValue(), '');
  await page.getByRole('button', { name: 'انصراف', exact: true }).click();

  // Denied reloads remove both page and notification snapshots.
  await context.route('**/api/v1/activities', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 403, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'FORBIDDEN', message: 'دسترسی لغو شده است.' }) })
    : route.continue());
  await notifications(); assert.equal(await page.locator('.notif-item').filter({ hasText: marker + '-edited' }).count(), 0);
  await page.reload({ waitUntil: 'networkidle' }); await openActivities();
  await page.locator('.activities-page [role=alert]').waitFor();
  assert.equal(await page.getByRole('button', { name: 'ثبت برنامهٔ جدید', exact: true }).isEnabled(), false);
  assert.equal(await page.getByRole('button', { name: 'جزئیات ' + marker + '-edited', exact: true }).count(), 0);
  await context.unroute('**/api/v1/activities'); await page.reload({ waitUntil: 'networkidle' }); await openActivities();
  await detail(marker + '-edited'); await page.getByRole('button', { name: 'حذف برنامه', exact: true }).click();
  await page.getByRole('button', { name: 'تأیید حذف برنامه', exact: true }).click(); await idle();
  await api('/activities/' + activity.id, actor, 'GET', undefined, [404]);
  assert.ok(!(await api('/events', actor)).some(row => row.id === activity.id));
  assert.ok((await api('/events', actor)).some(row => row.id === oldEvent.id), 'Activity deletion removed old event');
  await api('/events/' + oldEvent.id, actor, 'DELETE');
  assert.deepEqual(await api('/transactions', actor), beforeFinance, 'Activity changed Finance');
  assert.deepEqual(await api('/events', actor), beforeCalendar, 'Existing events changed');
  await screenshot('activities-list-mobile');
  console.log('PASS: Activities mobile CRUD, Jalali date, introduced child/participants, completion/cancellation/replanning, canonical calendar same ID/date and fresh detail, one reminder, participant edit denial, offline form erasure, late activity/calendar response rejection, revoked snapshot erasure, deletion, and Finance/old-event preservation.');
} catch (error) {
  if (page) await page.screenshot({ path: '.local-test/activities-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  releaseLate?.(); releaseCalendar?.(); if (browser) await browser.close();
  for (const id of created) {
    const row = await api('/activities/' + id, actor, 'GET', undefined, [200, 404]).catch(() => null);
    if (row?.revision) await api(`/activities/${id}?base_revision=${row.revision}`, actor, 'DELETE').catch(() => {});
  }
  for (const id of legacyEvents) await api('/events/' + id, actor, 'DELETE', undefined, [204, 404]).catch(() => {});
  for (const id of introduced) await api('/auth/members/' + id, owner, 'DELETE', undefined, [200, 404]).catch(() => {});
  if (actor && originalPrefs) await api('/notifications/prefs', actor, 'PATCH', {
    enabled: originalPrefs.enabled,
    domains: { activities: originalPrefs.domains?.activities !== false, event: originalPrefs.domains?.event !== false },
    lead_days: { activities: originalPrefs.lead_days?.activities ?? 7, event: originalPrefs.lead_days?.event ?? 7 },
  }).catch(() => {});
  for (const token of tokens) await api('/auth/logout', token, 'POST').catch(() => {});
}
