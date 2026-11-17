import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { backupHomePreferences } from './sandbox-home-preferences.mjs';

// This probe uses only the isolated local sandbox and removes its own records.
const base = 'http://127.0.0.1:5700';
const marker = 'home-e2e-' + Date.now();
const tokens = [], records = [], savedPrefs = [], pageErrors = [], cleanupErrors = [];
const checks = [];
let browser, ownerContext, memberContext, ownerPage, memberPage, owner, member, releaseSummary, releaseFreshSummary, homePrefsBackup;
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran', calendar: 'gregory', numberingSystem: 'latn',
  year: 'numeric', month: 'numeric', day: 'numeric',
}).formatToParts(new Date()).filter(part => ['year', 'month', 'day'].includes(part.type))
  .map(part => [part.type, Number(part.value)]));
const todayIso = [parts.year, String(parts.month).padStart(2, '0'), String(parts.day).padStart(2, '0')].join('-');
const day = offset => new Date(Date.parse(todayIso + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
const rows = (result, kind) => Array.isArray(result) ? result : result[kind];
const row = (page, id) => page.locator('.hub-overview [data-home-ref-id="' + id + '"]');

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

async function loginUi(page, phone) {
  await page.goto(base, { waitUntil: 'networkidle' });
  if (!(await page.getByPlaceholder('شماره موبایل', { exact: true }).count())) {
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
  }
  await page.getByPlaceholder('شماره موبایل', { exact: true }).first().fill(phone);
  await page.getByPlaceholder('رمز عبور', { exact: true }).fill('Test12345!');
  const login = page.waitForResponse(response => response.url().endsWith('/auth/login'));
  await page.locator('form').filter({ has: page.getByPlaceholder('رمز عبور', { exact: true }) })
    .locator('button[type=submit]').click();
  tokens.push((await (await login).json()).session_token);
  await page.locator('.hub-overview').waitFor();
}

async function poll(check, message, page = ownerPage) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await page.waitForTimeout(150);
  }
  throw new Error(message);
}

async function expandAgenda(page) {
  for (const group of await page.locator('.hub-overview [data-home-group]').all()) {
    const expand = group.getByRole('button', { name: /^نمایش همه/ });
    if (await expand.isVisible()) await expand.click();
  }
}

async function home(page = ownerPage) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.hub-overview').waitFor();
  // The shared online snapshots may finish slightly after the initial core data.
  await poll(async () => !(await page.locator('.hub-overview').getAttribute('aria-busy') === 'true'), 'Home did not finish loading', page);
  await expandAgenda(page);
}

async function assertGroup(page, id, group) {
  await poll(async () => {
    await expandAgenda(page);
    return await row(page, id).count() > 0;
  }, 'Home item missing: ' + group, page);
  assert.ok(await row(page, id).first().evaluate((element, expected) =>
    element.closest('[data-home-group]')?.getAttribute('data-home-group') === expected, group),
  'Home item has the wrong date group');
}

async function screenshot(name, page = ownerPage) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Home overflows the mobile viewport');
  for (const sheet of await page.locator('.modal-sheet').all()) {
    assert.ok(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Detail sheet overflows');
  }
  await page.screenshot({ path: '.local-test/' + name + '.png', fullPage: true });
}

async function openExact(page, entity) {
  await home(page);
  await poll(async () => {
    await expandAgenda(page);
    return await row(page, entity.id).count() > 0;
  }, 'Exact target is missing', page);
  await row(page, entity.id).first().click();
  await page.getByRole('heading', { name: entity.title, exact: true }).waitFor();
  await screenshot('home-target-' + entity.id, page);
}

try {
  homePrefsBackup = await backupHomePreferences('home');
  await mkdir('.local-test', { recursive: true });
  owner = await loginApi('09000000001'); member = await loginApi('09000000002');
  await disableReminders(owner); await disableReminders(member);
  const overdueTask = await create('tasks', { title: marker + '-overdue', assignee_id: member.id, due_date: day(-1) });
  const todayTask = await create('tasks', { title: marker + '-today', assignee_id: owner.id, due_date: todayIso });
  const upcomingTask = await create('tasks', { title: marker + '-week-boundary', due_date: day(7) });
  const distantTask = await create('tasks', { title: marker + '-outside-week', due_date: day(8) });
  const equipment = await create('equipment', {
    title: marker + '-equipment', service_due_date: day(2), warranty_until: day(3), service_reminder_enabled: false,
  });
  const vehicle = await create('vehicles', {
    title: marker + '-vehicle', odometer: 1001, service_due_odometer: 1000,
    service_due_date: day(20), service_reminder_enabled: false,
  });
  const activity = await create('activities', {
    title: marker + '-activity', date: day(1), participant_ids: [owner.id, member.id], reminder_enabled: false,
  });
  const event = await create('events', { title: marker + '-event', date: todayIso });
  const bill = await create('bills', { title: marker + '-bill', kind: 'internet', amount: 1234, due_date: todayIso });
  const ownGoal = await create('goals', { title: marker + '-owner-private', target_date: todayIso, reminder_enabled: false });
  const otherGoal = await create('goals', { title: marker + '-member-private', target_date: todayIso, reminder_enabled: false }, member);

  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  ownerContext = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  ownerPage = await ownerContext.newPage(); ownerPage.on('pageerror', error => pageErrors.push(error.message));
  await loginUi(ownerPage, '09000000001');
  await assertGroup(ownerPage, overdueTask.id, 'overdue');
  await assertGroup(ownerPage, todayTask.id, 'today');
  await assertGroup(ownerPage, upcomingTask.id, 'upcoming');
  await assertGroup(ownerPage, equipment.id, 'upcoming');
  await assertGroup(ownerPage, vehicle.id, 'overdue');
  await assertGroup(ownerPage, bill.id, 'today');
  await assertGroup(ownerPage, event.id, 'today');
  await assertGroup(ownerPage, ownGoal.id, 'today');
  await assertGroup(ownerPage, activity.id, 'upcoming');
  assert.equal(await row(ownerPage, distantTask.id).count(), 0, 'Eight-day task should stay outside the weekly overview');
  assert.equal(await row(ownerPage, activity.id).count(), 1, 'Activity and calendar entry were duplicated');
  assert.equal(await ownerPage.getByText(otherGoal.title, { exact: true }).count(), 0, 'Manager can see another member private goal');
  assert.equal(await ownerPage.locator('.hub-bell-dot').count(), 0, 'Reminders were not disabled');
  checks.push('real household tasks, seven-day boundary, shared event identity and reminders-off independence');

  assert.equal(await ownerPage.getByRole('heading', { name: 'به‌زودی', exact: true }).count(), 0, 'Empty roadmap heading remains');
  const allModules = ownerPage.locator('.home-catalog');
  for (const group of await allModules.locator('details').all()) {
    if (await group.getAttribute('open') === null) await group.locator('summary').click();
  }
  assert.equal(await allModules.locator('[data-home-module]').count(), 19, 'The grouped catalog must retain every module');
  await ownerPage.getByText('حیوانات خانگی و مراقبت از آن‌ها', { exact: true }).waitFor();
  await allModules.locator('[data-home-module="equipment"]').waitFor();
  const equipmentSubtitle = await allModules.locator('[data-home-module="equipment"] .home-module-sub').innerText();
  assert.ok(/[۰-۹0-9]/.test(equipmentSubtitle), 'Equipment summary has no actual count');
  await screenshot('home-mobile-light');
  await ownerPage.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await screenshot('home-mobile-dark');
  await ownerPage.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  checks.push('live counts, complete grouped catalog, empty-roadmap removal, light and dark mobile layout');

  // Simulate a delayed, failed server response through the real repository/model path.
  let summaryRequested = false;
  const delayedSummary = new Promise(resolve => { releaseSummary = resolve; });
  const summaryFailure = async route => {
    summaryRequested = true;
    await delayedSummary;
    await route.fulfill({ status: 503, contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ detail: 'Local probe unavailable' }) });
  };
  await ownerPage.route('**/api/v1/equipment', summaryFailure);
  await ownerPage.reload({ waitUntil: 'domcontentloaded' });
  await ownerPage.locator('.hub-overview').waitFor();
  await poll(async () => summaryRequested && await ownerPage.locator('.hub-overview').getAttribute('aria-busy') === 'true',
    'Delayed summary did not show the loading state');
  assert.equal(await ownerPage.locator('.hub-overview-empty').count(), 0, 'Loading incorrectly reported no pending work');
  await screenshot('home-mobile-loading');
  releaseSummary(); releaseSummary = undefined;
  await ownerPage.getByText('بخشی از اطلاعات دریافت نشد.', { exact: true }).waitFor();
  assert.equal(await row(ownerPage, equipment.id).count(), 0, 'Failed source kept stale equipment work');
  await screenshot('home-mobile-partial-error');
  await ownerPage.unroute('**/api/v1/equipment', summaryFailure);
  await ownerPage.locator('.hub-overview').getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
  await poll(async () => {
    await expandAgenda(ownerPage);
    return await row(ownerPage, equipment.id).count() > 0
      && await ownerPage.getByText('بخشی از اطلاعات دریافت نشد.', { exact: true }).count() === 0;
  }, 'Retry did not restore the failed summary source');
  checks.push('delayed loading, no false empty result, partial-error clearing and successful retry');

  const previousEquipment = await api('/equipment', owner.token);
  let oldRequested = false, freshRequested = false, oldDelivered = false, reconnected = false;
  const previousSummary = new Promise(resolve => { releaseSummary = resolve; });
  const freshSummary = new Promise(resolve => { releaseFreshSummary = resolve; });
  const delayedEpoch = async route => {
    if (!reconnected) {
      oldRequested = true;
      await previousSummary;
      await route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(previousEquipment) });
      oldDelivered = true;
    } else {
      freshRequested = true;
      await freshSummary;
      await route.continue();
    }
  };
  await ownerPage.route('**/api/v1/equipment', delayedEpoch);
  await ownerPage.reload({ waitUntil: 'domcontentloaded' });
  await poll(async () => oldRequested && await ownerPage.locator('.hub-overview').getAttribute('aria-busy') === 'true',
    'Pre-offline summary was not pending');
  await ownerContext.setOffline(true);
  await poll(async () => await row(ownerPage, equipment.id).count() === 0
    && await ownerPage.locator('.hub-overview').getAttribute('aria-busy') === 'false',
  'Offline did not invalidate the previous summary');
  reconnected = true;
  await ownerContext.setOffline(false);
  await poll(async () => freshRequested, 'Fresh summary was not requested after reconnection');
  releaseSummary(); releaseSummary = undefined;
  await poll(async () => oldDelivered, 'Previous connection response was not delivered');
  assert.equal(await row(ownerPage, equipment.id).count(), 0, 'Old connection response restored stale equipment');
  assert.equal(await ownerPage.getByText(equipment.title, { exact: true }).count(), 0, 'Old connection response restored its title');
  assert.equal(await ownerPage.locator('.hub-overview').getAttribute('aria-busy'), 'true', 'Fresh summary stopped showing its loading state');
  await screenshot('home-mobile-late-response');
  releaseFreshSummary(); releaseFreshSummary = undefined;
  await poll(async () => {
    await expandAgenda(ownerPage); return await row(ownerPage, equipment.id).count() > 0;
  }, 'Fresh connection response did not restore equipment');
  await ownerPage.unroute('**/api/v1/equipment', delayedEpoch);
  checks.push('pre-offline delayed response stays invalid after reconnect until the fresh summary arrives');

  for (const entity of [equipment, vehicle, ownGoal, activity]) await openExact(ownerPage, entity);
  await home(); await row(ownerPage, event.id).click();
  await ownerPage.getByRole('heading', { name: 'تقویم و مناسبت‌ها', exact: true }).waitFor();
  await ownerPage.getByText(event.title, { exact: true }).first().waitFor();
  await home(); await row(ownerPage, bill.id).click();
  await ownerPage.getByRole('heading', { name: 'قبوض و شارژ', exact: true }).waitFor();
  await ownerPage.getByText(bill.title, { exact: true }).first().waitFor();
  await home(); await row(ownerPage, todayTask.id).click();
  await ownerPage.getByRole('heading', { name: 'کارهای خانه', exact: true }).waitFor();
  await ownerPage.getByText(todayTask.title, { exact: true }).first().waitFor();
  checks.push('exact equipment, vehicle, goal and activity targets; task, bill and event destinations');

  const currentTask = rows(await api('/tasks', owner.token), 'tasks').find(item => item.id === todayTask.id);
  await api('/tasks/' + todayTask.id + '/complete', owner.token, 'POST', { completed: true, base_revision: currentTask.revision });
  await api('/bills/' + bill.id + '/pay', owner.token, 'POST', { date: todayIso });
  await home();
  assert.equal(await row(ownerPage, todayTask.id).count(), 0, 'Completed task stayed in Home work list');
  assert.equal(await row(ownerPage, bill.id).count(), 0, 'Paid bill stayed in Home work list');
  checks.push('task completion and bill payment remove pending work');

  memberContext = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  memberPage = await memberContext.newPage(); memberPage.on('pageerror', error => pageErrors.push(error.message));
  await loginUi(memberPage, '09000000002');
  await assertGroup(memberPage, otherGoal.id, 'today');
  assert.equal(await memberPage.getByText(ownGoal.title, { exact: true }).count(), 0, 'Member can see another member private goal');
  await assertGroup(memberPage, overdueTask.id, 'overdue');
  await assertGroup(memberPage, equipment.id, 'upcoming');
  await memberContext.setOffline(true);
  await poll(async () => await row(memberPage, otherGoal.id).count() === 0 && await row(memberPage, equipment.id).count() === 0,
    'Private or online-only work remained after losing connection', memberPage);
  assert.equal(await memberPage.getByText(otherGoal.title, { exact: true }).count(), 0, 'Private goal text remained offline');
  await assertGroup(memberPage, overdueTask.id, 'overdue');
  await screenshot('home-mobile-offline', memberPage);
  await memberContext.setOffline(false);
  await poll(async () => {
    await expandAgenda(memberPage); return await row(memberPage, otherGoal.id).count() > 0;
  }, 'Online work did not return after reconnection', memberPage);
  checks.push('member/manager goal isolation and online-only clearing with authorized offline tasks preserved');
  assert.deepEqual(pageErrors, [], 'Home or target page raised a browser error');
  console.log('Home overview browser checks passed: ' + checks.length + ' groups.');
} catch (error) {
  if (ownerPage) {
    await ownerPage.screenshot({ path: '.local-test/home-failure.png', fullPage: true }).catch(() => {});
    await writeFile('.local-test/home-failure.txt', await ownerPage.locator('body').innerText()).catch(() => {});
  }
  throw error;
} finally {
  releaseSummary?.();
  releaseFreshSummary?.();
  await memberContext?.setOffline(false).catch(() => {});
  await ownerContext?.setOffline(false).catch(() => {});
  await browser?.close();
  try { await homePrefsBackup?.restore(); } catch { cleanupErrors.push('Could not restore original Home preferences'); }
  for (const record of records.slice().reverse()) {
    try {
      const listed = rows(await api('/' + record.kind, record.token), record.kind);
      let current = listed.find(item => item.id === record.id);
      if (!current) continue;
      if (record.kind === 'bills' && current.state === 'paid') {
        current = await api('/bills/' + current.id + '/unpay', record.token, 'POST');
      }
      const query = ['tasks', 'equipment', 'vehicles', 'goals', 'activities'].includes(record.kind)
        ? '?base_revision=' + current.revision : '';
      await api('/' + record.kind + '/' + current.id + query, record.token, 'DELETE');
    } catch { cleanupErrors.push('Could not remove own ' + record.kind + ' fixture'); }
  }
  for (const { token, original } of savedPrefs) {
    try {
      await api('/notifications/prefs', token, 'PATCH', { enabled: original.enabled, domains: original.domains, lead_days: original.lead_days });
    } catch { cleanupErrors.push('Could not restore test notification preferences'); }
  }
  for (const token of tokens) {
    try { await api('/auth/logout', token, 'POST'); }
    catch { cleanupErrors.push('Could not close one test session'); }
  }
  await writeFile('.local-test/home-check-result.json', JSON.stringify({ todayIso, checks, pageErrors, cleanupErrors }, null, 2));
  assert.deepEqual(cleanupErrors, [], 'Home probe cleanup failed');
}
