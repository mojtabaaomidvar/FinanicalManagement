(() => {
  const packageData = JSON.parse(document.getElementById('copy-package').textContent);
  const previewData = JSON.parse(document.getElementById('copy-preview-package').textContent);
  const entryMap = new Map(packageData.entries.map(entry => [entry.id, entry]));
  const visualMap = new Map((packageData.visualEntries ?? []).map(entry => [entry.id, entry]));
  const text = value => JSON.stringify(value).replaceAll('<', '\\u003c');
  const script = value => '<script>' + value.replace(/<\/script/gi, '<\\/script') + '<' + '/script>';
  const message = (value, error = false) => {
    const element = document.getElementById('transfer-status'); element.textContent = value; element.dataset.tone = error ? 'error' : 'info';
  };
  const tokenNames = entry => (entry.tokens ?? []).map(token => typeof token === 'string' ? token : token.token);
  function validateText(entry, value) {
    if (typeof value !== 'string' || value.length > 16000 || value.includes('\0')) throw new Error('متن پیشنهادی معتبر نیست.');
    if (JSON.stringify([...value.matchAll(/\{slot\d+\}/g)].map(match => match[0])) !== JSON.stringify(tokenNames(entry))) throw new Error('نشانه‌های مقدار متغیر باید دقیقاً یک بار و با همان ترتیب باقی بمانند.');
  }
  function validateVisual(entry, change) {
    if (typeof change.visible !== 'boolean' || change.deleted !== undefined && change.deleted !== true) throw new Error('تغییر عنصر معتبر نیست.');
    if (change.deleted && entry.deletable === false) throw new Error('این عنصر از این بسته قابل حذف نیست.');
    if (Object.hasOwn(change, 'icon') && !(change.icon === null && entry.nativeIcon || packageData.iconOptions.some(icon => icon.id === change.icon))) throw new Error('آیکون پیشنهادی در مجموعهٔ برنامه نیست.');
  }
  function currentChanges() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem('khaneyar:copy-portable:' + packageData.packageId + ':drafts:v2') ?? 'null'); } catch { saved = null; }
    return { changes: (saved?.drafts ?? []).filter(draft => !draft.error).map(({ id, text }) => ({ id, text })),
      visualChanges: (saved?.visualDrafts ?? []).filter(draft => !draft.error).map(({ id, visible, icon, deleted }) => ({ id, visible, ...(icon !== undefined ? { icon } : {}), ...(deleted ? { deleted: true } : {}) })) };
  }
  function exportChanges(input = currentChanges()) {
    const changes = [], visualChanges = [], seen = new Set();
    for (const change of input.changes ?? []) {
      const entry = entryMap.get(change.id); if (!entry || seen.has(change.id)) throw new Error('یکی از نوشته‌های پیشنهادی متعلق به این بسته نیست.');
      seen.add(change.id); validateText(entry, change.text); changes.push({ id: entry.id, text: change.text });
    }
    for (const change of input.visualChanges ?? []) {
      const entry = visualMap.get(change.id); if (!entry || seen.has(change.id)) throw new Error('یکی از عنصرهای پیشنهادی متعلق به این بسته نیست.');
      seen.add(change.id); validateVisual(entry, change); visualChanges.push({ id: entry.id, visible: change.visible, ...(Object.hasOwn(change, 'icon') ? { icon: change.icon } : {}), ...(change.deleted ? { deleted: true } : {}) });
    }
    if (!changes.length && !visualChanges.length) throw new Error('ابتدا یک نوشته یا آیکون را ویرایش کن.');
    const payload = { format: 'khaneyar-copy-edits', version: 2, packageId: packageData.packageId, changes, visualChanges };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'khaneyar-changes-' + packageData.packageId.slice(0, 8) + '.json';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    message('فایل تغییرها دریافت شد. آن را برای صاحب پروژه بفرست؛ پیش‌نویس‌ها برای ادامهٔ ویرایش حفظ شده‌اند.');
    return { exported: changes.length + visualChanges.length };
  }
  async function importChanges(file) {
    if (!file || file.size > 2 * 1024 * 1024) throw new Error('فایل تغییرها معتبر یا در اندازهٔ مجاز نیست.');
    let payload; try { payload = JSON.parse(await file.text()); } catch { throw new Error('فایل تغییرها خوانده نشد.'); }
    if (!payload || payload.format !== 'khaneyar-copy-edits' || payload.version !== 2 || payload.packageId !== packageData.packageId
      || Object.keys(payload).some(key => !['format', 'version', 'packageId', 'changes', 'visualChanges'].includes(key))
      || !Array.isArray(payload.changes) || !Array.isArray(payload.visualChanges) || payload.changes.length + payload.visualChanges.length > 10000) throw new Error('این فایل تغییرها متعلق به همین بسته نیست.');
    const changes = [], visualChanges = [], seen = new Set();
    for (const change of payload.changes) {
      if (!change || Object.keys(change).some(key => !['id', 'text'].includes(key))) throw new Error('ساختار تغییر نوشته معتبر نیست.');
      const entry = entryMap.get(change.id); if (!entry || seen.has(change.id)) throw new Error('شناسهٔ نوشته در فایل تغییرها معتبر نیست.');
      seen.add(change.id); validateText(entry, change.text); changes.push({ id: entry.id, expectedText: entry.text, text: change.text });
    }
    for (const change of payload.visualChanges) {
      if (!change || Object.keys(change).some(key => !['id', 'visible', 'icon', 'deleted'].includes(key))) throw new Error('ساختار تغییر عنصر معتبر نیست.');
      const entry = visualMap.get(change.id); if (!entry || seen.has(change.id)) throw new Error('شناسهٔ عنصر در فایل تغییرها معتبر نیست.');
      seen.add(change.id); validateVisual(entry, change); visualChanges.push({ ...change, expected: { visible: entry.visible, ...(Object.hasOwn(entry, 'icon') ? { icon: entry.icon } : {}) } });
    }
    const detail = { changes, visualChanges, promise: null }; window.dispatchEvent(new CustomEvent('copy-workbench:stage-copy', { detail }));
    if (!detail.promise) throw new Error('فهرست ویرایشگر هنوز آماده نیست.');
    const result = await detail.promise;
    message(String(result.staged).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]) + ' ویرایش برای ادامهٔ کار وارد شد.' + (result.blocked.length ? ' برخی پیش‌نویس‌های متفاوت حفظ شدند.' : ''), Boolean(result.blocked.length));
    return result;
  }
  function createPreview({ scenarioId, route }) {
    const scenario = previewData.scenarios.find(item => item.id === scenarioId), routeInfo = previewData.routes.find(item => item.id === route);
    if (!scenario || !routeInfo) throw new Error('حالت یا صفحهٔ پیش‌نمایش معتبر نیست.');
    const session = crypto.randomUUID();
    const config = { portable: true, packageId: packageData.packageId, session, scenario, route, routeInfo, routeMeta: routeInfo,
      credentials: { phone: '09000000001', password: 'Test12345!' }, allowedIconIds: packageData.iconOptions.map(icon => icon.id) };
    const scripts = script('window.__COPY_PREVIEW__=' + text(config) + ';') + script(previewData.fixturesJS) + script(previewData.adapterJS)
      + script(previewData.bridgeJS) + script('window.__COPY_PREVIEW_READY__.then(function(){' + previewData.appJS + '\n});');
    return { session, srcdoc: previewData.html.replace('</head>', () => '<style>' + previewData.appCSS.replace(/<\/style/gi, '<\\/style') + '</style></head>').replace('</body>', () => scripts + '</body>') };
  }
  window.__COPY_WORKBENCH__ = { portable: true, csrfToken: '', origin: 'null' };
  window.__COPY_PORTABLE__ = { packageId: packageData.packageId, package: packageData, exportChanges, importChanges, createPreview,
    async api(path, method = 'GET', body) {
      if (path === '/__copy/preview' && method === 'POST') return createPreview(body);
      if (method !== 'GET') throw new Error('این بسته فقط فایل تغییرها را تحویل می‌دهد.');
      if (path === '/__copy/catalog') return { ...packageData, revision: packageData.packageId, iconOptions: packageData.iconOptions };
      if (path === '/__copy/scenarios') return { scenarios: previewData.scenarios, routes: previewData.routes };
      if (path === '/__copy/status') return { ready: true, busy: false, previewCurrent: true, buildRevision: packageData.packageId, latestBatch: null };
      if (path === '/__copy/history') return { batches: [], latestBatch: null };
      throw new Error('این عملیات در بستهٔ ویرایش آفلاین در دسترس نیست.');
    },
  };
  const byId = id => document.getElementById(id);
  document.querySelector('.local-label').textContent = 'ویرایش آفلاین';
  byId('undo-batch').hidden = true;
  byId('apply-changes').firstChild.textContent = 'دریافت فایل تغییرها ';
  byId('save-title').textContent = 'وضعیت ویرایش‌ها';
  byId('save-status').textContent = 'پیش‌نویس‌ها روی همین دستگاه نگه داشته می‌شوند.';
  byId('saved-history').hidden = true;
  document.querySelector('.save-panel > p.help-note:last-of-type').textContent = 'تغییرها را در پیش‌نمایش بررسی کن و «دریافت فایل تغییرها» را بزن. صاحب پروژه آن‌ها را بررسی و در کد اعمال می‌کند.';
  byId('transfer-title').textContent = 'ادامهٔ ویرایش روی دستگاه دیگر';
  document.querySelector('.transfer-panel > p.help-note').textContent = 'فایل تغییرهای همین بسته را باز کن تا بتوانی ویرایش را در این مرورگر ادامه بدهی.';
  byId('export-package').hidden = true;
  byId('package-download').hidden = true;
  byId('import-package').parentElement.firstChild.textContent = 'بازکردن فایل تغییرها';
  byId('import-package').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; void importChanges(file).catch(error => message(error.message, true)); });
  byId('copy-original').previousElementSibling.textContent = 'متن فعلی در بسته';
  byId('copy-edit-help').textContent = 'ویرایش را در پیش‌نمایش ببین؛ سپس فایل تغییرها را دریافت کن.';
  document.querySelector('#draft-summary > p').textContent = 'همهٔ ویرایش‌های معتبر در فایل تغییرها قرار می‌گیرند.';
  byId('preview-open').hidden = true;
  for (const element of document.querySelectorAll('.source-note')) element.hidden = true;
  const sprite = new DOMParser().parseFromString(packageData.sprite, 'image/svg+xml').documentElement;
  sprite.style.display = 'none'; sprite.setAttribute('aria-hidden', 'true'); document.body.append(document.importNode(sprite, true));
})();
