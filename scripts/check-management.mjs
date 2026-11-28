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
async function inspectWorkbook(path) {
  const script = `from zipfile import ZipFile
from xml.etree import ElementTree as ET
import json, sys
with ZipFile(sys.argv[1]) as archive:
    assert archive.testzip() is None
    names = {item.filename for item in archive.infolist()}
    assert {"[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml"} <= names
    for name in names:
        if name.endswith((".xml", ".rels")):
            ET.fromstring(archive.read(name))
    ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    book = ET.fromstring(archive.read("xl/workbook.xml"))
    sheets = [sheet.attrib["name"] for sheet in book.findall("x:sheets/x:sheet", ns)]
    result = {"sheets": sheets, "rows": {}, "formula_cells": 0}
    for index, name in enumerate(sheets, 1):
        sheet = ET.fromstring(archive.read(f"xl/worksheets/sheet{index}.xml"))
        rows = sheet.findall("x:sheetData/x:row", ns)
        result["rows"][name] = len(rows) - 1
        result["formula_cells"] += len(sheet.findall(".//x:f", ns))
print(json.dumps(result, ensure_ascii=False))`;
  const child = spawn(python, ['-X', 'utf8', '-c', script, path], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, stderr);
  return JSON.parse(stdout);
}
await command(['init', '--credentials-file', resolve(output, 'access.txt')]);
const access = await readFile(resolve(output, 'access.txt'), 'utf8');
const password = /^Password: (.+)$/m.exec(access)[1];
const server = spawn(python, ['-X', 'utf8', '-m', 'app.management.cli', '--config', config, 'serve'], { cwd: resolve(root, 'backend'), stdio: ['ignore', 'pipe', 'pipe'] });
let serverErrors = ''; server.stderr.on('data', chunk => { serverErrors += chunk; });
let browser;
const results = { checks: [], screenshots: [], consoleErrors: [], pageErrors: [], externalRequests: [] };
const labels = ['داشبورد', 'نمای کلی', 'آمار و بهبود محصول', 'سرور و سرویس‌ها', 'کاربران', 'تنظیمات برنامه', 'پشتیبان‌ها', 'نسخه‌ها', 'لاگ سرویس‌ها', 'مدیران و دسترسی‌ها', 'سابقهٔ عملیات'];
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
  await page.getByRole('heading', { name: 'داشبورد', exact: true, level: 1 }).waitFor();
  await page.getByText('خانواده‌های عضو', { exact: true }).waitFor();
  results.checks.push('Independent cookie login and dashboard under /management/');
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
  results.checks.push('All eleven pages at 360 and 1440 pixels without body overflow');
  await page.setViewportSize({ width: 360, height: 900 });
  await navigate('داشبورد');
  for (const days of [7, 90]) {
    await page.getByLabel('بازهٔ داشبورد', { exact: true }).selectOption(String(days));
    await page.waitForFunction(days => document.querySelectorAll('.mg-dash-chart tbody tr').length === days * 2, days);
  }
  const expectedDashboard = await (await ownerContext.request.get(origin + '/management/api/state/analytics?days=90')).json();
  const activity = page.locator('.mg-dash-chart').filter({ has: page.getByRole('heading', { name: 'روند استفاده', exact: true }) });
  assert.equal(await activity.locator('.mg-dash-chart-total strong').innerText(), expectedDashboard.usage.requests.toLocaleString('fa-IR'));
  await activity.getByRole('combobox').selectOption('opens');
  assert.equal(await activity.locator('.mg-dash-chart-total strong').innerText(), expectedDashboard.usage.opens.toLocaleString('fa-IR'));
  await activity.getByRole('combobox').selectOption('errors');
  assert.equal(await activity.locator('.mg-dash-chart-total strong').innerText(), expectedDashboard.errors.total.toLocaleString('fa-IR'));
  const slider = activity.getByRole('slider');
  await slider.focus(); await slider.press('Home');
  assert.equal(await slider.inputValue(), '0');
  await slider.press('End'); assert.equal(await slider.inputValue(), '89');
  await page.getByLabel('معیار رتبه‌بندی بخش‌ها', { exact: true }).selectOption('opens');
  assert.ok(await page.locator('.mg-dash-ranking > li').count() > 0);
  await page.getByRole('button', { name: 'جزئیات سلامت و منابع', exact: true }).click();
  await page.getByRole('heading', { name: 'نمای کلی', exact: true, level: 1 }).waitFor();
  await navigate('داشبورد');
  await page.getByRole('button', { name: 'گزارش کامل و دریافت آمار', exact: true }).click();
  await page.getByRole('heading', { name: 'آمار و بهبود محصول', exact: true, level: 1 }).waitFor();
  results.checks.push('Dashboard periods, exact chart totals, keyboard date selection, ranking and detail navigation');
  await navigate('آمار و بهبود محصول');
  for (const days of [7, 90]) {
    await page.getByLabel('بازهٔ آمار', { exact: true }).selectOption(String(days));
    await page.waitForFunction(days => document.querySelector('.mg-analytics-daily')?.querySelectorAll('tbody tr').length === days, days);
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
  const productExcelDownload = page.waitForEvent('download');
  await page.getByLabel('بازهٔ آماری فایل اکسل', { exact: true }).selectOption('90');
  await page.getByRole('button', { name: 'دریافت اکسل این بخش', exact: true }).click();
  const productExcelPath = resolve(output, 'product-report.xlsx');
  const productExcel = await productExcelDownload;
  assert.ok(productExcel.suggestedFilename().endsWith('.xlsx'));
  await productExcel.saveAs(productExcelPath);
  const productWorkbook = await inspectWorkbook(productExcelPath);
  assert.ok(productWorkbook.sheets.includes('راهنمای فایل'));
  assert.ok(productWorkbook.sheets.includes('پوشش اندازه‌گیری'));
  assert.ok(productWorkbook.sheets.includes('همهٔ مسیرهای AI'));
  assert.equal(productWorkbook.rows['روند روزانه'], 90);
  assert.equal(productWorkbook.formula_cells, 0);
  results.checks.push('Excel download opens with all rows, separate AI reporting, missing states and zero formulas');
  const aiCard = page.getByRole('region', { name: 'مصرف هوش مصنوعی', exact: true });
  await aiCard.getByText('فراخوانی سرویس AI', { exact: true }).waitFor();
  const aiExpected = await (await ownerContext.request.get(origin + '/management/api/state/ai-analytics?days=90')).json();
  assert.equal(await aiCard.locator('dt').filter({ hasText: /^فراخوانی سرویس AI$/ }).locator('..').locator('dd').innerText(), aiExpected.totals.requests.toLocaleString('fa-IR'));
  await aiCard.getByText('جزئیات فراخوانی‌های هوش مصنوعی', { exact: true }).click();
  assert.equal(await aiCard.locator('tbody tr').count(), 4);
  const aiDownloadPromise = page.waitForEvent('download');
  await aiCard.getByRole('button', { name: 'دریافت گزارش تجمیعی AI', exact: true }).click();
  const aiFile = resolve(output, 'ai-aggregate.json');
  await (await aiDownloadPromise).saveAs(aiFile);
  const aiExport = JSON.parse(await readFile(aiFile, 'utf8'));
  assert.equal(aiExport.days, 90);
  assert.deepEqual(aiExport.totals, aiExpected.totals);
  assert.deepEqual(aiExport.stages, aiExpected.stages);
  for (const forbidden of ['family_id', 'member_id', 'prompt', 'response', 'ddc41176-861c-44c5-a67a-ff0aba53ee80']) {
    assert.ok(!JSON.stringify(aiExport).includes(forbidden));
  }
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await screenshot(`ai-analytics-${width}`);
  }
  await page.setViewportSize({ width: 360, height: 900 });
  results.checks.push('AI totals, stage details and separate aggregate export preserve the original export');
  await navigate('نمای کلی');
  for (const label of ['نسخهٔ برنامه', 'نسخهٔ اعلامی API', 'نسخهٔ پنل مدیریت']) {
    await page.getByText(label, { exact: true }).waitFor();
  }
  assert.equal(await page.locator('dt').filter({ hasText: /^نسخهٔ برنامه$/ }).locator('..').locator('dd').innerText(), '0.6.0');
  assert.equal(await page.locator('dt').filter({ hasText: /^نسخهٔ اعلامی API$/ }).locator('..').locator('dd').innerText(), '0.1.0');
  results.checks.push('Installed app, reported API and management versions are independently labeled');
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

  await page.getByLabel('کارهای خانه', { exact: true }).selectOption('read_only');
  await page.getByLabel('روش اتصال هوش مصنوعی', { exact: true }).selectOption('direct');
  await page.getByLabel('سقف روزانهٔ کل فراخوانی‌ها', { exact: true }).fill('20');
  await page.getByLabel('سقف روزانهٔ هر خانواده', { exact: true }).fill('4');
  await page.getByLabel(/^کلید سرویس هوش مصنوعی/).fill('browser-synthetic-private-key');
  await page.getByRole('button', { name: 'بررسی و ذخیرهٔ تغییرها', exact: true }).click();
  const settingsDialog = page.getByRole('dialog');
  await settingsDialog.waitFor();
  assert.ok(!(await settingsDialog.innerText()).includes('browser-synthetic-private-key'));
  await settingsDialog.getByText('کارهای خانه', { exact: true }).waitFor();
  await settingsDialog.getByText('فقط‌خواندنی', { exact: true }).waitFor();
  await confirm();
  await page.getByLabel('کارهای خانه', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('کارهای خانه', { exact: true }).inputValue(), 'read_only');
  assert.equal(await page.getByLabel('سقف روزانهٔ هر خانواده', { exact: true }).inputValue(), '4');
  const savedConfiguration = await (await ownerContext.request.get(origin + '/management/api/state/settings')).json();
  assert.equal(savedConfiguration.environment.DEEPSEEK_API_KEY, true);
  assert.ok(!JSON.stringify(savedConfiguration).includes('browser-synthetic-private-key'));
  await page.getByLabel('کارهای خانه', { exact: true }).selectOption('disabled');
  await page.getByRole('button', { name: 'لغو تغییرهای ذخیره‌نشده', exact: true }).click();
  assert.equal(await page.getByLabel('کارهای خانه', { exact: true }).inputValue(), 'read_only');
  assert.equal(await page.getByRole('button', { name: 'بررسی و ذخیرهٔ تغییرها', exact: true }).isDisabled(), true);
  await screenshot('feature-and-ai-controls-360');
  results.checks.push('Feature policy and AI configuration confirmation, persistence, secret masking and cancel');

  await page.getByLabel('فرستندهٔ پیامک', { exact: true }).fill('sender-before-import');
  const importPanel = page.getByRole('region', { name: 'ورود تنظیمات پیامک و AI از فایل', exact: true });
  await importPanel.locator('input[type=file]').setInputFiles({
    name: 'custom-ai-settings.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ AI_CONNECTION_MODE: 'direct', AI_SMS_MODEL: 'custom-model-from-file',
      AI_MAX_OUTPUT_TOKENS: 4096, SMS_PROVIDER: 'kavenegar', SMS_API_KEY: 'browser-import-secret', SMS_SENDER: '' })),
  });
  const importPreview = importPanel.getByRole('region', { name: 'پیش‌نمایش ورود تنظیمات', exact: true });
  await importPreview.waitFor();
  assert.ok(!(await importPreview.innerText()).includes('browser-import-secret'));
  assert.ok((await importPreview.innerText()).includes('کلید تازه؛ نمایش داده نمی‌شود.'));
  await importPanel.getByRole('button', { name: 'افزودن تنظیمات انتخاب‌شده به فرم', exact: true }).click();
  assert.equal(await page.getByLabel('روش اتصال هوش مصنوعی', { exact: true }).inputValue(), 'direct');
  assert.equal(await page.getByLabel('مدل دستیار', { exact: true }).inputValue(), 'custom-model-from-file');
  assert.equal(await page.getByLabel('سقف توکن خروجی اتصال مستقیم', { exact: true }).inputValue(), '4096');
  assert.equal(await page.getByLabel('فرستندهٔ پیامک', { exact: true }).inputValue(), 'sender-before-import');
  assert.equal(await page.getByLabel('کلید درگاه پیامک', { exact: true }).inputValue(), 'browser-import-secret');
  await page.getByRole('button', { name: 'بررسی و ذخیرهٔ تغییرها', exact: true }).click();
  const importConfirm = page.getByRole('dialog');
  await importConfirm.waitFor();
  assert.ok(!(await importConfirm.innerText()).includes('browser-import-secret'));
  await confirm();
  const importedSettings = await (await ownerContext.request.get(origin + '/management/api/state/settings')).json();
  assert.equal(importedSettings.environment.AI_SMS_MODEL, 'custom-model-from-file');
  assert.equal(importedSettings.environment.AI_MAX_OUTPUT_TOKENS, '4096');
  assert.equal(importedSettings.environment.SMS_API_KEY, true);
  assert.equal(importedSettings.environment.SMS_SENDER, 'sender-before-import');
  assert.ok(!JSON.stringify(importedSettings).includes('browser-import-secret'));
  results.checks.push('Custom JSON settings import, blank preservation, secret masking and explicit save');

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
  await page.getByRole('heading', { name: 'تغییرات نسخه‌ها', exact: true }).waitFor();
  assert.ok(await page.locator('[data-release-id="pwa-0.15.1"]').count() === 1);
  assert.ok(await page.locator('[data-release-id="pwa-0.14.0"]').count() === 1);
  await page.getByLabel('بخش نرم‌افزار', { exact: true }).selectOption('api');
  await page.getByText('نامشخص', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-release-id^="api-"] small').count(), 0);
  await page.getByLabel('بخش نرم‌افزار', { exact: true }).selectOption('management');
  await page.locator('[data-release-id="management-0.4.1"]').waitFor();
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await screenshot(`release-history-${width}`);
  }
  results.checks.push('Local PWA/API/management history and unknown API release without installing a package');
  await page.getByRole('button', { name: 'بسته‌های نصب', exact: true }).click();
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

  await navigate('آمار و بهبود محصول');
  const allExcelDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'دریافت اکسل همهٔ گزارش‌ها', exact: true }).click();
  const allExcelPath = resolve(output, 'all-reports.xlsx');
  await (await allExcelDownload).saveAs(allExcelPath);
  const allWorkbook = await inspectWorkbook(allExcelPath);
  for (const sheet of ['کاربران', 'پشتیبان‌ها', 'نسخه‌ها', 'عملیات', 'سابقهٔ دسترسی', 'مدیران', 'راهنمای فایل']) {
    assert.ok(allWorkbook.sheets.includes(sheet), `Missing Excel sheet: ${sheet}`);
  }
  assert.equal(allWorkbook.formula_cells, 0);
  results.checks.push('All-report Excel includes paged history, backups, releases and role-authorized sections');

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
  await viewerPage.getByRole('heading', { name: 'داشبورد', exact: true, level: 1 }).waitFor();
  await viewerPage.getByText('خانواده‌های عضو', { exact: true }).waitFor();
  assert.equal(await viewerPage.getByRole('button', { name: 'مدیران و دسترسی‌ها', exact: true }).count(), 0);
  assert.equal(await viewerPage.getByRole('button', { name: 'ساخت پشتیبان کامل', exact: true }).count(), 0);
  await viewerPage.getByRole('navigation').getByRole('button', { name: 'تنظیمات برنامه', exact: true }).click();
  await viewerPage.getByLabel('کارهای خانه', { exact: true }).waitFor();
  assert.equal(await viewerPage.getByLabel('کارهای خانه', { exact: true }).isDisabled(), true);
  assert.equal(await viewerPage.getByLabel('سقف روزانهٔ هر خانواده', { exact: true }).isDisabled(), true);
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
  await recoveryPage.getByText('در حال بررسی سلامت سرور…', { exact: true }).waitFor();
  releaseLoading();
  await recoveryPage.getByText('دریافت این بخش کامل نشد', { exact: true }).waitFor();
  await recoveryPage.getByRole('heading', { name: 'رشد خانواده و ثبت‌نام', exact: true }).waitFor();
  const failureScreenshot = resolve(output, 'failure-360.png');
  await recoveryPage.screenshot({ path: failureScreenshot, fullPage: true }); results.screenshots.push(failureScreenshot);
  await recoveryPage.getByRole('button', { name: 'بررسی دوباره', exact: true }).click();
  await recoveryPage.getByRole('heading', { name: 'وضعیت فعلی سرور', exact: true }).waitFor();
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
  const observedAi = await (await recoveryContext.request.get(origin + '/management/api/state/ai-analytics?days=30')).json();
  let aiVariant = { ...observedAi, available: false, first_counter: null, totals: null, stages: null };
  await recoveryContext.route('**/management/api/state/ai-analytics?*', async route => {
    if (aiVariant === 'failure') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'TEST_AI_REPORT', message: 'گزارش نمونهٔ هوش مصنوعی موقتاً در دسترس نیست.' }) });
    else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiVariant) });
  });
  const recoveryAi = recoveryPage.getByRole('region', { name: 'مصرف هوش مصنوعی', exact: true });
  await recoveryPage.getByRole('button', { name: 'بررسی دوباره', exact: true }).click();
  await recoveryAi.getByText('شمارندهٔ هوش مصنوعی روی این نسخه نصب نشده است؛ مصرف نامعلوم صفر نمایش داده نمی‌شود.', { exact: true }).waitFor();
  aiVariant = structuredClone(observedAi);
  for (const row of [aiVariant.totals, ...aiVariant.stages]) {
    for (const key of Object.keys(row)) if (key !== 'stage') row[key] = key === 'input_tokens' || key === 'output_tokens' ? null : 0;
  }
  aiVariant.first_counter = null;
  await recoveryPage.getByRole('button', { name: 'بررسی دوباره', exact: true }).click();
  await recoveryAi.getByText('هنوز فراخوانی‌ای در این شمارنده ثبت نشده است؛ تاریخچهٔ قبل از نصب بازسازی نمی‌شود.', { exact: true }).waitFor();
  assert.equal(await recoveryAi.getByText('اعلام‌نشده', { exact: true }).count(), 2);
  aiVariant = 'failure';
  await recoveryPage.getByRole('button', { name: 'بررسی دوباره', exact: true }).click();
  await recoveryAi.getByRole('alert').waitFor();
  assert.equal(await recoveryAi.locator('dd').count(), 0);
  await recoveryPage.getByText('وضعیت حساب‌ها و ثبت‌نام', { exact: true }).waitFor();
  aiVariant = observedAi;
  await recoveryPage.getByRole('button', { name: 'بررسی دوباره', exact: true }).click();
  await recoveryAi.getByText('فراخوانی سرویس AI', { exact: true }).waitFor();
  results.checks.push('AI unavailable, empty, unknown-token and independent failure recovery states');
  analyticsVariant = structuredClone(unmeasured);
  await recoveryPage.getByRole('navigation').getByRole('button', { name: 'داشبورد', exact: true }).click();
  await recoveryPage.getByText('داده‌ای برای این نمودار در دسترس نیست؛ مقدار ناموجود صفر محسوب نمی‌شود.', { exact: true }).waitFor();
  await recoveryPage.getByRole('heading', { name: 'وضعیت فعلی سرور', exact: true }).waitFor();
  assert.equal(await recoveryPage.locator('.mg-dash-ranking li').count(), 0);
  const missingScreenshot = resolve(output, 'dashboard-unmeasured-360.png');
  await recoveryPage.screenshot({ path: missingScreenshot, fullPage: true }); results.screenshots.push(missingScreenshot);
  analyticsVariant = structuredClone(observed);
  analyticsVariant.modules.forEach(row => { row.opens = row.creates = row.updates = row.completes = row.deletes = 0; });
  analyticsVariant.usage = { opens: 0, requests: 0 };
  analyticsVariant.daily.forEach(point => { point.families_created = point.registrations_completed = point.opens = point.requests = point.errors = 0; });
  analyticsVariant.snapshot.active_accounts = analyticsVariant.snapshot.pending_accounts = analyticsVariant.snapshot.inactive_accounts = analyticsVariant.snapshot.registered_accounts = 0;
  await recoveryPage.getByRole('button', { name: 'بررسی دوباره', exact: true }).click();
  await recoveryPage.getByText('حساب ثبت‌نام‌کامل برای نمایش وجود ندارد.', { exact: true }).waitFor();
  assert.equal(await recoveryPage.locator('.mg-dash-chart-total strong').first().innerText(), '۰');
  const emptyScreenshot = resolve(output, 'dashboard-empty-360.png');
  await recoveryPage.screenshot({ path: emptyScreenshot, fullPage: true }); results.screenshots.push(emptyScreenshot);
  analyticsVariant = structuredClone(observed);
  analyticsVariant.daily[1].requests = null;
  await recoveryPage.getByRole('button', { name: 'بررسی دوباره', exact: true }).click();
  await recoveryPage.getByText('دادهٔ بعضی روزها موجود نیست؛ نمودار در آن روزها قطع و جمع بازه نامشخص است.', { exact: true }).waitFor();
  assert.equal(await recoveryPage.locator('.mg-dash-chart[data-field="requests"] .mg-dash-line').count(), 2);
  analyticsVariant = 'failure';
  await recoveryPage.getByRole('button', { name: 'بررسی دوباره', exact: true }).click();
  await recoveryPage.getByText('دریافت این بخش کامل نشد', { exact: true }).waitFor();
  await recoveryPage.getByRole('heading', { name: 'وضعیت فعلی سرور', exact: true }).waitFor();
  assert.equal(await recoveryPage.locator('.mg-dash-kpis').count(), 0);
  analyticsVariant = observed;
  await recoveryPage.getByRole('button', { name: 'بررسی دوباره', exact: true }).click();
  await recoveryPage.getByText('خانواده‌های عضو', { exact: true }).waitFor();
  results.checks.push('Dashboard partial failures, measured zero, missing counters and gaps without stale totals');
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
