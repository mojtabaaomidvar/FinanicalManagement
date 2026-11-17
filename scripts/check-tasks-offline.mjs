import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = 'http://127.0.0.1:5700';
const suffix = 'tasks-e2e-' + Date.now();
const tokens = [];
const originalPrefs = new Map();
const mutationRoute = '**/api/v1/shopping/offline/mutations';
const screenshotDirectory = '.local-test';
let browser, context, page, owner, creator, assignee, admin;

async function api(path, token, method = 'GET', payload) {
  const response = await fetch(base + '/api/v1' + path, {
    method,
    headers: { Accept: 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
  assert.ok(response.ok, method + ' ' + path + ': ' + response.status);
  return response.status === 204 ? null : response.json();
}

async function loginApi(phone) {
  const result = await api('/auth/login', null, 'POST', { phone, password: 'Test12345!' });
  tokens.push(result.session_token);
  return { token: result.session_token, id: result.member.id };
}

async function enableTaskNotifications(account) {
  const prefs = await api('/notifications/prefs', account.token);
  originalPrefs.set(account, { enabled: prefs.enabled,
    domains: { tasks: prefs.domains?.tasks !== false },
    lead_days: { tasks: prefs.lead_days?.tasks ?? 0 } });
  await api('/notifications/prefs', account.token, 'PATCH', {
    enabled: true, domains: { tasks: true }, lead_days: { tasks: 0 },
  });
}

async function poll(check, message, timeout = 25000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      if (await check()) return;
    } catch (error) {
      if (!/Execution context was destroyed|Cannot find context with specified id|frame was detached/.test(error.message)) {
        throw error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(message);
}

async function savedStates(target = page) {
  return target.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mali-man-secure', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = key => new Promise((resolve, reject) => {
      const request = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const keys = await new Promise((resolve, reject) => {
      const request = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const key = await read('__crypto_key__');
    const states = [];
    for (const name of keys.filter(value => String(value).startsWith('shopping-offline:'))) {
      const record = await read(name);
      if (!record?.iv || !record?.ct || key?.extractable !== false) {
        throw new Error('Offline state requires ciphertext and a non-extractable key.');
      }
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(record.iv) }, key, record.ct,
      );
      states.push({ key: String(name), ...JSON.parse(new TextDecoder().decode(decrypted)) });
    }
    db.close();
    return states;
  });
}

async function secureKeys() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mali-man-secure', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const keys = await new Promise((resolve, reject) => {
      const request = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return keys;
  });
}

async function loginUi(target, phone) {
  await target.goto(base, { waitUntil: 'networkidle' });
  if (!(await target.getByPlaceholder('شماره موبایل', { exact: true }).count())) {
    await target.getByRole('button', { name: 'ورود', exact: true }).click();
  }
  await target.getByPlaceholder('شماره موبایل', { exact: true }).first().fill(phone);
  await target.getByPlaceholder('رمز عبور', { exact: true }).fill('Test12345!');
  const logged = target.waitForResponse(response => response.url().endsWith('/auth/login'));
  await target.locator('form').filter({ has: target.getByPlaceholder('رمز عبور', { exact: true }) })
    .locator('button[type=submit]').click();
  tokens.push((await (await logged).json()).session_token);
  await target.getByText('کارهای خانه', { exact: true }).waitFor();
  await poll(async () => (await savedStates(target)).some(state => state.lastSyncedAt),
    'Initial task snapshot was not installed');
}

async function openTasks(target = page, reload = false) {
  if (reload) await target.reload({ waitUntil: 'domcontentloaded' });
  if (!(await target.getByRole('heading', { name: 'کارهای خانه', exact: true }).isVisible())) {
    await target.getByText('کارهای خانه', { exact: true }).click();
  }
  await target.getByRole('heading', { name: 'کارهای خانه', exact: true }).waitFor();
  await poll(async () => !(await target.getByText('در حال دریافت کارها…', { exact: true }).isVisible()),
    'Task list did not finish loading');
}

const taskRow = (title, target = page) => target.locator('.shop-item').filter({ hasText: title });

async function openCompletionUi(title, target = page) {
  await taskRow(title, target).getByRole('checkbox').click();
  await target.getByRole('heading', { name: 'تأیید انجام کار', exact: true }).waitFor();
  assert.equal(await taskRow(title, target).getByRole('checkbox').getAttribute('aria-checked'), 'false',
    'Opening completion confirmation changed the checkbox');
}

async function confirmCompletionUi(target = page) {
  await target.getByRole('button', { name: 'تأیید انجام کار', exact: true }).click();
  await poll(async () => !(await target.getByRole('heading', { name: 'تأیید انجام کار', exact: true }).isVisible()),
    'Task completion confirmation did not close');
}

async function completeUi(title, target = page) {
  await openCompletionUi(title, target);
  await confirmCompletionUi(target);
}

async function selectCompletionPhoto(target = page) {
  const imageBase64 = await target.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#517b62'; ctx.fillRect(0, 0, 64, 48);
    ctx.fillStyle = '#faf5dd'; ctx.fillRect(12, 10, 40, 28);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await target.getByLabel('عکس انجام کار', { exact: true }).setInputFiles({
    name: 'completion.png', mimeType: 'image/png', buffer: Buffer.from(imageBase64, 'base64'),
  });
  const preview = target.getByAltText('پیش‌نمایش عکس انجام کار', { exact: true });
  await preview.waitFor();
  await poll(async () => preview.evaluate(image => image.complete && image.naturalWidth > 0),
    'Completion photo preview did not load');
  const source = await preview.getAttribute('src');
  assert.match(source, /^data:image\/jpeg;base64,/, 'Completion photo was not compressed');
  return source;
}

async function checkCompletionPhoto(title, target = page) {
  await taskRow(title, target).locator('.shop-body').click();
  const photo = target.getByAltText('عکس انجام کار', { exact: true });
  await photo.waitFor();
  await poll(async () => photo.evaluate(image => image.complete && image.naturalWidth > 0),
    'Saved completion photo did not load');
  await target.getByRole('button', { name: /^(بستن|انصراف)$/ }).click();
}

async function createUi(title, { description = 'توضیح مشترک آزمون', assigneeId = '', dueToday = false } = {}) {
  await page.getByRole('button', { name: 'ثبت کار جدید', exact: true }).click();
  await page.getByRole('textbox', { name: 'عنوان کار', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'توضیح مشترک', exact: true }).fill(description);
  if (await page.evaluate(() => navigator.onLine === false)) {
    const choices = await page.getByRole('combobox', { name: 'مسئول', exact: true })
      .locator('option').evaluateAll(options => options.map(option => option.value));
    assert.deepEqual(choices.sort(), ['', creator.id].sort(), 'Offline creation offered another member');
  }
  await page.getByRole('combobox', { name: 'مسئول', exact: true }).selectOption(assigneeId);
  if (dueToday) {
    await page.getByRole('button', { name: 'بدون موعد', exact: true }).click();
    await page.getByRole('button', { name: 'امروز', exact: true }).click();
  }
  await page.getByRole('button', { name: 'ثبت کار', exact: true }).click();
  await poll(async () => !(await page.getByRole('textbox', { name: 'عنوان کار', exact: true }).isVisible()),
    'Create task form did not close');
  await taskRow(title).waitFor();
}

async function editUi(title, changes, target = page) {
  await target.getByRole('button', { name: 'ویرایش ' + title, exact: true }).click();
  if (changes.title !== undefined) await target.getByRole('textbox', { name: 'عنوان کار', exact: true }).fill(changes.title);
  if (changes.description !== undefined) await target.getByRole('textbox', { name: 'توضیح مشترک', exact: true }).fill(changes.description);
  if (changes.assigneeId !== undefined) await target.getByRole('combobox', { name: 'مسئول', exact: true }).selectOption(changes.assigneeId);
  await target.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
  await poll(async () => !(await target.getByRole('textbox', { name: 'عنوان کار', exact: true }).isVisible()),
    'Edit task form did not close');
}

async function serverTask(id) {
  return (await api('/tasks', owner.token)).find(row => row.id === id);
}

async function updateApi(task, token, changes) {
  return api('/tasks/' + task.id, token, 'PATCH', {
    title: task.title, description: task.description, assignee_id: task.assignee_id,
    due_date: task.due_date, base_revision: task.revision, ...changes,
  });
}

async function acceptServer() {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'پذیرفتن نسخهٔ سرور', exact: true }).click();
  await poll(async () => (await savedStates())[0]?.pending.length === 0, 'Conflict discard did not finish');
}

async function settleModal(target) {
  await target.locator('.modal-sheet').evaluate(async sheet => {
    await Promise.all(sheet.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
}

// A short visual check can be repeated without creating or changing task records.
if (process.argv.includes('--mobile-check')) {
  await mkdir(screenshotDirectory, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge' });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tehran' });
  page = await context.newPage();
  try {
    await loginUi(page, '09000000003');
    await openTasks();
    await page.getByRole('button', { name: 'ثبت کار جدید', exact: true }).click();
    await page.getByRole('textbox', { name: 'عنوان کار', exact: true }).fill('تعویض فیلتر آب');
    await page.getByRole('textbox', { name: 'توضیح مشترک', exact: true }).fill('فیلتر تازه در کابینت آشپزخانه است.');
    await settleModal(page);
    await page.screenshot({ path: screenshotDirectory + '/tasks-mobile-form.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    console.log('PASS: mobile task form has no viewport overflow.');
  } finally {
    await browser.close();
    for (const token of tokens) await api('/auth/logout', token, 'POST').catch(() => {});
  }
  process.exit(0);
}

try {
  await mkdir(screenshotDirectory, { recursive: true });
  owner = await loginApi('09000000001');
  creator = await loginApi('09000000002');
  assignee = await loginApi('09000000003');
  admin = await loginApi('09000000004');
  await enableTaskNotifications(creator);
  await enableTaskNotifications(assignee);
  browser = await chromium.launch({ headless: true, channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge' });
  context = await browser.newContext({ viewport: { width: 1100, height: 900 }, timezoneId: 'Asia/Tehran' });
  page = await context.newPage();
  await loginUi(page, '09000000002');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await openTasks();

  const firstTitle = 'کار مشترک ' + suffix;
  await createUi(firstTitle, { assigneeId: assignee.id, dueToday: true });
  let first = (await api('/tasks', owner.token)).find(row => row.title === firstTitle);
  assert.ok(first);
  assert.equal(first.created_by, creator.id);
  assert.equal(first.assignee_id, assignee.id);
  assert.equal(first.due_date, new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date()));
  assert.equal(first.completed, false);
  const editedTitle = 'کار ویرایش‌شده ' + suffix;
  await editUi(firstTitle, { title: editedTitle, description: 'توضیح تازه برای خانواده' });
  first = await serverTask(first.id);
  assert.equal(first.description, 'توضیح تازه برای خانواده');
  await page.screenshot({ path: screenshotDirectory + '/tasks-online.png', fullPage: true });

  const assigneeContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tehran' });
  const assigneePage = await assigneeContext.newPage();
  await loginUi(assigneePage, '09000000003');
  await openTasks(assigneePage);
  await taskRow(editedTitle, assigneePage).waitFor();
  await assigneePage.screenshot({ path: screenshotDirectory + '/tasks-mobile.png', fullPage: true });
  assert.equal(await assigneePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
    'Task page overflows the mobile viewport');
  assert.equal(await taskRow(editedTitle, assigneePage).getByRole('button', { name: 'حذف ' + editedTitle }).count(), 0);
  await assigneePage.getByRole('button', { name: 'جزئیات ' + editedTitle, exact: true }).click();
  await settleModal(assigneePage);
  await assigneePage.screenshot({ path: screenshotDirectory + '/tasks-mobile-details.png', fullPage: true });
  assert.equal(await assigneePage.getByRole('textbox', { name: 'عنوان کار', exact: true }).isDisabled(), true);
  await assigneePage.getByRole('button', { name: 'ثبت انجام کار', exact: true }).click();
  await assigneePage.getByRole('heading', { name: 'تأیید انجام کار', exact: true }).waitFor();
  const initialCompletionRevision = first.revision;
  const assertUnconfirmed = async () => {
    const current = await serverTask(first.id);
    assert.equal(current.completed, false, 'Unconfirmed task was completed on the server');
    assert.equal(current.revision, initialCompletionRevision, 'Unconfirmed task changed its server revision');
    assert.equal((await savedStates(assigneePage))[0].pending.length, 0,
      'Opening or canceling completion queued a mutation');
    assert.equal(await taskRow(editedTitle, assigneePage).getByRole('checkbox').getAttribute('aria-checked'), 'false');
  };
  await assertUnconfirmed();
  await assigneePage.getByRole('button', { name: 'انصراف', exact: true }).click();
  await assertUnconfirmed();
  await openCompletionUi(editedTitle, assigneePage);
  await assertUnconfirmed();
  await settleModal(assigneePage);
  await assigneePage.screenshot({ path: screenshotDirectory + '/tasks-mobile-completion.png', fullPage: true });
  assert.equal(await assigneePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
    'Completion confirmation overflows the mobile viewport');
  await selectCompletionPhoto(assigneePage);
  await assigneePage.getByRole('button', { name: 'انصراف', exact: true }).click();
  await assertUnconfirmed();
  await openCompletionUi(editedTitle, assigneePage);
  assert.equal(await assigneePage.getByAltText('پیش‌نمایش عکس انجام کار', { exact: true }).count(), 0,
    'Canceled completion retained the draft photo');
  await assigneePage.keyboard.press('Escape');
  await assertUnconfirmed();
  await openCompletionUi(editedTitle, assigneePage);
  await settleModal(assigneePage);
  await assigneePage.locator('.modal-overlay').click({ position: { x: 8, y: 8 } });
  await assertUnconfirmed();
  await completeUi(editedTitle, assigneePage);
  await assigneePage.getByRole('button', { name: 'انجام‌شده', exact: true }).click();
  await taskRow(editedTitle, assigneePage).waitFor();
  await poll(async () => (await serverTask(first.id))?.completed === true, 'Assignee completion did not reach server');
  first = await serverTask(first.id);
  assert.equal(first.completed, true);
  assert.equal(first.completed_by, assignee.id);
  assert.ok(first.completed_at);
  assert.equal(first.completion_photo_url, null, 'Completion without a photo saved an attachment');
  await taskRow(editedTitle, assigneePage).getByRole('checkbox').click();
  await assigneePage.getByRole('button', { name: 'باز', exact: true }).click();
  await taskRow(editedTitle, assigneePage).waitFor();
  await poll(async () => (await serverTask(first.id))?.completed === false, 'Assignee reopening did not reach server');
  first = await serverTask(first.id);
  assert.equal(first.completed, false);
  assert.equal(first.completed_by, null);
  assert.equal(first.completed_at, null);

  await openCompletionUi(editedTitle, assigneePage);
  await selectCompletionPhoto(assigneePage);
  await assigneePage.getByRole('button', { name: 'حذف عکس', exact: true }).click();
  assert.equal(await assigneePage.getByAltText('پیش‌نمایش عکس انجام کار', { exact: true }).count(), 0,
    'Removing a draft photo left the preview');
  await assigneePage.getByRole('button', { name: 'افزودن عکس', exact: true }).waitFor();
  await selectCompletionPhoto(assigneePage);
  await settleModal(assigneePage);
  await assigneePage.screenshot({ path: screenshotDirectory + '/tasks-mobile-completion-photo.png', fullPage: true });
  assert.equal(await assigneePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
    'Completion photo preview overflows the mobile viewport');
  await confirmCompletionUi(assigneePage);
  await assigneePage.getByRole('button', { name: 'انجام‌شده', exact: true }).click();
  await taskRow(editedTitle, assigneePage).waitFor();
  await poll(async () => Boolean((await serverTask(first.id))?.completion_photo_url),
    'Assignee completion photo did not reach the server');
  await checkCompletionPhoto(editedTitle, assigneePage);
  await openTasks(page, true);
  await page.getByRole('button', { name: 'انجام‌شده', exact: true }).click();
  await checkCompletionPhoto(editedTitle);
  await openTasks(assigneePage, true);
  await assigneePage.getByRole('button', { name: 'انجام‌شده', exact: true }).click();
  await checkCompletionPhoto(editedTitle, assigneePage);
  await taskRow(editedTitle, assigneePage).getByRole('checkbox').click();
  await assigneePage.getByRole('button', { name: 'باز', exact: true }).click();
  await taskRow(editedTitle, assigneePage).waitFor();
  await poll(async () => (await serverTask(first.id))?.completed === false,
    'Reopening a task with a photo did not reach the server');
  first = await serverTask(first.id);
  assert.equal(first.completion_photo_url, null, 'Reopening a task retained its completion photo');
  console.log('PASS: task completion requires confirmation; cancel, Escape and backdrop keep it open; optional photo can be removed, reselected and viewed after reload.');

  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tehran' });
  const adminPage = await adminContext.newPage();
  await loginUi(adminPage, '09000000004');
  await openTasks(adminPage);
  await editUi(editedTitle, { description: 'ویرایش مدیر دوم' }, adminPage);
  first = await serverTask(first.id);
  assert.equal(first.description, 'ویرایش مدیر دوم');
  assert.equal(first.created_by, creator.id);
  await assigneeContext.close();
  await adminContext.close();
  await openTasks(page, true);
  await page.getByRole('button', { name: 'حذف ' + editedTitle, exact: true }).click();
  await page.getByRole('button', { name: 'حذف کار', exact: true }).click();
  await poll(async () => !await serverTask(first.id), 'Creator deletion did not reach server');
  await poll(async () => (await savedStates())[0]?.pending.length === 0, 'Deletion acknowledgment remained queued');
  console.log('PASS: browser creation, assignment, Jalali day, editing, assignee-only completion/reopen, second-admin editing and creator deletion.');

  await context.setOffline(true);
  await page.getByText('اتصال اینترنت نیست', { exact: true }).waitFor();
  const offlineTitle = 'کار آفلاین ' + suffix;
  await createUi(offlineTitle, { assigneeId: creator.id, description: 'متن مشترک آفلاین' });
  await poll(async () => (await savedStates())[0]?.pending.some(entry => entry.operation.kind === 'task.create'),
    'Offline task creation was not encrypted and persisted');
  const offlineId = (await savedStates())[0].pending.find(entry => entry.operation.kind === 'task.create').operation.entity_id;
  await openCompletionUi(offlineTitle);
  assert.equal((await savedStates())[0].pending.length, 1,
    'Opening completion confirmation queued an offline completion');
  const offlinePhoto = await selectCompletionPhoto();
  await confirmCompletionUi();
  await page.getByRole('button', { name: 'انجام‌شده', exact: true }).click();
  await taskRow(offlineTitle).waitFor();
  await poll(async () => (await savedStates())[0]?.pending.length === 2, 'Offline completion was not persisted');
  await openTasks(page, true);
  await page.getByRole('button', { name: 'انجام‌شده', exact: true }).click();
  await taskRow(offlineTitle).waitFor();
  const offlineState = (await savedStates())[0];
  assert.equal(offlineState.pending.length, 2);
  assert.equal(offlineState.pending.find(entry => entry.operation.kind === 'task.complete')
    .operation.payload.completion_photo, offlinePhoto, 'Offline completion photo did not survive reload');
  await checkCompletionPhoto(offlineTitle);
  const privateText = JSON.stringify(offlineState);
  for (const forbidden of ['"phone"', '"role"', '"budget"', '"price"', '"account_id"', '"members"']) {
    assert.equal(privateText.includes(forbidden), false, forbidden);
  }
  await page.screenshot({ path: screenshotDirectory + '/tasks-offline.png', fullPage: true });
  await context.setOffline(false);
  await poll(async () => (await savedStates())[0]?.pending.length === 0, 'Task queue did not sync automatically');
  let offlineTask = await serverTask(offlineId);
  assert.equal(offlineTask.completed, true);
  assert.equal(offlineTask.completed_by, creator.id);
  assert.equal(offlineTask.created_by, creator.id);
  assert.ok(offlineTask.completion_photo_url, 'Offline completion photo was not synchronized');
  assert.equal((await api('/tasks', owner.token)).filter(row => row.title === offlineTitle).length, 1);
  await openTasks(page, true);
  await page.getByRole('button', { name: 'انجام‌شده', exact: true }).click();
  await checkCompletionPhoto(offlineTitle);
  await taskRow(offlineTitle).getByRole('checkbox').click();
  await page.getByRole('button', { name: 'باز', exact: true }).click();
  await taskRow(offlineTitle).waitFor();
  await poll(async () => (await savedStates())[0]?.pending.length === 0 &&
    (await serverTask(offlineId))?.completed === false, 'Reopening acknowledgment remained queued');
  assert.equal((await serverTask(offlineId)).completion_photo_url, null,
    'Reopening an offline-synchronized task retained its completion photo');
  console.log('PASS: encrypted offline create/self-assignment/text/completion/photo survive reload and automatically synchronize once.');

  // Follow the shared reminder to its real destination and verify its lifecycle.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^اعلان‌ها/ }).click();
  const reminder = page.locator('.notif-item').filter({ hasText: offlineTitle });
  await reminder.waitFor();
  await reminder.click();
  await page.getByRole('heading', { name: 'کارهای خانه', exact: true }).waitFor();
  await completeUi(offlineTitle);
  await poll(async () => (await serverTask(offlineId))?.completed === true,
    'Reminder completion did not reach server');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^اعلان‌ها/ }).click();
  await page.getByRole('heading', { name: 'اعلان‌ها', exact: true }).waitFor();
  assert.equal(await page.locator('.notif-item').filter({ hasText: offlineTitle }).count(), 0,
    'Completed task still has a reminder');
  await page.keyboard.press('Escape');
  await openTasks();
  await page.getByRole('button', { name: 'انجام‌شده', exact: true }).click();
  await taskRow(offlineTitle).getByRole('checkbox').click();
  await poll(async () => (await savedStates())[0]?.pending.length === 0 &&
    (await serverTask(offlineId))?.completed === false, 'Reminder fixture did not reopen');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'پروفایل و تنظیمات', exact: true }).click();
  await page.getByText('اعلان‌ها', { exact: true }).click();
  const taskSwitch = page.getByRole('switch', { name: /کارهای خانه/ });
  await taskSwitch.waitFor();
  await poll(async () => !(await page.getByText('در حال خواندن تنظیمات…', { exact: true }).isVisible()),
    'Notification settings did not load');
  assert.equal(await taskSwitch.getAttribute('aria-checked'), 'true');
  await taskSwitch.click();
  await poll(async () => (await api('/notifications/prefs', creator.token)).domains.tasks === false,
    'Task reminder setting did not persist');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await poll(async () => (await savedStates())[0]?.snapshot.task_notification_prefs?.tasks_enabled === false,
    'Disabled reminder setting did not enter the restricted offline snapshot');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^اعلان‌ها/ }).click();
  await page.getByRole('heading', { name: 'اعلان‌ها', exact: true }).waitFor();
  assert.equal(await page.locator('.notif-item').filter({ hasText: offlineTitle }).count(), 0,
    'Disabled task reminders reappeared after offline reload');
  await page.keyboard.press('Escape');
  await context.setOffline(false);
  await api('/notifications/prefs', creator.token, 'PATCH', { domains: { tasks: true } });
  await openTasks(page, true);
  console.log('PASS: task reminder opens Tasks, completion removes it, and setting-off remains effective after offline reload.');

  let responseDropped = false;
  await context.route(mutationRoute, async route => {
    try {
      const response = await route.fetch();
      if (!response.ok()) { await route.fulfill({ response }); return; }
      responseDropped = true;
      await route.abort();
    } catch {
      // The browser can cancel another in-flight retry as handlers are removed.
      await route.abort().catch(() => {});
    }
  });
  const droppedTitle = 'پاسخ گم‌شده ' + suffix;
  await createUi(droppedTitle);
  await poll(async () => responseDropped && (await savedStates())[0]?.pending.length === 1,
    'Committed task with lost response did not remain queued');
  assert.equal((await api('/tasks', owner.token)).filter(row => row.title === droppedTitle).length, 1);
  await context.unrouteAll({ behavior: 'wait' });
  await context.setOffline(true);
  await context.setOffline(false);
  await poll(async () => (await savedStates())[0]?.pending.length === 0, 'Lost task response did not recover');
  assert.equal((await api('/tasks', owner.token)).filter(row => row.title === droppedTitle).length, 1);
  console.log('PASS: retry after a committed task response is dropped creates no duplicate.');

  await context.setOffline(true);
  await page.getByText('اتصال اینترنت نیست', { exact: true }).waitFor();
  const localTitle = 'ویرایش محلی ' + suffix;
  const serverTitle = 'ویرایش سرور ' + suffix;
  await editUi(offlineTitle, { title: localTitle });
  await poll(async () => (await savedStates())[0]?.pending.length === 1, 'Conflict edit was not queued');
  offlineTask = await serverTask(offlineId);
  await updateApi(offlineTask, admin.token, { title: serverTitle });
  await context.setOffline(false);
  await poll(async () => (await savedStates())[0]?.pending[0]?.status === 'conflict', 'Task conflict was not exposed');
  assert.equal((await serverTask(offlineId)).title, serverTitle);
  await page.getByRole('button', { name: 'پذیرفتن نسخهٔ سرور', exact: true }).waitFor();
  await page.screenshot({ path: screenshotDirectory + '/tasks-conflict.png', fullPage: true });
  await acceptServer();
  await taskRow(serverTitle).waitFor();
  console.log('PASS: another member changes the server revision, conflict stays visible and explicit acceptance retains the server task.');

  const deniedTitle = 'مجوز تغییرکرده ' + suffix;
  const denied = await api('/tasks', owner.token, 'POST', { title: deniedTitle, assignee_id: creator.id });
  await openTasks(page, true);
  await taskRow(deniedTitle).waitFor();
  await context.setOffline(true);
  await completeUi(deniedTitle);
  await poll(async () => (await savedStates())[0]?.pending.length === 1, 'Permission fixture did not queue');
  await updateApi(denied, owner.token, { assignee_id: assignee.id });
  await context.setOffline(false);
  await poll(async () => (await savedStates())[0]?.pending[0]?.status === 'failed', 'Permission loss did not remain a visible failed write');
  const deniedState = (await savedStates())[0];
  assert.equal(deniedState.authorized, true);
  assert.equal(deniedState.scope.memberId, creator.id);
  assert.equal((await serverTask(denied.id)).completed, false);
  await page.getByRole('heading', { name: 'کارهای خانه', exact: true }).waitFor();
  await page.getByRole('button', { name: 'پذیرفتن نسخهٔ سرور', exact: true }).waitFor();
  console.log('PASS: losing task permission retains the failed change and valid session without applying completion.');

  // Keep that failed write queued while deliberately logging out.
  const previousKey = deniedState.key;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'پروفایل و تنظیمات', exact: true }).click();
  await page.getByText('خروج از حساب', { exact: true }).click();
  await page.getByPlaceholder('شماره موبایل', { exact: true }).first().waitFor();
  await poll(async () => (await savedStates()).length === 0, 'Logout retained a task cache partition');
  assert.deepEqual(await secureKeys(), ['__crypto_key__']);
  await loginUi(page, '09000000003');
  const newState = (await savedStates())[0];
  assert.equal(newState.scope.memberId, assignee.id);
  assert.equal(newState.pending.length, 0);
  assert.notEqual(newState.key, previousKey);
  assert.equal((await savedStates()).some(state => state.key === previousKey), false);
  await context.setOffline(true);
  await openTasks(page, true);
  await taskRow(deniedTitle).waitFor();
  assert.equal(await taskRow(deniedTitle).getByRole('checkbox').getAttribute('aria-checked'), 'false');
  await context.setOffline(false);
  console.log('PASS: logout clears encrypted tasks and failed writes; another account reopens offline with its own clean queue.');
} catch (error) {
  if (page) {
    await context.setOffline(false).catch(() => {});
    await page.screenshot({ path: screenshotDirectory + '/tasks-failure.png', fullPage: true }).catch(() => {});
    console.log('Task browser diagnostic:', (await page.locator('body').innerText()).slice(0, 4500));
  }
  throw error;
} finally {
  if (browser) await browser.close();
  if (owner) {
    const ownedRows = await api('/tasks', owner.token).catch(() => []);
    for (const row of ownedRows.filter(task => task.title.includes(suffix))) {
      await api('/tasks/' + row.id + '?base_revision=' + row.revision, owner.token, 'DELETE').catch(() => {});
    }
  }
  for (const [account, prefs] of originalPrefs) {
    await api('/notifications/prefs', account.token, 'PATCH', prefs).catch(() => {});
  }
  for (const token of tokens) await api('/auth/logout', token, 'POST').catch(() => {});
}
