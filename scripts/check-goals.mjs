import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = 'http://127.0.0.1:5700';
const marker = 'goals-e2e-' + Date.now();
const tokens = [], created = [];
let browser, context, page, actor, originalPrefs, releaseLate;
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
  if (path.startsWith('/goals')) assert.equal(response.headers.get('cache-control'), 'no-store');
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
  await target.getByText('اهداف و آرزوهای شخصی', { exact: true }).waitFor();
}
async function openGoals(target = page) {
  const deadline = Date.now() + 25000;
  while (!await target.getByRole('heading', { name: 'اهداف و آرزوها', exact: true }).isVisible()) {
    assert.ok(Date.now() < deadline, 'Goals navigation unavailable');
    await target.getByText('اهداف و آرزوهای شخصی', { exact: true }).click();
    await target.waitForTimeout(250);
  }
  await target.waitForFunction(() => document.querySelector('.goals-page')?.getAttribute('aria-busy') === 'false');
}
async function chooseDate(iso) {
  await page.getByRole('group', { name: 'موعد', exact: true }).locator('.date-field').click();
  const selected = parts(new Date(iso + 'T12:00:00Z'), 'persian');
  const current = parts(new Date(todayIso + 'T12:00:00Z'), 'persian');
  const difference = (selected.year - current.year) * 12 + selected.month - current.month;
  for (let index = 0; index < Math.abs(difference); index++) await page.getByRole('button', { name: difference > 0 ? 'ماه بعد' : 'ماه قبل', exact: true }).click();
  await page.locator('.dp-box').getByRole('button', { name: fa(selected.day), exact: true }).click();
  await page.locator('.dp-overlay').waitFor({ state: 'hidden' });
}
async function saveForm() {
  const response = page.waitForResponse(item => item.url().includes('/api/v1/goals') && ['POST', 'PATCH'].includes(item.request().method()));
  await page.getByRole('button', { name: 'ذخیرهٔ مورد', exact: true }).click();
  const saved = await response; assert.ok([200, 201].includes(saved.status()), 'Saving goal failed');
  const result = await saved.json();
  if (!created.some(item => item.id === result.id)) created.push({ id: result.id, token: actor });
  await page.getByRole('button', { name: 'ذخیرهٔ مورد', exact: true }).waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('.goals-page')?.getAttribute('aria-busy') === 'false');
  return result;
}
async function detail(title) {
  await page.getByRole('button', { name: 'جزئیات ' + title, exact: true }).click();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
}
async function screenshot(name) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page overflows');
  for (const sheet of await page.locator('.modal-sheet').all()) assert.ok(await sheet.evaluate(item => item.scrollWidth <= item.clientWidth + 1), 'Mobile sheet overflows');
  await page.screenshot({ path: '.local-test/' + name + '.png', fullPage: true });
}
async function notifications() {
  await page.reload({ waitUntil: 'networkidle' }); await page.locator('.floating-navigation').getByRole('button', { name: 'اعلان‌ها', exact: true }).click();
  await page.getByRole('heading', { name: 'اعلان‌ها', exact: true }).waitFor();
}
try {
  await mkdir('.local-test', { recursive: true });
  actor = await loginApi('09000000002');
  const other = await loginApi('09000000003');
  const owner = await loginApi('09000000001');
  const admin = await loginApi('09000000004');
  originalPrefs = await api('/notifications/prefs', actor);
  await api('/notifications/prefs', actor, 'PATCH', { enabled: true, domains: { goals: true }, lead_days: { goals: 7 } });
  const beforeFinance = await api('/transactions', actor), beforeCalendar = await api('/events', actor);
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  page = await context.newPage(); await loginUi(page, '09000000002'); await openGoals();
  await page.getByRole('button', { name: 'ثبت هدف یا آرزوی جدید', exact: true }).click();
  await page.getByRole('textbox', { name: 'عنوان', exact: true }).fill(marker);
  await page.getByRole('textbox', { name: 'توضیح', exact: true }).fill('توضیح خصوصی\nخط دوم توضیح');
  await chooseDate(todayIso); await screenshot('goals-create-mobile');
  const goal = await saveForm();
  assert.equal(goal.owner_id, (await api('/auth/session', actor)).member.id);
  assert.equal(goal.target_date, todayIso); assert.equal(goal.kind, 'goal');
  for (const token of [other, owner, admin]) {
    assert.ok(!(await api('/goals', token)).goals.some(item => item.id === goal.id), 'Another household member saw private goal');
    await api('/goals/' + goal.id, token, 'GET', undefined, [404]);
    await api('/goals/' + goal.id, token, 'PATCH', { title: 'unauthorized', base_revision: goal.revision }, [404]);
    await api(`/goals/${goal.id}?base_revision=${goal.revision}`, token, 'DELETE', undefined, [404]);
  }
  await notifications();
  const reminder = page.locator('.notif-item').filter({ hasText: marker });
  await reminder.waitFor(); assert.equal(await reminder.getByRole('button', { name: /نادیده/ }).count(), 0);
  await reminder.click();
  await page.getByRole('heading', { name: marker, exact: true }).waitFor();
  await screenshot('goals-reminder-detail-mobile');
  await page.getByRole('button', { name: 'ویرایش مورد', exact: true }).click();
  await page.getByRole('combobox', { name: 'نوع مورد', exact: true }).selectOption('wish');
  await page.getByRole('textbox', { name: 'عنوان', exact: true }).fill(marker + '-wish');
  const wish = await saveForm(); assert.equal(wish.id, goal.id); assert.equal(wish.kind, 'wish');
  await page.getByRole('button', { name: 'ثبت انجام‌شدن', exact: true }).click();
  await page.getByRole('button', { name: 'بازگشایی مورد', exact: true }).waitFor();
  assert.equal((await api('/goals/' + goal.id, actor)).status, 'done');
  await page.getByRole('button', { name: 'بازگشایی مورد', exact: true }).click();
  await page.getByRole('button', { name: 'ثبت انجام‌شدن', exact: true }).waitFor();
  assert.equal((await api('/goals/' + goal.id, actor)).status, 'active');
  await page.getByRole('button', { name: 'بستن جزئیات', exact: true }).click();
  await page.getByRole('group', { name: 'فیلتر نوع مورد', exact: true }).getByRole('button', { name: 'هدف‌ها', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'جزئیات ' + marker + '-wish', exact: true }).count(), 0);
  await page.getByRole('group', { name: 'فیلتر نوع مورد', exact: true }).getByRole('button', { name: 'آرزوها', exact: true }).click();
  await detail(marker + '-wish');
  await page.getByRole('button', { name: 'حذف مورد', exact: true }).click();
  await page.getByRole('button', { name: 'انصراف', exact: true }).click();
  assert.equal((await api('/goals/' + goal.id, actor)).id, goal.id);
  await page.getByRole('button', { name: 'بستن جزئیات', exact: true }).click();

  // Invalidate a live detail response across an offline/online cycle.
  let held = false;
  const gate = new Promise(resolve => { releaseLate = resolve; });
  const detailPath = '**/api/v1/goals/' + goal.id;
  await context.route(detailPath, async route => {
    if (route.request().method() !== 'GET' || held) return route.continue();
    held = true; const response = await route.fetch(); const body = await response.json();
    await gate;
    await route.fulfill({ response, json: { ...body, title: marker + '-late-response' } }).catch(() => {});
  });
  await page.getByRole('button', { name: 'جزئیات ' + marker + '-wish', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.goals-page')?.getAttribute('aria-busy') === 'true');
  await context.setOffline(true);
  await page.getByText('اهداف و آرزوهای شخصی', { exact: true }).waitFor();
  assert.equal(await page.locator('.goals-sheet').count(), 0);
  await context.setOffline(false); await openGoals();
  releaseLate(); releaseLate = undefined; await page.waitForTimeout(300);
  assert.equal(await page.getByText(marker + '-late-response', { exact: true }).count(), 0, 'Pre-offline response revived private detail');
  await context.unroute(detailPath);
  await detail(marker + '-wish'); await page.getByRole('button', { name: 'ویرایش مورد', exact: true }).click();
  await page.getByRole('textbox', { name: 'عنوان', exact: true }).fill(marker + '-unsaved');
  await context.setOffline(true); await page.getByText('اهداف و آرزوهای شخصی', { exact: true }).waitFor();
  assert.equal(await page.locator('.goals-sheet').count(), 0); assert.ok(!(await page.locator('body').innerText()).includes(marker + '-unsaved'));
  await context.setOffline(false); await openGoals();
  await page.getByRole('button', { name: 'ثبت هدف یا آرزوی جدید', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'عنوان', exact: true }).inputValue(), '');
  await page.getByRole('button', { name: 'انصراف', exact: true }).click();

  // Revoked access must clear both the page and notification snapshots.
  await context.route('**/api/v1/goals', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 403, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'FORBIDDEN', message: 'دسترسی لغو شده است.' }) })
    : route.continue());
  await notifications(); await page.waitForTimeout(300);
  assert.equal(await page.locator('.notif-item').filter({ hasText: marker }).count(), 0, 'Revoked snapshot kept private reminder');
  await page.reload({ waitUntil: 'networkidle' }); await openGoals();
  await page.locator('.goals-page [role=alert]').waitFor();
  assert.equal(await page.getByRole('button', { name: 'ثبت هدف یا آرزوی جدید', exact: true }).isEnabled(), false);
  assert.equal(await page.getByRole('button', { name: 'جزئیات ' + marker + '-wish', exact: true }).count(), 0);
  await context.unroute('**/api/v1/goals'); await page.reload({ waitUntil: 'networkidle' }); await openGoals();

  // Reuse the same browser after logout to check owner isolation in rendered UI.
  await page.reload({ waitUntil: 'networkidle' }); await page.getByRole('button', { name: 'پروفایل و تنظیمات', exact: true }).click();
  const signedOut = page.waitForNavigation({ waitUntil: 'networkidle' });
  await page.getByText('خروج از حساب', { exact: true }).click();
  await signedOut;
  await page.getByPlaceholder('شماره موبایل', { exact: true }).first().waitFor();
  await loginUi(page, '09000000004'); await openGoals();
  assert.ok(!(await page.locator('body').innerText()).includes(marker), 'Previous owner data survived account change');
  await notifications(); await page.waitForTimeout(300);
  assert.equal(await page.locator('.notif-item').filter({ hasText: marker }).count(), 0);

  const ownerContext = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  page = await ownerContext.newPage(); await loginUi(page, '09000000002'); await openGoals(); await detail(marker + '-wish');
  await page.getByRole('button', { name: 'حذف مورد', exact: true }).click();
  await page.getByRole('button', { name: 'تأیید حذف مورد', exact: true }).click();
  await page.getByRole('button', { name: 'جزئیات ' + marker + '-wish', exact: true }).waitFor({ state: 'hidden' });
  await api('/goals/' + goal.id, actor, 'GET', undefined, [404]);
  assert.deepEqual(await api('/transactions', actor), beforeFinance, 'Goals changed Finance');
  assert.deepEqual(await api('/events', actor), beforeCalendar, 'Goals changed shared calendar');
  await screenshot('goals-list-mobile');
  console.log('PASS: Goals/Wishes mobile CRUD, Jalali date, kind conversion, completion/reopen, filters, private reminder exact navigation, member/owner/admin denial, account change, offline form erasure, late response rejection, revoked snapshot erasure, deletion, and Finance/calendar preservation.');
} catch (error) {
  if (page) await page.screenshot({ path: '.local-test/goals-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  releaseLate?.(); if (browser) await browser.close();
  for (const { id, token } of created) {
    const row = await api('/goals/' + id, token, 'GET', undefined, [200, 404]).catch(() => null);
    if (row?.revision) await api(`/goals/${id}?base_revision=${row.revision}`, token, 'DELETE').catch(() => {});
  }
  if (actor && originalPrefs) await api('/notifications/prefs', actor, 'PATCH', {
    enabled: originalPrefs.enabled, domains: { goals: originalPrefs.domains?.goals !== false },
    lead_days: { goals: originalPrefs.lead_days?.goals ?? 7 },
  }).catch(() => {});
  for (const token of tokens) await api('/auth/logout', token, 'POST').catch(() => {});
}
