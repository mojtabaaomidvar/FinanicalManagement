import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:5700';
const tokens = [];
const suffix = Date.now().toString();
let list, stock, item, page, browser, context, owner, second;
async function api(path, token, method = 'GET', payload) {
  const response = await fetch(base + '/api/v1' + path, {
    method, headers: {Accept: 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {}),
      ...(payload !== undefined ? {'Content-Type': 'application/json'} : {})},
    ...(payload !== undefined ? {body: JSON.stringify(payload)} : {}),
  });
  assert.ok(response.ok, method + ' ' + path + ': ' + response.status);
  return response.status === 204 ? null : response.json();
}
async function login(phone) {
  const result = await api('/auth/login', null, 'POST', {phone, password: 'Test12345!'});
  tokens.push(result.session_token);
  return result.session_token;
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
async function savedStates() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('mali-man-secure', 1);
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const read = key => new Promise((resolve, reject) => {
      const r = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const keys = await new Promise((resolve, reject) => {
      const r = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const key = await read('__crypto_key__');
    const states = [];
    for (const name of keys.filter(k => String(k).startsWith('shopping-offline:'))) {
      const record = await read(name);
      assertEncrypted(record, key);
      const decrypted = await crypto.subtle.decrypt({name:'AES-GCM', iv:new Uint8Array(record.iv)}, key, record.ct);
      states.push(JSON.parse(new TextDecoder().decode(decrypted)));
    }
    db.close();
    return states;

    function assertEncrypted(record, key) {
      if (!record?.iv || !record?.ct || key?.extractable !== false) {
        throw new Error('Offline storage must contain ciphertext and a non-extractable key.');
      }
    }
  });
}
async function secureKeys() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('mali-man-secure', 1);
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const keys = await new Promise((resolve, reject) => {
      const r = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    db.close();
    return keys;
  });
}
async function openHub() {
  await page.evaluate(() => history.back());
  await page.getByText('لیست خرید', {exact:true}).waitFor();
}
async function openSettings() {
  await openHub();
  await poll(async () => {
    if (await page.getByRole('heading', {name:'تنظیمات',exact:true}).isVisible()) return true;
    await page.getByRole('button', {name:'پروفایل و تنظیمات',exact:true}).click();
    return false;
  }, 'Online navigation did not become available');
}

try {
  owner = await login('09000000001');
  second = await login('09000000003');
  stock = await api('/inventory', owner, 'POST', {title:'کالای آزمون آفلاین ' + suffix, quantity:2, threshold:1});
  list = await api('/shopping/lists', owner, 'POST', {title:'آزمون آفلاین ' + suffix});
  item = await api('/shopping/lists/' + list.id + '/items', owner, 'POST', {
    title:'قلم آزمون قیمت ' + suffix, qty:1, price:45000, inventory_item_id:stock.id,
  });
  browser = await chromium.launch({headless:true, channel:process.env.KHANEYAR_TEST_BROWSER || 'msedge'});
  context = await browser.newContext({viewport:{width:1100,height:900}});
  page = await context.newPage();
  await page.goto(base, {waitUntil:'networkidle'});
  await page.getByRole('button', {name:'ورود', exact:true}).click();
  await page.getByPlaceholder('شماره موبایل',{exact:true}).first().fill('09000000002');
  await page.getByPlaceholder('رمز عبور',{exact:true}).fill('Test12345!');
  const logged = page.waitForResponse(r => r.url().endsWith('/auth/login'));
  await page.locator('form').filter({has:page.getByPlaceholder('رمز عبور',{exact:true})}).locator('button[type=submit]').click();
  tokens.push((await (await logged).json()).session_token);
  await page.getByText('لیست خرید',{exact:true}).waitFor();
  await poll(async () => (await savedStates()).some(s => s.lastSyncedAt && s.snapshot.lists.some(l => l.id === list.id)), 'Offline snapshot not ready');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.getByText('لیست خرید',{exact:true}).click();
  await page.getByRole('tab',{name:new RegExp(list.title)}).click();
  await page.getByText(item.title,{exact:true}).waitFor();
  console.log('PASS: online data and installed PWA ready.');

  await context.setOffline(true);
  await page.getByText('اتصال اینترنت نیست',{exact:true}).waitFor();
  const row = page.locator('.shop-item').filter({hasText:item.title});
  await row.getByRole('checkbox').click();
  await poll(async () => (await savedStates())[0]?.pending.length === 1, 'Check not persisted');
  await page.getByPlaceholder('چه چیزی اضافه کنم؟').fill('افزودهٔ آفلاین ' + suffix);
  await page.locator('.shop-add-btn').click();
  await page.getByText('افزودهٔ آفلاین ' + suffix,{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'خرید انجام شد',exact:true}).isEnabled(), false);
  assert.equal((await page.locator('body').innerText()).includes('۴۵٬۰۰۰'), false);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText('انبار خانه',{exact:true}).click();
  const inv = page.locator('.inv-item').filter({hasText:stock.title});
  await inv.getByRole('button',{name:'یکی اضافه کن',exact:true}).click();
  await poll(async () => (await savedStates())[0]?.pending.length === 3, 'First stock adjustment missing');
  await inv.getByRole('button',{name:'یکی اضافه کن',exact:true}).click();
  await poll(async () => (await savedStates())[0]?.pending.length === 4, 'Second stock adjustment missing');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText('انبار خانه',{exact:true}).click();
  await page.locator('.inv-item').filter({hasText:stock.title}).getByText(/۴.*آستانه/).waitFor();
  const states = await savedStates();
  assert.equal(states[0].pending.length, 4);
  const text = JSON.stringify(states);
  for (const forbidden of ['"price"','"transaction_id"','"phone"','"budget"','"account_id"']) assert.equal(text.includes(forbidden),false,forbidden);
  // Creator references are permitted for task authorization, never for shopping.
  const shoppingText = JSON.stringify({ lists: states[0].snapshot.lists, inventory: states[0].snapshot.inventory });
  assert.equal(shoppingText.includes('"created_by"'), false);
  await page.screenshot({path:'.local-test/offline-inventory.png',fullPage:true});
  console.log('PASS: offline check/add/two inventory changes survive reload; checkout blocked; encrypted projection contains no financial fields.');

  await context.setOffline(false);
  await poll(async () => (await savedStates())[0]?.pending.length === 0, 'Queue did not drain automatically');
  const liveLists = await api('/shopping/lists', owner);
  const liveStock = await api('/inventory', owner);
  assert.equal(Number(liveStock.find(r => r.id === stock.id).quantity), 4);
  const liveList = liveLists.find(r => r.id === list.id);
  assert.equal(liveList.items.find(r => r.id === item.id).checked, true);
  assert.equal(Number(liveList.items.find(r => r.id === item.id).price), 45000);
  assert.equal(liveList.items.filter(r => r.title === 'افزودهٔ آفلاین ' + suffix).length, 1);
  await poll(async () => !(await page.locator('body').innerText()).includes('در حال ارسال تغییرها'), 'Sync stayed busy');

  await openHub();
  await page.getByText('لیست خرید',{exact:true}).click();
  await page.getByRole('tab',{name:new RegExp(list.title)}).click();
  const droppedTitle = 'پاسخ گم‌شده ' + suffix;
  const mutationRoute = '**/api/v1/shopping/offline/mutations';
  let responseDropped = false;
  await context.route(mutationRoute, async route => {
    try {
      const response = await route.fetch();
      if (!response.ok()) { await route.fulfill({response}); return; }
      responseDropped = true;
      await route.abort();
    } catch {
      // Removing interception can cancel another retry already in flight.
      await route.abort().catch(() => {});
    }
  });
  await page.getByPlaceholder('چه چیزی اضافه کنم؟').fill(droppedTitle);
  await page.locator('.shop-add-btn').click();
  await poll(async () => responseDropped && (await savedStates())[0]?.pending.length === 1,
    'Committed change with lost response did not stay queued');
  assert.equal((await api('/shopping/lists', owner)).find(r => r.id === list.id).items.filter(r => r.title === droppedTitle).length, 1);
  await context.unrouteAll({behavior:'wait'});
  await context.setOffline(true);
  await context.setOffline(false);
  await poll(async () => (await savedStates())[0]?.pending.length === 0, 'Lost response did not recover automatically');
  assert.equal((await api('/shopping/lists', owner)).find(r => r.id === list.id).items.filter(r => r.title === droppedTitle).length, 1);
  console.log('PASS: server commit with a dropped response retries automatically without creating a duplicate item.');

  const cachedApiRequests = await page.evaluate(async () => {
    const requests = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        if (new URL(request.url).pathname.startsWith('/api/')) requests.push(request.url);
      }
    }
    return requests;
  });
  assert.deepEqual(cachedApiRequests, []);
  await openSettings();
  console.log('PASS: automatic sync applies each change once, retains server price, and restores online navigation after offline reload.');

  await openHub();
  await page.getByText('انبار خانه',{exact:true}).click();
  await context.setOffline(true);
  await page.getByText('اتصال اینترنت نیست',{exact:true}).waitFor();
  await page.locator('.inv-item').filter({hasText:stock.title}).getByRole('button',{name:'یکی اضافه کن',exact:true}).click();
  await poll(async () => (await savedStates())[0]?.pending.length === 1, 'Conflict fixture not queued');
  await api('/inventory/' + stock.id + '/adjust', second, 'POST', {delta:2});
  await context.setOffline(false);
  await poll(async () => (await savedStates())[0]?.pending[0]?.status === 'conflict', 'Conflict not surfaced');
  assert.equal(Number((await api('/inventory',owner)).find(r => r.id === stock.id).quantity),6);
  await page.getByRole('button',{name:'پذیرفتن نسخهٔ سرور',exact:true}).waitFor();
  await page.screenshot({path:'.local-test/offline-conflict.png',fullPage:true});
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button',{name:'پذیرفتن نسخهٔ سرور',exact:true}).click();
  await poll(async () => (await savedStates())[0]?.pending.length === 0, 'Explicit conflict discard failed');
  console.log('PASS: second member edit produces visible conflict; server value preserved until explicit acceptance.');

  // Leave a rejected change queued to verify that logout discards it, too.
  await context.setOffline(true);
  await page.getByText('اتصال اینترنت نیست',{exact:true}).waitFor();
  await page.locator('.inv-item').filter({hasText:stock.title}).getByRole('button',{name:'یکی اضافه کن',exact:true}).click();
  await poll(async () => (await savedStates())[0]?.pending.length === 1, 'Logout fixture not queued');
  await api('/inventory/' + stock.id + '/adjust', second, 'POST', {delta:2});
  await context.setOffline(false);
  await poll(async () => (await savedStates())[0]?.pending[0]?.status === 'conflict', 'Logout fixture did not conflict');
  await openSettings();
  // Deliberate logout also removes any old authenticated response cache.
  await page.evaluate(async () => {
    const cache = await caches.open('offline-check-private');
    await cache.put('/api/v1/offline-check-private', new Response('private test data'));
  });
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.getByText('خروج از حساب',{exact:true}).click(),
  ]);
  await poll(async () => (await savedStates()).length === 0, 'Logout left offline partitions');
  assert.deepEqual(await secureKeys(), ['__crypto_key__']);
  assert.equal((await page.evaluate(() => caches.keys())).includes('offline-check-private'), false);
  console.log('PASS: logout clears session, encrypted household partitions, rejected changes, and private response caches.');

  await page.getByPlaceholder('شماره موبایل',{exact:true}).first().fill('09000000003');
  await page.getByPlaceholder('رمز عبور',{exact:true}).fill('Test12345!');
  const relogged = page.waitForResponse(r => r.url().endsWith('/auth/login'));
  await page.locator('form').filter({has:page.getByPlaceholder('رمز عبور',{exact:true})}).locator('button[type=submit]').click();
  tokens.push((await (await relogged).json()).session_token);
  await page.getByText('لیست خرید',{exact:true}).waitFor();
  await poll(async () => (await savedStates()).some(s => s.lastSyncedAt && s.snapshot.inventory.some(r => r.id === stock.id)), 'Relogin snapshot not ready');
  const reloginStates = await savedStates();
  assert.equal(reloginStates.length, 1);
  assert.equal(reloginStates[0].pending.length, 0);
  assert.equal(Number(reloginStates[0].snapshot.inventory.find(r => r.id === stock.id).quantity), 8);
  assert.ok((await page.evaluate(() => caches.keys())).length > 0, 'Static application shell was removed');
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText('انبار خانه',{exact:true}).click();
  await page.getByText(stock.title,{exact:true}).waitFor();
  await page.locator('.inv-item').filter({hasText:stock.title}).getByText(/۸.*آستانه/).waitFor();
  console.log('PASS: another member reopens offline after logout and online login without replaying the previous account’s changes.');
  await context.setOffline(false);
} catch (error) {
  if (page) {
    await context.setOffline(false).catch(()=>{});
    await page.screenshot({path:'.local-test/offline-failure.png',fullPage:true}).catch(()=>{});
    console.log('Browser diagnostic:', (await page.locator('body').innerText()).slice(0,5000));
  }
  throw error;
} finally {
  if (browser) await browser.close();
  if (list) await api('/shopping/lists/' + list.id, owner, 'DELETE').catch(()=>{});
  if (stock) await api('/inventory/' + stock.id, owner, 'DELETE').catch(()=>{});
  for (const token of tokens) await api('/auth/logout',token,'POST').catch(()=>{});
}
