import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';

const context = JSON.parse(process.env.HOUSEHOLD_BROWSER_CONTEXT);
const backend = new URL(context.backend);
assert.equal(backend.hostname, '127.0.0.1');
const root = resolve('dist'), output = resolve('.local-test/household-live');
await mkdir(output, { recursive:true });
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
// Test-only loopback proxy. It never opens an external API or a manual sandbox.
const server = http.createServer(async (request, response) => {
  if (request.url.startsWith('/api/')) {
    const upstream = http.request(new URL(request.url, backend), { method:request.method, headers:{...request.headers, host:backend.host} }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    response.on('close', () => upstream.destroy()); request.pipe(upstream); return;
  }
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const path = resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
    assert.ok(path.startsWith(root + sep));
    let bytes = await readFile(path);
    if (extname(path) === '.js') bytes = Buffer.from(bytes.toString().replaceAll('https://api.khaanehyar.ir', ''));
    response.writeHead(200, { 'Content-Type':types[extname(path)] ?? 'application/octet-stream', 'Cache-Control':'no-store' }); response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({channel:'chrome'}), pages = [], errors = [];
async function open(actor) {
  const browserContext = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const page = await browserContext.newPage(); pages.push(page);
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', request => new URL(request.request().url()).origin === base ? request.continue() : request.abort());
  await page.addInitScript(() => {
    localStorage.setItem('khaneyar.intro.seen', '1'); localStorage.setItem('khaneyar.a2hs.installed','1');
    window.__HOUSEHOLD_UPDATES__ = 0;
    window.addEventListener('household-data-changed', () => window.__HOUSEHOLD_UPDATES__++);
  });
  await page.goto(base);
  const form = page.locator('.auth-track form').first();
  await form.locator('input[type=tel]').fill(actor.phone);
  await form.locator('input[type=password]').fill(context.password);
  await form.evaluate(form => form.requestSubmit());
  await page.locator('.application-shell').waitFor();
  await page.getByRole('button',{name:'بخش‌های خانه',exact:true}).click();
  await page.locator('[data-open-module="inventory"]').click();
  await page.locator('.inventory-page').waitFor();
  await page.waitForFunction(() => window.__HOUSEHOLD_UPDATES__ > 0);
  return page;
}
async function api(actor, method, path, body) {
  const response = await fetch(new URL('/api/v1' + path, backend), {method,headers:{Authorization:`Bearer ${actor.token}`,'Content-Type':'application/json','X-Khaneyar-Money-Contract':'decimal-v1'},body:body===undefined?undefined:JSON.stringify(body)});
  assert.ok(response.ok, `Isolated API returned ${response.status}`);
  return response.status === 204 ? null : response.json();
}
try {
  const [owner, member, unrelated] = await Promise.all([open(context.owner),open(context.member),open(context.other)]);
  const originalOther = await unrelated.evaluate(() => window.__HOUSEHOLD_UPDATES__);
  const added = await api(context.owner, 'POST', '/inventory', {title:'قلم آزمون زنده',quantity:2,category:'cleaning',unit:'بطری'});
  await expect(member.locator('.inv-body b').filter({hasText:'قلم آزمون زنده'})).toHaveCount(1);
  await member.getByRole('button',{name:'افزودن قلم به انبار',exact:true}).click();
  const draft = member.getByRole('combobox',{name:'نام قلم انبار'});
  await draft.fill('پیش‌نویس باز عضو دوم');
  await api(context.owner,'PATCH','/inventory/'+added.id,{title:'نام تازهٔ قلم زنده',quantity:5,category:'cleaning',unit:'بطری'});
  await expect(member.locator('.inv-body b').filter({hasText:'نام تازهٔ قلم زنده'})).toHaveCount(1);
  await expect(draft).toHaveValue('پیش‌نویس باز عضو دوم');
  await expect(member.locator('.inv-edit-sheet')).toBeVisible();
  assert.equal(await unrelated.evaluate(() => window.__HOUSEHOLD_UPDATES__), originalOther);
  await expect(unrelated.locator('.inv-body b')).toHaveCount(0);
  await expect(member.locator('.shopping-sync-content')).toHaveCount(0);
  await api(context.owner,'DELETE','/inventory/'+added.id);
  await expect(member.locator('.inv-body b')).toHaveCount(0);
  await expect(draft).toHaveValue('پیش‌نویس باز عضو دوم');
  assert.deepEqual(await api(context.owner,'GET','/transactions'),[]);
  assert.deepEqual(errors,[]);
  await member.screenshot({path:resolve(output,'preserved-draft-390.png')});
  const results={passed:['Real PostgreSQL/API changes update another active household member without reload.','Open draft and modal survive external edits and deletion.','Another household receives no event or record.','No sync status is displayed and no financial records are created.'],isolated:true};
  await writeFile(resolve(output,'result.json'),JSON.stringify(results,null,2));
  for (const result of results.passed) console.log('PASS '+result);
} finally {
  await browser.close();
  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
}
