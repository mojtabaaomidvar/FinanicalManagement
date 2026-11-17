import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only profile/calendar probe against the real, isolated local sandbox.
// Only its own login sessions are created and closed. The normal Home refresh
// may synchronize next birthday reminders; no profile, photo or event is edited.
const base = 'http://127.0.0.1:5700';
const localDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.local-test');
const phone = '09000000001';
const birthIso = '1961-11-06'; // 15 Aban 1340
const tokens = [], checks = [], pageErrors = [], cleanupErrors = [], protectedWrites = [];
let browser, context, page, owner, beforeEvents, originalProfile, canonicalBirthday;

const parts = (value, calendar = 'gregory') => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran', calendar, numberingSystem: 'latn', year: 'numeric', month: 'numeric', day: 'numeric',
}).formatToParts(value).filter(part => ['year', 'month', 'day'].includes(part.type))
  .map(part => [part.type, Number(part.value)]));
const iso = value => [value.year, String(value.month).padStart(2, '0'), String(value.day).padStart(2, '0')].join('-');
const todayIso = iso(parts(new Date()));
const todayJ = parts(new Date(), 'persian');
const shift = (day, offset) => new Date(Date.parse(day + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
const fa = value => String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
const sortEvents = events => [...events].sort((a, b) => a.id.localeCompare(b.id));
const profile = member => ({ name: member.name, gender: member.gender, birth_date: member.birth_date, avatar_url: member.avatar_url });
const birthdayRows = events => events.filter(value => value.for_member_id === owner.id
  && value.kind === 'event' && value.title.startsWith('تولد'));

// Derive the expected Gregorian day independently through Intl's Persian calendar.
function anniversary(year) {
  const start = Date.UTC(year + 621, 8, 1);
  for (let index = 0; index < 100; index++) {
    const value = new Date(start + index * 86400000);
    const candidate = parts(value, 'persian');
    if (candidate.year === year && candidate.month === 8 && candidate.day === 15) return value.toISOString().slice(0, 10);
  }
  throw new Error('Could not derive 15 Aban ' + year);
}

async function api(route, token, method = 'GET', body) {
  assert.ok(method === 'GET' || ['/auth/login', '/auth/logout'].includes(route), 'Probe attempted a data mutation');
  const response = await fetch(base + '/api/v1' + route, {
    method, headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok([200, 201, 204].includes(response.status), `${method} ${route}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function poll(check, message) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await page.waitForTimeout(100);
  }
  throw new Error(message);
}

async function loginUi() {
  await page.goto(base, { waitUntil: 'networkidle' });
  if (!(await page.getByPlaceholder('شماره موبایل', { exact: true }).count())) {
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
  }
  await page.getByPlaceholder('شماره موبایل', { exact: true }).first().fill(phone);
  await page.getByPlaceholder('رمز عبور', { exact: true }).fill('Test12345!');
  const loginResponse = page.waitForResponse(response => response.url().endsWith('/auth/login'));
  await page.locator('form').filter({ has: page.getByPlaceholder('رمز عبور', { exact: true }) })
    .locator('button[type=submit]').click();
  tokens.push((await (await loginResponse).json()).session_token);
  await page.locator('.hub-overview').waitFor();
  await poll(async () => (await page.locator('.hub-overview').getAttribute('aria-busy')) !== 'true', 'Home stayed busy');
}

async function openCalendar() {
  await page.locator('.hub-overview').waitFor();
  const shortcut = page.locator('[data-home-shortcut="calendar"]');
  const tile = page.locator('[data-home-module="calendar"]');
  if (await shortcut.isVisible()) await shortcut.click();
  else if (await tile.isVisible()) await tile.click();
  else await tile.evaluate(button => {
    // Navigate immediately so this read-only birthday probe does not save an expanded group.
    button.closest('details').open = true;
    button.click();
  });
  await page.locator('.household-calendar').waitFor();
  await poll(async () => (await page.locator('.household-calendar').getAttribute('aria-busy')) !== 'true', 'Calendar stayed busy');
  assert.equal(await page.locator('.household-calendar').getByText(/بخشی از اطلاعات دریافت نشد/).count(), 0,
    'Calendar is missing a real source');
  const expand = page.locator('[data-calendar-list="upcoming"]').getByRole('button', { name: /^نمایش همه/ });
  if (await expand.count()) await expand.click();
}

async function selectDay(day) {
  let cell = page.locator('[data-calendar-date="' + day + '"]');
  for (let attempts = 0; !(await cell.count()) && attempts < 60; attempts++) {
    const first = await page.locator('[data-calendar-date]').first().getAttribute('data-calendar-date');
    await page.getByRole('button', { name: day < first ? 'ماه قبل' : 'ماه بعد', exact: true }).click();
    cell = page.locator('[data-calendar-date="' + day + '"]');
  }
  assert.equal(await cell.count(), 1, 'Could not reach calendar day ' + day);
  await cell.click();
  assert.equal(await cell.getAttribute('aria-selected'), 'true');
  return cell;
}

const birthdayRow = (list = 'day') => page.locator('[data-calendar-list="' + list
  + '"] [data-calendar-ref-kind="event"][data-calendar-ref-id="' + canonicalBirthday.id + '"]');

async function assertUpcoming(expected) {
  assert.equal(await birthdayRow('upcoming').count(), expected,
    'Viewing another year changed the 30-day birthday list');
}

async function checkYear(year, expectedUpcoming = 0) {
  const day = anniversary(year);
  await selectDay(shift(day, -1));
  assert.equal(await birthdayRow().count(), 0, 'Birthday appears before 15 Aban ' + year);
  const cell = await selectDay(day);
  assert.equal(await birthdayRow().count(), 1, 'Expected one birthday on 15 Aban ' + year);
  assert.equal(await birthdayRow().getAttribute('data-calendar-entry-id'),
    'event:' + canonicalBirthday.id + ':birthday:' + year, 'Annual row lost its year-specific view identity');
  assert.ok((await birthdayRow().innerText()).includes(canonicalBirthday.title), 'Birthday title changed');
  assert.ok((await birthdayRow().innerText()).includes('تولد سالانه'), 'Annual birthday label is missing');
  assert.equal(await birthdayRow().getByRole('button', { name: /^حذف رویداد/ }).count(), 0,
    'Projected annual birthday exposes canonical event deletion');
  assert.ok((await cell.getAttribute('aria-label')).startsWith('۱۵ آبان ' + fa(year)), 'Birthday is on the wrong Jalali day');
  await page.getByRole('heading', { name: '۱۵ آبان ' + fa(year), exact: true }).waitFor();
  const dayEntries = await page.locator('[data-calendar-list="day"] [data-calendar-entry-id]').count();
  assert.equal(Number(await cell.getAttribute('data-calendar-count')), dayEntries,
    'Month count differs from the day list on 15 Aban ' + year);
  assert.ok(dayEntries >= 1, 'Birthday did not contribute to the monthly count');
  await assertUpcoming(expectedUpcoming);
  if (year === 1405) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Calendar overflows at 360px');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: path.join(localDir, 'birthday-15-aban-1405-mobile.png'), fullPage: true });
  }
  await selectDay(shift(day, 1));
  assert.equal(await birthdayRow().count(), 0, 'Birthday appears after 15 Aban ' + year);
  await assertUpcoming(expectedUpcoming);
  checks.push('15 Aban ' + year + ': exactly one birthday, adjacent days empty, monthly count matches');
}

async function browserToday(day) {
  // Only browser time changes; the real API keeps its canonical next reminder.
  await page.clock.setFixedTime(new Date(day + 'T12:00:00Z'));
  await page.reload({ waitUntil: 'networkidle' });
  await openCalendar();
}

try {
  await mkdir(localDir, { recursive: true });
  const login = await api('/auth/login', null, 'POST', { phone, password: 'Test12345!' });
  tokens.push(login.session_token); owner = login.member;
  assert.equal(owner.phone, phone);
  assert.equal(owner.birth_date, birthIso, 'The fake owner birthday fixture changed; do not alter it for this read-only check');
  assert.deepEqual(parts(new Date(birthIso + 'T12:00:00Z'), 'persian'), { year: 1340, month: 8, day: 15 });
  originalProfile = profile(owner);
  beforeEvents = sortEvents(await api('/events', tokens[0]));
  const birthdays = birthdayRows(beforeEvents);
  assert.equal(birthdays.length, 1, 'Expected one existing canonical owner birthday');
  canonicalBirthday = birthdays[0];
  const currentAnniversary = anniversary(todayJ.year);
  const nextYear = currentAnniversary < todayIso ? todayJ.year + 1 : todayJ.year;
  assert.equal(canonicalBirthday.date, anniversary(nextYear), 'Stored birthday must remain the next reminder occurrence');
  assert.ok(anniversary(1405) < todayIso, 'This regression requires 15 Aban 1405 to have already passed');
  assert.ok(canonicalBirthday.date > shift(todayIso, 30), 'Fixture birthday must be outside the current 30-day horizon');

  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['data:', 'blob:'].includes(url.protocol)
      && !['http://127.0.0.1:5700', 'http://127.0.0.1:5800'].includes(url.origin)) return route.abort();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())
      && /^\/api\/v1\/(members\/me|events(?:\/|$)|uploads\/avatar)/.test(url.pathname)
      && url.pathname !== '/api/v1/events/sync-birthdays') {
      protectedWrites.push(request.method() + ' ' + url.pathname);
      return route.abort();
    }
    return route.continue();
  });
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await loginUi();
  await openCalendar();
  for (const year of [1405, 1404, 1406, 1407]) await checkYear(year);
  checks.push('real-date upcoming excludes the passed birthday and the next occurrence beyond 30 days, in every viewed year');

  // Both horizon endpoints are inclusive; viewing another year must never move
  // the list away from the browser's Tehran today. No stored dates are changed.
  for (const [offset, expected] of [[-31, 0], [-30, 1], [-29, 1], [0, 1], [1, 0]]) {
    await browserToday(shift(anniversary(1405), offset));
    await assertUpcoming(expected);
    if (expected) assert.ok((await birthdayRow('upcoming').innerText()).includes('۱۵ آبان ۱۴۰۵'), 'Upcoming projects the wrong year');
    await selectDay(anniversary(1407));
    assert.equal(await birthdayRow().count(), 1, 'Annual future birthday missing during horizon check');
    await assertUpcoming(expected);
  }
  checks.push('browser-only date checks: 31 days excluded, 30/29 days and birthday included, next day excluded; future-year view preserves the horizon');

  assert.deepEqual(sortEvents(await api('/events', tokens[0])), beforeEvents, 'Read-only calendar viewing changed canonical events');
  assert.deepEqual(profile((await api('/auth/session', tokens[0])).member), originalProfile, 'Read-only calendar viewing changed the profile');
  assert.deepEqual(protectedWrites, [], 'Browser attempted a profile, photo or event mutation');
  assert.deepEqual(pageErrors, [], 'Birthday calendar raised a browser error');
  checks.push('all canonical event rows, birthday ID/date, profile and avatar preserved');
  console.log('Annual birthday calendar browser checks passed: ' + checks.length + ' groups.');
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(localDir, 'birthday-calendar-failure.png'), fullPage: true }).catch(() => {});
    await writeFile(path.join(localDir, 'birthday-calendar-failure.txt'), await page.locator('body').innerText()).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  for (const token of tokens) {
    try { await api('/auth/logout', token, 'POST'); }
    catch { cleanupErrors.push('Could not close own local test session'); }
  }
  await writeFile(path.join(localDir, 'birthday-calendar-check-result.json'), JSON.stringify({
    todayIso, todayJ, birthday: canonicalBirthday && { id: canonicalBirthday.id, date: canonicalBirthday.date },
    checks, pageErrors, protectedWrites, cleanupErrors,
  }, null, 2));
  assert.deepEqual(cleanupErrors, [], 'Probe session cleanup must succeed');
}
