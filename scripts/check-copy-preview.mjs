import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// The copy studio has a separate origin and fictional in-memory API. This check
// never applies source text and never reaches the existing sandbox on port5700.
const base = 'http://127.0.0.1:5701';
const artifactDir = resolve('.local-test/copy-workbench');
const screenshotDir = resolve(artifactDir, 'preview-screenshots');
const argumentsList = process.argv.slice(2);
const selectedRoutes = argumentsList.find(value => value.startsWith('--routes='))?.slice(9).split(',');
const selectedScenarios = argumentsList.find(value => value.startsWith('--scenarios='))?.slice(12).split(',');
const routesOnly = argumentsList.includes('--routes-only');
const scenariosOnly = argumentsList.includes('--scenarios-only');
const previousRun = argumentsList.includes('--retry-failures')
  ? JSON.parse(await readFile(resolve(artifactDir, 'preview-results.json'), 'utf8')) : null;
const retryNames = previousRun ? new Set(previousRun.failures.map(value => value.name)) : null;
const results = { startedAt: previousRun?.startedAt ?? new Date().toISOString(), origin: base,
  checks: previousRun?.checks ?? [], failures: [], pageErrors: previousRun?.pageErrors ?? [],
  unknownEndpoints: previousRun?.unknownEndpoints ?? [], blockedRequests: previousRun?.blockedRequests ?? [],
  screenshots: previousRun?.screenshots ?? [], ...(previousRun ? { retriedChecks: [...retryNames], retriedAt: new Date().toISOString() } : {}) };
const headings = { hub: /خانه.*نمونه/, dashboard: /^سلام،/, transactions: 'تراکنش‌ها', reports: 'گزارش‌ها',
  sections: 'بخش‌های خانه', notifications: 'اعلان‌ها', sms: 'پیامک‌های بانکی',
  accounts: 'کیف پول‌ها', budgets: 'بودجه‌بندی', bills: 'قبوض و شارژ', calendar: 'تقویم و مناسبت‌ها',
  shopping: 'لیست خرید', inventory: 'انبار خانه', tasks: 'کارهای خانه', documents: 'اسناد خانه',
  meals: 'برنامهٔ غذایی', equipment: 'وسایل خانه', vehicles: 'خودرو و نگهداری', goals: 'اهداف و آرزوها',
  activities: 'تفریح و برنامه‌های خانوادگی', children: 'فرزندان و برنامه‌های آن‌ها', pets: 'حیوانات خانگی و مراقبت',
  market: 'ارز و بورس', settings: 'تنظیمات', auth: 'خانه یار', invite: 'دعوت به خانواده',
  'settings/profile': 'پروفایل من', 'settings/premium': 'نسخه پرمیوم', 'settings/family': 'خانواده',
  'settings/joinRequests': 'درخواست‌های عضویت', 'settings/events': 'رویدادهای مهم',
  'settings/accounts': 'کارت‌ها و حساب‌ها', 'settings/scheduled': 'تراکنش‌های تکرارشونده',
  'settings/categories': 'دسته‌ها', 'settings/labels': 'برچسب‌ها', 'settings/export': 'خروجی داده‌ها',
  'settings/sms': 'تشخیص تراکنش از پیامک', 'settings/notifications': 'اعلان‌ها', 'settings/about': 'درباره' };
const loadedText = { hub: 'نمونه: کار عقب‌افتاده', accounts: 'نمونه', transactions: 'نمونه',
  bills: 'نمونه: قبض عقب‌افتادهٔ برق', shopping: 'نمونه: خرید این هفته', inventory: 'نمونه', tasks: 'نمونه: کار عقب‌افتاده',
  documents: 'نمونه: سند مشترک با اعتبار نزدیک', equipment: 'نمونه: ماشین لباس‌شویی', vehicles: 'نمونه: خودروی خانواده',
  goals: 'نمونه: هدف نزدیک', activities: 'نمونه: برنامهٔ امروز خانواده', children: 'فرزند نمونه', pets: 'نمونه: گربهٔ خانه' };
let browser, context, page, frame, activeCheck = 'initialization';
const pendingResponses = new Set();

async function persist() { await writeFile(resolve(artifactDir, 'preview-results.json'), JSON.stringify(results, null, 2), 'utf8'); }
async function screenshot(name, wholeWorkbench = false) {
  const path = resolve(screenshotDir, name.replace(/[^a-z0-9_-]/gi, '-') + '.png');
  if (wholeWorkbench) await page.screenshot({ path, fullPage: true });
  else await page.locator('#copy-preview').screenshot({ path });
  results.screenshots.push(path); return path;
}
async function diagnostics() {
  return { workbenchState: await page.locator('#preview-state').textContent().catch(() => ''),
    notice: await page.locator('#notice').textContent().catch(() => ''),
    url: frame?.url(), body: await frame?.locator('body').innerText().catch(() => ''),
    buttons: await frame?.getByRole('button').allTextContents().catch(() => []),
    messages: await page.evaluate(() => window.__previewCheckEvents ?? []).catch(() => []) };
}
async function check(name, run) {
  if (retryNames && !retryNames.has(name)) return;
  activeCheck = name; const started = Date.now(), errorsBefore = results.pageErrors.length, endpointsBefore = results.unknownEndpoints.length;
  try {
    await run();
    await Promise.allSettled([...pendingResponses]);
    assert.equal(results.pageErrors.length, errorsBefore, 'The page emitted a JavaScript error');
    assert.equal(results.unknownEndpoints.length, endpointsBefore, 'The app requested an unsupported fixture endpoint');
    results.checks.push({ name, durationMs: Date.now() - started }); console.log('PASS ' + name);
  } catch (error) {
    const details = await diagnostics();
    results.failures.push({ name, message: error.message, details });
    await screenshot('failure-' + name).catch(() => {});
    console.error('FAIL ' + name + ': ' + error.message + '\n' + JSON.stringify(details));
  }
  await persist();
}
async function openPreview(scenarioId, route) {
  const previous = await page.locator('#copy-preview').getAttribute('src');
  await page.evaluate(({ scenarioId, route }) => {
    document.getElementById('preview-scenario').value = scenarioId;
    document.getElementById('preview-route').value = route;
    window.__previewCheckEvents = [];
    document.getElementById('reload-preview').click();
  }, { scenarioId, route });
  await page.waitForFunction(previous => {
    const src = document.getElementById('copy-preview').getAttribute('src'); return src && src !== previous && src.includes('/preview/');
  }, previous, { timeout: 15000 });
  frame = await (await page.locator('#copy-preview').elementHandle()).contentFrame();
  await frame.waitForFunction(({ scenarioId, route }) => window.__COPY_PREVIEW__?.scenario?.id === scenarioId
    && window.__COPY_PREVIEW__?.route === route && window.__COPY_PREVIEW_OBSERVED__ === true,
  { scenarioId, route }, { timeout: 28000 });
  await page.waitForFunction(() => (window.__previewCheckEvents ?? []).some(event => ['copy-preview-ready', 'copy-preview-error'].includes(event.type)), null, { timeout: 28000 });
  const error = await page.evaluate(() => (window.__previewCheckEvents ?? []).find(event => event.type === 'copy-preview-error'));
  assert.ok(!error, error?.message);
  assert.equal(await page.locator('#preview-state').textContent(), 'آماده');
  return frame;
}
async function routeReady(route, scenarioId = 'full-owner') {
  await openPreview(scenarioId, route);
  const renderedRoute = scenarioId === 'offline' && !['hub', 'shopping', 'inventory', 'tasks'].includes(route) ? 'hub' : route;
  await frame.getByRole('heading', { name: headings[renderedRoute], exact: typeof headings[renderedRoute] === 'string', level: 1 }).waitFor({ timeout: 6000 });
  if (!['loading', 'offline'].includes(scenarioId)) {
    await frame.waitForFunction(() => !document.querySelector('section.page.active[aria-busy="true"]'), null, { timeout: 8000 });
  }
  if (scenarioId.startsWith('full-') && loadedText[route]) await frame.locator('section.page.active').getByText(loadedText[route], { exact: false }).first().waitFor({ timeout: 5000 });
  const text = await frame.locator('body').innerText();
  assert.ok(text.trim().length > 30, 'The destination has no usable visible content');
  assert.ok(!/(?:NaN|undefined)/u.test(text), 'Invalid fixture data appeared in visible text');
}

async function detail(route, title) {
  await routeReady(route);
  await frame.getByRole('button', { name: 'جزئیات ' + title, exact: true }).click();
  await frame.getByRole('button', { name: 'بستن جزئیات', exact: true }).waitFor({ timeout: 5000 });
  await frame.waitForFunction(() => !document.querySelector('section.page.active[aria-busy="true"]'), null, { timeout: 5000 });
}
async function detailsChecks() {
  await check('details:documents', async () => {
    await routeReady('documents');
    await frame.getByRole('button', { name: 'جزئیات نمونه: سند مشترک با اعتبار نزدیک', exact: true }).click();
    await frame.getByRole('button', { name: 'دریافت PDF', exact: true }).click();
    await frame.getByText('فایل PDF آمادهٔ دانلود است.', { exact: true }).waitFor({ timeout: 5000 });
    await screenshot('details-document-pdf');
    await frame.getByRole('button', { name: 'بستن فایل', exact: true }).click();
    await frame.getByRole('button', { name: 'بستن', exact: true }).click();
    await frame.getByRole('button', { name: 'جزئیات نمونه: سند شخصی من', exact: true }).click();
    await frame.getByRole('button', { name: 'مشاهدهٔ فایل', exact: true }).click();
    const image = frame.locator('.document-image-preview'); await image.waitFor({ timeout: 5000 });
    await frame.waitForFunction(() => document.querySelector('.document-image-preview')?.naturalWidth > 0, null, { timeout: 5000 });
    await screenshot('details-document-image');
  });
  await check('details:equipment', async () => {
    await detail('equipment', 'نمونه: ماشین لباس‌شویی');
    await frame.locator('.equipment-history li').first().waitFor({ timeout: 5000 });
    await screenshot('details-equipment-history');
    await frame.getByRole('button', { name: 'مشاهدهٔ سند گارانتی', exact: true }).click();
    await frame.getByRole('button', { name: 'بستن سند', exact: true }).waitFor({ timeout: 5000 });
    await screenshot('details-equipment-document');
    await frame.getByRole('button', { name: 'بستن سند', exact: true }).click();
    await frame.getByRole('button', { name: 'ثبت سرویس انجام‌شده', exact: true }).click();
    await frame.getByRole('textbox', { name: 'شرح سرویس', exact: true }).waitFor();
    await screenshot('form-equipment-service');
  });
  await check('details:vehicles', async () => {
    await detail('vehicles', 'نمونه: خودروی خانواده');
    await frame.locator('.vehicle-history li').first().waitFor({ timeout: 5000 });
    assert.equal(await frame.locator('.vehicle-history li').count(), 3);
    await screenshot('details-vehicle-history');
    await frame.getByRole('button', { name: 'مشاهدهٔ سند خودرو', exact: true }).click();
    await frame.getByRole('button', { name: 'بستن سند', exact: true }).waitFor({ timeout: 5000 });
    await frame.getByRole('button', { name: 'بستن سند', exact: true }).click();
    await frame.getByRole('button', { name: 'ثبت سرویس انجام‌شده', exact: true }).click();
    await frame.getByRole('textbox', { name: 'شرح سرویس', exact: true }).waitFor();
    await screenshot('form-vehicle-service');
  });
  await check('details:goals', async () => {
    await detail('goals', 'نمونه: هدف نزدیک');
    await screenshot('details-goal');
    await frame.getByRole('button', { name: 'ویرایش مورد', exact: true }).click();
    await frame.getByRole('textbox', { name: 'عنوان', exact: true }).waitFor(); await screenshot('form-goal');
  });
  await check('details:activities', async () => {
    await detail('activities', 'نمونه: برنامهٔ امروز خانواده');
    await frame.getByRole('heading', { name: 'شرکت‌کنندگان', exact: true }).waitFor(); await screenshot('details-activity');
    await frame.getByRole('button', { name: 'ویرایش برنامه', exact: true }).click();
    await frame.getByRole('textbox', { name: 'عنوان برنامه', exact: true }).waitFor(); await screenshot('form-activity');
  });
  await check('details:children', async () => {
    await detail('children', 'فرزند نمونه');
    await frame.getByRole('heading', { name: 'کارهای محول‌شده', exact: true }).waitFor();
    await frame.getByRole('heading', { name: 'برنامه‌های مرتبط', exact: true }).waitFor(); await screenshot('details-child');
    await frame.getByRole('button', { name: 'ویرایش مشخصات فرزند', exact: true }).click();
    await frame.getByRole('textbox', { name: 'نام فرزند', exact: true }).waitFor(); await screenshot('form-child');
  });
  await check('details:pets', async () => {
    await detail('pets', 'نمونه: گربهٔ خانه');
    await frame.locator('.pets-care-list li').first().waitFor(); await screenshot('details-pet-care');
    await frame.locator('.pets-care-list button').first().click();
    await frame.locator('.toast').filter({ hasText: 'انجام‌شدن کار مراقبتی ثبت شد.' }).waitFor({ timeout: 5000 });
    await frame.getByRole('button', { name: 'انجام‌شده', exact: true }).click();
    await frame.locator('.pets-care-list li').first().waitFor(); await screenshot('details-pet-care-completed');
    await frame.getByRole('button', { name: 'ثبت کار مراقبتی جدید', exact: true }).click();
    await frame.getByRole('textbox', { name: 'عنوان کار مراقبتی', exact: true }).waitFor(); await screenshot('form-pet-care');
  });
  await check('details:meals', async () => {
    await routeReady('meals');
    await frame.locator('.meal-slot-dish.assigned').first().click();
    await frame.getByRole('button', { name: 'ذخیرهٔ وعده', exact: true }).waitFor(); await screenshot('form-meal-slot');
    await page.keyboard.press('Escape');
    await frame.getByRole('button', { name: 'ذخیرهٔ وعده', exact: true }).waitFor({ state: 'hidden' });
    await frame.getByRole('button', { name: 'فهرست غذاها', exact: true }).click();
    await frame.locator('.meal-dish-details').first().click();
    await frame.getByRole('button', { name: 'ذخیرهٔ غذا', exact: true }).waitFor(); await screenshot('form-dish');
  });
}

async function scenarioChecks(metadata) {
  const selected = id => !selectedScenarios || selectedScenarios.includes(id);
  if (selected('empty-owner')) {
    for (const destination of metadata.routes.filter(route => !['auth', 'invite'].includes(route.id) && !route.id.startsWith('settings/'))) {
      await check('scenario:empty-owner:' + destination.id, async () => {
        await routeReady(destination.id, 'empty-owner');
        assert.ok(!(await frame.locator('body').innerText()).includes('نمونه:'), 'An empty household retained populated fixture records');
        await screenshot('empty-' + destination.id);
      });
    }
  }
  for (const scenarioId of ['full-admin', 'full-member']) {
    if (!selected(scenarioId)) continue;
    await check('scenario:' + scenarioId + ':children', async () => {
      await routeReady('children', scenarioId);
      assert.equal(await frame.getByRole('button', { name: 'ثبت فرزند جدید', exact: true }).count(), scenarioId === 'full-admin' ? 1 : 0);
      await frame.getByRole('button', { name: 'جزئیات فرزند نمونه', exact: true }).click();
      await frame.getByRole('button', { name: 'بستن جزئیات', exact: true }).waitFor();
      assert.equal(await frame.getByRole('button', { name: 'ویرایش مشخصات فرزند', exact: true }).count(), scenarioId === 'full-admin' ? 1 : 0);
      await screenshot('scenario-' + scenarioId);
    });
  }
  for (const scenarioId of ['minor-member', 'missing-birth']) {
    if (!selected(scenarioId)) continue;
    await check('scenario:' + scenarioId, async () => {
      await routeReady('vehicles', scenarioId);
      assert.equal(await frame.getByRole('button', { name: 'ثبت خودروی جدید', exact: true }).count(), 0);
      await screenshot('scenario-' + scenarioId);
      await frame.getByRole('button', { name: 'جزئیات نمونه: خودروی خانواده', exact: true }).click();
      await frame.getByRole('button', { name: 'بستن جزئیات', exact: true }).waitFor();
      assert.equal(await frame.getByRole('button', { name: 'ثبت سرویس انجام‌شده', exact: true }).count(), 0);
      assert.equal(await frame.getByRole('button', { name: 'ویرایش خودرو', exact: true }).count(), 0);
      await routeReady('documents', scenarioId);
      await frame.getByText('اجازه انجام این کار را ندارید', { exact: true }).waitFor({ timeout: 5000 });
      await screenshot('scenario-' + scenarioId + '-documents');
    });
  }
  if (selected('errors')) {
    for (const destination of ['equipment', 'vehicles', 'documents', 'goals', 'activities', 'children', 'pets', 'meals']) {
      await check('scenario:errors:' + destination, async () => {
        await routeReady(destination, 'errors');
        await frame.locator('section.page.active [role="alert"]').first().waitFor({ timeout: 5000 });
        assert.ok(await frame.getByRole('button', { name: 'تلاش دوباره', exact: true }).isEnabled());
        await screenshot('error-' + destination);
      });
    }
  }
  if (selected('loading')) {
    for (const destination of ['equipment', 'documents', 'meals']) {
      await check('scenario:loading:' + destination, async () => {
        await routeReady(destination, 'loading');
        assert.equal(await frame.locator('section.page.active').getAttribute('aria-busy'), 'true');
        await frame.getByText(/در حال دریافت/).first().waitFor(); await screenshot('loading-' + destination);
      });
    }
  }
  if (selected('offline')) {
    for (const destination of ['shopping', 'inventory', 'tasks', 'equipment']) {
      await check('scenario:offline:' + destination, async () => {
        await routeReady(destination, 'offline');
        assert.equal(await frame.evaluate(() => navigator.onLine), false);
        if (['shopping', 'inventory', 'tasks'].includes(destination)) {
          await frame.locator('section.page.active').getByText(loadedText[destination], { exact: false }).first().waitFor({ timeout: 5000 });
        } else {
          await frame.locator('.hub-page').waitFor();
          await frame.getByText('اتصال اینترنت نیست', { exact: true }).waitFor();
          await frame.getByText('در حالت آفلاین، موعدهای کارهای خانه نمایش داده می‌شوند.', { exact: true }).waitFor();
        }
        await screenshot('offline-' + destination);
      });
    }
  }
  for (const scenarioId of ['save-errors', 'conflict']) {
    if (!selected(scenarioId)) continue;
    await check('scenario:' + scenarioId, async () => {
      await routeReady('children', scenarioId);
      await frame.getByRole('button', { name: 'جزئیات فرزند نمونه', exact: true }).click();
      await frame.getByRole('button', { name: 'ویرایش مشخصات فرزند', exact: true }).click();
      await frame.getByRole('textbox', { name: 'نام فرزند', exact: true }).fill('نام آزمایشی برای بررسی پیام');
      const response = page.waitForResponse(response => response.url().includes('/api/v1/children/') && response.request().method() === 'PATCH');
      await frame.getByRole('button', { name: 'ذخیرهٔ مشخصات فرزند', exact: true }).click();
      assert.equal((await response).status(), scenarioId === 'conflict' ? 409 : 503);
      await frame.locator('.modal-sheet [role="alert"]').first().waitFor({ timeout: 5000 });
      if (scenarioId === 'conflict') await frame.getByRole('button', { name: 'دریافت مشخصات جدید', exact: true }).waitFor();
      await screenshot('scenario-' + scenarioId);
    });
  }
  if (selected('reminders-off')) await check('scenario:reminders-off', async () => {
    await routeReady('settings/notifications', 'reminders-off');
    await frame.getByText('در حال خواندن تنظیمات…', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await frame.getByRole('switch').first().getAttribute('aria-checked'), 'false'); await screenshot('scenario-reminders-off');
  });
  if (selected('sms-pending')) await check('scenario:sms-pending', async () => {
    await routeReady('sms', 'sms-pending');
    await frame.locator('.sms-inbox-row').first().click();
    const sheet = frame.locator('.modal-sheet').filter({ has: frame.locator('.pending-head') });
    await sheet.waitFor();
    await screenshot('scenario-sms-pending');
    await sheet.getByRole('button', { name: 'نادیده', exact: true }).click();
    await sheet.waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal(await frame.locator('.sms-inbox-row').count(), 0);
  });
}

async function guestChecks() {
  const selected = id => !selectedScenarios || selectedScenarios.includes(id);
  const loginForm = () => frame.locator('.auth-track form').nth(0);
  const registerForm = () => frame.locator('.auth-track form').nth(1);
  const toast = text => frame.locator('.toast').filter({ hasText: text }).waitFor({ timeout: 6000 });
  const login = async () => {
    await loginForm().locator('input[type=tel]').fill('09000000001');
    await loginForm().locator('input[type=password]').fill('Test12345!');
    await loginForm().locator('button[type=submit]').click();
  };
  const fillRegister = async () => {
    await registerForm().getByPlaceholder('شماره موبایل', { exact: true }).fill('09000000009');
    await registerForm().getByPlaceholder('نام خانواده', { exact: true }).fill('خانوادهٔ تازهٔ نمونه');
    await registerForm().getByPlaceholder('نام شما', { exact: true }).fill('مدیر تازهٔ نمونه');
    await registerForm().getByPlaceholder('رمز عبور (حداقل ۸ کاراکتر)', { exact: true }).fill('Test12345!');
  };
  const submitInvite = async () => {
    await frame.getByPlaceholder('نام', { exact: true }).fill('عضو تازهٔ نمونه');
    await frame.getByPlaceholder('۰۹۱۲۳۴۵۶۷۸۹', { exact: true }).fill('09000000009');
    await frame.getByPlaceholder('حداقل ۸ کاراکتر', { exact: true }).fill('Test12345!');
    await frame.locator('select').selectOption('همسر');
    await frame.getByRole('button', { name: 'ارسال درخواست عضویت', exact: true }).click();
  };
  if (selected('auth-login')) await check('scenario:auth-login:reset-and-join', async () => {
    await openPreview('auth-login', 'auth'); await frame.locator('.auth-track:not(.reg)').waitFor(); await screenshot('auth-login');
    await loginForm().locator('button[type=submit]').click(); await toast('شماره موبایل معتبر نیست'); await screenshot('auth-invalid-phone');
    await frame.getByRole('button', { name: 'رمز عبور را فراموش کرده‌اید؟', exact: true }).click();
    await frame.getByRole('heading', { name: 'بازیابی رمز عبور', exact: true }).waitFor(); await screenshot('auth-reset-phone');
    await frame.getByPlaceholder('شماره موبایل', { exact: true }).fill('09000000001');
    await frame.getByRole('button', { name: 'ارسال کد بازیابی', exact: true }).click();
    await frame.getByRole('heading', { name: 'رمز جدید', exact: true }).waitFor(); await screenshot('auth-reset-code');
    assert.equal(await frame.getByRole('button', { name: /ارسال مجدد تا/ }).isDisabled(), true);
    await frame.getByPlaceholder('••••••', { exact: true }).fill('123456');
    await frame.getByPlaceholder('رمز عبور جدید (حداقل ۸ کاراکتر)', { exact: true }).fill('Test98765!');
    await frame.getByRole('button', { name: 'تغییر رمز', exact: true }).click();
    await frame.locator('.auth-track').waitFor(); await toast('رمز عبور عوض شد');
    await frame.getByRole('button', { name: 'با کد خانواده بپیوندید', exact: true }).click();
    await frame.getByRole('heading', { name: 'پیوستن به خانواده', exact: true }).waitFor(); await screenshot('auth-join-code');
    await frame.getByPlaceholder('••••••', { exact: true }).fill('123456');
    await frame.getByPlaceholder('نام شما', { exact: true }).fill('عضو تازهٔ نمونه'); await frame.locator('select').selectOption('همسر');
    await frame.getByPlaceholder('شماره موبایل', { exact: true }).fill('09000000009');
    await frame.getByPlaceholder('رمز عبور (حداقل ۸ کاراکتر)', { exact: true }).fill('Test12345!');
    await frame.getByRole('button', { name: 'ارسال درخواست عضویت', exact: true }).click();
    await frame.getByRole('heading', { name: 'درخواست شما ثبت شد', exact: true }).waitFor(); await screenshot('auth-join-pending');
  });
  if (selected('auth-register')) await check('scenario:auth-register', async () => {
    await openPreview('auth-register', 'auth'); await frame.locator('.auth-track.reg').waitFor(); await screenshot('auth-register');
    await registerForm().locator('button[type=submit]').click(); await toast('نام خانواده را وارد کنید');
    await fillRegister(); const response = page.waitForResponse(value => value.url().endsWith('/auth/register'));
    await registerForm().locator('button[type=submit]').click(); assert.equal((await response).status(), 200);
    await toast('خانواده ساخته شد'); await screenshot('auth-register-success');
  });
  if (selected('auth-otp')) {
    await check('scenario:auth-otp:login', async () => {
      await openPreview('auth-otp', 'auth'); await login();
      await frame.getByRole('heading', { name: 'کد تأیید', exact: true }).waitFor(); await screenshot('auth-otp');
      await frame.getByPlaceholder('••••••', { exact: true }).fill('000000');
      await frame.getByRole('button', { name: 'تأیید و ورود', exact: true }).click();
      await toast('کد وارد شده صحیح نیست یا منقضی شده'); await screenshot('auth-otp-invalid');
      await frame.getByRole('button', { name: 'ارسال مجدد کد', exact: true }).click();
      await frame.getByPlaceholder('••••••', { exact: true }).fill('123456');
      const response = page.waitForResponse(value => value.url().endsWith('/auth/login'));
      await frame.getByRole('button', { name: 'تأیید و ورود', exact: true }).click(); assert.equal((await response).status(), 200);
    });
    await check('scenario:auth-otp:register', async () => {
      await openPreview('auth-otp', 'auth'); await frame.locator('.auth-switch').getByRole('button', { name: 'ثبت‌نام', exact: true }).click();
      await fillRegister(); await registerForm().locator('button[type=submit]').click();
      await frame.getByRole('heading', { name: 'کد تأیید', exact: true }).waitFor();
      await frame.getByPlaceholder('••••••', { exact: true }).fill('000000');
      const response = page.waitForResponse(value => value.url().endsWith('/auth/register'));
      await frame.getByRole('button', { name: 'تأیید و ورود', exact: true }).click(); assert.equal((await response).status(), 400);
      await toast('کد وارد شده صحیح نیست یا منقضی شده'); await screenshot('auth-register-otp-invalid');
    });
  }
  for (const [scenarioId, message] of [['auth-invalid', 'شماره موبایل یا رمز عبور اشتباه است'], ['auth-suspended', 'عضویت شما در خانواده فعال نیست.']]) {
    if (!selected(scenarioId)) continue;
    await check('scenario:' + scenarioId, async () => { await openPreview(scenarioId, 'auth'); await login(); await toast(message); await screenshot(scenarioId); });
  }
  if (selected('auth-pre-registered')) await check('scenario:auth-pre-registered', async () => {
    await openPreview('auth-pre-registered', 'auth'); await frame.locator('.auth-track.reg').waitFor();
    await registerForm().getByPlaceholder('شماره موبایل', { exact: true }).fill('09000000009');
    await frame.getByText(/این شماره قبلاً به‌عنوان عضو خانواده/).waitFor();
    assert.equal(await registerForm().locator('input[aria-readonly=true]').count(), 1); await screenshot('auth-pre-registered');
    await registerForm().getByPlaceholder('نام شما', { exact: true }).fill('عضو معرفی‌شدهٔ نمونه');
    await registerForm().getByPlaceholder('رمز عبور (حداقل ۸ کاراکتر)', { exact: true }).fill('Test12345!');
    await registerForm().locator('select').selectOption('همسر');
    await frame.getByRole('button', { name: 'تکمیل ثبت‌نام', exact: true }).click(); await toast('ثبت‌نام کامل شد');
  });
  for (const scenarioId of ['invite-valid', 'invite-expired', 'invite-pending']) {
    if (!selected(scenarioId)) continue;
    await check('scenario:' + scenarioId, async () => {
      await openPreview(scenarioId, 'invite');
      if (scenarioId === 'invite-expired') await toast('لینک دعوت نامعتبر یا منقضی شده است');
      else await frame.getByText(/شما به خانواده «/).waitFor();
      await screenshot(scenarioId);
      const response = page.waitForResponse(value => value.url().endsWith('/auth/accept-invite'));
      await submitInvite(); assert.equal((await response).status(), scenarioId === 'invite-expired' ? 404 : 200);
      if (scenarioId === 'invite-expired') assert.equal(await frame.getByRole('heading', { name: 'درخواست شما ثبت شد', exact: true }).count(), 0);
      else { await frame.getByRole('heading', { name: 'درخواست شما ثبت شد', exact: true }).waitFor(); await screenshot(scenarioId + '-submitted'); }
    });
  }
  if (selected('intro')) await check('scenario:intro', async () => {
    await openPreview('intro', 'hub'); await frame.getByRole('heading', { name: 'به خانه‌یار خوش آمدی', exact: true }).waitFor(); await screenshot('intro-welcome');
    await frame.locator('.onb-btn-primary').click(); await frame.getByRole('heading', { name: 'خانه‌یار چه کار می‌کند؟', exact: true }).waitFor(); await screenshot('intro-features');
    await frame.locator('.onb-btn-primary').click(); await frame.getByRole('heading', { name: 'خانه‌ی شما را بسازیم', exact: true }).waitFor(); await screenshot('intro-household');
  });
  if (selected('install')) await check('scenario:install', async () => {
    await openPreview('install', 'hub');
    await frame.getByRole('heading', { name: 'خانه‌یار را به صفحه‌ی اصلی اضافه کنید', exact: true }).waitFor(); await screenshot('install-desktop');
  });
}

try {
  await mkdir(screenshotDir, { recursive: true });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1900, height: 1120 }, timezoneId: 'Asia/Tehran',
    serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) {
      results.blockedRequests.push({ check: activeCheck, origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient');
    }
    if (/^\/__copy\/(?:apply|undo)/.test(url.pathname)) throw new Error('This check must never apply source text');
    return route.continue();
  });
  await context.addInitScript(() => {
    window.__previewCheckEvents = [];
    window.addEventListener('message', event => {
      const iframe = document.getElementById('copy-preview');
      if (event.origin === location.origin && event.source === iframe?.contentWindow && event.data?.type?.startsWith('copy-preview')) {
        window.__previewCheckEvents.push({ ...event.data, time: Date.now() });
      }
    });
  });
  page = await context.newPage();
  page.on('pageerror', error => results.pageErrors.push({ check: activeCheck, message: error.message }));
  page.on('response', response => {
    if (!response.url().includes('/api/v1') || response.status() !== 404) return;
    const pending = response.json().then(body => {
      if (body?.error === 'PREVIEW_ENDPOINT_NOT_FOUND' || body?.error?.code === 'PREVIEW_ENDPOINT_NOT_FOUND' || body?.code === 'PREVIEW_ENDPOINT_NOT_FOUND') {
        results.unknownEndpoints.push({ check: activeCheck, method: response.request().method(), url: response.url(), body });
      }
    }).catch(() => {}).finally(() => pendingResponses.delete(pending)); pendingResponses.add(pending);
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#preview-route option').first().waitFor({ state: 'attached' });
  const metadata = await page.evaluate(async () => (await fetch('/__copy/scenarios')).json());
  assert.equal(metadata.routes.length, 39); assert.equal(metadata.scenarios.length, 24);
  results.availableRoutes = metadata.routes.map(value => value.id); results.availableScenarios = metadata.scenarios.map(value => value.id);
  // Do not interrupt the studio's initial preview bootstrap with another reset.
  await page.waitForFunction(() => (window.__previewCheckEvents ?? []).some(event => ['copy-preview-ready', 'copy-preview-error'].includes(event.type)), null, { timeout: 28000 });
  for (const route of metadata.routes) {
    if (scenariosOnly) continue;
    if (selectedRoutes && !selectedRoutes.includes(route.id)) continue;
    await check('route:' + route.id, async () => { await routeReady(route.id); await screenshot('route-' + route.id); });
  }
  if (!routesOnly) {
    if (!scenariosOnly && !selectedRoutes && !selectedScenarios) await detailsChecks();
    await scenarioChecks(metadata);
    await guestChecks();
  }
  if (!selectedRoutes && !selectedScenarios) await check('workbench:overview', async () => {
    await routeReady('hub'); await screenshot('workbench-overview', true);
    assert.equal(await page.locator('#apply-changes').isDisabled(), true);
  });
} catch (error) {
  results.failures.push({ name: activeCheck, message: error.message, details: page ? await diagnostics().catch(() => null) : null });
  console.error(error);
} finally {
  results.finishedAt = new Date().toISOString();
  await Promise.allSettled([...pendingResponses]);
  await persist(); await context?.close(); await browser?.close();
  console.log(JSON.stringify({ passed: results.checks.length, failed: results.failures.length, pageErrors: results.pageErrors.length,
    unknownEndpoints: results.unknownEndpoints.length, blockedRequests: results.blockedRequests.length, artifact: resolve(artifactDir, 'preview-results.json') }));
  if (results.failures.length || results.pageErrors.length || results.unknownEndpoints.length || results.blockedRequests.length) process.exitCode = 1;
}
