import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { collectScreenshotRegions, createPortableCapturePlan, collectPortableScreenshots } from './portable-screenshots.mjs';
import { ROUTES, SCENARIOS } from './fixtures.mjs';

test('portable screenshot plan covers every page and every scenario without duplicate captures', () => {
  const plan = createPortableCapturePlan();
  assert.equal(new Set(plan.map(item => item.scenarioId + ':' + item.route)).size, plan.length);
  for (const route of ROUTES) assert.ok(plan.some(item => item.route === route.id), route.id);
  for (const scenario of SCENARIOS) assert.ok(plan.some(item => item.scenarioId === scenario.id), scenario.id);
  assert.ok(plan.length <= 60); assert.ok(plan.every(item => typeof item.label === 'string' && typeof item.section === 'string'));
});

test('portable screenshot collector refuses the real sandbox and external origins before any request', async () => {
  for (const origin of ['http://127.0.0.1:5700', 'https://example.com', 'http://user:password@127.0.0.1:5701', 'http://127.0.0.1:5701/preview/']) {
    await assert.rejects(collectPortableScreenshots({ origin }), /پیش‌نمایش نمونه/);
  }
});

test('screenshot regions retain distinct rendered source identities and full-page coordinates without user text', async () => {
  const browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
    await page.setContent('<html><body style="margin:0"><h1 id="first">عنوان تکراری</h1><h1 id="second">عنوان تکراری</h1><h1 id="authored">عنوان تکراری</h1><div style="height:1100px"></div><p id="template">سلام شخص نمونه</p><p id="hidden" hidden>پنهان</p><h2 id="forwarded">عنوان جزء</h2><input id="input" placeholder="نام شما"><input id="filled" placeholder="نام شما" value="اطلاعات شخصی"></body></html>');
    await page.evaluate(() => {
      document.querySelector('#first').dataset.copySources = JSON.stringify([{ id: 'one', text: 'عنوان تکراری' }]);
      document.querySelector('#second').dataset.copySources = JSON.stringify([{ id: 'two', text: 'عنوان تکراری' }]);
      document.querySelector('#authored').dataset.copySources = JSON.stringify([{ id: 'wrong', text: 'عنوان تکراری', active: false }]);
      document.querySelector('#template').dataset.copySources = JSON.stringify([{ id: 'template', text: 'سلام {slot1}', tokens: [{ token: '{slot1}' }] }]);
      document.querySelector('#hidden').dataset.copySources = JSON.stringify([{ id: 'hidden', text: 'پنهان' }]);
      document.querySelector('#forwarded')['__reactFiber$probe'] = { type: 'h2', memoizedProps: {}, return: { type: function Heading() {}, memoizedProps: { 'data-copy-sources': JSON.stringify([{ id: 'forwarded', text: 'عنوان جزء', attribute: 'title' }]) } } };
      for (const id of ['input', 'filled']) document.querySelector('#' + id).dataset.copySources = JSON.stringify([{ id, text: 'نام شما', attribute: 'placeholder' }]);
    });
    const result = await collectScreenshotRegions(page, { entries: ['one', 'two', 'wrong', 'template', 'hidden', 'forwarded', 'input', 'filled'].map(id => ({ id })) });
    assert.deepEqual(result.flatMap(region => region.sourceIds).sort(), ['one', 'two', 'template', 'forwarded', 'input'].sort());
    assert.ok(result.find(region => region.sourceIds.includes('template')).rect.y > 932);
    assert.ok(result.every(region => Object.keys(region).join(',') === 'sourceIds,rect'));
    assert.ok(!JSON.stringify(result).includes('شخص نمونه')); assert.ok(!JSON.stringify(result).includes('اطلاعات شخصی'));
  } finally { await browser.close(); }
});

test('screenshot regions omit clipped accessibility labels, hidden ancestors and text beyond the image canvas', async () => {
  const browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
    await page.setContent('<html><body style="margin:0"><p id="visible">نوشتهٔ نمایان</p><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)"><span id="sr">پین‌شده</span></span><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)"><span id="clipPath">برچسب دسترس‌پذیری</span></span><div style="opacity:0"><span id="ancestorOpacity">نوشتهٔ محو</span></div><div hidden><span id="ancestorHidden">نوشتهٔ پنهان</span></div><span id="outsideRight" style="position:absolute;left:600px;top:100px">بیرون راست</span><span id="outsideLeft" style="position:absolute;left:-600px;top:150px">بیرون چپ</span><span id="partial" style="position:absolute;left:-10px;top:200px">متن نیمهٔ نمایان</span></body></html>');
    const ids = ['visible', 'sr', 'clipPath', 'ancestorOpacity', 'ancestorHidden', 'outsideRight', 'outsideLeft', 'partial'];
    await page.evaluate(ids => {
      for (const id of ids) {
        const element = document.getElementById(id);
        element.dataset.copySources = JSON.stringify([{ id, text: element.textContent }]);
      }
    }, ids);
    const result = await collectScreenshotRegions(page, { entries: ids.map(id => ({ id })) });
    assert.deepEqual(result.flatMap(region => region.sourceIds).sort(), ['partial', 'visible']);
    assert.equal(result.find(region => region.sourceIds.includes('partial')).rect.x, 0);
    assert.ok(result.every(({ rect }) => rect.x >= 0 && rect.x + rect.width <= 430 && rect.y >= 0 && rect.y + rect.height <= 932));
  } finally { await browser.close(); }
});
