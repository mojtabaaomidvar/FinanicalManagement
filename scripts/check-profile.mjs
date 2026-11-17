import { chromium } from 'playwright';
import { backupHomePreferences } from './sandbox-home-preferences.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// All requests and fixture restoration are confined to this isolated local sandbox.
const base = 'http://127.0.0.1:5700';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localDir = path.join(root, '.local-test');
const backupPath = path.join(localDir, 'profile-fixture-backup.json');
const marker = 'profile-e2e-' + Date.now();
const phone = '09000000001';
const tokens = [], uploads = [], uploadReads = [], checks = [], pageErrors = [], cleanupErrors = [];
let browser, context, page, owner, original, originalBirthdays, sandboxConfig, releaseRefresh, homePrefsBackup;
let fixtureBackupCreated = false;
const parts = (value, calendar = 'gregory') => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran', calendar, numberingSystem: 'latn', year: 'numeric', month: 'numeric', day: 'numeric',
}).formatToParts(value).filter(part => ['year', 'month', 'day'].includes(part.type))
  .map(part => [part.type, Number(part.value)]));
const iso = value => [value.year, String(value.month).padStart(2, '0'), String(value.day).padStart(2, '0')].join('-');
const todayIso = iso(parts(new Date()));
const tomorrowIso = new Date(Date.parse(todayIso + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
const fa = value => String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);

function adultBirth(anniversary) {
  const desired = parts(new Date(anniversary + 'T12:00:00Z'), 'persian');
  const year = desired.year - 20;
  const start = Date.UTC(year + 620, 0, 1);
  for (const day of desired.month === 12 && desired.day === 30 ? [30, 29] : [desired.day]) {
    for (let index = 0; index < 740; index++) {
      const value = new Date(start + index * 86400000);
      const candidate = parts(value, 'persian');
      if (candidate.year === year && candidate.month === desired.month && candidate.day === day) return value.toISOString().slice(0, 10);
    }
  }
  throw new Error('Could not derive adult Jalali birthday fixture');
}

async function api(route, token, method = 'GET', body) {
  const response = await fetch(base + '/api/v1' + route, {
    method, headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok([200, 201, 204].includes(response.status), `${method} ${route}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

// API-generated IDs cannot be restored via HTTP. Preserve only this fake owner's
// original birthday rows through the sandbox's non-superuser connection and RLS.
async function birthdayFixture(action, rows = []) {
  const source = `import json,sys,psycopg
p=json.load(sys.stdin)
assert p['phone']=='09000000001'
with psycopg.connect(host='127.0.0.1',port=55439,dbname='khaneyar_local_sandbox',user='khaneyar_sandbox',password=p['password']) as db:
 with db.cursor() as cur:
  cur.execute('SELECT current_database()')
  assert cur.fetchone()[0]=='khaneyar_local_sandbox'
  cur.execute('SELECT phone,family_id::text FROM members WHERE id=%s',(p['id'],))
  assert cur.fetchone()==(p['phone'],p['familyId'])
  cur.execute("SELECT set_config('app.family_id',%s,true)",(p['familyId'],))
  cur.execute("SELECT set_config('app.document_member_id',%s,true)",(p['id'],))
  where="family_id=%s AND for_member_id=%s AND kind='event' AND title LIKE 'تولد%%'"
  if p['action']=='restore':
   cur.execute('DELETE FROM family_events WHERE '+where,(p['familyId'],p['id']))
   for row in p['rows']:
    assert row['family_id']==p['familyId'] and row['for_member_id']==p['id'] and row['kind']=='event' and row['title'].startswith('تولد')
    cur.execute('INSERT INTO family_events SELECT * FROM json_populate_record(NULL::family_events,%s::json)',(json.dumps(row),))
  cur.execute('SELECT to_jsonb(e) FROM family_events e WHERE '+where+' ORDER BY id',(p['familyId'],p['id']))
  print(json.dumps([row[0] for row in cur.fetchall()]))
`;
  const python = await realpath(path.join(root, 'backend', '.venv', 'Scripts', 'python.exe')).catch(() => 'python.exe');
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-X', 'utf8', '-c', source], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.on('close', code => {
      if (code !== 0) reject(new Error('Local birthday fixture operation failed: ' + error));
      else { try { resolve(JSON.parse(output)); } catch (cause) { reject(cause); } }
    });
    child.stdin.end(JSON.stringify({ action, rows, phone, id: owner.id, familyId: owner.family_id, password: sandboxConfig.AppPassword }));
  });
}

async function poll(check, message) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await page.waitForTimeout(120);
  }
  throw new Error(message);
}

async function loginUi() {
  await page.goto(base, { waitUntil: 'networkidle' });
  if (!(await page.getByPlaceholder('شماره موبایل', { exact: true }).count())) await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await page.getByPlaceholder('شماره موبایل', { exact: true }).first().fill(phone);
  await page.getByPlaceholder('رمز عبور', { exact: true }).fill('Test12345!');
  const response = page.waitForResponse(value => value.url().endsWith('/auth/login'));
  await page.locator('form').filter({ has: page.getByPlaceholder('رمز عبور', { exact: true }) }).locator('button[type=submit]').click();
  tokens.push((await (await response).json()).session_token);
  await page.locator('.hub-overview').waitFor();
  await homeIdle();
}

async function homeIdle() {
  await page.locator('.hub-overview').waitFor();
  await poll(async () => (await page.locator('.hub-overview').getAttribute('aria-busy')) !== 'true', 'Home did not finish loading');
}

async function homeFromProfile() {
  await page.getByRole('button', { name: 'بازگشت', exact: true }).click();
  await page.getByRole('heading', { name: 'تنظیمات', exact: true }).waitFor();
  await page.goBack();
  await homeIdle();
}

async function openProfile() {
  await page.getByRole('button', { name: 'پروفایل و تنظیمات', exact: true }).click();
  await page.getByRole('heading', { name: 'تنظیمات', exact: true }).waitFor();
  await page.locator('.set-row-profile').click();
  await page.getByRole('heading', { name: 'پروفایل من', exact: true }).first().waitFor();
}

async function pickBirth(birthIso) {
  const target = parts(new Date(birthIso + 'T12:00:00Z'), 'persian');
  await page.locator('.date-field').click();
  await page.locator('.dp-box').getByRole('button', { name: 'انتخاب ماه و سال', exact: true }).click();
  const columns = page.locator('.dp-wheel .wheel-col');
  for (const [column, index] of [[columns.nth(0), target.month - 1], [columns.nth(1), target.year - 1300]]) {
    await column.locator('.wheel-scroll').evaluate((element, value) => {
      element.scrollTop = value * 40;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    }, index);
    await poll(async () => (await column.locator('.wheel-item.active').count()) === 1
      && (await column.locator('.wheel-item.active').innerText()).trim() === (await column.locator('.wheel-item').nth(index).innerText()).trim(),
    'Birthday month/year wheel did not settle');
  }
  await page.locator('.dp-box').getByRole('button', { name: 'تایید', exact: true }).click();
  await page.locator('.dp-grid').getByRole('button', { name: fa(target.day), exact: true }).click();
  await page.locator('.dp-overlay').waitFor({ state: 'hidden' });
}

async function saveProfile(message = 'پروفایل ذخیره شد') {
  const response = page.waitForResponse(value => value.url().endsWith('/api/v1/members/me') && value.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'ذخیره پروفایل', exact: true }).click();
  const saved = await response;
  assert.equal(saved.status(), 200, 'Profile save was rejected');
  const member = await saved.json();
  await page.getByText(message, { exact: true }).waitFor();
  await poll(async () => await page.getByRole('button', { name: 'ذخیره پروفایل', exact: true }).isEnabled(), 'Profile save stayed busy');
  return member;
}

async function ownerBirthdays() {
  return (await api('/events', tokens[0])).filter(value => value.for_member_id === owner.id && value.kind === 'event' && value.title.startsWith('تولد'));
}

async function openCalendar(day) {
  const tile = page.locator('[data-home-module="calendar"]');
  if (!(await tile.isVisible())) await tile.locator('xpath=ancestor::details').locator('summary').click();
  await tile.click();
  await page.locator('.household-calendar').waitFor();
  await poll(async () => (await page.locator('.household-calendar').getAttribute('aria-busy')) !== 'true', 'Calendar stayed busy');
  let cell = page.locator('[data-calendar-date="' + day + '"]');
  for (let attempt = 0; !(await cell.count()) && attempt < 13; attempt++) {
    const first = await page.locator('[data-calendar-date]').first().getAttribute('data-calendar-date');
    await page.getByRole('button', { name: day < first ? 'ماه قبل' : 'ماه بعد', exact: true }).click();
    cell = page.locator('[data-calendar-date="' + day + '"]');
  }
  await cell.click();
}

const calendarRow = id => page.locator('[data-calendar-list="day"] [data-calendar-ref-kind="event"][data-calendar-ref-id="' + id + '"]');

async function screenshot(name) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Profile/Home has horizontal mobile overflow');
  await page.screenshot({ path: path.join(localDir, name + '.png'), fullPage: true });
}

async function removeUpload(url) {
  const value = new URL(url, base);
  assert.ok(['http://127.0.0.1:5700', 'http://127.0.0.1:5800'].includes(value.origin), 'Fixture avatar escaped the local sandbox');
  const objectPath = decodeURIComponent(value.pathname.replace(/^\/api\/v1\/files\//, ''));
  assert.match(objectPath, new RegExp('^avatars/' + owner.id + '-[0-9]+\\.(jpg|jpeg|png|webp)$'));
  const storageRoot = await realpath(path.join(localDir, 'uploads'));
  const candidate = path.resolve(storageRoot, objectPath);
  assert.ok(candidate.startsWith(storageRoot + path.sep), 'Avatar cleanup escaped local uploads');
  const actual = await realpath(candidate).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (actual) { assert.ok(actual.startsWith(storageRoot + path.sep)); await unlink(actual); }
}

try {
  homePrefsBackup = await backupHomePreferences('profile');
  await mkdir(localDir, { recursive: true });
  const previousBackup = await realpath(backupPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  assert.equal(previousBackup, null, 'A previous profile fixture backup remains; restore it before running another probe');
  sandboxConfig = JSON.parse(await readFile(path.join(localDir, 'config.json'), 'utf8'));
  const login = await api('/auth/login', null, 'POST', { phone, password: 'Test12345!' });
  tokens.push(login.session_token); owner = login.member;
  assert.equal(owner.phone, phone);
  original = { name: owner.name, gender: owner.gender, birth_date: owner.birth_date, avatar_url: owner.avatar_url };
  originalBirthdays = await birthdayFixture('snapshot');
  // Keep a recovery copy if the process exits before its finally block completes.
  await writeFile(backupPath, JSON.stringify({
    phone, memberId: owner.id, familyId: owner.family_id, profile: original, birthdays: originalBirthdays,
  }, null, 2));
  fixtureBackupCreated = true;
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['data:', 'blob:'].includes(url.protocol) || ['http://127.0.0.1:5700', 'http://127.0.0.1:5800'].includes(url.origin)
      ? route.continue() : route.abort();
  });
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (response.url().endsWith('/api/v1/uploads/avatar') && response.status() === 200) {
      uploadReads.push(response.json().then(value => { uploads.push(value.url); }));
    }
  });
  await loginUi();
  assert.equal(await page.locator('[data-home-module="settings"]').count(), 0, 'Settings still appears as a Home tile');
  await openProfile();
  await page.getByPlaceholder('نام شما', { exact: true }).fill(marker);
  await pickBirth(adultBirth(todayIso));
  const saved = await saveProfile();
  assert.equal(saved.birth_date, adultBirth(todayIso));
  let birthdays = await ownerBirthdays();
  assert.equal(birthdays.length, 1); assert.equal(birthdays[0].date, todayIso); assert.equal(birthdays[0].title, 'تولد ' + marker);
  const birthdayId = birthdays[0].id;
  if (originalBirthdays.length) assert.equal(birthdayId, originalBirthdays[0].id, 'Changing a profile replaced its canonical birthday identity');
  await homeFromProfile(); await openCalendar(todayIso);
  assert.equal(await calendarRow(birthdayId).count(), 1, 'Saved DOB did not immediately appear in calendar');
  assert.ok((await calendarRow(birthdayId).innerText()).includes('تولد ' + marker));
  await screenshot('profile-birthday-immediate-mobile');
  await page.goBack(); await homeIdle(); await openProfile();
  await pickBirth(adultBirth(tomorrowIso)); await saveProfile();
  birthdays = await ownerBirthdays();
  assert.equal(birthdays.length, 1); assert.equal(birthdays[0].id, birthdayId); assert.equal(birthdays[0].date, tomorrowIso);
  await homeFromProfile(); await openCalendar(todayIso);
  assert.equal(await calendarRow(birthdayId).count(), 0, 'Changed birthday stayed on the old calendar day');
  await page.locator('[data-calendar-date="' + tomorrowIso + '"]').click();
  assert.equal(await calendarRow(birthdayId).count(), 1, 'Changed DOB did not immediately move in calendar');
  checks.push('adult Jalali DOB add/change immediately updates calendar with one canonical birthday identity, without reloading');
  await page.goBack(); await homeIdle(); await openProfile();
  let heldRefresh = false;
  const refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
  await page.route('**/api/v1/events/sync-birthdays', async route => {
    heldRefresh = true; await refreshGate;
    await route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: 'LOCAL_PROBE', message: 'Local refresh probe unavailable' }) });
  });
  const changedName = marker + '-refresh';
  await page.getByPlaceholder('نام شما', { exact: true }).fill(changedName);
  const failedRefreshSave = saveProfile('پروفایل ذخیره شد؛ به‌روزرسانی اطلاعات خانه کامل نشد.');
  await poll(async () => heldRefresh, 'Saved profile did not start its Home refresh');
  assert.ok(await page.getByRole('button', { name: 'انتخاب عکس پروفایل', exact: true }).isDisabled(), 'Avatar upload stayed enabled during profile save/refresh');
  releaseRefresh(); releaseRefresh = undefined;
  await failedRefreshSave;
  birthdays = await ownerBirthdays();
  assert.equal(birthdays[0].id, birthdayId); assert.equal(birthdays[0].title, 'تولد ' + changedName);
  assert.equal((await api('/auth/session', tokens[0])).member.name, changedName, 'Refresh failure lost the successful profile save');
  await page.unroute('**/api/v1/events/sync-birthdays');
  await homeFromProfile();
  await page.locator('.hub-overview').getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
  await homeIdle();
  assert.equal(await page.locator('.hub-overview').getByText('بخشی از اطلاعات دریافت نشد.', { exact: true }).count(), 0);
  checks.push('refresh failure keeps the committed profile and atomic birthday, shows partial-success message, and recovers through Home retry');
  await openProfile();
  await page.getByRole('button', { name: 'حذف تاریخ تولد', exact: true }).click();
  assert.equal(await page.locator('.date-field').innerText(), 'انتخاب تاریخ');
  await saveProfile();
  assert.equal((await ownerBirthdays()).length, 0, 'Cleared DOB kept its generated birthday');
  await homeFromProfile(); await openCalendar(tomorrowIso);
  assert.equal(await page.locator('.household-calendar [data-calendar-ref-id="' + birthdayId + '"]').count(), 0, 'Cleared DOB stayed in calendar');
  checks.push('DOB clear is an editable draft and removes the calendar birthday immediately after saving');
  await page.goBack(); await homeIdle(); await openProfile();
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 48;
    const brush = canvas.getContext('2d'); brush.fillStyle = '#3478a1'; brush.fillRect(0, 0, 48, 48);
    brush.fillStyle = '#e0c8a8'; brush.beginPath(); brush.arc(24, 21, 10, 0, 2 * Math.PI); brush.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const avatarResponse = page.waitForResponse(value => value.url().endsWith('/api/v1/uploads/avatar') && value.status() === 200);
  await page.locator('input[type=file]').setInputFiles({ name: marker + '.png', mimeType: 'image/png', buffer: Buffer.from(imageData, 'base64') });
  const uploaded = (await (await avatarResponse).json()).url;
  await page.getByText('پروفایل ذخیره شد', { exact: true }).waitFor();
  await poll(async () => await page.getByRole('button', { name: 'انتخاب عکس پروفایل', exact: true }).isEnabled(), 'Avatar upload stayed busy');
  assert.equal((await api('/auth/session', tokens[0])).member.avatar_url, uploaded);
  await homeFromProfile();
  const header = page.getByRole('button', { name: 'پروفایل و تنظیمات', exact: true });
  await poll(async () => await header.locator('img').count() === 1
    && await header.locator('img').evaluate(element => element.complete && element.naturalWidth > 0), 'Uploaded avatar did not display in Home header');
  assert.equal(await header.locator('img').getAttribute('src'), uploaded);
  assert.equal(await header.getAttribute('title'), 'پروفایل و تنظیمات');
  const avatarBox = await header.boundingBox(), bellBox = await page.locator('.hub-bell').boundingBox();
  assert.ok(avatarBox && bellBox && Math.abs((avatarBox.y + avatarBox.height / 2) - (bellBox.y + bellBox.height / 2)) < 3,
    'Avatar and notification bell are not aligned in the Home header');
  assert.ok(avatarBox.x + avatarBox.width <= bellBox.x + 1 || bellBox.x + bellBox.width <= avatarBox.x + 1, 'Header actions overlap');
  assert.equal(await page.locator('[data-home-module="settings"]').count(), 0);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await screenshot('profile-home-header-mobile-light');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await screenshot('profile-home-header-mobile-dark');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  checks.push('real avatar upload saves and displays next to the bell in the 360px light/dark Home header; Settings tile is absent');
  const mountedHome = await page.locator('.hub-page').elementHandle();
  const currentProfile = { name: changedName, gender: saved.gender, birth_date: null };
  const missingAvatar = base + '/' + marker + '-missing-avatar.png';
  await page.route(missingAvatar, route => route.fulfill({ status: 404, body: '' }));
  await api('/members/me', tokens[0], 'PATCH', { ...currentProfile, avatar_url: missingAvatar });
  // A reconnect notification refreshes the existing mounted Home through its real repository.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await poll(async () => await header.locator('img').count() === 0 && (await header.innerText()).trim() === changedName[0], 'Failed avatar did not fall back to the member initial');
  assert.ok(await mountedHome.evaluate(element => element.isConnected), 'Home remounted before the failed-avatar check');
  const recoveredAvatar = uploaded + '#recovered';
  await api('/members/me', tokens[0], 'PATCH', { ...currentProfile, avatar_url: recoveredAvatar });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await poll(async () => await header.locator('img').count() === 1
    && await header.locator('img').getAttribute('src') === recoveredAvatar
    && await header.locator('img').evaluate(element => element.complete && element.naturalWidth > 0), 'Changed avatar URL did not recover from a previous image failure');
  assert.ok(await mountedHome.evaluate(element => element.isConnected), 'Home remounted before the changed-avatar recovery check');
  await homeIdle();
  await header.click(); await page.getByRole('heading', { name: 'تنظیمات', exact: true }).waitFor();
  checks.push('failed avatar uses the initial; a changed URL recovers on the same mounted Home; header opens Settings');
  assert.deepEqual(pageErrors, [], 'Profile/Home/calendar raised a browser error');
  console.log('Profile browser checks passed: ' + checks.length + ' groups.');
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(localDir, 'profile-failure.png'), fullPage: true }).catch(() => {});
    await writeFile(path.join(localDir, 'profile-failure.txt'), await page.locator('body').innerText()).catch(() => {});
  }
  throw error;
} finally {
  releaseRefresh?.();
  await browser?.close();
  try { await homePrefsBackup?.restore(); } catch { cleanupErrors.push('Could not restore original Home preferences'); }
  await Promise.allSettled(uploadReads);
  if (owner && original) {
    try { await api('/members/me', tokens[0], 'PATCH', original); }
    catch { cleanupErrors.push('Could not restore fake owner profile'); }
    if (originalBirthdays) {
      try { assert.deepEqual(await birthdayFixture('restore', originalBirthdays), originalBirthdays); }
      catch (error) { cleanupErrors.push('Could not restore original owner birthday rows and IDs: ' + error.message); }
    }
    try {
      const restored = (await api('/auth/session', tokens[0])).member;
      assert.deepEqual({ name: restored.name, gender: restored.gender, birth_date: restored.birth_date, avatar_url: restored.avatar_url }, original);
    } catch { cleanupErrors.push('Restored profile fields did not match the original'); }
  }
  for (const url of new Set(uploads)) {
    try { await removeUpload(url); }
    catch { cleanupErrors.push('Could not remove one own local avatar fixture'); }
  }
  for (const token of tokens) {
    try { await api('/auth/logout', token, 'POST'); }
    catch { cleanupErrors.push('Could not close one own test session'); }
  }
  await writeFile(path.join(localDir, 'profile-check-result.json'), JSON.stringify({ todayIso, checks, pageErrors, cleanupErrors }, null, 2));
  if (fixtureBackupCreated && !cleanupErrors.length) await unlink(backupPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  assert.deepEqual(cleanupErrors, [], 'Profile probe cleanup failed');
}
