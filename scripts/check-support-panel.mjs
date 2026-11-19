import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createPreviewSession, handlePreviewRequest } from './copy-workbench/fixtures.mjs';

// Synthetic UI requests and a separate read-only check against the manual sandbox.
const base = 'http://127.0.0.1:5700';
const artifacts = resolve('.local-test/support-check');
const checks = [], errors = [], forbidden = [];
const browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
let page, context;
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
async function open(scenario = 'full-owner', width = 1360) {
  await context?.close();
  context = await browser.newContext({ viewport: { width, height: 920 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const session = createPreviewSession(scenario, 'support');
  const state = { session, delay: '', fail: '', expire: false, loginCalls: 0, requests: [] };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/v1', '');
    state.requests.push(path);
    if (!path.startsWith('/support/')) { forbidden.push(path); return route.abort(); }
    assert.equal(request.headers().authorization, undefined, 'Support must not attach a household bearer');
    if (path === '/support/login') state.loginCalls++;
    if (state.delay === path) await new Promise(resolve => setTimeout(resolve, 650));
    if (state.fail === path) return route.fulfill({ status: 503, json: { error: 'SERVER', message: 'خطای آزمایشی پشتیبانی' } });
    if (state.expire && !['/support/session', '/support/login', '/support/logout'].includes(path)) {
      return route.fulfill({ status: 401, json: { error: 'SUPPORT_UNAUTHORIZED', message: 'نشست پایان یافت' } });
    }
    const result = handlePreviewRequest(session, { path: url.pathname + url.search, method: request.method(), body: request.postDataJSON() });
    if (result.delayMs) await new Promise(resolve => setTimeout(resolve, result.delayMs));
    await route.fulfill({ status: result.status, ...(result.status === 204 ? {} : { json: result.body }) });
  });
  await page.goto(base + '/support');
  return state;
}
async function ready(name = 'نمای کلی') { await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor(); }
async function nav(name) { await page.getByRole('navigation').getByRole('button', { name, exact: true }).click(); await ready(name); }
async function screenshot(name) { await page.screenshot({ path: resolve(artifacts, name + '.png'), fullPage: true }); }
async function fits() { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page overflows viewport'); }

try {
  await mkdir(artifacts, { recursive: true });
  await check('desktop overview, date range and independent loading', async () => {
    await open(); await ready();
    await page.locator('.support-chart li').first().waitFor();
    assert.equal(await page.locator('.support-chart li').count(), 7);
    await page.locator('.support-period select').selectOption('30');
    await page.waitForFunction(() => document.querySelectorAll('.support-chart li').length === 30);
    await fits(); await screenshot('overview-desktop');
  });
  await check('exact code search, status filters, pagination and clipboard fallback', async () => {
    await nav('پیگیری کاربران'); await page.locator('tbody tr').first().waitFor();
    assert.equal(await page.locator('tbody tr').count(), 25);
    const code = await page.locator('tbody code').first().innerText();
    await page.getByRole('button', { name: 'بعدی', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 6);
    await page.getByRole('button', { name: 'قبلی', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 25);
    await page.getByLabel('کد پشتیبانی', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { value: () => Promise.reject(new Error('test')) }));
    await page.getByRole('button', { name: 'کپی کد پشتیبانی', exact: true }).click();
    await page.getByText('کپی انجام نشد؛ کد نمایش‌داده‌شده را انتخاب و کپی کنید.', { exact: true }).waitFor();
    await page.locator('.support-filters > label').filter({ hasText: 'عضویت' }).locator('select').selectOption('pending');
    await page.getByText('موردی با این کد یا فیلترها پیدا نشد.', { exact: true }).waitFor();
    await page.getByLabel('کد پشتیبانی', { exact: true }).fill('');
    await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
    await page.locator('.support-filters > label').filter({ hasText: 'ثبت‌نام' }).locator('select').selectOption('introduced');
    await page.locator('tbody tr').first().waitFor();
    await screenshot('users-desktop');
  });
  await check('mobile navigation, roster scroll and technical states', async () => {
    await open('full-owner', 390); await ready(); await fits(); await screenshot('overview-mobile');
    await nav('پیگیری کاربران'); await page.locator('tbody tr').first().waitFor(); await fits(); await screenshot('users-mobile');
    await nav('وضعیت فنی'); await page.getByText('غیرفعال', { exact: true }).waitFor(); await fits(); await screenshot('technical-mobile');
  });
  await check('login validation, single submission and logout clearing', async () => {
    const state = await open('auth-login', 390); await ready('ورود پشتیبانی');
    await page.getByLabel('نام کاربری پشتیبانی').fill('support');
    await page.getByLabel('رمز پشتیبانی').fill('fixture-only');
    state.delay = '/support/login';
    await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    await ready(); assert.equal(state.loginCalls, 1);
    state.delay = ''; await page.getByRole('button', { name: 'خروج از پنل', exact: true }).click();
    await ready('ورود پشتیبانی');
    assert.equal(await page.locator('tbody, .support-metrics').count(), 0);
    assert.equal(await page.getByLabel('رمز پشتیبانی').inputValue(), '');
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    await screenshot('login-mobile');
  });
  await check('wrong login and technical failure remain retryable', async () => {
    const state = await open('auth-invalid'); await ready('ورود پشتیبانی');
    await page.getByLabel('نام کاربری پشتیبانی').fill('support'); await page.getByLabel('رمز پشتیبانی').fill('fixture-only');
    await page.getByRole('button', { name: 'ورود به پنل', exact: true }).click();
    await page.getByRole('alert').waitFor(); assert.ok(await page.getByRole('button', { name: 'ورود به پنل', exact: true }).isEnabled());
    state.session.scenario.mode = 'full'; await page.getByRole('button', { name: 'ورود به پنل', exact: true }).click(); await ready();
    state.fail = '/support/technical'; await nav('وضعیت فنی'); await page.getByRole('alert').waitFor();
    state.fail = ''; await page.getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
    await page.getByText('وضعیت سرویس‌ها', { exact: true }).waitFor();
    state.fail = '/support/logout'; await page.getByRole('button', { name: 'خروج از پنل', exact: true }).click(); await page.getByRole('alert').waitFor();
    state.fail = ''; await page.getByRole('button', { name: 'خروج از پنل', exact: true }).click(); await ready('ورود پشتیبانی');
  });
  await check('expired operator session clears roster and returns to login', async () => {
    const state = await open(); await ready(); await nav('پیگیری کاربران'); await page.locator('tbody tr').first().waitFor();
    state.expire = true; await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click(); await ready('ورود پشتیبانی');
    await page.getByText('نشست پشتیبانی پایان یافته است. دوباره وارد شوید.', { exact: true }).waitFor();
    assert.equal(await page.locator('tbody code').count(), 0);
  });
  await check('late results cannot replace another support section', async () => {
    const state = await open(); await ready(); state.delay = '/support/users';
    await nav('پیگیری کاربران'); await nav('وضعیت فنی');
    await page.getByText('وضعیت سرویس‌ها', { exact: true }).waitFor();
    await page.waitForTimeout(850); assert.equal(await page.locator('tbody').count(), 0);
    await ready('وضعیت فنی');
  });
  await check('empty and loading states are usable', async () => {
    await open('empty-owner'); await ready(); await page.getByText('در این بازه حساب تازه‌ای با ثبت‌نام کامل وجود ندارد.', { exact: true }).waitFor();
    await nav('پیگیری کاربران'); await page.getByText('موردی با این کد یا فیلترها پیدا نشد.', { exact: true }).waitFor();
    const state = await open(); await ready(); state.delay = '/support/technical'; await nav('وضعیت فنی');
    await page.getByRole('status').filter({ hasText: 'در حال دریافت وضعیت…' }).waitFor();
    await page.getByText('وضعیت سرویس‌ها', { exact: true }).waitFor();
  });
  await context.close(); context = null;
  await check('real sandbox login returns only approved metadata and scoped cookies', async () => {
    const text = await readFile(resolve('.local-test/support-panel-login.txt'), 'utf8');
    const username = text.match(/^Username: (.+)$/m)?.[1].trim(), password = text.match(/^Password: (.+)$/m)?.[1].trim();
    assert.ok(username && password, 'Local operator credentials are missing');
    const api = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const response = await api.request.post(base + '/api/v1/support/login', { headers: { Origin: base }, data: { username, password } });
      assert.equal(response.status(), 200, 'Local operator login failed');
      const cookies = await api.cookies(); assert.equal(cookies.length, 1); assert.equal(cookies[0].httpOnly, true);
      assert.equal(cookies[0].sameSite, 'Strict'); assert.equal(cookies[0].path, '/api/v1/support');
      for (const path of ['users', 'overview', 'technical']) {
        const result = await api.request.get(base + '/api/v1/support/' + path); assert.equal(result.status(), 200);
        assert.equal(result.headers()['cache-control'], 'no-store');
        if (path === 'users') {
          const data = await result.json();
          for (const user of data.items) assert.deepEqual(Object.keys(user).sort(), ['created_at', 'membership_state', 'registration_state', 'support_code']);
        }
      }
      await api.request.post(base + '/api/v1/support/logout', { headers: { Origin: base } });
      assert.equal((await api.request.get(base + '/api/v1/support/users')).status(), 401);
    } finally { await api.close(); }
  });
  assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
} catch (error) {
  await screenshot('failure').catch(() => {}); console.error(error.message); process.exitCode = 1;
} finally {
  await writeFile(resolve(artifacts, 'results.json'), JSON.stringify({ checks, errors, forbidden, passed: !process.exitCode }, null, 2));
  await browser.close();
}
