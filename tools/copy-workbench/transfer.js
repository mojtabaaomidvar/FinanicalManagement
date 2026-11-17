const element = id => document.getElementById(id);
const fa = value => new Intl.NumberFormat('fa-IR').format(value);
let busy = false, review = null;
function message(text, error = false) { element('transfer-status').textContent = text; element('transfer-status').dataset.tone = error ? 'error' : 'info'; }
async function request(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Copy-Workbench-Token': window.__COPY_WORKBENCH__?.csrfToken ?? '' }) }, cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.message || 'عملیات بستهٔ ویرایش کامل نشد.'); return data;
}
function setBusy(value) { busy = value; element('export-package').disabled = value; element('import-package').disabled = value; element('stage-package').disabled = value; window.dispatchEvent(new CustomEvent('copy-workbench:transfer-busy', { detail: { busy: value } })); }
async function exportPackage() {
  if (busy) return;
  setBusy(true); message('در حال آماده‌سازی همین ویرایشگر با پیش‌نمایش تعاملی…');
  let progressPending = false;
  const timer = setInterval(async () => { if (progressPending) return; progressPending = true; try { const status = await request('/__copy/status'); if (status.operation?.kind === 'package' && status.busy) message(status.operation.message); } catch { /* The export response determines completion. */ } finally { progressPending = false; } }, 2500);
  try {
    const result = await request('/__copy/package/export', {});
    const link = element('package-download'); link.href = result.downloadUrl; link.download = 'khaneyar-text-editor-' + result.packageId.slice(0, 8) + '.html'; link.hidden = false;
    link.click(); message('بسته با ' + fa(result.entries) + ' نوشته و ' + fa(result.visualEntries ?? 0) + ' عنصر قابل ویرایش آماده شد. همین فایل HTML را برای آن شخص بفرست؛ او تغییرها را در فایل JSON به تو برمی‌گرداند.');
  } catch (error) { message(error.message || 'ساخت بسته کامل نشد؛ دوباره تلاش کن.', true); }
  finally { clearInterval(timer); setBusy(false); }
}
function appendChange(change, conflict = false) {
  const row = document.createElement('div'); row.className = 'transfer-change'; row.dataset.sourceId = change.id;
  const label = document.createElement('label'), checkbox = document.createElement('input'), title = document.createElement('span'); checkbox.type = 'checkbox'; checkbox.checked = !conflict; checkbox.disabled = conflict; checkbox.dataset.changeId = change.id; title.textContent = conflict ? 'نیاز به بررسی' : 'واردکردن این نوشته'; label.append(checkbox, title); row.append(label);
  const visual = change.kind === 'visual' || Boolean(change.expected);
  const describe = value => value?.deleted ? 'حذف عنصر از کد' : value?.icon ? 'آیکون: ' + value.icon : value?.visible ? 'عنصر نمایان' : 'وضعیت قبلی عنصر';
  const before = visual ? describe(change.expected ?? change.before) : change.expectedText ?? change.before;
  const after = visual ? describe(change.after ?? change) : change.text ?? change.after;
  for (const [caption, text] of [[visual ? 'وضعیت قبلی' : 'متن قبلی', before], [visual ? 'تغییر پیشنهادی' : 'متن پیشنهادی', after]]) { const heading = document.createElement('p'), value = document.createElement('pre'); heading.className = 'saved-change-label'; heading.textContent = caption; value.textContent = String(text ?? '').trim() ? text : 'متن خالی'; row.append(heading, value); }
  if (conflict) { const reason = document.createElement('p'); reason.className = 'conflict'; reason.textContent = change.reason; row.append(reason); if (change.current !== null) { const current = document.createElement('pre'); current.textContent = change.current; row.append(current); } }
  element('transfer-changes').append(row);
}
async function importPackage(file) {
  if (!file || busy) return;
  setBusy(true); message('در حال بررسی فایل تغییرها…');
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('فایل تغییرها بیش از اندازه بزرگ است.');
    let input; try { input = JSON.parse(await file.text()); } catch { throw new Error('فایل باید خروجی JSON ویرایشگر آفلاین باشد.'); }
    review = await request('/__copy/package/import', input);
    element('transfer-changes').replaceChildren(); for (const change of [...review.changes, ...(review.visualChanges ?? [])]) appendChange(change); for (const conflict of review.conflicts) appendChange(conflict, true);
    element('transfer-review').hidden = false; element('transfer-review').open = true; element('transfer-count').textContent = fa(review.changes.length + (review.visualChanges?.length ?? 0) + review.conflicts.length);
    message(fa(review.changes.length) + ' نوشتهٔ آمادهٔ ورود، ' + fa(review.visualChanges?.length ?? 0) + ' تغییر عنصر، ' + fa(review.conflicts.length) + ' مورد نیازمند بررسی و ' + fa(review.unchanged) + ' مورد بدون تغییر. هنوز چیزی در کد اعمال نشده است.');
  } catch (error) { message(error.message || 'فایل تغییرها بررسی نشد.', true); }
  finally { setBusy(false); }
}
async function stagePackage() {
  if (!review || busy) return;
  const ids = new Set([...element('transfer-changes').querySelectorAll('input:checked:not(:disabled)')].map(input => input.dataset.changeId));
  const changes = review.changes.filter(change => ids.has(change.id)), visualChanges = (review.visualChanges ?? []).filter(change => ids.has(change.id)); if (!changes.length && !visualChanges.length) { message('ابتدا موارد موردنظر را انتخاب کن.'); return; }
  setBusy(true);
  try {
    const detail = { changes, visualChanges, promise: null };
    window.dispatchEvent(new CustomEvent('copy-workbench:stage-copy', { detail }));
    if (!detail.promise) throw new Error('فهرست ویرایشگر هنوز آماده نیست؛ صفحه را دوباره باز کن.');
    const result = await detail.promise;
    message(fa(result.staged) + ' مورد به پیش‌نویس‌ها اضافه شد.' + (result.blocked.length ? ' ' + fa(result.blocked.length) + ' مورد با متن یا پیش‌نویس فعلی متفاوت بود و تغییر نکرد.' : '') + ' پس از بررسی، «اعمال در کد» را بزن.', Boolean(result.blocked.length));
    if (!result.blocked.length) { element('transfer-review').hidden = true; review = null; }
  } catch (error) { message(error.message || 'نوشته‌ها وارد پیش‌نویس‌ها نشدند.', true); }
  finally { setBusy(false); }
}
element('export-package').addEventListener('click', () => { void exportPackage(); });
element('import-package').addEventListener('change', event => { void importPackage(event.target.files[0]); event.target.value = ''; });
element('stage-package').addEventListener('click', () => { void stagePackage(); });
element('close-package-review').addEventListener('click', () => { element('transfer-review').hidden = true; review = null; });
