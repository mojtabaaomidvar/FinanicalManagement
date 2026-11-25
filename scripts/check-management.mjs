import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';

// An ephemeral management demo with its own identity and sample data. No production
// or manual sandbox requests, provider calls, sudo helpers or Docker operations.
const root = resolve('.');
const output = resolve('.local-test/management-browser', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((done, reject) => reservation.close(error => error ? reject(error) : done()));
const origin = `http://127.0.0.1:${port}`;
const config = resolve(output, 'config.json');
await writeFile(config, JSON.stringify({ mode: 'demo', origin, port, state_dir: output, web_root: resolve('.local-test/management-web') }));
const python = process.platform === 'win32' ? 'python.exe' : 'python3';
async function command(arguments_) {
  const child = spawn(python, ['-X', 'utf8', '-m', 'app.management.cli', '--config', config, ...arguments_], { cwd: resolve(root, 'backend'), stdio: ['ignore', 'pipe', 'pipe'] });
  let text = ''; child.stderr.on('data', chunk => { text += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, text);
}
await command(['init', '--credentials-file', resolve(output, 'access.txt')]);
const access = await readFile(resolve(output, 'access.txt'), 'utf8');
const password = /^Password: (.+)$/m.exec(access)[1];
const server = spawn(python, ['-X', 'utf8', '-m', 'app.management.cli', '--config', config, 'serve'], { cwd: resolve(root, 'backend'), stdio: ['ignore', 'pipe', 'pipe'] });
let serverErrors = ''; server.stderr.on('data', chunk => { serverErrors += chunk; });
let browser;
const results = { checks: [], screenshots: [], consoleErrors: [], pageErrors: [], externalRequests: [] };
const labels = ['نمای کلی', 'آمار و بهبود محصول', 'سرور و سرویس‌ها', 'کاربران', 'تنظیمات برنامه', 'پشتیبان‌ها', 'نسخه‌ها', 'لاگ سرویس‌ها', 'مدیران و دسترسی‌ها', 'سابقهٔ عملیات'];
const delay = ms => new Promise(done => setTimeout(done, ms));
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(origin + '/management/api/session')).ok) { ready = true; break; } } catch { /* Wait for this test's process only. */ }
    await delay(250);
  }
  assert.ok(ready, serverErrors);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  async function context(width = 360) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Tehran' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
        results.externalRequests.push(url.origin + url.pathname); await route.abort();
      } else await route.continue();
    });
    return context;
  }
  const ownerContext = await context();
  const page = await ownerContext.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => results.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') results.consoleErrors.push(message.text()); });
  await page.goto(origin + '/management/');
  await page.getByRole('heading', { name: 'ورود به پنل مدیریت', exact: true }).waitFor();
  await page.getByLabel('نام کاربری', { exact: true }).fill('admin');
  await page.getByLabel('رمز حساب مدیریت', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ورود به مدیریت', exact: true }).click();
  await page.getByRole('heading', { name: 'خانه‌یار در دسترس است', exact: true }).waitFor();
  results.checks.push('Independent cookie login and overview under /management/');
  async function navigate(label) {
    await page.getByRole('navigation').getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.mg-state[role=status]').length === 0);
    await page.getByRole('heading', { name: label, level: 1, exact: true }).waitFor();
  }
  async function screenshot(name) {
    const path = resolve(output, name + '.png');
    await page.screenshot({ path, fullPage: true }); results.screenshots.push(path);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Body overflow: ' + name);
  }
  async function confirm({ target, shot } = {}) {
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    if (target) await dialog.locator('input[autocomplete="off"]').fill(target);
    await dialog.getByLabel('رمز حساب مدیریت', { exact: true }).fill(password);
    await dialog.getByRole('checkbox').check();
    if (shot) await screenshot(shot);
    await dialog.getByRole('button', { name: 'تأیید و اجرا', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByText('عملیات با موفقیت انجام شد.', { exact: true }).waitFor();
  }
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (let index = 0; index < labels.length; index++) {
      await navigate(labels[index]);
      if (labels[index] === 'کاربران') {
        const control = await page.getByRole('button', { name: 'تعلیق', exact: true }).boundingBox();
        assert.ok(control && control.x >= 0 && control.x + control.width <= width, 'User actions require horizontal scrolling');
      }
      await screenshot(`page-${index}-${width}`);
    }
  }
  results.checks.push('All ten pages at 360 and 1440 pixels without body overflow');
  await page.setViewportSize({ width: 360, height: 900 });
  await navigate('آمار و بهبود محصول');
  for (const days of [7, 90]) {
    await page.getByLabel('بازهٔ آمار', { exact: true }).selectOption(String(days));
    await page.waitForFunction(days => document.querySelectorAll('.mg-analytics-daily tbody tr').length === days, days);
  }
  await page.getByRole('button', { name: 'نمایش همهٔ بخش‌ها، همراه شمارنده‌های صفر', exact: true }).click();
  assert.equal(await page.locator('.mg-analytics-modules > li').count(), 21);
  await page.locator('.mg-analytics-modules > li').filter({ has: page.getByRole('heading', { name: 'لیست خرید', exact: true }) }).getByText('جزئیات درخواست‌ها', { exact: true }).click();
  await page.getByText('تعداد رکوردهای سایر بخش‌ها', { exact: true }).click();
  await page.getByText('قلم انبار', { exact: true }).waitFor();
  const analyticsDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'دریافت گزارش تجمیعی', exact: true }).click();
  const analyticsFile = resolve(output, 'product-aggregate.json');
  await (await analyticsDownloadPromise).saveAs(analyticsFile);
  const aggregate = JSON.parse(await readFile(analyticsFile, 'utf8'));
  assert.equal(aggregate.days, 90);
  assert.equal(aggregate.daily.length, 90);
  assert.equal(aggregate.modules.length, 21);
  assert.equal(aggregate.record_inventory.inventory_items, 22);
  assert.equal(aggregate.measurement.website, 'not_measured');
  for (const forbidden of ['ddc41176-861c-44c5-a67a-ff0aba53ee80', '0912***45', 'password_hash', 'family_id', 'member_id']) {
    assert.ok(!JSON.stringify(aggregate).includes(forbidden));
  }
  results.checks.push('Analytics periods, module details and aggregate-only JSON export');
  await navigate('نمای کلی');
  await page.getByRole('button', { name: 'ساخت پشتیبان کامل', exact: true }).click();
  await confirm();
  await navigate('پشتیبان‌ها');
  assert.equal(await page.locator('.mg-records > li').count(), 1);
  await page.getByRole('button', { name: 'بررسی', exact: true }).click(); await confirm();
  await page.getByRole('button', { name: 'دریافت', exact: true }).click();
  const downloadDialog = page.getByRole('dialog'); await downloadDialog.waitFor();
  await downloadDialog.getByLabel('رمز حساب مدیریت', { exact: true }).fill(password);
  await downloadDialog.getByRole('checkbox').check();
  const downloadPromise = page.waitForEvent('download');
  await downloadDialog.getByRole('button', { name: 'دریافت فایل', exact: true }).click();
  await (await downloadPromise).saveAs(resolve(output, 'downloaded-demo-backup.json'));
  await downloadDialog.waitFor({ state: 'hidden' });
  results.checks.push('Backup creation, integrity check and protected download');

  await navigate('تنظیمات برنامه');
  await page.getByLabel('ثبت‌نام و پیوستن حساب تازه', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'بررسی و ذخیرهٔ تغییرها', exact: true }).click();
  await confirm({ shot: 'settings-confirm-360' });
  await page.getByLabel('ثبت‌نام و پیوستن حساب تازه', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('ثبت‌نام و پیوستن حساب تازه', { exact: true }).isChecked(), false);
  results.checks.push('Runtime settings preview, confirmation and persisted result');

  await navigate('کاربران');
  await page.getByRole('button', { name: 'تعلیق', exact: true }).click(); await confirm();
  await page.getByRole('button', { name: 'رفع تعلیق', exact: true }).nth(1).waitFor();
  assert.equal(await page.getByRole('button', { name: 'رفع تعلیق', exact: true }).count(), 2);
  await page.getByRole('button', { name: 'رفع تعلیق', exact: true }).first().click(); await confirm();
  await page.getByLabel('کد پشتیبانی یا شمارهٔ کامل', { exact: true }).fill('00000000-0000-4000-8000-000000000000');
  await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
  await page.getByText('کاربری با این جست‌وجو پیدا نشد.', { exact: true }).waitFor();
  await screenshot('empty-users-360');
  results.checks.push('User suspension, activation and empty search');

  await navigate('نسخه‌ها');
  await page.getByLabel('شمارهٔ نسخه', { exact: true }).fill('v0.6.1');
  await page.getByRole('button', { name: 'دریافت و بررسی', exact: true }).click(); await confirm();
  await page.getByRole('button', { name: 'بررسی و نصب', exact: true }).click();
  await confirm({ target: 'v0.6.1', shot: 'release-confirm-360' });
  await navigate('نمای کلی');
  await page.getByText('0.6.1', { exact: true }).waitFor();
  results.checks.push('Release stage and install with explicit target confirmation');

  await navigate('پشتیبان‌ها');
  const backup = page.locator('.mg-records > li').last();
  const backupId = await backup.locator('code').innerText();
  await backup.getByRole('button', { name: 'بازیابی', exact: true }).click(); await confirm({ target: backupId });
  await navigate('نمای کلی');
  await page.getByText('0.6.0', { exact: true }).waitFor();
  results.checks.push('Restore snapshot and automatic safety backup');

  await navigate('مدیران و دسترسی‌ها');
  await page.getByRole('button', { name: 'افزودن مدیر', exact: true }).click();
  const account = page.getByRole('dialog'); await account.waitFor();
  await account.getByLabel('نام کاربری', { exact: true }).fill('test-viewer');
  await account.getByLabel(/^رمز حساب تازه/).fill('viewer-test-password-123');
  await account.getByLabel('رمز حساب مدیریت', { exact: true }).fill(password);
  await account.getByRole('button', { name: 'ذخیرهٔ حساب', exact: true }).click();
  await account.waitFor({ state: 'hidden' });
  await page.getByText('test-viewer', { exact: true }).waitFor();
  const viewerContext = await context(1440);
  const login = await viewerContext.request.post(origin + '/management/api/login', { headers: { Origin: origin }, data: { username: 'test-viewer', password: 'viewer-test-password-123', code: '' } });
  assert.equal(login.status(), 200);
  const viewerSession = await login.json();
  const viewerPage = await viewerContext.newPage(); await viewerPage.goto(origin);
  await viewerPage.getByRole('heading', { name: 'خانه‌یار در دسترس است', exact: true }).waitFor();
  assert.equal(await viewerPage.getByRole('button', { name: 'مدیران و دسترسی‌ها', exact: true }).count(), 0);
  assert.equal(await viewerPage.getByRole('button', { name: 'ساخت پشتیبان کامل', exact: true }).count(), 0);
  const viewerAnalytics = await viewerContext.request.get(origin + '/management/api/state/analytics?days=7');
  assert.equal(viewerAnalytics.status(), 200);
  assert.equal((await viewerAnalytics.json()).days, 7);
  const forbidden = await viewerContext.request.post(origin + '/management/api/plans', { headers: { Origin: origin, 'X-Management-CSRF': viewerSession.csrf }, data: { kind: 'backup.create' } });
  assert.equal(forbidden.status(), 403);
  await viewerContext.close();
  results.checks.push('Manager creation and viewer permissions in both UI and API');

  await navigate('سابقهٔ عملیات');
  assert.ok(await page.locator('.mg-records > li').count() >= 7);
  await screenshot('history-complete-360');
  const keyboardTargets = await page.locator('button:visible').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
  assert.ok(keyboardTargets.every(height => height >= 44), 'Touch targets below 44px');
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'));
  results.checks.push('Audit history, touch targets and keyboard focus');

  const recoveryContext = await context(360);
  const recoveryLogin = await recoveryContext.request.post(origin + '/management/api/login', { headers: { Origin: origin }, data: { username: 'admin', password, code: '' } });
  assert.equal(recoveryLogin.status(), 200);
  let releaseLoading;
  const loadingGate = new Promise(done => { releaseLoading = done; });
  let failOnce = true;
  await recoveryContext.route('**/management/api/state/overview', async route => {
    if (failOnce) {
      await loadingGate; failOnce = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'TEST_UNAVAILABLE', message: 'سرویس نمونه برای بررسی بازیابی موقتاً قطع شده است.' }) });
    } else await route.continue();
  });
  const recoveryPage = await recoveryContext.newPage();
  recoveryPage.on('pageerror', error => results.pageErrors.push(error.message));
  await recoveryPage.goto(origin);
  await recoveryPage.locator('.mg-state[role=status]').waitFor();
  releaseLoading();
  await recoveryPage.getByText('دریافت اطلاعات کامل نشد', { exact: true }).waitFor();
  const failureScreenshot = resolve(output, 'failure-360.png');
  await recoveryPage.screenshot({ path: failureScreenshot, fullPage: true }); results.screenshots.push(failureScreenshot);
  await recoveryPage.getByRole('button', { name: 'بررسی دوباره', exact: true }).click();
  await recoveryPage.getByRole('heading', { name: 'خانه‌یار در دسترس است', exact: true }).waitFor();
  const observed = await (await recoveryContext.request.get(origin + '/management/api/state/analytics?days=30')).json();
  const unmeasured = structuredClone(observed);
  unmeasured.measurement.usage_available = false;
  unmeasured.measurement.records_available = false;
  unmeasured.measurement.first_usage_counter = null;
  unmeasured.modules = unmeasured.usage = unmeasured.lifetime_usage = unmeasured.records = null;
  unmeasured.daily.forEach(point => { point.opens = point.requests = null; });
  let analyticsVariant = unmeasured;
  await recoveryContext.route('**/management/api/state/analytics?*', async route => {
    if (analyticsVariant === 'failure') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'TEST_REPORT', message: 'گزارش نمونه موقتاً در دسترس نیست.' }) });
    else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(analyticsVariant) });
  });
  await recoveryPage.getByRole('navigation').getByRole('button', { name: 'آمار و بهبود محصول', exact: true }).click();
  await recoveryPage.getByText('شمارندهٔ استفاده در این نسخه در دسترس نیست؛ عدد صفر به‌جای دادهٔ ناموجود نمایش داده نمی‌شود.', { exact: true }).waitFor();
  assert.ok(await recoveryPage.getByText('اندازه‌گیری‌نشده', { exact: true }).count() > 0);
  const unmeasuredScreenshot = resolve(output, 'analytics-unmeasured-360.png');
  await recoveryPage.screenshot({ path: unmeasuredScreenshot, fullPage: true }); results.screenshots.push(unmeasuredScreenshot);
  analyticsVariant = structuredClone(observed);
  analyticsVariant.modules.forEach(row => { row.opens = row.creates = row.updates = row.completes = row.deletes = 0; });
  analyticsVariant.usage = analyticsVariant.lifetime_usage = { opens: 0, requests: 0 };
  analyticsVariant.measurement.first_usage_counter = null;
  analyticsVariant.daily.forEach(point => { point.opens = point.requests = 0; });
  await recoveryPage.getByRole('button', { name: 'بررسی دوباره', exact: true }).click();
  await recoveryPage.getByText('هنوز رویدادی در شمارنده ثبت نشده است. این وضعیت به‌تنهایی به معنی استفاده‌نشدن از برنامه نیست.', { exact: true }).waitFor();
  analyticsVariant = 'failure';
  await recoveryPage.getByRole('button', { name: 'بررسی دوباره', exact: true }).click();
  await recoveryPage.getByText('گزارش آماری دریافت نشد', { exact: true }).waitFor();
  analyticsVariant = observed;
  await recoveryPage.getByRole('button', { name: 'بررسی دوباره', exact: true }).click();
  await recoveryPage.getByText('وضعیت حساب‌ها و ثبت‌نام', { exact: true }).waitFor();
  results.checks.push('Analytics missing, empty and failure states without fabricated zeros');
  await recoveryContext.route('**/management/api/state/users*', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'UNAUTHORIZED', message: 'نشست نمونه پایان یافته است.' }) }));
  await recoveryPage.getByRole('navigation').getByRole('button', { name: 'کاربران', exact: true }).click();
  await recoveryPage.getByRole('heading', { name: 'ورود به پنل مدیریت', exact: true }).waitFor();
  assert.equal(await recoveryPage.getByLabel('رمز حساب مدیریت', { exact: true }).inputValue(), '');
  assert.equal(await recoveryPage.locator('.mg-sidebar').count(), 0);
  await recoveryContext.close();
  results.checks.push('Loading, failure recovery and expired-session data clearing');

  assert.deepEqual(results.externalRequests, []);
  assert.deepEqual(results.pageErrors, []);
  assert.deepEqual(results.consoleErrors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`PASS: ${results.checks.length} browser checks; ${results.screenshots.length} screenshots; no console errors or external requests. Evidence: ${output}`);
} finally {
  if (browser) await browser.close();
  server.kill();
}
