const byId = id => document.getElementById(id);
const fa = value => String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
const normalize = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const kindNames = { 'jsx-text': 'نوشتهٔ صفحه', jsx: 'نوشتهٔ صفحه', 'jsx-attribute': 'راهنما و برچسب', 'html-attribute': 'راهنما و برچسب', attribute: 'راهنما و برچسب', string: 'متن ثابت', 'typescript-string': 'متن ثابت', template: 'متن با مقدار متغیر', 'typescript-template': 'متن با مقدار متغیر', 'python-string': 'پیام سرور', python: 'پیام سرور', 'python-template': 'پیام سرور با مقدار متغیر', 'html-text': 'نوشتهٔ صفحه', html: 'نوشتهٔ صفحه', 'css-content': 'نوشتهٔ نمایشی' };
const sectionNames = { HubPage: 'خانه', DashboardPage: 'خرج و درآمد', TransactionsPage: 'تراکنش‌ها', ReportsPage: 'گزارش‌ها', AccountsPage: 'کیف پول', BudgetsPage: 'بودجه‌ها', BillsPage: 'قبوض و شارژ', CalendarPage: 'تقویم', ShoppingPage: 'خرید', InventoryPage: 'انبار', TasksPage: 'کارهای خانه', DocumentsPage: 'اسناد', MealsPage: 'برنامهٔ غذایی', EquipmentPage: 'وسایل خانه', VehiclesPage: 'خودرو', GoalsPage: 'هدف‌ها و آرزوها', ActivitiesPage: 'برنامه‌های خانوادگی', ChildrenPage: 'فرزندان', PetsPage: 'حیوانات خانگی', MarketPage: 'بازار', SettingsPage: 'تنظیمات', auth: 'ورود و ثبت‌نام', onboarding: 'شروع برنامه', 'install-prompt': 'نصب برنامه', notifications: 'اعلان‌ها', shared: 'اجزای مشترک', backend: 'پیام‌های سرور' };
const portable = window.__COPY_PORTABLE__ ?? null;
const storageKey = portable ? 'khaneyar:copy-portable:' + portable.packageId + ':drafts:v2' : 'khaneyar:copy-workbench:drafts:v1';
const batchKey = portable ? storageKey + ':batch' : 'khaneyar:copy-workbench:last-batch:v1';
const state = { catalog: null, entries: [], entryMap: new Map(), visualEntries: [], visualEntryMap: new Map(), iconOptions: [], selected: null, drafts: new Map(), visualDrafts: new Map(), conflicts: [], visualConflicts: [], scenarios: [], routes: [], picked: null, limit: 160, busy: false, previewRequest: 0, previewUrl: null, previewPhase: 'loading', picker: false, lastBatch: null, statusRequest: 0, catalogRequest: 0, mutationRequest: 0, savedFact: null };

function sectionLabel(entry) {
  if (sectionNames[entry.section]) return sectionNames[entry.section];
  const file = entry.file ?? '';
  for (const [key, label] of Object.entries(sectionNames)) if (file.includes('/' + key + '/')) return label;
  return entry.section || 'نوشته‌های مشترک';
}
function kindLabel(kind) { return kind === 'icon' ? 'آیکون' : kind === 'text-element' ? 'عنصر متن' : kindNames[kind] ?? (String(kind).includes('template') ? 'متن با مقدار متغیر' : String(kind).includes('python') ? 'پیام سرور' : 'متن ثابت'); }
function allEntries() { return [...state.entries, ...state.visualEntries]; }
function entryById(id) { return state.entryMap.get(id) ?? state.visualEntryMap.get(id); }
function isVisual(entry) { return Boolean(entry && state.visualEntryMap.has(entry.id)); }
function draftCount() { return state.drafts.size + state.visualDrafts.size; }
function validDraftCount() { return [...state.drafts.values(), ...state.visualDrafts.values()].filter(draft => !draft.error).length; }
function iconLabel(id) { return id === null ? 'آیکون اولیه' : state.iconOptions.find(icon => icon.id === id)?.label ?? id ?? 'آیکون'; }
function visualValue(entry) { const draft = state.visualDrafts.get(entry.id), icon = draft && Object.hasOwn(draft, 'icon') ? draft.icon : entry.icon; return { visible: draft?.visible ?? entry.visible, deleted: draft?.deleted === true, ...(icon !== undefined ? { icon } : {}) }; }
function sameVisual(a, b) { return Boolean(a?.deleted) === Boolean(b?.deleted) && a?.visible === b?.visible && (a?.icon ?? '') === (b?.icon ?? ''); }
function visualDescription(value) { return (value.deleted ? 'حذف از کد' : value.visible ? 'نمایان' : 'عنصر حذف‌شده از نمایش در نسخهٔ قبلی') + (Object.hasOwn(value, 'icon') ? ' · ' + iconLabel(value.icon) : ''); }
function visualPayload(draft) { return { id: draft.id, visible: draft.visible, ...(Object.hasOwn(draft, 'icon') ? { icon: draft.icon } : {}), ...(draft.deleted ? { deleted: true } : {}) }; }
function visualIcon(id, size = 24) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); svg.setAttribute('aria-hidden', 'true'); use.setAttribute('href', (portable ? '#' : '/__copy/sprite.svg#') + id); svg.append(use); return svg; }
function useLabel(entry) { return [sectionLabel(entry), entry.context || kindLabel(entry.kind)].join(' · '); }
function copyLabel(text) { const value = String(text ?? ''); return value.trim() ? value : 'متن خالی'; }
function sourceLocation(entry) { return portable ? useLabel(entry) : entry.file + (entry.line ? ':' + entry.line : ''); }
function dateLabel(value) { try { return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); } catch { return ''; } }
function bodyOrder(entry) {
  const file = entry.file ?? '';
  return file.includes('/pages/HubPage/') ? 0 : file.includes('/features/auth/') ? 1 : file.includes('/features/onboarding/') ? 2
    : file.includes('/pages/') ? 3 : file.includes('/features/') ? 4 : file.startsWith('src/') ? 5 : file.startsWith('backend/') ? 7 : 6;
}
function tokenList(entry) { return (entry.tokens ?? []).map(value => typeof value === 'string' ? { token: value } : value).filter(value => value?.token); }
function validate(entry, text) {
  if (typeof text !== 'string' || text.length > 16000 || text.includes('\0')) return 'متن پیشنهادی نامعتبر یا بیش از حد طولانی است.';
  const tokens = tokenList(entry);
  if (JSON.stringify([...text.matchAll(/\{slot\d+\}/g)].map(match => match[0])) !== JSON.stringify(tokens.map(value => value.token))) return 'نشانه‌های مقدار متغیر باید دقیقاً یک بار و با ترتیب فعلی در متن باقی بمانند.';
  let last = -1;
  for (const { token } of tokens) {
    const first = text.indexOf(token);
    if (first < 0 || first <= last || text.indexOf(token, first + token.length) >= 0) return 'نشانه‌های مقدار متغیر باید دقیقاً یک بار و با ترتیب فعلی در متن باقی بمانند.';
    last = first;
  }
  return '';
}
function notify(message, tone = 'info') {
  const notice = byId('notice'); notice.textContent = message; notice.dataset.tone = tone;
  notice.setAttribute('role', tone === 'error' ? 'alert' : 'status'); notice.hidden = !message;
}
function saveMessage(message, phase = 'saved') {
  byId('save-status').textContent = message; document.querySelector('.save-panel').dataset.saveState = phase;
}
function appendCopyChange(container, change, entry) {
  const row = document.createElement('div'); row.className = 'saved-change';
  if (entry || change.file) { const location = document.createElement('p'); location.className = 'saved-change-label'; location.textContent = entry ? useLabel(entry) + ' · ' + sourceLocation(entry) : [change.context, change.file].filter(Boolean).join(' · '); row.append(location); }
  for (const [title, text] of [['پیش از اعمال', change.before], ['پس از اعمال', change.after]]) {
    const label = document.createElement('span'), value = document.createElement('pre'); label.className = 'saved-change-label'; label.textContent = title; value.textContent = copyLabel(text ?? ''); row.append(label, value);
  }
  container.append(row);
}
function appendVisualChange(container, change, entry) {
  const before = change.before ?? change.expected ?? { visible: true }, after = change.after ?? visualPayload(change);
  appendCopyChange(container, { before: visualDescription(before), after: visualDescription(after), file: change.file, context: change.label }, entry);
}
function renderHistory(batches) {
  const container = byId('saved-batches'); container.replaceChildren();
  if (!batches.length) { const empty = document.createElement('p'); empty.className = 'help-note'; empty.textContent = 'هنوز اعمال موفقی در این پروژه ثبت نشده است.'; container.append(empty); return; }
  for (const batch of batches) {
    const article = document.createElement('article'), title = document.createElement('h3'), metadata = document.createElement('p'); article.className = 'saved-batch'; article.dataset.batchId = batch.id;
    title.textContent = batch.kind === 'undo' ? 'بازگردانی ویرایش‌ها' : fa(batch.count ?? 0) + (batch.visualChanges?.length ? ' ویرایش در کد ذخیره شد' : ' نوشته در کد ذخیره شد') + (batch.undone ? '؛ سپس بازگردانده شد' : '');
    metadata.textContent = dateLabel(batch.completedAt) + ' · ' + fa(batch.files?.length ?? 0) + ' فایل'; article.append(title, metadata);
    const files = document.createElement('div'); files.className = 'saved-files';
    for (const file of batch.files ?? []) { const code = document.createElement('code'); code.textContent = file; files.append(code); } article.append(files);
    if (batch.changes?.length) { const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'نوشته‌های این اعمال'; details.append(summary); for (const change of batch.changes) appendCopyChange(details, change, state.entryMap.get(change.id)); article.append(details); }
    if (batch.visualChanges?.length) { const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'تغییرهای بصری این اعمال'; details.append(summary); for (const change of batch.visualChanges) appendVisualChange(details, change, state.visualEntryMap.get(change.id)); article.append(details); }
    container.append(article);
  }
}
async function refreshSavedState() {
  if (portable) { byId('build-status').textContent = 'پیش‌نمایش با اطلاعات نمونه در همین فایل اجرا می‌شود.'; return; }
  const request = ++state.statusRequest;
  const status = await api('/__copy/status');
  if (request !== state.statusRequest) return;
  if (status.busy) {
    if (state.busy || !state.savedFact) saveMessage(status.message || 'در حال ذخیره و آماده‌سازی پیش‌نمایش…', 'pending');
  } else if (state.savedFact) saveMessage(state.savedFact.message, state.savedFact.phase);
  else if (status.latestBatch) {
    const batch = status.latestBatch;
    saveMessage(batch.undone ? 'آخرین اعمال بازگردانده شده است.' : 'آخرین اعمال: ' + fa(batch.count) + (batch.visualChanges?.length ? ' تغییر در ' : ' نوشته در ') + fa(batch.files.length) + ' فایل ذخیره شده است.', batch.undone ? 'idle' : 'saved');
    if (!batch.undone && !state.busy) { state.lastBatch = batch.id; try { localStorage.setItem(batchKey, JSON.stringify(batch.id)); } catch { /* The durable server history remains available. */ } updateControls(); }
    else if (batch.undone && state.lastBatch === batch.id && !state.busy) { state.lastBatch = null; try { localStorage.removeItem(batchKey); } catch { /* The server remains the source of history. */ } updateControls(); }
  } else saveMessage('هنوز اعمال موفقی در این پروژه ثبت نشده است.', 'idle');
  byId('build-status').textContent = status.busy ? 'پیش‌نمایش در حال آماده‌سازی است.' : status.previewCurrent === false
    ? 'کد پروژه پس از آخرین ساخت تغییر کرده است؛ برای دیدن نسخهٔ فعلی، محیط را دوباره اجرا کن.'
    : status.buildRevision ? 'ساخت پیش‌نمایش با کد فعلی هماهنگ است. وضعیت بازشدن صفحه در بخش پیش‌نمایش دیده می‌شود.' : 'وضعیت ساخت پیش‌نمایش هنوز دریافت نشده است.';
  const result = await api('/__copy/history');
  if (request === state.statusRequest) renderHistory(result.batches ?? []);
}
function refreshSavedStateQuietly() { return refreshSavedState().catch(() => { byId('build-status').textContent = 'دریافت وضعیت ذخیره کامل نشد؛ «دریافت وضعیت ذخیره» را دوباره بزن.'; }); }
async function api(path, method = 'GET', body) {
  if (portable) return portable.api(path, method, body);
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-Copy-Workbench-Token'] = window.__COPY_WORKBENCH__?.csrfToken ?? '';
  }
  const controller = method === 'GET' || path === '/__copy/preview' ? new AbortController() : null;
  const timeout = controller && setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { method, headers, cache: 'no-store', ...(controller ? { signal: controller.signal } : {}), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let data;
    try { data = await response.json(); } catch (error) { if (controller?.signal.aborted) throw error; data = null; }
    if (!response.ok) {
      const error = new Error(data?.message || data?.error?.message || 'درخواست انجام نشد؛ دوباره تلاش کن.'); error.status = response.status; error.details = data; throw error;
    }
    return data;
  } catch (error) {
    if (controller?.signal.aborted) throw new Error('دریافت اطلاعات بیش از حد طول کشید؛ دوباره تلاش کن.');
    throw error;
  } finally { if (timeout) clearTimeout(timeout); }
}
function persist() {
  const data = { revision: state.catalog?.revision, drafts: [...state.drafts.values()], conflicts: state.conflicts, visualDrafts: [...state.visualDrafts.values()], visualConflicts: state.visualConflicts };
  try { localStorage.setItem(storageKey, JSON.stringify(data)); }
  catch { notify('نگهداری پیش‌نویس روی این دستگاه ممکن نیست. پیش از بستن صفحه، تغییرها را اعمال کن.', 'error'); }
}
function loadStoredDrafts() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    return { drafts: Array.isArray(data?.drafts) ? data.drafts : [], conflicts: Array.isArray(data?.conflicts) ? data.conflicts : [], visualDrafts: Array.isArray(data?.visualDrafts) ? data.visualDrafts : [], visualConflicts: Array.isArray(data?.visualConflicts) ? data.visualConflicts : [] };
  } catch { return { drafts: [], conflicts: [], visualDrafts: [], visualConflicts: [] }; }
}
function reconcileDrafts(items) {
  state.drafts.clear(); state.conflicts = [];
  for (const draft of items) {
    if (!draft || typeof draft.text !== 'string' || typeof draft.original !== 'string') continue;
    let entry = state.entryMap.get(draft.id);
    if (entry?.text === draft.text) continue;
    if (!entry || entry.text !== draft.original) {
      const alternatives = state.entries.filter(value => value.file === draft.file && value.text === draft.original && value.editable !== false);
      entry = alternatives.length === 1 ? alternatives[0] : null;
    }
    if (entry && entry.text === draft.text) continue;
    if (entry?.text === draft.original && entry.editable !== false) state.drafts.set(entry.id, { ...draft, id: entry.id, file: entry.file, error: validate(entry, draft.text) });
    else if (!state.conflicts.some(value => value.id === draft.id && value.text === draft.text)) state.conflicts.push(draft);
  }
}
function reconcileVisualDrafts(items) {
  state.visualDrafts.clear(); state.visualConflicts = [];
  for (const draft of items) {
    if (!draft || typeof draft.id !== 'string' || typeof draft.visible !== 'boolean' || !draft.expected) continue;
    const entry = state.visualEntryMap.get(draft.id), legacyDeletion = draft.visible === false && draft.expected.visible === true && !Object.hasOwn(draft, 'deleted');
    const desired = { visible: legacyDeletion ? draft.expected.visible : draft.visible, deleted: draft.deleted === true || legacyDeletion, ...(Object.hasOwn(draft, 'icon') ? { icon: draft.icon } : {}) };
    if (entry && sameVisual(visualValue(entry), desired)) continue;
    if (entry && sameVisual(visualValue(entry), draft.expected)) {
      const validIcon = !Object.hasOwn(draft, 'icon') || draft.icon === null && entry.nativeIcon || state.iconOptions.some(icon => icon.id === draft.icon);
      state.visualDrafts.set(entry.id, { ...draft, ...desired, file: entry.file, error: desired.deleted && entry.deletable === false ? entry.deleteReason : validIcon ? '' : 'این آیکون در فهرست آیکون‌های برنامه نیست.' });
    } else if (!state.visualConflicts.some(value => value.id === draft.id)) state.visualConflicts.push(draft);
  }
}
async function loadCatalog(initial = false) {
  const request = ++state.catalogRequest, stored = initial ? loadStoredDrafts() : null;
  byId('catalog-list').setAttribute('aria-busy', 'true');
  try {
    const catalog = await api('/__copy/catalog');
    if (request !== state.catalogRequest) return;
    const previous = stored ?? { drafts: [...state.drafts.values()], conflicts: state.conflicts, visualDrafts: [...state.visualDrafts.values()], visualConflicts: state.visualConflicts };
    const selected = entryById(state.selected);
    state.catalog = catalog; state.entries = (catalog.entries ?? []).filter(entry => entry.editable !== false).sort((a, b) => bodyOrder(a) - bodyOrder(b)); state.entryMap = new Map(state.entries.map(entry => [entry.id, entry]));
    state.visualEntries = (catalog.visualEntries ?? []).filter(entry => entry.editable !== false).sort((a, b) => bodyOrder(a) - bodyOrder(b)); state.visualEntryMap = new Map(state.visualEntries.map(entry => [entry.id, entry])); state.iconOptions = catalog.iconOptions ?? [];
    reconcileDrafts([...previous.drafts, ...previous.conflicts]);
    reconcileVisualDrafts([...(previous.visualDrafts ?? []), ...(previous.visualConflicts ?? [])]);
    if (!entryById(state.selected)) state.selected = state.entries.find(entry => selected && entry.file === selected.file && entry.text === selected.text)?.id ?? null;
    const section = byId('copy-section').value, kind = byId('copy-kind').value;
    setOptions(byId('copy-section'), [...new Map(allEntries().map(entry => [sectionLabel(entry), { id: sectionLabel(entry), label: sectionLabel(entry) }])).values()].sort((a, b) => a.label.localeCompare(b.label, 'fa')), 'همهٔ بخش‌ها');
    setOptions(byId('copy-kind'), [...new Set(allEntries().map(entry => entry.kind))].map(id => ({ id, label: kindLabel(id) })), 'همهٔ نوشته‌ها و آیکون‌ها');
    byId('copy-section').value = section; byId('copy-kind').value = kind;
    state.picked = null; state.limit = 160; persist(); renderList(); renderEditor(); renderConflicts(); updateControls(); sendDrafts();
    if (state.conflicts.length || state.visualConflicts.length) notify('فهرست به‌روز شد. ' + fa(state.conflicts.length + state.visualConflicts.length) + ' پیش‌نویس به بررسی نیاز دارد و نگه داشته شده است.', 'error');
    else if (!initial) notify('فهرست نوشته‌ها و آیکون‌ها از کد پروژه دوباره دریافت شد.');
  } finally { if (request === state.catalogRequest) byId('catalog-list').setAttribute('aria-busy', 'false'); }
}
function setOptions(select, items, firstLabel) {
  select.replaceChildren();
  if (firstLabel) { const first = document.createElement('option'); first.value = ''; first.textContent = firstLabel; select.append(first); }
  for (const item of items) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; select.append(option); }
}
function filteredEntries() {
  const search = normalize(byId('copy-search').value).toLocaleLowerCase('fa'), section = byId('copy-section').value, kind = byId('copy-kind').value;
  return allEntries().filter(entry => (!state.picked || state.picked.has(entry.id)) && (!section || sectionLabel(entry) === section)
    && (!kind || entry.kind === kind) && (!byId('draft-only').checked || state.drafts.has(entry.id) || state.visualDrafts.has(entry.id))
    && (!search || normalize([entry.text === '' ? 'متن خالی' : entry.text, entry.label, entry.icon, entry.icon ? iconLabel(entry.icon) : '', isVisual(entry) && visualValue(entry).deleted ? 'حذف از کد' : '', state.drafts.get(entry.id)?.text, entry.context, entry.file, sectionLabel(entry)].join(' ')).toLocaleLowerCase('fa').includes(search)));
}
function renderList() {
  const entries = filteredEntries(), list = byId('catalog-list'); list.replaceChildren();
  byId('catalog-count').textContent = fa(entries.length) + ' از ' + fa(allEntries().length); byId('catalog-empty').hidden = Boolean(entries.length);
  byId('picked-note').hidden = !state.picked; byId('picked-count').textContent = state.picked ? fa(state.picked.size) + ' محل انتخاب‌شده' : '';
  for (const entry of entries.slice(0, state.limit)) {
    const visual = isVisual(entry), draft = state.drafts.get(entry.id) ?? state.visualDrafts.get(entry.id), button = document.createElement('button'); button.type = 'button'; button.className = 'copy-item'; button.dataset.copyId = entry.id; if (visual) button.dataset.visualId = entry.id;
    button.setAttribute('aria-current', String(state.selected === entry.id));
    const text = document.createElement('span'); text.className = 'copy-item-text'; text.textContent = visual ? entry.label || kindLabel(entry.kind) : copyLabel(draft?.text ?? entry.text);
    if (visual) { const value = visualValue(entry); if (value.icon) text.prepend(visualIcon(value.icon, 20)); if (value.deleted || !value.visible) { const hidden = document.createElement('span'); hidden.className = 'hidden-tag'; hidden.textContent = value.deleted ? 'حذف از کد' : 'نسخهٔ قبلی'; text.append(hidden); } }
    const metadata = document.createElement('span'); metadata.className = 'copy-item-meta';
    const location = document.createElement('span'); location.textContent = sectionLabel(entry) + ' · ' + kindLabel(entry.kind); metadata.append(location);
    if (draft) { const flag = document.createElement('span'); flag.className = 'draft-dot' + (draft.error ? ' copy-item-invalid' : ''); flag.textContent = draft.error ? 'نیاز به اصلاح' : 'ویرایش‌شده'; metadata.append(flag); }
    button.append(text, metadata); button.addEventListener('click', () => selectEntry(entry.id)); list.append(button);
    const context = document.createElement('span'), source = document.createElement('span'); context.className = 'copy-item-context'; context.textContent = entry.context || kindLabel(entry.kind);
    source.className = 'copy-item-source'; source.textContent = sourceLocation(entry); button.append(context, source);
  }
  if (entries.length > state.limit) {
    const more = document.createElement('button'); more.type = 'button'; more.className = 'text-button'; more.textContent = 'نمایش موارد بیشتر (' + fa(entries.length - state.limit) + ')';
    more.addEventListener('click', () => { const position = list.scrollTop; state.limit += 160; renderList(); list.scrollTop = position; }); list.append(more);
  }
}
function selectEntry(id) { state.selected = id; renderEditor(); for (const button of byId('catalog-list').querySelectorAll('[data-copy-id]')) button.setAttribute('aria-current', String(button.dataset.copyId === id)); }
function renderEditor() {
  const entry = entryById(state.selected), visual = isVisual(entry); byId('editor-empty').hidden = Boolean(entry); byId('editor-content').hidden = !entry || visual; byId('visual-editor-content').hidden = !entry || !visual; byId('editor-kind').hidden = !entry;
  if (!entry) return;
  if (visual) { renderVisualEditor(entry); return; }
  byId('editor-kind').textContent = kindLabel(entry.kind); byId('editor-section').textContent = sectionLabel(entry); byId('editor-context').textContent = entry.context ?? '';
  byId('copy-original').textContent = entry.text; byId('copy-edit').value = state.drafts.get(entry.id)?.text ?? entry.text; byId('copy-edit').disabled = state.busy;
  byId('copy-source').textContent = sourceLocation(entry);
  const tokens = tokenList(entry), note = byId('copy-tokens'); note.replaceChildren(); note.hidden = !tokens.length;
  if (tokens.length) {
    const explanation = document.createElement('p'); explanation.textContent = 'این نشانه‌ها جای مقدارهای متغیرند؛ آن‌ها را با همین ترتیب در متن نگه دار.'; note.append(explanation);
    for (const item of tokens) { const row = document.createElement('p'), code = document.createElement('code'); code.textContent = item.token; row.append(code); if (item.example) row.append(document.createTextNode(' نمونه: ' + item.example)); note.append(row); }
  }
  renderTextVisualControls(entry); updateEditorState();
}
function updateEditorState() {
  const entry = state.entryMap.get(state.selected); if (!entry) return;
  const draft = state.drafts.get(entry.id); byId('reset-entry').disabled = state.busy || !draft;
  byId('entry-draft-state').textContent = draft ? 'پیش‌نویس؛ هنوز در کد اعمال نشده' : 'متن فعلی';
  const error = draft?.error ?? ''; byId('copy-validation').textContent = error; byId('copy-validation').hidden = !error; byId('copy-edit').setAttribute('aria-invalid', String(Boolean(error)));
  byId('clear-text').disabled = state.busy || Boolean(tokenList(entry).length); byId('clear-text-help').hidden = !tokenList(entry).length;
  updateTextVisualState();
}
function renderTextVisualControls(entry) {
  const candidates = state.visualEntries.filter(item => item.kind === 'text-element' && (item.textEntryIds ?? []).includes(entry.id));
  const select = byId('text-element-target'), previous = select.value; select.replaceChildren();
  if (candidates.length > 1) { const prompt = document.createElement('option'); prompt.value = ''; prompt.textContent = 'عنصر موردنظر را انتخاب کن'; select.append(prompt); }
  for (const item of candidates) { const option = document.createElement('option'); option.value = item.id; option.textContent = (item.label || 'عنصر متن') + (portable ? '' : ' · خط ' + fa(item.line)); select.append(option); }
  if (candidates.some(item => item.id === previous)) select.value = previous;
  byId('text-visual-controls').hidden = !candidates.length; byId('text-element-choice').hidden = candidates.length < 2; updateTextVisualState();
}
function updateTextVisualState() {
  const target = state.visualEntryMap.get(byId('text-element-target').value); if (!target) { byId('text-hide-element').disabled = true; byId('text-show-element').disabled = true; byId('text-element-state').textContent = 'محل عنصر را انتخاب کن.'; return; }
  const value = visualValue(target); byId('text-hide-element').disabled = state.busy || value.deleted || target.deletable === false; byId('text-show-element').disabled = state.busy || !value.deleted;
  byId('text-element-state').textContent = target.deletable === false ? target.deleteReason : value.deleted ? 'پس از اعمال، خود عنصر و نوشته‌های داخلش از کد حذف می‌شوند.' : 'با حذف عنصر، خود آن و فضای آن از کد برداشته می‌شوند.';
}
function editVisual(entry, patch) {
  if (!entry || state.busy || patch.deleted && entry.deletable === false) return;
  const current = visualValue(entry), desired = { ...current, ...patch }, expected = { visible: entry.visible, ...(entry.icon !== undefined ? { icon: entry.icon } : {}) };
  if (sameVisual(desired, expected)) state.visualDrafts.delete(entry.id);
  else state.visualDrafts.set(entry.id, { id: entry.id, file: entry.file, label: entry.label, expected, ...desired, error: '' });
  persist(); renderList(); updateControls(); updateTextVisualState(); sendDrafts();
}
function renderVisualEditor(entry) {
  byId('editor-kind').textContent = kindLabel(entry.kind); byId('visual-section').textContent = sectionLabel(entry); byId('visual-context').textContent = entry.label || entry.context || kindLabel(entry.kind); byId('visual-source').textContent = sourceLocation(entry);
  const value = visualValue(entry), current = byId('visual-current'); current.replaceChildren();
  if (value.icon) current.append(visualIcon(value.icon, 38));
  const caption = document.createElement('span'); caption.textContent = visualDescription(value); current.append(caption); current.classList.toggle('is-hidden', value.deleted || !value.visible);
  byId('visual-hide').disabled = state.busy || value.deleted || entry.deletable === false; byId('visual-hide').title = entry.deleteReason ?? ''; byId('visual-show').disabled = state.busy || !value.deleted; byId('visual-reset').disabled = state.busy || !state.visualDrafts.has(entry.id);
  byId('visual-draft-state').textContent = state.visualDrafts.has(entry.id) ? 'پیش‌نویس؛ هنوز در کد اعمال نشده' : 'وضعیت فعلی در کد';
  byId('icon-choice').hidden = entry.kind !== 'icon'; byId('visual-text-links').hidden = entry.kind !== 'text-element' || !(entry.textEntryIds ?? []).length;
  const links = byId('visual-text-links'); links.replaceChildren();
  for (const id of entry.textEntryIds ?? []) { const text = state.entryMap.get(id); if (!text) continue; const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = 'ویرایش نوشته: ' + copyLabel(text.text); button.addEventListener('click', () => { selectEntry(text.id); }); links.append(button); }
  if (entry.kind === 'icon') renderIconPalette(entry);
}
function renderIconPalette(entry = state.visualEntryMap.get(state.selected)) {
  const palette = byId('icon-palette'); palette.replaceChildren(); if (!entry || entry.kind !== 'icon') return;
  const search = normalize(byId('icon-search').value).toLocaleLowerCase('fa'), current = visualValue(entry);
  const options = [...(entry.nativeIcon ? [{ id: null, label: 'آیکون اولیه' }] : []), ...state.iconOptions].filter(option => !search || normalize([option.label, option.id].join(' ')).toLocaleLowerCase('fa').includes(search));
  byId('icon-empty').hidden = Boolean(options.length);
  for (const option of options) { const button = document.createElement('button'); button.type = 'button'; button.className = 'icon-choice'; button.dataset.iconId = option.id ?? '__native__'; button.disabled = state.busy; button.setAttribute('aria-pressed', String(current.icon === option.id)); button.setAttribute('aria-label', option.label); if (option.id) button.append(visualIcon(option.id, 28)); const label = document.createElement('span'); label.textContent = option.label; button.append(label); button.addEventListener('click', () => editVisual(entry, { icon: option.id })); palette.append(button); }
}
function editSelected(text) {
  const entry = state.entryMap.get(state.selected); if (!entry || state.busy) return;
  if (text === entry.text) state.drafts.delete(entry.id); else state.drafts.set(entry.id, { id: entry.id, file: entry.file, original: entry.text, text, error: validate(entry, text) });
  persist(); updateEditorState(); updateControls(); renderList(); sendDrafts();
}
function renderConflicts() {
  byId('draft-conflicts').hidden = !state.conflicts.length && !state.visualConflicts.length; byId('conflict-count').textContent = fa(state.conflicts.length + state.visualConflicts.length); const list = byId('conflict-list'); list.replaceChildren();
  for (const draft of state.conflicts) { const item = document.createElement('div'); item.className = 'conflict-item'; const original = document.createElement('p'), text = document.createElement('pre'); original.textContent = draft.original; text.textContent = draft.text; item.append(original, text); list.append(item); }
  for (const draft of state.visualConflicts) { const item = document.createElement('div'); item.className = 'conflict-item'; appendVisualChange(item, { ...draft, before: draft.expected, after: visualPayload(draft) }); list.append(item); }
}
function updateControls() {
  const valid = validDraftCount(), invalid = draftCount() - valid;
  byId('apply-count').textContent = fa(valid); byId('apply-changes').disabled = state.busy || state.transferBusy || !valid;
  const reason = state.busy ? 'در حال ذخیرهٔ ویرایش‌ها؛ پس از پایان عملیات می‌توانی دوباره اعمال کنی.'
    : state.transferBusy ? 'بستهٔ ویرایش در حال آماده‌سازی است؛ پس از پایان دوباره اعمال کن.'
    : invalid ? (valid ? fa(valid) + ' ویرایش معتبر اعمال می‌شود؛ ' : '') + fa(invalid) + ' پیش‌نویس دارای خطا حفظ می‌شود تا آن را اصلاح کنی.'
    : !valid ? 'تغییر تازه‌ای برای اعمال نیست؛ متن یا آیکون را ویرایش کن.' : portable ? 'فایل تغییرها را دریافت کن و به صاحب پروژه بده.' : 'ویرایش‌های تازه را در کد ذخیره کن.';
  byId('apply-changes').title = reason; byId('apply-changes').setAttribute('aria-description', reason);
  const help = byId('apply-help'); if (help) { help.textContent = reason; help.hidden = !invalid && !state.busy && !state.transferBusy; }
  byId('apply-changes').setAttribute('aria-busy', String(state.busy || Boolean(state.transferBusy))); byId('reload-catalog').disabled = state.busy; byId('undo-batch').disabled = state.busy || state.transferBusy || !state.lastBatch;
  byId('reset-all').disabled = state.busy || !draftCount(); byId('clear-conflicts').disabled = state.busy;
  byId('copy-edit').disabled = state.busy; updateEditorState();
  if (isVisual(entryById(state.selected))) renderVisualEditor(entryById(state.selected));
  const summary = byId('draft-summary-list'); summary.replaceChildren(); byId('draft-summary').hidden = !draftCount(); byId('draft-summary-count').textContent = fa(draftCount());
  for (const draft of state.drafts.values()) appendCopyChange(summary, { before: draft.original, after: draft.text, file: draft.file }, state.entryMap.get(draft.id));
  for (const draft of state.visualDrafts.values()) appendVisualChange(summary, { ...draft, before: draft.expected, after: visualPayload(draft) }, state.visualEntryMap.get(draft.id));
}
function invalidateCatalogRequests() { ++state.catalogRequest; byId('catalog-list').setAttribute('aria-busy', 'false'); }
function acknowledgeApply(result, changes, visualChanges) {
  const revision = result.sourceRevision ?? result.revision;
  if (typeof revision === 'string') state.catalog.revision = revision;
  for (const change of changes) { const entry = state.entryMap.get(change.id); if (entry) entry.text = change.text; }
  for (const change of visualChanges) {
    const entry = state.visualEntryMap.get(change.id);
    if (entry && change.deleted) {
      const descendants = state.visualEntries.filter(value => value.id === entry.id || value.file === entry.file && Number.isInteger(value.sourceStart) && value.sourceStart >= entry.sourceStart && value.sourceEnd <= entry.sourceEnd);
      for (const removed of descendants) { state.visualEntryMap.delete(removed.id); state.visualDrafts.delete(removed.id); for (const id of removed.textEntryIds ?? []) { state.entryMap.delete(id); state.drafts.delete(id); } }
      state.visualEntries = state.visualEntries.filter(value => state.visualEntryMap.has(value.id)); state.entries = state.entries.filter(value => state.entryMap.has(value.id));
    } else if (entry) { entry.visible = change.visible; if (Object.hasOwn(change, 'icon')) entry.icon = change.icon; }
  }
  for (const change of changes) state.drafts.delete(change.id);
  for (const change of visualChanges) state.visualDrafts.delete(change.id);
  persist(); renderEditor(); renderList();
}
async function refreshAfterApply(request) {
  const fact = state.savedFact;
  try { await loadCatalog(); } catch { if (request === state.mutationRequest && fact === state.savedFact) fact.warning += ' دریافت فهرست جدید کامل نشد؛ فهرست را دوباره دریافت کن.'; }
  if (request !== state.mutationRequest || fact !== state.savedFact) return;
  const previewStarted = await startPreview();
  if (request === state.mutationRequest && fact === state.savedFact) notify(fact.message + (previewStarted ? ' پیش‌نمایش در حال بازشدن است.' : ' بازکردن پیش‌نمایش کامل نشد؛ حالت را دوباره شروع کن.') + fact.warning, !previewStarted || fact.warning ? 'error' : 'success');
}
function sendDrafts() {
  const frame = byId('copy-preview').contentWindow; if (!frame) return;
  const targetOrigin = portable ? '*' : location.origin;
  frame.postMessage({ type: 'copy-drafts', drafts: [...state.drafts.values()].filter(draft => !draft.error).map(draft => ({ id: draft.id, file: draft.file, original: draft.original, text: draft.text,
    matchingIds: state.entries.filter(entry => normalize(entry.text) === normalize(draft.original)).map(entry => entry.id), tokens: tokenList(state.entryMap.get(draft.id) ?? {}) })) }, targetOrigin);
  frame.postMessage({ type: 'copy-pick-mode', enabled: state.picker }, targetOrigin);
  frame.postMessage({ type: 'copy-visual-drafts', drafts: [...state.visualDrafts.values()].filter(draft => !draft.error).map(visualPayload) }, targetOrigin);
}
async function applyChanges() {
  if (byId('apply-changes').disabled) return;
  if (portable) {
    try { await portable.exportChanges({ changes: [...state.drafts.values()].filter(draft => !draft.error).map(draft => ({ id: draft.id, text: draft.text })), visualChanges: [...state.visualDrafts.values()].filter(draft => !draft.error).map(visualPayload) }); saveMessage('فایل تغییرها دریافت شد؛ برای اعمال در کد آن را به صاحب پروژه بده.'); }
    catch (error) { notify(error.message, 'error'); }
    return;
  }
  const request = ++state.mutationRequest; invalidateCatalogRequests();
  const changes = [...state.drafts.values()].filter(draft => !draft.error).map(draft => ({ id: draft.id, text: draft.text, expectedText: draft.original }));
  const visualChanges = [...state.visualDrafts.values()].filter(draft => !draft.error).map(draft => ({ ...visualPayload(draft), expected: draft.expected })), count = changes.length + visualChanges.length, retained = draftCount() - count;
  state.busy = true; state.savedFact = null; updateControls(); saveMessage('در حال اعمال ' + fa(count) + ' ویرایش در کد…', 'pending'); notify('در حال اعمال ' + fa(count) + ' ویرایش در کد و آماده‌سازی پیش‌نمایش…');
  const progress = setInterval(() => { void refreshSavedStateQuietly(); }, 2000);
  try {
    let result;
    try { result = await api('/__copy/apply', 'POST', { revision: state.catalog.revision, changes, visualChanges }); }
    catch (error) {
      const code = error.details?.error;
      const message = code === 'BUSY' ? 'عملیات قبلی هنوز تمام نشده است. پیش‌نویس‌های تو حفظ شده‌اند؛ پس از آماده‌شدن محیط دوباره اعمال کن.'
        : ['STALE_CATALOG', 'STALE_TEXT', 'SOURCE_CHANGED'].includes(code) ? 'کد پروژه از زمان دریافت فهرست تغییر کرده است. فهرست را دوباره دریافت کن تا پیش‌نویس‌ها با نسخهٔ فعلی بررسی شوند.'
        : error.status ? error.message : 'پاسخ اعمال دریافت نشد. وضعیت ذخیره را دریافت کن تا مشخص شود عملیات کامل شده است؛ پیش‌نویس‌ها حفظ شده‌اند.';
      state.savedFact = { phase: 'failed', message }; saveMessage(message, 'failed'); notify(message, 'error'); return;
    }
    if (result.backupId) { state.lastBatch = result.backupId; try { localStorage.setItem(batchKey, JSON.stringify(result.backupId)); } catch { /* The current button still works. */ } }
    state.savedFact = { phase: 'saved', message: fa(result.applied ?? count) + (visualChanges.length ? ' تغییر در فایل‌های پروژه ذخیره شد.' : ' نوشته در فایل‌های پروژه ذخیره شد.'), warning: (result.warning ?? '') + (retained ? ' ' + fa(retained) + ' پیش‌نویس دارای خطا حفظ شد؛ پس از اصلاح می‌توانی آن را اعمال کنی.' : '') }; saveMessage(state.savedFact.message);
    acknowledgeApply(result, changes, visualChanges);
    void refreshAfterApply(request);
  } finally { clearInterval(progress); state.busy = false; updateControls(); void refreshSavedStateQuietly(); }
}
async function undoBatch() {
  if (!state.lastBatch || state.busy) return;
  ++state.mutationRequest; invalidateCatalogRequests();
  state.busy = true; state.savedFact = null; updateControls(); saveMessage('در حال برگرداندن آخرین ویرایش‌های اعمال‌شده…', 'pending'); notify('در حال برگرداندن آخرین ویرایش‌های اعمال‌شده…');
  const progress = setInterval(() => { void refreshSavedStateQuietly(); }, 2000);
  try {
    let result;
    try { result = await api('/__copy/undo', 'POST', { backupId: state.lastBatch }); }
    catch (error) { state.savedFact = { phase: 'failed', message: error.message }; saveMessage(error.message, 'failed'); notify(error.message, 'error'); return; }
    state.lastBatch = null; try { localStorage.removeItem(batchKey); } catch { /* No effect on the restored code. */ }
    state.savedFact = { phase: 'saved', message: 'آخرین اعمال در فایل‌های پروژه بازگردانده شد.', warning: result.warning ?? '' }; saveMessage(state.savedFact.message);
    try { await loadCatalog(); } catch { state.savedFact.warning += ' دریافت فهرست جدید کامل نشد؛ فهرست را دوباره دریافت کن.'; }
    const previewStarted = await startPreview(); notify(state.savedFact.message + (previewStarted ? ' پیش‌نمایش در حال بازشدن است.' : ' بازکردن پیش‌نمایش کامل نشد؛ حالت را دوباره شروع کن.') + state.savedFact.warning, !previewStarted || state.savedFact.warning ? 'error' : 'success');
  } finally { clearInterval(progress); state.busy = false; updateControls(); void refreshSavedStateQuietly(); }
}
function resizePreview() {
  const viewport = byId('preview-viewport'), wrapper = byId('preview-frame-scale'), frame = byId('copy-preview');
  const width = byId('preview-size').value === 'desktop' ? 1000 : 390, height = byId('preview-size').value === 'desktop' ? 880 : 820;
  const panelWidth = Math.max(200, byId('preview-panel')?.clientWidth ?? byId('preview-viewport').parentElement.clientWidth - 32);
  const available = Math.min(width, panelWidth - 2); viewport.style.width = available + 'px';
  const scale = Math.min(1, (viewport.clientWidth - 2) / width); wrapper.style.width = width + 'px'; wrapper.style.height = height + 'px'; wrapper.style.transform = 'scale(' + scale + ')';
  frame.style.width = width + 'px'; frame.style.height = height + 'px'; viewport.style.height = Math.round(height * scale + 2) + 'px';
}
async function startPreview() {
  if (!state.scenarios.length) return false;
  const request = ++state.previewRequest, scenarioId = byId('preview-scenario').value, route = byId('preview-route').value;
  state.previewUrl = null; state.previewPhase = 'loading'; byId('preview-open').hidden = true; byId('preview-draft-status').textContent = ''; byId('preview-draft-status').hidden = true;
  const scenario = state.scenarios.find(value => value.id === scenarioId); byId('scenario-description').textContent = scenario?.description ?? ''; byId('preview-state').textContent = 'در حال آماده‌سازی…';
  try {
    const result = await api('/__copy/preview', 'POST', { scenarioId, route }); if (request !== state.previewRequest) return false;
    if (portable) { state.previewUrl = 'https://portable.invalid/preview/?session=' + encodeURIComponent(result.session); byId('copy-preview').srcdoc = result.srcdoc; resizePreview(); return true; }
    const url = new URL(result.url, location.origin); if (url.origin !== location.origin || !url.pathname.startsWith('/preview')) throw new Error('نشانی پیش‌نمایش معتبر نیست.');
    state.previewUrl = url.href; byId('copy-preview').src = url.href; byId('preview-open').href = url.href; byId('preview-open').hidden = false; resizePreview();
    return true;
  } catch (error) { if (request === state.previewRequest) { state.previewPhase = 'error'; byId('preview-state').textContent = 'پیش‌نمایش آماده نشد'; notify(error.message, 'error'); } return false; }
}
function templateMatches(entry, value) {
  const tokens = tokenList(entry); if (!tokens.length) return false;
  let pattern = normalize(entry.text); for (const { token } of tokens) pattern = pattern.replace(token, '\u0000');
  const parts = pattern.split('\u0000'); if (parts.join('').trim().length < 2) return false;
  return new RegExp('^' + parts.map(escapeRegex).join('(.+?)') + '$', 'u').test(value);
}
function pickText(picked) {
  const visualIds = Array.isArray(picked.visualEntryIds) ? [...new Set(picked.visualEntryIds)].filter(id => state.visualEntryMap.has(id)) : [];
  const icons = visualIds.filter(id => state.visualEntryMap.get(id).kind === 'icon');
  if (icons.length) { pickVisual(icons); return; }
  const value = normalize(picked.text); if (!value) { if (visualIds.length) pickVisual(visualIds); return; }
  const ids = Array.isArray(picked.entryIds) ? [...new Set(picked.entryIds)].filter(id => state.entryMap.has(id)) : [];
  const exact = state.entries.filter(entry => normalize(entry.text) === value || normalize(state.drafts.get(entry.id)?.text) === value);
  const matches = ids.length ? ids.map(id => state.entryMap.get(id)) : exact.length ? exact : state.entries.filter(entry => templateMatches(entry, value));
  if (!matches.length) { if (visualIds.length) { pickVisual(visualIds); return; } notify('این مقدار در فهرست نوشته‌های ثابت پیدا نشد. برای پیدا کردن بخش ثابت آن، در فهرست جست‌وجو کن.'); return; }
  state.picked = new Set(matches.map(entry => entry.id)); byId('copy-search').value = ''; byId('copy-section').value = ''; byId('copy-kind').value = ''; byId('draft-only').checked = false; state.limit = 160;
  if (matches.length === 1) {
    selectEntry(matches[0].id);
    const selectedElements = visualIds.filter(id => (state.visualEntryMap.get(id).textEntryIds ?? []).includes(matches[0].id));
    if (selectedElements.length === 1) { byId('text-element-target').value = selectedElements[0]; updateTextVisualState(); }
  }
  else { state.selected = null; renderEditor(); }
  renderList(); byId('picked-count').textContent = matches.length === 1 ? 'محل دقیق نوشته انتخاب شد' : fa(matches.length) + ' محل؛ نوشتهٔ موردنظر را از فهرست انتخاب کن';
  notify(matches.length === 1 ? 'محل نوشته انتخاب شد؛ فقط همین محل ویرایش می‌شود.' : 'این نوشته در ' + fa(matches.length) + ' محل استفاده شده است. محل موردنظر را با توجه به بخش و فایل از فهرست انتخاب کن.');
}
function pickVisual(ids) {
  const matches = ids.map(id => state.visualEntryMap.get(id)).filter(Boolean); if (!matches.length) return;
  state.picked = new Set(matches.map(entry => entry.id)); byId('copy-search').value = ''; byId('copy-section').value = ''; byId('copy-kind').value = ''; byId('draft-only').checked = false; state.limit = 160;
  if (matches.length === 1) { byId('icon-search').value = ''; selectEntry(matches[0].id); } else { state.selected = null; renderEditor(); }
  renderList(); byId('picked-count').textContent = matches.length === 1 ? 'محل دقیق عنصر انتخاب شد' : fa(matches.length) + ' محل؛ عنصر موردنظر را انتخاب کن';
  notify(matches.length === 1 ? (matches[0].kind === 'icon' ? 'این آیکون را از کد حذف کن یا آیکون جایگزین انتخاب کن؛ فقط همین محل ویرایش می‌شود.' : 'این عنصر را از کد حذف کن یا نوشتهٔ آن را ویرایش کن؛ فقط همین محل ویرایش می‌شود.') : 'چند محل برای این عنصر پیدا شد. محل موردنظر را از فهرست انتخاب کن.');
}
window.addEventListener('message', event => {
  if (event.origin !== (portable ? 'null' : location.origin) || event.source !== byId('copy-preview').contentWindow || !event.data || typeof event.data !== 'object') return;
  const data = event.data;
  const expectedSession = state.previewUrl && new URL(state.previewUrl, location.origin).searchParams.get('session');
  if (!expectedSession || data.session !== expectedSession) return;
  if (data.type === 'copy-preview-ready') { state.previewPhase = 'ready'; byId('preview-state').textContent = 'آماده'; sendDrafts(); if (state.savedFact?.phase === 'saved') notify(state.savedFact.message + ' پیش‌نمایش جدید باز شد.' + (state.savedFact.warning ?? ''), state.savedFact.warning ? 'error' : 'success'); }
  else if (data.type === 'copy-preview-status') byId('preview-state').textContent = data.message ?? '';
  else if (data.type === 'copy-preview-draft-status') { const note = byId('preview-draft-status'); note.textContent = typeof data.message === 'string' ? data.message : ''; note.hidden = !note.textContent.trim(); }
  else if (data.type === 'copy-preview-error') { state.previewPhase = 'error'; byId('preview-state').textContent = 'این حالت کامل آماده نشد'; notify((state.savedFact?.phase === 'saved' ? state.savedFact.message + ' ' : '') + (data.message ?? 'پیش‌نمایش آماده نشد؛ حالت را دوباره شروع کن.'), 'error'); }
  else if (data.type === 'copy-pick') pickText(data);
});
byId('copy-search').addEventListener('input', () => { state.limit = 160; renderList(); });
for (const id of ['copy-section', 'copy-kind', 'draft-only']) byId(id).addEventListener('change', () => { state.limit = 160; renderList(); });
byId('copy-edit').addEventListener('input', event => editSelected(event.target.value));
byId('clear-text').addEventListener('click', () => { const entry = state.entryMap.get(state.selected); if (entry && !tokenList(entry).length) { editSelected(''); byId('copy-edit').value = ''; } });
byId('text-element-target').addEventListener('change', updateTextVisualState);
byId('text-hide-element').addEventListener('click', () => editVisual(state.visualEntryMap.get(byId('text-element-target').value), { deleted: true }));
byId('text-show-element').addEventListener('click', () => editVisual(state.visualEntryMap.get(byId('text-element-target').value), { deleted: false }));
byId('visual-hide').addEventListener('click', () => editVisual(state.visualEntryMap.get(state.selected), { deleted: true }));
byId('visual-show').addEventListener('click', () => editVisual(state.visualEntryMap.get(state.selected), { deleted: false }));
byId('visual-reset').addEventListener('click', () => { const entry = state.visualEntryMap.get(state.selected); if (entry && !state.busy) editVisual(entry, { deleted: false, visible: entry.visible, ...(entry.icon !== undefined ? { icon: entry.icon } : {}) }); });
byId('icon-search').addEventListener('input', () => renderIconPalette());
byId('reset-entry').addEventListener('click', () => { const entry = state.entryMap.get(state.selected); if (entry) { editSelected(entry.text); byId('copy-edit').value = entry.text; } });
byId('reset-all').addEventListener('click', () => { state.drafts.clear(); state.visualDrafts.clear(); persist(); renderEditor(); renderList(); updateControls(); sendDrafts(); });
byId('clear-conflicts').addEventListener('click', () => { state.conflicts = []; state.visualConflicts = []; persist(); renderConflicts(); updateControls(); });
byId('clear-pick').addEventListener('click', () => { state.picked = null; renderList(); });
byId('reload-catalog').addEventListener('click', () => { void loadCatalog().catch(error => notify(error.message, 'error')); });
byId('reload-save-state').addEventListener('click', () => { state.savedFact = null; void refreshSavedStateQuietly(); });
byId('apply-changes').addEventListener('click', () => { void applyChanges(); }); byId('undo-batch').addEventListener('click', () => { void undoBatch(); });
byId('preview-scenario').addEventListener('change', () => {
  const scenario = state.scenarios.find(value => value.id === byId('preview-scenario').value);
  if (scenario?.route && state.routes.some(route => route.id === scenario.route)) byId('preview-route').value = scenario.route;
  else if (['auth', 'invite'].includes(byId('preview-route').value)) byId('preview-route').value = 'hub';
  void startPreview();
});
byId('preview-route').addEventListener('change', () => { void startPreview(); });
byId('reload-preview').addEventListener('click', () => { void startPreview(); }); byId('preview-size').addEventListener('change', resizePreview);
byId('pick-text').addEventListener('click', () => { state.picker = !state.picker; byId('pick-text').setAttribute('aria-pressed', String(state.picker)); sendDrafts(); });
byId('copy-preview').addEventListener('load', sendDrafts); window.addEventListener('resize', resizePreview); new ResizeObserver(resizePreview).observe(byId('preview-viewport').parentElement);
window.addEventListener('keydown', event => { if (event.ctrlKey && event.key === 'Enter' && !byId('apply-changes').disabled) { event.preventDefault(); void applyChanges(); } });
try { state.lastBatch = JSON.parse(localStorage.getItem(batchKey) ?? 'null'); } catch { /* There is no undo target. */ }
window.addEventListener('copy-workbench:transfer-busy', event => { state.transferBusy = event.detail?.busy === true; updateControls(); });
window.addEventListener('copy-workbench:stage-copy', event => {
  const detail = event.detail; if (!detail || !Array.isArray(detail.changes)) return;
  detail.promise = (async () => {
    if (state.busy) throw new Error('ذخیرهٔ قبلی هنوز تمام نشده است.');
    await loadCatalog();
    if (state.busy) throw new Error('ذخیرهٔ قبلی هنوز تمام نشده است.');
    const blocked = [], staged = [];
    for (const change of detail.changes) {
      const entry = state.entryMap.get(change?.id), existing = state.drafts.get(change?.id);
      if (!entry || entry.text !== change.expectedText || typeof change.text !== 'string' || validate(entry, change.text) || existing && existing.text !== change.text) { blocked.push(change.id); continue; }
      if (entry.text !== change.text) { state.drafts.set(entry.id, { id: entry.id, file: entry.file, original: entry.text, text: change.text, error: '' }); staged.push(entry.id); }
    }
    for (const change of detail.visualChanges ?? []) {
      const entry = state.visualEntryMap.get(change?.id), existing = state.visualDrafts.get(change?.id);
      if (!entry || !sameVisual({ visible: entry.visible, icon: entry.icon }, change.expected) || existing && !sameVisual(existing, change) || change.deleted && entry.deletable === false) { blocked.push(change.id); continue; }
      const validIcon = !Object.hasOwn(change, 'icon') || change.icon === null && entry.nativeIcon || state.iconOptions.some(icon => icon.id === change.icon);
      if (!validIcon) { blocked.push(change.id); continue; }
      state.visualDrafts.set(entry.id, { ...visualPayload(change), expected: change.expected, file: entry.file, label: entry.label, error: '' }); staged.push(entry.id);
    }
    persist(); renderList(); renderEditor(); updateControls(); sendDrafts();
    return { staged: staged.length, blocked };
  })();
});
void (async () => {
  try {
    const [, scenarios] = await Promise.all([loadCatalog(true), api('/__copy/scenarios')]); state.scenarios = scenarios.scenarios ?? []; state.routes = scenarios.routes ?? [];
    setOptions(byId('preview-scenario'), state.scenarios); setOptions(byId('preview-route'), state.routes); byId('preview-route').value = state.routes.some(route => route.id === 'hub') ? 'hub' : state.routes[0]?.id ?? '';
    updateControls(); await startPreview(); void refreshSavedStateQuietly();
  } catch (error) { notify(error.message, 'error'); byId('preview-state').textContent = 'اتصال به محیط محلی ممکن نیست'; }
})();
