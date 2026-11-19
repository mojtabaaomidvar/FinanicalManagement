import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = 'http://127.0.0.1:5700';
const marker = 'children-e2e-' + Date.now();
const tokens = [], children = [], activities = [], tasks = [], events = [];
let browser, context, page, owner, member, originalPrefs, releaseLate;
const parts = (date, calendar = 'gregory') => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran', calendar, numberingSystem: 'latn', year: 'numeric', month: 'numeric', day: 'numeric',
}).formatToParts(date).filter(part => ['year', 'month', 'day'].includes(part.type)).map(part => [part.type, Number(part.value)]));
const currentDay = parts(new Date());
const todayIso = [currentDay.year, String(currentDay.month).padStart(2, '0'), String(currentDay.day).padStart(2, '0')].join('-');
function birthTenJalaliYearsAgo(dayIso = todayIso) {
  const desired = parts(new Date(dayIso + 'T12:00:00Z'), 'persian');
  const targetYear = desired.year - 10;
  const beginning = Date.UTC(targetYear + 620, 0, 1);
  for (const targetDay of desired.month === 12 && desired.day === 30 ? [30, 29] : [desired.day]) {
    for (let index = 0; index < 740; index++) {
      const day = new Date(beginning + index * 86400000);
      const selected = parts(day, 'persian');
      if (selected.year === targetYear && selected.month === desired.month && selected.day === targetDay) return day.toISOString().slice(0, 10);
    }
  }
  throw new Error('Could not derive ten-year-old Jalali birthday fixture');
}
const olderBirth = birthTenJalaliYearsAgo();
async function api(path, token, method = 'GET', body, expected = [200, 201, 204]) {
  const response = await fetch(base + '/api/v1' + path, {
    method, headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(expected.includes(response.status), `${method} ${path}: ${response.status}`);
  if (path.startsWith('/children') || path.startsWith('/events')) assert.equal(response.headers.get('cache-control'), 'no-store');
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
  await target.getByText('فرزندان و برنامه‌های آن‌ها', { exact: true }).waitFor();
}
async function openChildren(target = page) {
  const deadline = Date.now() + 25000;
  while (!(await target.locator('.children-page').isVisible())) {
    assert.ok(Date.now() < deadline, 'Children navigation unavailable');
    await target.getByText('فرزندان و برنامه‌های آن‌ها', { exact: true }).click();
    await target.waitForTimeout(250);
  }
  await target.waitForFunction(() => document.querySelector('.children-page')?.getAttribute('aria-busy') === 'false');
}
async function idle(target = page) {
  await target.waitForFunction(() => document.querySelector('.children-page')?.getAttribute('aria-busy') === 'false');
}
async function detail(name, target = page) {
  await target.getByRole('button', { name: 'جزئیات ' + name, exact: true }).click();
  await target.getByRole('heading', { name, exact: true }).waitFor();
}
async function screenshot(name) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page overflows');
  for (const sheet of await page.locator('.modal-sheet').all()) assert.ok(await sheet.evaluate(item => item.scrollWidth <= item.clientWidth + 1), 'Mobile sheet overflows');
  await page.screenshot({ path: '.local-test/' + name + '.png', fullPage: !(await page.locator('.modal-sheet').count()) });
}
async function saveChild() {
  const response = page.waitForResponse(item => item.url().includes('/api/v1/children') && ['POST', 'PATCH'].includes(item.request().method()));
  await page.getByRole('button', { name: 'ذخیرهٔ مشخصات فرزند', exact: true }).click();
  const saved = await response; assert.ok([200, 201].includes(saved.status()), 'Saving child failed');
  const result = await saved.json();
  if (!children.includes(result.id)) children.push(result.id);
  await page.getByRole('button', { name: 'ذخیرهٔ مشخصات فرزند', exact: true }).waitFor({ state: 'hidden' });
  await idle(); return result;
}
async function poll(check, message) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await page.waitForTimeout(150);
  }
  throw new Error(message);
}
try {
  await mkdir('.local-test', { recursive: true });
  owner = await loginApi('09000000001');
  member = await loginApi('09000000002');
  const admin = await loginApi('09000000004');
  originalPrefs = await api('/notifications/prefs', owner);
  await api('/notifications/prefs', owner, 'PATCH', { enabled: true, domains: { event: true }, lead_days: { event: 7 } });
  const beforeFinance = await api('/transactions', owner);
  const legacy = await api('/events', owner, 'POST', { title: marker + '-legacy', date: todayIso });
  events.push(legacy.id);
  // The dedicated child route permits no phone; the existing invitation contract stays intact.
  await api('/auth/members', owner, 'POST', { name: marker + '-invalid-auth', relation: 'فرزند' }, [422]);
  await api('/children', member, 'POST', { name: marker + '-forbidden', birth_date: todayIso }, [403]);
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  page = await context.newPage(); await loginUi(page, '09000000001'); await openChildren();
  await page.getByRole('button', { name: 'ثبت فرزند جدید', exact: true }).click();
  await page.getByRole('textbox', { name: 'نام فرزند', exact: true }).fill(marker);
  assert.equal(await page.getByPlaceholder('شماره موبایل', { exact: true }).count(), 0);
  await page.getByRole('group', { name: 'تاریخ تولد', exact: true }).locator('.date-field').click();
  await page.locator('.dp-box').getByRole('button', { name: 'امروز', exact: true }).click();
  await page.locator('.dp-overlay').waitFor({ state: 'hidden' });
  await screenshot('children-create-mobile');
  let child = await saveChild();
  assert.equal(child.birth_date, todayIso); assert.equal(child.age_years, 0); assert.equal(child.status, 'pending');
  assert.equal(child.can_edit, true);
  const canonical = (await api('/auth/members', owner)).find(row => row.id === child.id);
  assert.ok(canonical); assert.equal(canonical.phone, null); assert.equal(canonical.status, 'pending');
  assert.equal(canonical.membership_state, 'active'); assert.equal(canonical.relation, 'فرزند');
  const firstDetail = await api('/children/' + child.id, owner);
  assert.equal(firstDetail.child.id, canonical.id); assert.equal(firstDetail.birthday.date, todayIso);
  assert.ok(!(JSON.stringify(firstDetail).includes('document_access_not_before')));
  assert.deepEqual(Object.keys(firstDetail).sort(), ['activities', 'birthday', 'child', 'tasks']);
  const birthdayId = firstDetail.birthday.id;
  assert.equal((await api('/events', owner)).filter(row => row.for_member_id === child.id && row.title.startsWith('تولد')).length, 1);
  assert.equal((await api('/children/' + child.id, member)).child.can_edit, false);
  assert.equal((await api('/children/' + child.id, admin)).child.can_edit, true);
  await api('/children/' + child.id, member, 'PATCH', { name: 'forbidden', birth_date: todayIso, base_revision: child.revision }, [403]);

  const older = await api('/children', owner, 'POST', { name: marker + '-older', birth_date: olderBirth });
  children.push(older.id); assert.equal(older.age_years, 10);
  const unknown = await api('/children', owner, 'POST', { name: marker + '-unknown', birth_date: null });
  children.push(unknown.id); assert.equal(unknown.age_years, null);
  assert.equal((await api('/children/' + unknown.id, owner)).birthday, null);
  const knownAgain = await api('/children/' + unknown.id, owner, 'PATCH', { name: unknown.name, birth_date: todayIso, base_revision: unknown.revision });
  assert.ok((await api('/children/' + unknown.id, owner)).birthday);
  await api('/children/' + unknown.id, owner, 'PATCH', { name: unknown.name, birth_date: null, base_revision: knownAgain.revision });
  assert.equal((await api('/children/' + unknown.id, owner)).birthday, null);
  assert.ok(!(await api('/events', owner)).some(row => row.for_member_id === unknown.id && row.title.startsWith('تولد')));
  child = await api('/children/' + child.id, owner, 'PATCH', { name: marker + '-edited', birth_date: olderBirth, base_revision: child.revision });
  assert.equal(child.age_years, 10);
  const birthdayAfter = (await api('/children/' + child.id, owner)).birthday;
  assert.equal(birthdayAfter.id, birthdayId); assert.equal(birthdayAfter.title, 'تولد ' + marker + '-edited');
  assert.ok(birthdayAfter.date >= todayIso);
  await api('/children/' + child.id, owner, 'PATCH', { name: marker + '-stale', birth_date: todayIso, base_revision: firstDetail.child.revision }, [409]);
  await api('/events/sync-birthdays', owner, 'POST');
  await api('/events/sync-birthdays', owner, 'POST');
  assert.equal((await api('/events', owner)).filter(row => row.for_member_id === child.id && row.title.startsWith('تولد')).length, 1);

  // A phone-less introduced child is available to the existing task form.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('کارهای خانه', { exact: true }).click();
  await page.getByRole('heading', { name: 'کارهای خانه', exact: true }).waitFor();
  await page.getByRole('button', { name: 'ثبت کار جدید', exact: true }).click();
  await page.getByRole('textbox', { name: 'عنوان کار', exact: true }).fill(marker + '-task');
  await page.getByRole('combobox', { name: 'مسئول', exact: true }).selectOption(child.id);
  await page.getByRole('button', { name: 'ثبت کار', exact: true }).click();
  await page.getByRole('button', { name: 'ثبت کار', exact: true }).waitFor({ state: 'hidden' });
  let assignedTask;
  await poll(async () => { assignedTask = (await api('/tasks', owner)).find(row => row.title === marker + '-task'); return assignedTask; }, 'Queued UI task was not synchronized');
  tasks.push(assignedTask.id); assert.equal(assignedTask.assignee_id, child.id);
  const directTask = await api('/tasks', member, 'POST', { title: marker + '-task-direct', assignee_id: child.id, due_date: todayIso });
  tasks.push(directTask.id);
  const activity = await api('/activities', member, 'POST', {
    title: marker + '-activity', note: null, date: todayIso, location: 'پارک آزمایشی',
    status: 'planned', participant_ids: [child.id], reminder_enabled: true,
  });
  activities.push(activity.id);
  const related = await api('/children/' + child.id, owner);
  assert.deepEqual(new Set(related.tasks.map(row => row.id)), new Set([assignedTask.id, directTask.id]));
  assert.equal(related.activities.find(row => row.id === activity.id)?.location, 'پارک آزمایشی');
  assert.deepEqual(Object.keys(related.tasks[0]).sort(), ['completed', 'due_date', 'id', 'title']);
  assert.ok(!('goals' in related)); assert.ok(!('documents' in related)); assert.ok(!('transactions' in related));
  const activityEvent = (await api('/events', owner)).find(row => row.id === activity.id);
  assert.equal(activityEvent.kind, 'activity');
  await page.reload({ waitUntil: 'networkidle' }); await openChildren(); await detail(child.name);
  await page.getByText(marker + '-task', { exact: true }).waitFor();
  await page.getByText(marker + '-task-direct', { exact: true }).waitFor();
  await page.getByText(marker + '-activity', { exact: true }).waitFor();
  await screenshot('children-detail-mobile');
  await page.locator('.children-sheet').evaluate(sheet => { sheet.scrollTop = sheet.scrollHeight; });
  await screenshot('children-detail-footer-mobile');
  await page.locator('.children-sheet').evaluate(sheet => { sheet.scrollTop = 0; });
  await page.getByRole('button', { name: 'رفتن به کارهای خانواده', exact: true }).click();
  await page.getByRole('heading', { name: 'کارهای خانه', exact: true }).waitFor();
  await page.getByText(marker + '-task', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'networkidle' }); await openChildren(); await detail(child.name);
  await page.getByRole('button', { name: 'رفتن به برنامه‌های خانوادگی', exact: true }).click();
  await page.getByRole('heading', { name: 'تفریح و برنامه‌های خانوادگی', exact: true }).waitFor();
  await page.getByRole('button', { name: 'جزئیات ' + marker + '-activity', exact: true }).waitFor();
  await page.reload({ waitUntil: 'networkidle' }); await openChildren(); await detail(child.name);
  await page.getByRole('button', { name: 'ویرایش مشخصات فرزند', exact: true }).click();
  await page.getByRole('textbox', { name: 'نام فرزند', exact: true }).fill(marker + '-final');
  child = await saveChild(); assert.equal(child.id, canonical.id); assert.equal(child.name, marker + '-final');
  assert.equal((await api('/children/' + child.id, owner)).birthday.id, birthdayId);

  const readContext = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  const readPage = await readContext.newPage(); await loginUi(readPage, '09000000002'); await openChildren(readPage); await detail(child.name, readPage);
  assert.equal(await readPage.getByRole('button', { name: 'ویرایش مشخصات فرزند', exact: true }).count(), 0);
  assert.equal(await readPage.getByRole('button', { name: 'ثبت فرزند جدید', exact: true }).count(), 0);
  await readContext.close();

  // The same canonical birthday appears once in the existing event notification domain.
  const tomorrowIso = new Date(Date.parse(todayIso + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  child = await api('/children/' + child.id, owner, 'PATCH', { name: child.name, birth_date: birthTenJalaliYearsAgo(tomorrowIso), base_revision: child.revision });
  const reminderDate = (await api('/children/' + child.id, owner)).birthday.date;
  const selectedReminder = parts(new Date(reminderDate + 'T12:00:00Z'), 'persian');
  await page.reload({ waitUntil: 'networkidle' }); await page.locator('.floating-navigation').getByRole('button', { name: 'اعلان‌ها', exact: true }).click();
  await page.getByRole('heading', { name: 'اعلان‌ها', exact: true }).waitFor();
  const birthdayReminder = page.locator('.notif-item').filter({ hasText: 'تولد ' + child.name });
  await birthdayReminder.waitFor(); assert.equal(await birthdayReminder.count(), 1);
  await birthdayReminder.click(); await page.getByRole('heading', { name: 'تقویم و مناسبت‌ها', exact: true }).waitFor();
  const selectedDayCard = page.locator('.card').filter({ has: page.getByRole('button', { name: '+ افزودن', exact: true }) });
  await selectedDayCard.getByText('تولد ' + child.name, { exact: true }).waitFor();
  const faDay = String(selectedReminder.day).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
  assert.equal((await page.locator('.cal-grid [aria-selected=true]').innerText()).trim(), faDay);
  await screenshot('children-birthday-mobile');

  await page.reload({ waitUntil: 'networkidle' }); await openChildren();
  let held = false;
  const gate = new Promise(resolve => { releaseLate = resolve; });
  const detailPath = '**/api/v1/children/' + child.id;
  await context.route(detailPath, async route => {
    if (route.request().method() !== 'GET' || held) return route.continue();
    held = true; const response = await route.fetch(); const body = await response.json();
    await gate;
    await route.fulfill({ response, json: { ...body, child: { ...body.child, name: marker + '-late-response' } } }).catch(() => {});
  });
  await page.getByRole('button', { name: 'جزئیات ' + child.name, exact: true }).click();
  await poll(async () => held, 'Children detail request was not held');
  await context.setOffline(true);
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.children-sheet').count(), 0);
  assert.ok(!(await page.locator('body').innerText()).includes(marker + '-task-direct'));
  await context.setOffline(false); await openChildren(); releaseLate(); releaseLate = undefined;
  await page.waitForTimeout(300); assert.ok(!(await page.locator('body').innerText()).includes(marker + '-late-response'));
  await context.unroute(detailPath);
  await detail(child.name); await page.getByRole('button', { name: 'ویرایش مشخصات فرزند', exact: true }).click();
  await page.getByRole('textbox', { name: 'نام فرزند', exact: true }).fill(marker + '-unsaved');
  await context.setOffline(true); await page.waitForTimeout(250);
  assert.equal(await page.locator('.children-sheet').count(), 0);
  await context.setOffline(false); await openChildren();
  await page.getByRole('button', { name: 'ثبت فرزند جدید', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'نام فرزند', exact: true }).inputValue(), '');
  await page.getByRole('button', { name: 'انصراف', exact: true }).click();
  await context.route('**/api/v1/children', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 403, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'FORBIDDEN', message: 'دسترسی لغو شده است.' }) })
    : route.continue());
  await page.reload({ waitUntil: 'networkidle' }); await openChildren();
  await page.locator('.children-page [role=alert]').waitFor();
  assert.equal(await page.getByRole('button', { name: 'جزئیات ' + child.name, exact: true }).count(), 0);
  const createAfterDenial = page.getByRole('button', { name: 'ثبت فرزند جدید', exact: true });
  assert.ok(!(await createAfterDenial.count()) || !(await createAfterDenial.isEnabled()));
  await context.unroute('**/api/v1/children');
  await page.reload({ waitUntil: 'networkidle' }); await openChildren(); await screenshot('children-list-mobile');
  assert.deepEqual(await api('/transactions', owner), beforeFinance, 'Children changed Finance');
  assert.ok((await api('/events', owner)).some(row => row.id === legacy.id && row.title === legacy.title), 'Children changed the old event');
  await api('/auth/members/' + child.id, owner, 'DELETE');
  await api('/children/' + child.id, owner, 'GET', undefined, [404]);
  assert.ok(!(await api('/events', owner)).some(row => row.id === birthdayId), 'Removed child left a phantom birthday');
  const retainedActivity = await api('/activities/' + activity.id, owner);
  assert.equal(retainedActivity.id, activity.id); assert.ok(!retainedActivity.participant_ids.includes(child.id));
  assert.equal((await api('/tasks', owner)).find(row => row.id === assignedTask.id)?.assignee_id, null);
  assert.equal((await api('/tasks', owner)).find(row => row.id === directTask.id)?.assignee_id, null);
  console.log('PASS: Children mobile phone-less create/update, Jalali birth input and age, canonical Member/task/activity/birthday identity, queued UI and direct task assignment, one next-birthday reminder, manager/member writes, revision conflict, unknown/cleared birth, existing-module navigation, offline form/detail erasure, late response and denied snapshot rejection, no mobile overflow, member-removal birthday/participant cleanup, and Finance/legacy-event preservation.');
} catch (error) {
  if (page) await page.screenshot({ path: '.local-test/children-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  releaseLate?.(); if (browser) await browser.close();
  if (owner) {
    const allTasks = await api('/tasks', owner).catch(() => []);
    for (const row of allTasks.filter(item => tasks.includes(item.id) || item.title.startsWith(marker + '-task'))) {
      await api(`/tasks/${row.id}?base_revision=${row.revision}`, owner, 'DELETE', undefined, [204, 404]).catch(() => {});
    }
    for (const id of activities) {
      const row = await api('/activities/' + id, owner, 'GET', undefined, [200, 404]).catch(() => null);
      if (row?.revision) await api(`/activities/${id}?base_revision=${row.revision}`, owner, 'DELETE').catch(() => {});
    }
    const allChildren = await api('/children', owner).catch(() => ({ children: [] }));
    for (const row of allChildren.children.filter(item => children.includes(item.id) || item.name.startsWith(marker))) {
      await api('/auth/members/' + row.id, owner, 'DELETE', undefined, [200, 404]).catch(() => {});
    }
    for (const id of events) await api('/events/' + id, owner, 'DELETE', undefined, [204, 404]).catch(() => {});
  }
  if (owner && originalPrefs) await api('/notifications/prefs', owner, 'PATCH', {
    enabled: originalPrefs.enabled,
    domains: { event: originalPrefs.domains?.event !== false },
    lead_days: { event: originalPrefs.lead_days?.event ?? 7 },
  }).catch(() => {});
  for (const token of tokens) await api('/auth/logout', token, 'POST').catch(() => {});
}
