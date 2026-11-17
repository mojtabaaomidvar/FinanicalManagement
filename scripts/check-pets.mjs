import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:5700';
const marker = 'pets-e2e-' + Date.now();
const hubTitle = 'حیوانات خانگی و مراقبت از آن‌ها';
const tokens = [], pets = [], taskIds = [], originalPrefs = new Map(), pageErrors = [], careReplies = new Map();
const navigationEvents = [], modalStates = [], consoleErrors = [];
let browser, context, page, owner, member, other, releaseLate;
const dateParts = date => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran', calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: 'numeric', day: 'numeric',
}).formatToParts(date).filter(part => ['year', 'month', 'day'].includes(part.type)).map(part => [part.type, Number(part.value)]));
const currentDay = dateParts(new Date());
const todayIso = [currentDay.year, String(currentDay.month).padStart(2, '0'), String(currentDay.day).padStart(2, '0')].join('-');
const tomorrowIso = new Date(Date.parse(todayIso + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
const profile = (pet, patch = {}) => ({ name: pet.name, species: pet.species, breed: pet.breed, birth_date: pet.birth_date, ...patch });
const taskWrite = (task, patch = {}) => ({ title: task.title, description: task.description, assignee_id: task.assignee_id, due_date: task.due_date, ...patch });
async function api(path, token, method = 'GET', body, expected = [200, 201, 204]) {
  const response = await fetch(base + '/api/v1' + path, {
    method, headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(expected.includes(response.status), `${method} ${path}: ${response.status}`);
  if (path.startsWith('/pets')) assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.status === 204 ? null : response.json();
}
async function loginApi(phone) {
  const result = await api('/auth/login', null, 'POST', { phone, password: 'Test12345!' });
  tokens.push(result.session_token); return { token: result.session_token, id: result.member.id };
}
async function loginUi(target, phone) {
  await target.goto(base, { waitUntil: 'networkidle' });
  if (!(await target.getByPlaceholder('شماره موبایل', { exact: true }).count())) await target.getByRole('button', { name: 'ورود', exact: true }).click();
  await target.getByPlaceholder('شماره موبایل', { exact: true }).first().fill(phone);
  await target.getByPlaceholder('رمز عبور', { exact: true }).fill('Test12345!');
  const response = target.waitForResponse(item => item.url().endsWith('/auth/login'));
  await target.locator('form').filter({ has: target.getByPlaceholder('رمز عبور', { exact: true }) }).locator('button[type=submit]').click();
  tokens.push((await (await response).json()).session_token); await target.getByText(hubTitle, { exact: true }).waitFor();
}
async function openPets(target = page) {
  const deadline = Date.now() + 25000;
  while (!(await target.locator('.pets-page').isVisible())) {
    assert.ok(Date.now() < deadline, 'Pets navigation unavailable');
    await target.getByText(hubTitle, { exact: true }).click(); await target.waitForTimeout(250);
  }
  await idle(target);
}
async function idle(target = page) {
  await target.waitForFunction(() => document.querySelector('.pets-page')?.getAttribute('aria-busy') === 'false');
}
async function documentState() {
  return page.evaluate(() => ({
    url: location.origin === 'null' ? location.protocol + location.pathname : location.origin + location.pathname,
    title: document.title, readyState: document.readyState, bodyLength: document.body?.innerText.length ?? 0,
    bodyChildren: document.body?.childElementCount ?? 0, rootChildren: document.querySelector('#root,#app')?.childElementCount ?? null,
    petsCount: document.querySelectorAll('.pets-page').length, petsBusy: document.querySelector('.pets-page')?.getAttribute('aria-busy') ?? null,
    historyLength: history.length, historyState: history.state,
  }));
}
async function captureModal(label) { modalStates.push({ label, ...await documentState() }); }
async function detail(name, target = page) {
  await target.getByRole('button', { name: 'جزئیات ' + name, exact: true }).click();
  await target.getByRole('heading', { name, exact: true }).waitFor(); await idle(target);
}
async function screenshot(name, target = page) {
  await target.waitForTimeout(300);
  assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page overflows');
  for (const sheet of await target.locator('.modal-sheet').all()) assert.ok(await sheet.evaluate(item => item.scrollWidth <= item.clientWidth + 1), 'Mobile sheet overflows');
  await target.screenshot({ path: '.local-test/' + name + '.png', fullPage: !(await target.locator('.modal-sheet').count()) });
}
async function savePet() {
  const response = page.waitForResponse(item => item.url().includes('/api/v1/pets') && ['POST', 'PATCH'].includes(item.request().method()));
  await page.getByRole('button', { name: 'ذخیرهٔ مشخصات حیوان', exact: true }).click();
  const saved = await response; assert.ok([200, 201].includes(saved.status()), 'Saving pet failed');
  const result = await saved.json(); if (!pets.includes(result.id)) pets.push(result.id);
  await page.getByRole('button', { name: 'ذخیرهٔ مشخصات حیوان', exact: true }).waitFor({ state: 'hidden' }); await idle(); return result;
}
async function saveCare() {
  const response = page.waitForResponse(item => item.url().endsWith('/care-tasks') && item.request().method() === 'POST');
  await captureModal('care-before-retry');
  await page.getByRole('button', { name: 'ذخیرهٔ کار مراقبتی', exact: true }).click();
  const saved = await response; assert.ok([200, 201].includes(saved.status()), 'Saving care failed');
  await captureModal('care-response');
  const request = saved.request().postDataJSON();
  const captured = careReplies.get(request.operation_id);
  if (captured) assert.equal(captured.status, saved.status());
  const result = captured?.body ?? await saved.json(); taskIds.push(result.id);
  await page.getByRole('button', { name: 'ذخیرهٔ کار مراقبتی', exact: true }).waitFor({ state: 'hidden' }); await captureModal('care-form-closed'); await idle();
  await page.locator('[data-care-task-id="' + result.id + '"]').getByText(result.title, { exact: true }).waitFor();
  assert.deepEqual(pageErrors, [], 'Pets page failed after care creation');
  return { task: result, request };
}
async function poll(check, message, target = page) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) { if (await check()) return; await target.waitForTimeout(150); }
  throw new Error(message);
}
async function serverTask(id) { return (await api('/tasks', owner.token)).find(task => task.id === id); }
async function notifications(target = page) {
  await target.reload({ waitUntil: 'networkidle' }); await target.locator('.hub-bell').click();
  await target.getByRole('heading', { name: 'اعلان‌ها', exact: true }).waitFor(); await target.waitForTimeout(250);
}
async function enableTaskNotifications(account) {
  const prefs = await api('/notifications/prefs', account.token); originalPrefs.set(account, prefs);
  await api('/notifications/prefs', account.token, 'PATCH', { enabled: true, domains: { tasks: true }, lead_days: { tasks: 7 } });
}
async function offlineStates(target = page) {
  return target.evaluate(async () => {
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
    if (keys.some(key => /^pets[:/]/.test(String(key)))) throw new Error('Pet profiles were persisted');
    const key = await read('__crypto_key__'); const states = [];
    for (const name of keys.filter(value => String(value).startsWith('shopping-offline:'))) {
      const record = await read(name);
      if (!record?.iv || !record?.ct || key?.extractable !== false) throw new Error('Offline task state must remain encrypted');
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(record.iv) }, key, record.ct);
      states.push(JSON.parse(new TextDecoder().decode(decrypted)));
    }
    db.close(); return states;
  });
}
async function backOnlyProbe() {
  let pet;
  try {
    await mkdir('.local-test', { recursive: true }); owner = await loginApi('09000000001');
    const prefix = marker + '-back-';
    pet = await api('/pets', owner.token, 'POST', { name: prefix + 'W'.repeat(80 - prefix.length), species: 'گربه' });
    browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
    context = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
    page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message)); page.on('crash', () => pageErrors.push('Renderer crashed'));
    await loginUi(page, '09000000001'); await openPets(); await detail(pet.name);
    await screenshot('pets-long-name-mobile');
    await page.getByRole('button', { name: 'حذف حیوان', exact: true }).click(); await screenshot('pets-delete-mobile');
    await page.getByRole('button', { name: 'انصراف', exact: true }).click();
    await page.getByRole('button', { name: 'ثبت کار مراقبتی جدید', exact: true }).click();
    await page.getByRole('textbox', { name: 'عنوان کار مراقبتی', exact: true }).fill(marker + '-back-draft');
    await page.waitForTimeout(300); await captureModal('back-care-open');
    await page.goBack(); await page.getByRole('heading', { name: pet.name, exact: true }).waitFor(); await captureModal('back-care-to-detail');
    assert.equal(await page.getByRole('button', { name: 'ذخیرهٔ کار مراقبتی', exact: true }).count(), 0); assert.equal(page.url(), base + '/');
    await page.waitForTimeout(300); await page.goBack();
    await page.getByRole('heading', { name: pet.name, exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'جزئیات ' + pet.name, exact: true }).waitFor(); await captureModal('back-detail-to-list');
    assert.equal(await page.locator('.pets-sheet').count(), 0); assert.equal(page.url(), base + '/');
    await page.waitForTimeout(300); await page.goBack(); await page.getByText(hubTitle, { exact: true }).waitFor();
    await page.locator('.pets-page').waitFor({ state: 'hidden' }); await captureModal('back-list-to-hub');
    assert.equal(page.url(), base + '/'); assert.deepEqual(pageErrors, []);
    assert.equal((await api('/pets/' + pet.id, owner.token)).care_tasks.length, 0, 'Back saved an unsent care draft');
    await screenshot('pets-back-hub-mobile');
    console.log('PASS: Native browser Back closes care form to detail, detail to Pets list, then returns Hub without leaving5700 or saving draft; stable long-name/delete mobile screenshots captured.');
  } catch (error) {
    const state = page ? await documentState().catch(() => null) : null;
    console.error('Pets Back failure:', JSON.stringify({ state, modalStates, pageErrors }));
    if (page) await page.screenshot({ path: '.local-test/pets-back-failure.png', fullPage: true }).catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close();
    if (pet && owner) {
      const result = await api('/pets/' + pet.id, owner.token, 'GET', undefined, [200, 404]).catch(() => null);
      if (result) await api(`/pets/${pet.id}?base_revision=${result.pet.revision}`, owner.token, 'DELETE').catch(() => {});
    }
    for (const token of tokens) await api('/auth/logout', token, 'POST').catch(() => {});
  }
}
if (process.argv.includes('--back-only')) await backOnlyProbe();
else try {
  await mkdir('.local-test', { recursive: true });
  owner = await loginApi('09000000001'); member = await loginApi('09000000002'); other = await loginApi('09000000003');
  const admin = await loginApi('09000000004');
  for (const account of [owner, member, other]) await enableTaskNotifications(account);
  await api('/events/sync-birthdays', owner.token, 'POST');
  const beforeFinance = await api('/transactions', owner.token);
  const beforeCalendar = (await api('/events', owner.token)).map(event => ({ id: event.id, date: event.date, title: event.title }));
  const write = { name: marker, species: 'گربه', breed: 'پرشین', birth_date: todayIso };
  await api('/pets', member.token, 'POST', write, [403]);
  await api('/pets', owner.token, 'POST', { ...write, birth_date: tomorrowIso }, [422]);
  await api('/pets', owner.token, 'POST', { ...write, birth_date: todayIso + 'T12:00:00Z' }, [422]);
  await api('/pets', owner.token, 'POST', { ...write, species: '   ' }, [422]);
  await api('/pets', owner.token, 'POST', { ...write, family_id: randomUUID() }, [422]);
  browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  page = await context.newPage();
  page.on('pageerror', error => { pageErrors.push(error.message); console.error('Pets page error:', error.message); });
  page.on('crash', () => { pageErrors.push('Renderer crashed'); console.error('Pets renderer crashed'); });
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    const parsed = new URL(frame.url());
    const entry = { url: parsed.origin === 'null' ? parsed.protocol + parsed.pathname : parsed.origin + parsed.pathname };
    navigationEvents.push(entry); void documentState().then(state => Object.assign(entry, state)).catch(() => {});
  });
  await loginUi(page, '09000000001'); await openPets();
  await page.getByRole('button', { name: 'ثبت حیوان جدید', exact: true }).click();
  await page.getByRole('textbox', { name: 'نام حیوان', exact: true }).fill(marker);
  await page.getByRole('textbox', { name: 'نوع حیوان', exact: true }).fill('گربه');
  await page.getByRole('textbox', { name: 'نژاد', exact: true }).fill('پرشین');
  await page.getByRole('group', { name: 'تاریخ تولد', exact: true }).locator('.date-field').click();
  await page.locator('.dp-box').getByRole('button', { name: 'امروز', exact: true }).click();
  await page.locator('.dp-overlay').waitFor({ state: 'hidden' }); await screenshot('pets-create-mobile');
  let pet = await savePet(); assert.equal(pet.birth_date, todayIso); assert.equal(pet.species, 'گربه'); assert.equal(pet.breed, 'پرشین');
  assert.equal(pet.can_edit, true); assert.equal(pet.can_delete, true);
  assert.deepEqual(Object.keys(pet).sort(), ['birth_date', 'breed', 'can_delete', 'can_edit', 'created_at', 'id', 'name', 'revision', 'species', 'updated_at']);
  const longName = marker + '-minimal-' + 'W'.repeat(80 - marker.length - 9);
  const minimal = await api('/pets', owner.token, 'POST', { name: longName, species: 'پرنده' });
  pets.push(minimal.id); assert.equal(minimal.birth_date, null); assert.equal(minimal.breed, null);
  assert.equal((await api('/pets/' + pet.id, member.token)).pet.can_edit, false);
  assert.equal((await api('/pets/' + pet.id, admin.token)).pet.can_edit, true);
  await api('/pets/' + pet.id, member.token, 'PATCH', { ...profile(pet), base_revision: pet.revision }, [403]);
  await api(`/pets/${pet.id}?base_revision=${pet.revision}`, member.token, 'DELETE', undefined, [403]);
  await detail(pet.name); await captureModal('detail-before-profile'); await page.getByRole('button', { name: 'ویرایش مشخصات حیوان', exact: true }).click(); await captureModal('profile-open');
  await page.getByRole('textbox', { name: 'نام حیوان', exact: true }).fill(marker + '-edited');
  const firstRevision = pet.revision; pet = await savePet(); assert.equal(pet.name, marker + '-edited'); await captureModal('detail-after-profile');
  await api('/pets/' + pet.id, owner.token, 'PATCH', { ...profile(pet, { name: marker + '-stale' }), base_revision: firstRevision }, [409]);
  await api(`/pets/${pet.id}?base_revision=${firstRevision}`, owner.token, 'DELETE', undefined, [409]);
  await api('/pets/' + pet.id + '/care-tasks', member.token, 'POST', {
    title: marker + '-forbidden-care', assignee_id: member.id, due_date: todayIso, base_revision: pet.revision, operation_id: randomUUID(),
  }, [403]);
  await api('/pets/' + pet.id + '/care-tasks', owner.token, 'POST', {
    title: marker + '-stale-care', assignee_id: owner.id, due_date: todayIso, base_revision: firstRevision, operation_id: randomUUID(),
  }, [409]);

  // A committed care creation whose response was lost is retried with the same Task ID.
  await page.getByRole('button', { name: 'ثبت کار مراقبتی جدید', exact: true }).click();
  await captureModal('care-open');
  await page.getByRole('textbox', { name: 'عنوان کار مراقبتی', exact: true }).fill(marker + '-care');
  assert.equal(await page.getByRole('combobox', { name: 'مسئول کار', exact: true }).inputValue(), owner.id);
  await page.getByRole('combobox', { name: 'مسئول کار', exact: true }).selectOption(member.id);
  await page.getByRole('group', { name: 'موعد کار', exact: true }).locator('.date-field').click();
  await page.locator('.dp-box').getByRole('button', { name: 'امروز', exact: true }).click();
  await page.locator('.dp-overlay').waitFor({ state: 'hidden' }); await screenshot('pets-care-create-mobile');
  let lost = false, lostRequest, lostTask;
  const carePath = '**/api/v1/pets/' + pet.id + '/care-tasks';
  await context.route(carePath, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const request = route.request().postDataJSON(); const response = await route.fetch(); const body = await response.json();
    careReplies.set(request.operation_id, { status: response.status(), body });
    if (lost) return route.fulfill({ response, json: body });
    lost = true; lostRequest = request; lostTask = body;
    await route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: 'TEMPORARY', message: 'پاسخ موقت دریافت نشد؛ دوباره تلاش کنید.' }) });
  });
  const lostResponse = page.waitForResponse(item => item.url().endsWith('/care-tasks') && item.request().method() === 'POST');
  await page.getByRole('button', { name: 'ذخیرهٔ کار مراقبتی', exact: true }).click(); assert.equal((await lostResponse).status(), 503);
  await page.locator('.pets-sheet [role=alert]').waitFor(); await captureModal('care-after503'); assert.equal(lostTask.id, lostRequest.operation_id); taskIds.push(lostTask.id);
  const retried = await saveCare(); await context.unroute(carePath);
  assert.equal(retried.task.id, lostTask.id); assert.equal(retried.request.operation_id, lostRequest.operation_id);
  let care = retried.task; assert.equal(care.assignee_id, member.id); assert.equal(care.due_date, todayIso);
  const freshDetail = await api('/pets/' + pet.id, owner.token);
  assert.deepEqual(Object.keys(freshDetail).sort(), ['can_create_care', 'care_tasks', 'pet']);
  assert.equal(freshDetail.care_tasks.filter(task => task.id === care.id).length, 1);
  assert.deepEqual(Object.keys(care).sort(), ['assignee_id', 'can_complete', 'completed', 'due_date', 'id', 'revision', 'title']);
  assert.equal((await api('/tasks', owner.token)).filter(task => task.id === care.id).length, 1);
  await api('/pets/' + minimal.id + '/care-tasks', owner.token, 'POST', { ...lostRequest, base_revision: minimal.revision }, [409]);
  assert.equal((await api('/pets/' + minimal.id, owner.token)).care_tasks.length, 0);
  assert.ok(!('pet_id' in await serverTask(care.id))); assert.ok(!('pet_id' in (await api('/shopping/offline', owner.token)).tasks.find(task => task.id === care.id)));
  await api('/tasks', owner.token, 'POST', { title: marker + '-invalid-link', pet_id: pet.id }, [422]);
  assert.equal((await api('/pets/' + pet.id, member.token)).care_tasks.find(task => task.id === care.id).can_complete, true);
  assert.equal((await api('/pets/' + pet.id, other.token)).care_tasks.find(task => task.id === care.id).can_complete, false);
  await api('/tasks/' + care.id + '/complete', other.token, 'POST', { completed: true, base_revision: care.revision }, [403]);
  await screenshot('pets-detail-mobile');
  await page.locator('.pets-sheet').evaluate(sheet => { sheet.scrollTop = sheet.scrollHeight; }); await screenshot('pets-detail-footer-mobile');

  const readContext = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  const readPage = await readContext.newPage(); await loginUi(readPage, '09000000002');
  await notifications(readPage);
  const reminder = readPage.locator('.notif-item').filter({ hasText: care.title }); await reminder.waitFor(); assert.equal(await reminder.count(), 1);
  await reminder.click(); await readPage.getByRole('heading', { name: 'کارهای خانه', exact: true }).waitFor();
  await readPage.locator('#task-' + care.id).getByText(care.title, { exact: true }).waitFor();
  await readPage.reload({ waitUntil: 'networkidle' }); await openPets(readPage); await detail(pet.name, readPage);
  assert.equal(await readPage.getByRole('button', { name: 'ثبت حیوان جدید', exact: true }).count(), 0);
  for (const label of ['ویرایش مشخصات حیوان', 'حذف حیوان', 'ثبت کار مراقبتی جدید']) assert.equal(await readPage.getByRole('button', { name: label, exact: true }).count(), 0);
  await readPage.getByRole('button', { name: 'ثبت انجام‌شدن ' + care.title, exact: true }).click(); await idle(readPage);
  await poll(async () => (await serverTask(care.id)).completed, 'Assigned member completion was not synchronized', readPage);
  await readPage.getByRole('group', { name: 'وضعیت کارهای مراقبتی', exact: true }).getByRole('button', { name: 'انجام‌شده', exact: true }).click();
  await readPage.locator('[data-care-task-id="' + care.id + '"]').waitFor(); await screenshot('pets-completed-mobile', readPage);
  await notifications(readPage); assert.equal(await readPage.locator('.notif-item').filter({ hasText: care.title }).count(), 0);
  await readPage.reload({ waitUntil: 'networkidle' }); await openPets(readPage); await detail(pet.name, readPage);
  await readPage.getByRole('group', { name: 'وضعیت کارهای مراقبتی', exact: true }).getByRole('button', { name: 'انجام‌شده', exact: true }).click();
  await readPage.getByRole('button', { name: 'بازکردن دوبارهٔ ' + care.title, exact: true }).click(); await idle(readPage);
  await poll(async () => !(await serverTask(care.id)).completed, 'Assigned member reopening was not synchronized', readPage);
  await readContext.close();
  await notifications(); assert.equal(await page.locator('.notif-item').filter({ hasText: care.title }).count(), 0, 'Creator got an assignee-only reminder');
  const otherContext = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Asia/Tehran', serviceWorkers: 'block' });
  const otherPage = await otherContext.newPage(); await loginUi(otherPage, '09000000003'); await notifications(otherPage);
  assert.equal(await otherPage.locator('.notif-item').filter({ hasText: care.title }).count(), 0);
  await otherPage.reload({ waitUntil: 'networkidle' }); await openPets(otherPage); await detail(pet.name, otherPage);
  assert.equal(await otherPage.getByRole('button', { name: 'ثبت انجام‌شدن ' + care.title, exact: true }).count(), 0); await otherContext.close();

  // Existing direct and queued Task edits leave the server-only pet relation intact.
  let task = await serverTask(care.id);
  task = await api('/tasks/' + care.id, owner.token, 'PATCH', { ...taskWrite(task, { title: marker + '-care-direct' }), base_revision: task.revision });
  assert.equal((await api('/pets/' + pet.id, owner.token)).care_tasks.find(row => row.id === task.id).title, task.title);
  await page.reload({ waitUntil: 'networkidle' }); await openPets(); await detail(pet.name);
  await page.getByRole('button', { name: 'ویرایش و مدیریت در کارهای خانه', exact: true }).click();
  await page.getByRole('heading', { name: 'کارهای خانه', exact: true }).waitFor();
  await page.getByRole('button', { name: 'ویرایش ' + task.title, exact: true }).click();
  await context.setOffline(true); await page.waitForTimeout(250);
  await page.getByRole('textbox', { name: 'عنوان کار', exact: true }).fill(marker + '-care-offline');
  await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
  await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).waitFor({ state: 'hidden' });
  const pendingStates = await offlineStates(); assert.ok(pendingStates.some(state => state.pending.some(entry => entry.operation.kind === 'task.update' && entry.operation.entity_id === task.id)));
  for (const state of pendingStates) {
    for (const cached of state.snapshot.tasks ?? []) assert.ok(!['pet_id', 'petId', 'species', 'breed'].some(key => key in cached));
    for (const entry of state.pending) assert.ok(!['pet_id', 'petId'].some(key => key in entry.operation.payload));
  }
  await context.setOffline(false);
  await poll(async () => (await serverTask(task.id)).title === marker + '-care-offline', 'Offline Task edit was not synchronized');
  task = await serverTask(task.id);
  assert.equal((await api('/pets/' + pet.id, owner.token)).care_tasks.find(row => row.id === task.id).title, task.title);
  await api('/shopping/offline/mutations', owner.token, 'POST', {
    operation_id: randomUUID(), kind: 'task.update', entity_id: task.id, base_revision: task.revision, payload: { ...taskWrite(task), pet_id: pet.id },
  }, [422]);
  const replay = await api('/pets/' + pet.id + '/care-tasks', owner.token, 'POST', lostRequest);
  assert.equal(replay.id, task.id); assert.equal(replay.title, task.title, 'Care retry replaced a newer Task edit');
  assert.equal((await api('/pets/' + pet.id, owner.token)).care_tasks.length, 1);

  await page.reload({ waitUntil: 'networkidle' }); await openPets();
  let held = false; const gate = new Promise(resolve => { releaseLate = resolve; });
  const detailPath = '**/api/v1/pets/' + pet.id;
  await context.route(detailPath, async route => {
    if (route.request().method() !== 'GET' || held) return route.continue();
    held = true; const response = await route.fetch(); const body = await response.json(); await gate;
    await route.fulfill({ response, json: { ...body, pet: { ...body.pet, name: marker + '-late-response' } } }).catch(() => {});
  });
  await page.getByRole('button', { name: 'جزئیات ' + pet.name, exact: true }).click(); await poll(async () => held, 'Pet detail request was not held');
  await context.setOffline(true); await page.waitForTimeout(250); assert.equal(await page.locator('.pets-sheet').count(), 0);
  await context.setOffline(false); await openPets(); releaseLate(); releaseLate = undefined; await page.waitForTimeout(300);
  assert.ok(!(await page.locator('body').innerText()).includes(marker + '-late-response')); await context.unroute(detailPath);
  await detail(pet.name); await page.getByRole('button', { name: 'ویرایش مشخصات حیوان', exact: true }).click();
  await page.getByRole('textbox', { name: 'نام حیوان', exact: true }).fill(marker + '-unsaved');
  await context.setOffline(true); await page.waitForTimeout(250); assert.equal(await page.locator('.pets-sheet').count(), 0);
  await context.setOffline(false); await openPets(); await page.getByRole('button', { name: 'ثبت حیوان جدید', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'نام حیوان', exact: true }).inputValue(), ''); await page.getByRole('button', { name: 'انصراف', exact: true }).click();
  await detail(pet.name); await page.getByRole('button', { name: 'ثبت کار مراقبتی جدید', exact: true }).click();
  await page.getByRole('textbox', { name: 'عنوان کار مراقبتی', exact: true }).fill(marker + '-unsaved-care');
  await context.setOffline(true); await page.waitForTimeout(250); assert.equal(await page.locator('.pets-sheet').count(), 0);
  await context.setOffline(false); await openPets(); await detail(pet.name); await page.getByRole('button', { name: 'ثبت کار مراقبتی جدید', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'عنوان کار مراقبتی', exact: true }).inputValue(), ''); await page.getByRole('button', { name: 'انصراف', exact: true }).click();
  await page.getByRole('button', { name: 'بستن جزئیات', exact: true }).click();
  await context.route('**/api/v1/pets', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 403, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'FORBIDDEN', message: 'دسترسی لغو شده است.' }) })
    : route.continue());
  await page.reload({ waitUntil: 'networkidle' }); await openPets(); await page.locator('.pets-page [role=alert]').waitFor();
  assert.equal(await page.getByRole('button', { name: 'جزئیات ' + pet.name, exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'ثبت حیوان جدید', exact: true }).count(), 0); await context.unroute('**/api/v1/pets');
  await page.reload({ waitUntil: 'networkidle' }); await openPets(); await screenshot('pets-list-mobile'); await detail(pet.name);
  await page.getByRole('button', { name: 'حذف حیوان', exact: true }).click();
  await page.getByText(/کارهای مراقبتی آن در کارهای خانه باقی می‌مانند/).waitFor(); await screenshot('pets-delete-mobile');
  await page.getByRole('button', { name: 'انصراف', exact: true }).click(); assert.equal((await api('/pets/' + pet.id, owner.token)).pet.id, pet.id);
  const beforeDeleteTask = await serverTask(task.id);
  await page.getByRole('button', { name: 'حذف حیوان', exact: true }).click(); await page.getByRole('button', { name: 'تأیید حذف حیوان', exact: true }).click(); await idle();
  await api('/pets/' + pet.id, owner.token, 'GET', undefined, [404]);
  const retainedTask = await serverTask(task.id); assert.equal(retainedTask.title, beforeDeleteTask.title); assert.equal(retainedTask.completed, beforeDeleteTask.completed);
  assert.equal(retainedTask.revision, beforeDeleteTask.revision + 1, 'Pet deletion did not invalidate stale Task changes');
  await api('/tasks/' + task.id, owner.token, 'PATCH', { ...taskWrite(beforeDeleteTask), base_revision: beforeDeleteTask.revision }, [409]);
  await api('/shopping/offline/mutations', owner.token, 'POST', {
    operation_id: randomUUID(), kind: 'task.update', entity_id: task.id, base_revision: beforeDeleteTask.revision, payload: taskWrite(beforeDeleteTask),
  }, [409]);
  await detail(minimal.name); await screenshot('pets-long-name-mobile'); await page.getByRole('button', { name: 'بستن جزئیات', exact: true }).click();
  assert.deepEqual(await api('/transactions', owner.token), beforeFinance, 'Pets changed Finance');
  assert.deepEqual((await api('/events', owner.token)).map(event => ({ id: event.id, date: event.date, title: event.title })), beforeCalendar, 'Pets changed birthdays or shared Calendar');
  assert.deepEqual(pageErrors, [], 'Pets page reported a browser error');
  console.log('PASS: Pets mobile profile CRUD and Jalali dates, manager/member permissions, canonical Task care ID, lost-response retry without duplicates, assignee-only reminder/completion/reopen, generic direct and actual offline Task edits preserving care, no pet fields in Task/offline contracts, profile/form late/offline/denial guards, no mobile overflow, and Pet deletion preserving Tasks with stale revision conflicts; Finance and Calendar preserved.');
} catch (error) {
  if (page) {
    const state = await documentState().catch(() => null);
    console.error('Pets failure state:', JSON.stringify({ state, pageErrors, navigationEvents, modalStates, consoleErrorCount: consoleErrors.length }));
    await writeFile('.local-test/pets-failure.html', await page.content().catch(() => ''), 'utf8');
    await writeFile('.local-test/pets-failure-diagnostics.json', JSON.stringify({ state, pageErrors, navigationEvents, modalStates, consoleErrors }, null, 2), 'utf8');
    await page.screenshot({ path: '.local-test/pets-failure.png', fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  releaseLate?.(); if (browser) await browser.close();
  if (owner) {
    const allPets = await api('/pets', owner.token).catch(() => ({ pets: [] }));
    for (const pet of allPets.pets.filter(row => pets.includes(row.id) || row.name.startsWith(marker))) {
      await api(`/pets/${pet.id}?base_revision=${pet.revision}`, owner.token, 'DELETE', undefined, [204, 404]).catch(() => {});
    }
    const allTasks = await api('/tasks', owner.token).catch(() => []);
    for (const task of allTasks.filter(row => taskIds.includes(row.id) || row.title.startsWith(marker))) {
      await api(`/tasks/${task.id}?base_revision=${task.revision}`, owner.token, 'DELETE', undefined, [204, 404]).catch(() => {});
    }
  }
  for (const [account, prefs] of originalPrefs) await api('/notifications/prefs', account.token, 'PATCH', {
    enabled: prefs.enabled, domains: { tasks: prefs.domains?.tasks !== false }, lead_days: { tasks: prefs.lead_days?.tasks ?? 0 },
  }).catch(() => {});
  for (const token of tokens) await api('/auth/logout', token, 'POST').catch(() => {});
}
