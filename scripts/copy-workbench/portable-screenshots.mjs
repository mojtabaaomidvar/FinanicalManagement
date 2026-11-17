import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { ROUTES, SCENARIOS } from './fixtures.mjs';

const MAX_IMAGE_HEIGHT = 12_000, MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const imageId = value => createHash('sha256').update(value).digest('hex').slice(0, 32);
const sectionByRoute = {
  hub: 'خانه', dashboard: 'مالی و گزارش‌ها', transactions: 'مالی و گزارش‌ها', reports: 'مالی و گزارش‌ها',
  accounts: 'کیف پول', budgets: 'بودجه‌ها', bills: 'قبوض', calendar: 'تقویم و مناسبت‌ها',
  shopping: 'خرید و انبار', inventory: 'خرید و انبار', tasks: 'کارهای خانه', documents: 'اسناد خانه',
  meals: 'برنامهٔ غذایی', equipment: 'وسایل خانه', vehicles: 'خودرو', goals: 'اهداف شخصی',
  activities: 'برنامه‌های خانوادگی', children: 'فرزندان', pets: 'حیوانات خانگی', market: 'بازار',
  settings: 'پروفایل و تنظیمات', auth: 'ورود و عضویت', invite: 'ورود و عضویت',
};
const scenarioRoutes = {
  'minor-member': 'vehicles', 'missing-birth': 'vehicles', loading: 'tasks', errors: 'documents',
  'save-errors': 'tasks', conflict: 'shopping', offline: 'tasks', 'reminders-off': 'settings/notifications',
  'sms-pending': 'transactions', intro: 'hub', install: 'hub',
};

export function createPortableCapturePlan() {
  const destinations = ROUTES.map(route => ({ scenarioId: route.id === 'auth' ? 'auth-login' : route.id === 'invite' ? 'invite-valid' : 'full-owner',
    route: route.id, label: route.label, section: sectionByRoute[route.id.split('/')[0]] ?? 'اجزای مشترک برنامه' }));
  const existing = new Set(destinations.map(item => item.scenarioId + ':' + item.route));
  const variants = SCENARIOS.filter(scenario => scenario.id !== 'full-owner').map(scenario => {
    const route = scenario.route ?? scenarioRoutes[scenario.id] ?? 'hub';
    return { scenarioId: scenario.id, route, label: scenario.label,
      section: ['intro', 'install'].includes(scenario.id) ? 'شروع و نصب برنامه' : sectionByRoute[route.split('/')[0]] ?? 'اجزای مشترک برنامه' };
  }).filter(item => !existing.has(item.scenarioId + ':' + item.route));
  return [...destinations, ...variants];
}

/** Extract only known display-source identities and rectangles; never record rendered user values. */
export async function collectScreenshotRegions(page, catalog) {
  return page.evaluate(entries => {
    const allowed = new Set(entries.map(entry => entry.id));
    const normalize = text => String(text ?? '').replace(/\s+/g, ' ').trim();
    const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regions = [], seen = new Set();
    const matches = (record, value) => {
      const original = normalize(record.text);
      const tokens = (record.tokens ?? []).map(token => typeof token === 'string' ? token : token.token).filter(Boolean);
      if (!tokens.length) return original === normalize(value);
      let template = original;
      for (const token of tokens) template = template.replace(token, '\u0000');
      const pieces = template.split('\u0000');
      if (pieces.join('').length < 2) return false;
      return new RegExp('^' + pieces.map(escape).join('(.+?)') + '$', 'u').test(normalize(value));
    };
    const parse = value => {
      if (!value) return [];
      try { const records = JSON.parse(value); return Array.isArray(records) ? records.filter(record => allowed.has(record?.id) && typeof record.text === 'string' && record.active !== false) : []; }
      catch { return []; }
    };
    const recordsFor = (element, value, attribute) => {
      const filter = (records, forwarded = false) => records.filter(record =>
        (attribute ? record.attribute === attribute : forwarded || !record.attribute) && matches(record, value));
      const direct = filter(parse(element.getAttribute('data-copy-sources')));
      if (direct.length) return direct;
      const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
      let fiber = key ? element[key] : null, depth = 0;
      while (fiber && depth++ < 80) {
        const records = filter(parse(fiber.memoizedProps?.['data-copy-sources']), typeof fiber.type !== 'string');
        if (records.length) return records;
        fiber = fiber.return;
      }
      return [];
    };
    const visible = element => {
      if (element.closest('[hidden],[inert]')) return false;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
        const clipped = style.clip !== 'auto' || style.clipPath !== 'none';
        if (!clipped) continue;
        const box = ancestor.getBoundingClientRect();
        // Screen-reader-only labels keep their catalog slots, but have no visible image region.
        if (box.width <= 1.01 && box.height <= 1.01) return false;
        if (/^rect\(/.test(style.clip)) {
          const sides = style.clip.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
          if (sides?.length === 4 && (sides[1] <= sides[3] || sides[2] <= sides[0])) return false;
        }
      }
      return true;
    };
    const add = (records, box) => {
      const sourceIds = [...new Set(records.map(record => record.id))];
      if (!sourceIds.length || !box || box.width <= 0 || box.height <= 0) return;
      const canvasHeight = Math.min(12_000, Math.max(innerHeight, document.documentElement.scrollHeight, document.body.scrollHeight));
      const left = Math.max(0, box.x + scrollX), top = Math.max(0, box.y + scrollY);
      const right = Math.min(innerWidth, box.right + scrollX), bottom = Math.min(canvasHeight, box.bottom + scrollY);
      if (right <= left || bottom <= top) return;
      const x = Math.round(left * 100) / 100, y = Math.round(top * 100) / 100;
      const rect = { x, y, width: Math.round((Math.round(right * 100) / 100 - x) * 100) / 100,
        height: Math.round((Math.round(bottom * 100) / 100 - y) * 100) / 100 };
      if (rect.width <= 0 || rect.height <= 0) return;
      const key = sourceIds.join('|') + ':' + JSON.stringify(rect);
      if (seen.has(key)) return; seen.add(key); regions.push({ sourceIds, rect });
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      const element = node.parentElement;
      if (!element || !normalize(node.data) || element.closest('script,style,textarea,pre,code,[contenteditable="true"]') || !visible(element)) continue;
      const records = recordsFor(element, node.data);
      if (!records.length) continue;
      const range = document.createRange(); range.selectNodeContents(node); add(records, range.getBoundingClientRect());
    }
    for (const element of document.querySelectorAll('input[placeholder],textarea[placeholder]')) {
      if (element.value || !visible(element)) continue;
      add(recordsFor(element, element.getAttribute('placeholder'), 'placeholder'), element.getBoundingClientRect());
    }
    return regions;
  }, (catalog?.entries ?? []).map(({ id }) => ({ id })));
}

function validateOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '5701' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('تصویرهای بسته فقط از پیش‌نمایش نمونهٔ ویرایشگر تهیه می‌شوند.');
  }
  return url.origin;
}

async function cachePath(root, status) {
  if (!root) return null;
  const actual = await realpath(resolve(root));
  let compiler = '';
  try { compiler = JSON.parse(await readFile(join(actual, '.local-test/copy-workbench/state.json'), 'utf8')).compilerRevision ?? ''; } catch { /* The status still identifies the source build. */ }
  const directory = join(actual, '.local-test/copy-workbench/portable-images');
  await mkdir(directory, { recursive: true });
  return join(directory, imageId('v2:' + status.sourceRevision + ':' + status.buildRevision + ':' + compiler) + '.json');
}

export async function collectPortableScreenshots({ origin, root, catalog, onProgress, plan = createPortableCapturePlan() }) {
  origin = validateOrigin(origin);
  const response = await fetch(origin + '/__copy/status'), status = await response.json();
  if (!response.ok || !status.ready || !status.previewCurrent || (catalog?.revision && catalog.revision !== status.sourceRevision)) {
    throw new Error('پیش‌نمایش باید با کد فعلی هماهنگ باشد؛ ویرایشگر را دوباره اجرا کن.');
  }
  if (!catalog) catalog = await (await fetch(origin + '/__copy/catalog')).json();
  const standardPlan = createPortableCapturePlan(), standard = JSON.stringify(plan) === JSON.stringify(standardPlan);
  const path = standard ? await cachePath(root, status) : null;
  if (path) {
    try {
      const cached = JSON.parse(await readFile(path, 'utf8'));
      if (cached.revision === status.sourceRevision && cached.images?.length === plan.length && cached.images.every(image => /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image.dataUrl))) {
        onProgress?.({ completed: plan.length, total: plan.length, label: 'تصویرهای آمادهٔ صفحه‌ها' }); return cached.images;
      }
    } catch { /* A missing or invalid cache is rebuilt entirely from the fictional preview. */ }
  }
  const html = await (await fetch(origin)).text(), match = html.match(/window\.__COPY_WORKBENCH__=(.+?);<\/script>/);
  if (!match) throw new Error('پیش‌نمایش نمونه برای تهیهٔ تصویر آماده نیست.');
  const token = JSON.parse(match[1]).csrfToken;
  const browser = await chromium.launch({ channel: process.env.KHANEYAR_TEST_BROWSER || 'msedge', headless: true });
  const images = [];
  try {
    const context = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const address = new URL(route.request().url());
      return address.origin === origin || ['data:', 'blob:'].includes(address.protocol) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    for (const capture of plan) {
      const errors = [], onError = error => errors.push(error.message); page.on('pageerror', onError);
      try {
        const previewResponse = await fetch(origin + '/__copy/preview', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Copy-Workbench-Token': token },
          body: JSON.stringify({ scenarioId: capture.scenarioId, route: capture.route }) });
        const preview = await previewResponse.json();
        if (!previewResponse.ok || typeof preview.url !== 'string' || !preview.url.startsWith('/preview/?session=')) throw new Error('صفحهٔ نمونه برای تهیهٔ تصویر آماده نشد.');
        await page.goto(origin + preview.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForFunction(() => window.__COPY_PREVIEW_OBSERVED__ === true, null, { timeout: 30_000 });
        if (capture.scenarioId !== 'loading') {
          await page.waitForFunction(() => !document.querySelector('section.page.active[aria-busy="true"]'), null, { timeout: 12_000 });
        }
        await page.evaluate(async () => {
          await document.fonts.ready;
          const style = document.createElement('style'); style.textContent = '*{animation:none!important;transition:none!important;scroll-behavior:auto!important}'; document.head.append(style);
          for (const element of document.querySelectorAll('body *')) {
            const computed = getComputedStyle(element);
            if (computed.display === 'none' || !element.getBoundingClientRect().width || /^(?:INPUT|TEXTAREA|SELECT|CANVAS|SVG)$/.test(element.tagName)) continue;
            if (['auto', 'scroll'].includes(computed.overflowY) && element.scrollHeight > element.clientHeight + 2) {
              element.style.setProperty('height', 'auto', 'important'); element.style.setProperty('max-height', 'none', 'important'); element.style.setProperty('overflow-y', 'visible', 'important');
            }
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(100);
        if (errors.length) throw new Error('تهیهٔ تصویر این صفحه کامل نشد: ' + capture.label);
        const dimensions = await page.evaluate(() => ({ width: innerWidth, height: Math.max(innerHeight, document.documentElement.scrollHeight, document.body.scrollHeight) }));
        if (dimensions.height > MAX_IMAGE_HEIGHT) throw new Error('صفحهٔ نمونه برای یک تصویر بیش از حد بلند است: ' + capture.label);
        const regions = await collectScreenshotRegions(page, catalog), bytes = await page.screenshot({ fullPage: true, type: 'png', animations: 'disabled' });
        if (bytes.length > MAX_IMAGE_BYTES) throw new Error('اندازهٔ تصویر نمونه بیش از حد مجاز است: ' + capture.label);
        images.push({ id: imageId(capture.scenarioId + ':' + capture.route), label: capture.label, section: capture.section,
          dataUrl: 'data:image/png;base64,' + bytes.toString('base64'), regions });
        onProgress?.({ completed: images.length, total: plan.length, label: capture.label });
      } finally { page.off('pageerror', onError); }
    }
    await context.close();
  } finally { await browser.close(); }
  const current = await (await fetch(origin + '/__copy/status')).json();
  if (!current.ready || !current.previewCurrent || current.sourceRevision !== status.sourceRevision || current.buildRevision !== status.buildRevision) {
    throw new Error('کد هنگام تهیهٔ تصویرها تغییر کرده است؛ بسته را دوباره آماده کن.');
  }
  if (path) await writeFile(path, JSON.stringify({ revision: status.sourceRevision, images }), 'utf8');
  return images;
}
