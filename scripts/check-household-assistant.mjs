import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createWorkbench } from './copy-workbench/server.mjs';

// Only in-memory Copy Studio data, on an ephemeral loopback port. No manual
// database, provider, deployment or source-Apply route is used.
const output = resolve('.local-test/household-assistant');
await mkdir(output,{recursive:true});
const workbench = await createWorkbench({port:0});
await workbench.initialized;
assert.equal(workbench.status().ready,true,workbench.status().message);
const base = workbench.origin;
const browser = await chromium.launch({channel:'msedge',headless:true});
const contexts = [], results = {protocol:2,checks:[],errors:[],externalRequests:[],screenshots:[],billedInference:0,manualWrites:0};
const root = await browser.newPage(); await root.goto(base);
const token = await root.evaluate(() => window.__COPY_WORKBENCH__.csrfToken); await root.close();
const catalog = await (await fetch(base+'/__copy/catalog')).json();
async function session(scenario='assistant-bread-zero',width=360) {
  const context = await browser.newContext({viewport:{width,height:844},timezoneId:'Asia/Tehran'});
  contexts.push(context);
  await context.route('**/*',async route => {
    const url = new URL(route.request().url());
    if (['http:','https:'].includes(url.protocol) && url.origin !== base) {
      results.externalRequests.push(url.origin+url.pathname); await route.abort();
    } else await route.continue();
  });
  // Test-only bridge adaptation: fixed ports 5700/5701 are reserved by Windows.
  await context.route('**/__copy/ui/preview-bridge.js',async route => {
    const response = await route.fetch(), source = await response.text();
    assert.ok(source.includes("location.port !== '5701'"));
    assert.ok(source.includes('await resetFakeStorage();'));
    const body=source.replace("location.port !== '5701'",`location.port !== '${new URL(base).port}'`)
      // Copy previews intentionally reset on every load. A recovery regression
      // needs the same fictional session to retain encrypted state on reload.
      .replace('await resetFakeStorage();',`if (!sessionStorage.getItem('assistant-test-storage:' + session)) {
        await resetFakeStorage(); sessionStorage.setItem('assistant-test-storage:' + session, '1');
      }`);
    await route.fulfill({response,body});
  });
  const response = await context.request.post(base+'/__copy/preview',{
    headers:{Origin:base,'X-Copy-Workbench-Token':token},data:{scenarioId:scenario,route:'hub'},
  });
  assert.equal(response.status(),200);
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.calls=[];
  page.on('pageerror',error => results.errors.push(error.message));
  page.on('request',request => { if (/\/api\/v1\/assistant\/(report|prepare-action|execute|receipt\/)/.test(request.url())) page.calls.push(new URL(request.url()).pathname); });
  await page.goto(base+(await response.json()).url);
  await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true);
  await page.locator('.floating-assistant').waitFor(); return page;
}
const sheet = page => page.locator('.household-assistant-sheet');
const analyzeCalls = page => page.calls.filter(path => path.endsWith('/report')).length;
const executeCalls = page => page.calls.filter(path => path.endsWith('/execute')).length;
async function api(page,path) { return page.evaluate(async path => (await fetch('/api/v1'+path)).json(),path); }
async function savedAssistantDrafts(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve,reject) => {
      const request=indexedDB.open('mali-man-secure',1); request.onsuccess=() => resolve(request.result); request.onerror=() => reject(request.error);
    });
    const read = key => new Promise((resolve,reject) => {
      const request=db.transaction('kv','readonly').objectStore('kv').get(key); request.onsuccess=() => resolve(request.result); request.onerror=() => reject(request.error);
    });
    const keys = await new Promise((resolve,reject) => {
      const request=db.transaction('kv','readonly').objectStore('kv').getAllKeys(); request.onsuccess=() => resolve(request.result); request.onerror=() => reject(request.error);
    });
    const cryptoKey=await read('__crypto_key__'), drafts=[];
    for(const key of keys.filter(key => String(key).startsWith('khaneyar:household-assistant:'))) {
      const record=await read(key), raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv},cryptoKey,record.ct);
      drafts.push({key,draft:JSON.parse(new TextDecoder().decode(raw))});
    }
    db.close(); return drafts;
  });
}
async function snapshot(page) {
  const paths=['/accounts','/transactions','/sms','/shopping/lists','/tasks','/inventory','/meals/dishes'];
  return Object.fromEntries(await Promise.all(paths.map(async path => [path,await api(page,path)])));
}
async function open(page) { await page.locator('.floating-assistant').click(); await sheet(page).waitFor(); }
async function report(page,text='نون نداریم برای صبحونه') {
  await open(page); await sheet(page).locator('textarea').fill(text);
  await sheet(page).getByRole('button',{name:'ارسال',exact:true}).click();
  await sheet(page).getByRole('heading',{name:'گزارشِ اطلاعات ثبت‌شده',exact:true}).waitFor();
}
function shoppingAction(page) { return sheet(page).locator('article.assistant-proposal').filter({has:page.getByText('افزودن قلم خرید',{exact:true})}).first(); }
async function shoppingReview(page) {
  const item=shoppingAction(page);
  await item.getByRole('button',{name:'بررسی همین تغییر',exact:true}).click();
  assert.equal(await item.getByRole('button',{name:'بررسی تغییر بدون ثبت',exact:true}).isEnabled(),false);
  const lists=await api(page,'/shopping/lists');
  await item.getByLabel('لیست مقصد',{exact:true}).selectOption(lists[0].id);
  await item.getByRole('button',{name:'بررسی تغییر بدون ثبت',exact:true}).click();
  await item.getByRole('button',{name:'تأیید و انجام',exact:true}).waitFor(); return item;
}
async function capture(page,name) { const path=resolve(output,name+'.png'); await page.screenshot({path,animations:'disabled'}); results.screenshots.push(path); }
async function check(name,work) {
  try { await work(); results.checks.push(name); console.log('PASS '+name); }
  catch(error) { results.errors.push(name+': '+error.stack); console.log('FAIL '+name+': '+error.message); }
}
try {
  await check('floating-only direct access, left purple geometry, unchanged navigation and keyboard',async () => {
    const page=await session();
    assert.equal(await page.locator('.home-assistant').count(),0);
    const nav=page.locator('.floating-navigation'), button=page.locator('.floating-assistant');
    assert.deepEqual(await nav.locator('button > span:last-child').allTextContents(),['داشبورد','بخش‌های خانه','اعلان‌ها']);
    const n=await nav.boundingBox(),a=await button.boundingBox();
    assert.ok(a.x >= 0 && a.x+a.width <= n.x-8 && n.x+n.width <= 360 && a.width>=44 && a.height>=44);
    assert.equal(await button.evaluate(el => getComputedStyle(el).backgroundColor),'rgb(109, 40, 217)');
    await capture(page,'home-mobile-v2'); await open(page);
    assert.equal(await sheet(page).getByRole('combobox').count(),0);
    assert.equal(page.calls.length,0);
    const input=sheet(page).locator('textarea'); assert.equal(await input.evaluate(el => el===document.activeElement),true);
    await capture(page,'opening-mobile-v2');
    await input.fill('پیش‌نویس خانه');
    const last=sheet(page).getByRole('button',{name:'بستن دستیار',exact:true});
    await last.focus(); await page.keyboard.press('Tab'); assert.equal(await input.evaluate(el => el===document.activeElement),true);
    await page.keyboard.press('Shift+Tab'); assert.equal(await last.evaluate(el => el===document.activeElement),true);
    await page.keyboard.press('Escape'); await sheet(page).waitFor({state:'hidden'});
    assert.equal(await page.locator('.floating-assistant').evaluate(el => el===document.activeElement),true);
    await open(page); assert.equal(await input.inputValue(),''); assert.equal(page.calls.length,0);
    await page.context().close();
  });
  await check('bread zero yields contextual alternatives without any expense, price or business writes',async () => {
    const page=await session(),before=await snapshot(page); await report(page);
    await sheet(page).getByText('موجودی ثبت‌شده صفر است.',{exact:true}).waitFor();
    await sheet(page).getByText('مقدار ثبت‌شده کافی است',{exact:true}).waitFor();
    await sheet(page).getByText('مواد ثبت‌شده کافی نیست',{exact:true}).waitFor();
    assert.equal(await sheet(page).getByRole('button',{name:'بررسی در فرم مالی',exact:true}).count(),0);
    assert.deepEqual(await snapshot(page),before); assert.equal(analyzeCalls(page),1); assert.equal(executeCalls(page),0);
    await capture(page,'report-summary-mobile-v2');
    const choices=sheet(page).getByRole('radio'); assert.ok(await choices.count()>=2);
    await choices.first().check(); assert.equal(executeCalls(page),0);
    await capture(page,'report-mobile-v2'); await page.context().close();
  });
  await check('unrecorded stock is unknown and positive-stock contradiction is explained',async () => {
    const unknown=await session('assistant-bread-unknown'); await report(unknown);
    await sheet(unknown).getByText('موجودی ثبت‌نشده یا نامعلوم است؛ صفر فرض نمی‌کنیم.',{exact:true}).waitFor();
    await capture(unknown,'unknown-mobile-v2'); await unknown.context().close();
    const conflict=await session('assistant-bread-conflict'); await report(conflict);
    await sheet(conflict).getByText('موجودی ثبت‌شده مثبت است.',{exact:true}).waitFor();
    await sheet(conflict).getByText('گفتهٔ شما با رکورد مثبت اختلاف دارد؛ پیش از تصمیم، موجودی واقعی را روشن کنید. انبار را خودکار تغییر نمی‌دهیم.',{exact:true}).waitFor();
    assert.equal(executeCalls(conflict),0); await pageSafeClose(conflict);
  });
  await check('destination, quantity, exact review and double-click confirmation create one shopping item',async () => {
    const page=await session(); await report(page); const before=await snapshot(page);
    const item=await shoppingReview(page);
    assert.deepEqual(await snapshot(page),before); assert.equal(executeCalls(page),0);
    await capture(page,'review-mobile-v2');
    await item.getByRole('button',{name:'تأیید و انجام',exact:true}).evaluate(el => {el.click();el.click();});
    await item.getByText('این تغییر در سرور ثبت شد.',{exact:true}).waitFor();
    const after=await snapshot(page); assert.equal(after['/shopping/lists'][0].items.length,1);
    assert.equal(after['/shopping/lists'][0].items[0].price,null); assert.equal(after['/shopping/lists'][0].items[0].bought_at,null);
    for(const path of ['/accounts','/transactions','/sms','/inventory']) assert.deepEqual(after[path],before[path]);
    assert.equal(executeCalls(page),1); assert.equal(analyzeCalls(page),1);
    await capture(page,'receipt-mobile-v2'); await page.context().close();
  });
  await check('duplicate open shopping item returns existing rather than a second record',async () => {
    const page=await session('assistant-duplicate'); await report(page); const item=await shoppingReview(page);
    await item.getByRole('button',{name:'تأیید و انجام',exact:true}).click();
    await item.getByText('از قبل در مقصد وجود داشت؛ مورد تازه‌ای ساخته نشد.',{exact:true}).waitFor();
    assert.equal((await api(page,'/shopping/lists'))[0].items.length,1); await page.context().close();
  });
  await check('lost execution response remains locked across reload and receipt recovery performs no new inference',async () => {
    const page=await session(); await report(page); const item=await shoppingReview(page);
    await page.route('**/api/v1/assistant/execute',async route => { await route.fetch(); await route.abort('failed'); });
    await item.getByRole('button',{name:'تأیید و انجام',exact:true}).click();
    await sheet(page).getByText('نتیجهٔ این تغییر هنوز روشن نیست',{exact:true}).waitFor();
    assert.equal(await sheet(page).locator('textarea').isEnabled(),false);
    const saved=await savedAssistantDrafts(page); assert.equal(saved.length,1); assert.ok(saved[0].draft.session.pending);
    await page.reload(); await page.locator('.floating-assistant').waitFor(); await open(page);
    try { await sheet(page).getByText('نتیجهٔ این تغییر هنوز روشن نیست',{exact:true}).waitFor(); }
    catch(error) {
      await capture(page,'recovery-failure-mobile-v2');
      await writeFile(resolve(output,'recovery-failure.json'),JSON.stringify({saved,after:await savedAssistantDrafts(page),screen:await sheet(page).innerText()},null,2));
      throw error;
    }
    await capture(page,'recovery-mobile-v2');
    await sheet(page).getByRole('button',{name:'بررسی نتیجهٔ قبلی',exact:true}).click();
    await sheet(page).getByText('نتیجهٔ این تغییر هنوز روشن نیست',{exact:true}).waitFor({state:'hidden'});
    assert.equal((await api(page,'/shopping/lists'))[0].items.length,1);
    assert.equal(executeCalls(page),1); assert.equal(analyzeCalls(page),1); await page.context().close();
  });
  await check('meal scheduling requires explicit empty slot and task fields use a separate review',async () => {
    const page=await session(); await report(page);
    const meal=sheet(page).locator('article.assistant-proposal').filter({has:page.getByText('ثبت غذا در وعدهٔ خالی',{exact:true})}).filter({has:page.getByText('تخم مرغ آب‌پز',{exact:true})});
    await meal.getByRole('button',{name:'بررسی همین تغییر',exact:true}).click();
    await meal.getByLabel('روز، به تاریخ میلادی',{exact:true}).fill('2026-11-23');
    await meal.getByLabel('وعده',{exact:true}).selectOption('breakfast');
    await meal.getByRole('button',{name:'بررسی تغییر بدون ثبت',exact:true}).click();
    await meal.getByRole('button',{name:'تأیید و انجام',exact:true}).click();
    await meal.getByText('این تغییر در سرور ثبت شد.',{exact:true}).waitFor();
    await sheet(page).locator('textarea').fill('آشپزخانه را تمیز کن'); await sheet(page).getByRole('button',{name:'ارسال',exact:true}).click();
    const task=sheet(page).locator('article.assistant-proposal').filter({has:page.getByText('ساخت کار خانه',{exact:true})});
    await task.getByRole('button',{name:'بررسی همین تغییر',exact:true}).click();
    await task.getByRole('button',{name:'بررسی تغییر بدون ثبت',exact:true}).click();
    await task.getByRole('button',{name:'تأیید و انجام',exact:true}).click();
    await task.getByText('این تغییر در سرور ثبت شد.',{exact:true}).waitFor(); assert.equal(executeCalls(page),2);
    await page.context().close();
  });
  await check('proxy timeout after execution keeps the pending identity until receipt lookup',async () => {
    const page=await session(); await report(page); const item=await shoppingReview(page);
    await page.route('**/api/v1/assistant/execute',async route => {
      await route.fetch();
      await route.fulfill({status:408,json:{error:'AI_RESPONSE_TIMEOUT',message:'synthetic proxy timeout'}});
    });
    await item.getByRole('button',{name:'تأیید و انجام',exact:true}).click();
    await sheet(page).getByText('نتیجهٔ این تغییر هنوز روشن نیست',{exact:true}).waitFor();
    assert.equal(await sheet(page).locator('textarea').isEnabled(),false);
    await sheet(page).getByRole('button',{name:'بررسی نتیجهٔ قبلی',exact:true}).click();
    await sheet(page).getByText('نتیجهٔ این تغییر هنوز روشن نیست',{exact:true}).waitFor({state:'hidden'});
    assert.equal((await api(page,'/shopping/lists'))[0].items.length,1);
    assert.equal(executeCalls(page),1); assert.equal(analyzeCalls(page),1); await page.context().close();
  });
  await check('closing and reopening during a held report keeps the conversation empty',async () => {
    const page=await session(); let release, reached;
    const gate=new Promise(resolve=>{release=resolve;}), start=new Promise(resolve=>{reached=resolve;});
    await page.route('**/api/v1/assistant/report',async route=>{ const response=await route.fetch(); reached(); await gate; await route.fulfill({response}); });
    await open(page); await sheet(page).locator('textarea').fill('نون نداریم'); await sheet(page).getByRole('button',{name:'ارسال',exact:true}).click();
    await start; await sheet(page).getByRole('button',{name:'بستن دستیار',exact:true}).click(); await open(page);
    assert.equal(await sheet(page).locator('textarea').inputValue(),''); release();
    await page.waitForResponse(response=>response.url().endsWith('/assistant/report'));
    // Drain rendering after the held response, without sleep or polling a job.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await sheet(page).getByRole('heading',{name:'گزارشِ اطلاعات ثبت‌شده',exact:true}).count(),0);
    assert.equal(page.calls.filter(path=>path.endsWith('/report')).length,1); await page.context().close();
  });
  await check('closing and reopening during execution preserves recovery but never revives the report',async () => {
    const page=await session(); await report(page); const item=await shoppingReview(page); let release, reached;
    const gate=new Promise(resolve=>{release=resolve;}), start=new Promise(resolve=>{reached=resolve;});
    await page.route('**/api/v1/assistant/execute',async route=>{ const response=await route.fetch(); reached(); await gate; await route.fulfill({response}); });
    await item.getByRole('button',{name:'تأیید و انجام',exact:true}).click(); await start;
    const stored=await savedAssistantDrafts(page); assert.ok(stored[0].draft.session.pending); assert.equal(stored[0].draft.text,''); assert.equal(stored[0].draft.session.result,null);
    await sheet(page).getByRole('button',{name:'بستن دستیار',exact:true}).click(); await open(page); assert.equal(await sheet(page).locator('textarea').inputValue(),'');
    await sheet(page).getByText('نتیجهٔ این تغییر هنوز روشن نیست',{exact:true}).waitFor(); release();
    await sheet(page).getByText('نتیجهٔ این تغییر هنوز روشن نیست',{exact:true}).waitFor({state:'hidden'});
    assert.equal(await sheet(page).getByRole('heading',{name:'گزارشِ اطلاعات ثبت‌شده',exact:true}).count(),0);
    assert.equal((await api(page,'/shopping/lists'))[0].items.length,1);
    assert.equal(page.calls.filter(path=>path.endsWith('/execute')).length,1); assert.equal(page.calls.filter(path=>path.endsWith('/report')).length,1);
    await page.context().close();
  });
  await check('editing request invalidates a held late report without automatic resubmission',async () => {
    const page=await session(); await open(page);
    let release,requested; const held=new Promise(resolve => {release=resolve;}),called=new Promise(resolve => {requested=resolve;});
    await page.route('**/api/v1/assistant/report',async route => { const response=await route.fetch(); requested(); await held; await route.fulfill({response}); });
    await sheet(page).locator('textarea').fill('نون نداریم برای صبحونه'); await sheet(page).getByRole('button',{name:'ارسال',exact:true}).click(); await called;
    await capture(page,'analyzing-mobile-v2'); await sheet(page).locator('textarea').fill('درخواست تازه'); release();
    await page.waitForFunction(() => document.querySelector('.household-assistant')?.getAttribute('aria-busy')==='false');
    assert.equal(await sheet(page).getByRole('heading',{name:'گزارشِ اطلاعات ثبت‌شده',exact:true}).count(),0);
    assert.equal(await sheet(page).locator('textarea').inputValue(),'درخواست تازه'); assert.equal(analyzeCalls(page),1); await page.context().close();
  });
  await check('failed durable pending storage blocks execution before any business request',async () => {
    const page=await session(); await report(page); const item=await shoppingReview(page), before=await snapshot(page);
    await page.evaluate(() => {
      const transaction=IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction=function(stores,mode,...options) {
        if(mode==='readwrite') throw new DOMException('synthetic storage failure','QuotaExceededError');
        return transaction.call(this,stores,mode,...options);
      };
    });
    await item.getByRole('button',{name:'تأیید و انجام',exact:true}).click();
    await sheet(page).getByText('بازیابی نتیجه در این مرورگر ماندگار نشد؛ تغییری ارسال نکردیم.',{exact:true}).waitFor();
    assert.equal(executeCalls(page),0); assert.deepEqual(await snapshot(page),before); await page.context().close();
  });
  await check('offline keeps report and blocks direct actions; reconnect does not submit or execute',async () => {
    const page=await session(); await report(page); await page.context().setOffline(true);
    await sheet(page).getByText('گزارش و متن باقی می‌مانند، اما بررسی و اجرای تازه به اینترنت نیاز دارد. پس از اتصال، خودکار ارسال یا اجرا نمی‌کنیم.',{exact:true}).waitFor();
    assert.equal(await shoppingAction(page).getByRole('button',{name:'بررسی همین تغییر',exact:true}).isEnabled(),false);
    await capture(page,'offline-mobile-v2'); await page.context().setOffline(false);
    await page.waitForFunction(() => !document.querySelector('.household-assistant .home-assistant-actions button')?.disabled);
    assert.equal(analyzeCalls(page),1); assert.equal(executeCalls(page),0); await page.context().close();
  });
  await check('old gateway reports upgrade without a financial form handoff',async () => {
    const page=await session(); await page.route('**/api/v1/assistant/capabilities',route => route.fulfill({json:{status:'upgrade_required',protocol_version:null,kinds:[]}}));
    await page.reload(); await page.locator('.floating-assistant').waitFor(); await open(page);
    await sheet(page).getByText('برای بررسی اطلاعات خانه، درگاه دستیار باید به نسخهٔ جدید ارتقا پیدا کند.',{exact:true}).waitFor();
    await sheet(page).locator('textarea').fill('امروز ۲۵۰ هزار تومان خرج کردم');
    assert.equal(await sheet(page).getByRole('button',{name:'ادامه در فرم مالی فعلی',exact:true}).count(),0);
    assert.equal(await page.locator('.tx-simple').count(),0);
    assert.equal(analyzeCalls(page),0); await page.context().close();
  });
  await check('English and empty copy edits preserve source metadata and household records',async () => {
    const page=await session(); await report(page); const before=await snapshot(page);
    const entry=catalog.entries.find(row => row.file.endsWith('/HouseholdAssistant.tsx') && row.text==='ارسال'); assert.ok(entry);
    for(const text of ['Send','','Send']) {
      await page.evaluate(draft => window.postMessage({type:'copy-drafts',drafts:[draft]},location.origin),{id:entry.id,original:entry.text,text,matchingIds:[entry.id],tokens:[]});
      await page.waitForFunction(text => document.querySelector('.household-assistant .home-assistant-actions button')?.textContent===text,text);
      assert.equal(await sheet(page).locator('textarea').inputValue(),'نون نداریم برای صبحونه'); assert.deepEqual(await snapshot(page),before);
    }
    await page.context().close();
  });
  await check('desktop dark reduced-motion and ambiguous empty report remain usable',async () => {
    const page=await session('assistant-bread-zero',1440); await page.evaluate(() => document.documentElement.dataset.theme='dark');
    await page.emulateMedia({reducedMotion:'reduce'}); await report(page); await capture(page,'report-desktop-dark-v2'); await page.context().close();
    const empty=await session('empty-owner'); await report(empty,'سلام');
    await sheet(empty).getByText('برای گزارش، شاهد کافی پیدا نشد؛ درخواست را روشن‌تر بنویس.',{exact:true}).waitFor();
    assert.equal(executeCalls(empty),0); await capture(empty,'empty-mobile-v2'); await empty.context().close();
  });
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
  await browser.close(); await workbench.close(); await writeFile(resolve(output,'results.json'),JSON.stringify(results,null,2));
}
async function pageSafeClose(page) { await page.context().close(); }
if(results.errors.length || results.externalRequests.length) { console.error(results.errors); process.exitCode=1; }
else console.log(`Contextual assistant: ${results.checks.length} checks passed; zero billed inference or manual writes.`);
