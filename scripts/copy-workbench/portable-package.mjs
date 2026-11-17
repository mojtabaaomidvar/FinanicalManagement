import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { CatalogError } from './catalog.mjs';

const PACKAGE_FORMAT = 'khaneyar-copy-package';
const RETURN_FORMAT = 'khaneyar-copy-edits';
const hexId = /^[a-f0-9]{32}$/;
const maxReturnBytes = 2 * 1024 * 1024;
const maxTextLength = 16000;
const knownSections = new Set(['خانه', 'مالی و گزارش‌ها', 'کیف پول', 'بودجه‌ها', 'قبوض', 'تقویم و مناسبت‌ها', 'خرید و انبار', 'کارهای خانه', 'اسناد خانه', 'برنامهٔ غذایی', 'وسایل خانه', 'خودرو', 'اهداف شخصی', 'برنامه‌های خانوادگی', 'فرزندان', 'حیوانات خانگی', 'بازار', 'پروفایل و تنظیمات', 'ورود و عضویت', 'شروع و نصب برنامه', 'اعلان‌ها', 'صفحه‌های معرفی و دریافت', 'پیام‌های سرور', 'اجزای مشترک برنامه']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const identifier = () => randomBytes(16).toString('hex');
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, status = 400) => { throw new CatalogError(code, message, status); };
const sectionLabel = value => knownSections.has(value) ? value : 'اجزای مشترک برنامه';
const editorSections = { HubPage: 'خانه', DashboardPage: 'خرج و درآمد', TransactionsPage: 'تراکنش‌ها', ReportsPage: 'گزارش‌ها', AccountsPage: 'کیف پول', BudgetsPage: 'بودجه‌ها', BillsPage: 'قبوض و شارژ', CalendarPage: 'تقویم', ShoppingPage: 'خرید', InventoryPage: 'انبار', TasksPage: 'کارهای خانه', DocumentsPage: 'اسناد', MealsPage: 'برنامهٔ غذایی', EquipmentPage: 'وسایل خانه', VehiclesPage: 'خودرو', GoalsPage: 'هدف‌ها و آرزوها', ActivitiesPage: 'برنامه‌های خانوادگی', ChildrenPage: 'فرزندان', PetsPage: 'حیوانات خانگی', MarketPage: 'بازار', SettingsPage: 'تنظیمات', auth: 'ورود و ثبت‌نام', onboarding: 'شروع برنامه', 'install-prompt': 'نصب برنامه', notifications: 'اعلان‌ها', shared: 'اجزای مشترک', backend: 'پیام‌های سرور' };
function editorSection(entry) {
  if (editorSections[entry.section]) return editorSections[entry.section];
  for (const [key, label] of Object.entries(editorSections)) if (entry.file?.includes('/' + key + '/')) return label;
  return sectionLabel(entry.section);
}
const safeLabel = (value, fallback) => typeof value === 'string' && value.length <= 180 && !/[\\/]|(?:^|\s)[A-Za-z]:|\b(?:src|backend|scripts|node_modules)\b|\.(?:tsx?|jsx?|py|mjs)\b/.test(value) ? value : fallback;
const displayKind = entry => entry.tokens?.length ? 'متن با مقدار متغیر' : String(entry.kind).includes('python') ? 'پیام سرور' : String(entry.kind).includes('attribute') ? 'راهنما و برچسب' : 'متن ثابت';
const tokenNames = entry => (entry.tokens ?? []).map(value => typeof value === 'string' ? value : value.token);
function validateTokens(text, expected) {
  const actual = [...text.matchAll(/\{slot\d+\}/g)].map(match => match[0]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('TEMPLATE_TOKENS', 'بخش‌های متغیر باید دقیقاً یک بار و با همان ترتیب باقی بمانند.');
}
function validateText(text) {
  if (typeof text !== 'string' || text.length > maxTextLength || text.includes('\0')) fail('INVALID_TEXT', 'متن ویرایش‌شده نامعتبر یا بیش از حد طولانی است.');
}
async function sourceHash(root, file) {
  if (typeof file !== 'string' || !/^(?:src\/|backend\/app\/|site\/|public\/|index\.html$)/.test(file) || file.includes('\\')) fail('PATH_DENIED', 'محل نوشته در پروژه معتبر نیست.', 403);
  const actual = await realpath(resolve(root, file));
  const distance = relative(root, actual);
  if (!distance || distance === '..' || distance.startsWith('..' + sep) || resolve(root, distance) !== actual) fail('PATH_DENIED', 'محل نوشته در پروژه معتبر نیست.', 403);
  return digest(await readFile(actual));
}
function rasterDataUrl(value) {
  if (typeof value !== 'string') fail('INVALID_PACKAGE_IMAGE', 'تصویر راهنما معتبر نیست.');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length > 12 * 1024 * 1024) fail('INVALID_PACKAGE_IMAGE', 'تصویر راهنما معتبر یا در اندازهٔ مجاز نیست.');
  const bytes = Buffer.from(match[2], 'base64');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : match[1] === 'jpeg' ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) fail('INVALID_PACKAGE_IMAGE', 'تصویر راهنما باید یک تصویر معمولی باشد.');
  return value;
}
function portableFont(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^data:(?:font\/woff2|application\/font-woff2);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 1024 * 1024) fail('INVALID_PACKAGE_FONT', 'قلم بستهٔ ویرایش معتبر نیست.');
  const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
  if (bytes.subarray(0, 4).toString() !== 'wOF2') fail('INVALID_PACKAGE_FONT', 'قلم بستهٔ ویرایش معتبر نیست.');
  return value;
}
const validRect = rect => isObject(rect) && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]) && rect[key] >= 0 && rect[key] <= 100000) && rect.width > 0 && rect.height > 0;

/** Build a source-free display package; source identities remain in a local private manifest. */
export async function createPortablePackage(workspaceRoot, catalog, { images = [], fontDataUrl, now, interactive = false, visualCatalog } = {}) {
  const root = await realpath(resolve(workspaceRoot));
  if (!catalog || typeof catalog.revision !== 'string' || !Array.isArray(catalog.entries) || !catalog.entries.length || catalog.entries.length > 10000 || !Array.isArray(images) || images.length > 250) fail('INVALID_PACKAGE', 'فهرست بستهٔ ویرایش معتبر نیست.');
  const packageId = identifier(), createdAt = new Date(now ?? Date.now()).toISOString();
  const mapping = [], entries = [], sourceToPublic = new Map(), fileHashes = new Map(), sectionOrdinals = new Map();
  for (const entry of catalog.entries) {
    if (entry.editable === false) continue;
    if (typeof entry.id !== 'string' || sourceToPublic.has(entry.id)) fail('INVALID_PACKAGE', 'شناسه‌های فهرست بسته معتبر نیستند.');
    validateText(entry.text);
    const tokens = tokenNames(entry);
    if (tokens.some(token => typeof token !== 'string' || !/^\{slot\d+\}$/.test(token))) fail('INVALID_PACKAGE', 'بخش‌های متغیر بسته معتبر نیستند.');
    validateTokens(entry.text, tokens);
    const id = identifier(), section = interactive ? editorSection(entry) : sectionLabel(entry.section), ordinal = (sectionOrdinals.get(section) ?? 0) + 1;
    sectionOrdinals.set(section, ordinal);
    if (!fileHashes.has(entry.file)) fileHashes.set(entry.file, await sourceHash(root, entry.file));
    sourceToPublic.set(entry.id, id);
    mapping.push({ id, sourceId: entry.id, file: entry.file, fileHash: fileHashes.get(entry.file), registered: entry.registered === true, original: entry.text, tokens });
    entries.push({ id, text: entry.text, section, kind: interactive ? entry.kind : displayKind(entry), label: displayKind(entry) + ' ' + new Intl.NumberFormat('fa-IR').format(ordinal), ...(interactive ? { context: safeLabel(entry.context, displayKind(entry)) } : {}), tokens: tokens.map(token => ({ token, example: 'نمونه' })), imageIds: [] });
  }
  const visualMapping = [], visualEntries = [];
  if (interactive && visualCatalog) for (const entry of visualCatalog.entries ?? []) {
    if (sourceToPublic.has(entry.id)) fail('INVALID_PACKAGE', 'شناسهٔ عنصر بسته تکراری است.');
    const id = identifier(); sourceToPublic.set(entry.id, id);
    if (!fileHashes.has(entry.file)) fileHashes.set(entry.file, await sourceHash(root, entry.file));
    visualMapping.push({ id, sourceId: entry.id, file: entry.file, fileHash: fileHashes.get(entry.file), expected: { visible: entry.visible, ...(entry.icon !== undefined ? { icon: entry.icon } : {}) }, nativeIcon: Boolean(entry.nativeIcon), deletable: entry.deletable !== false });
    visualEntries.push({ id, kind: entry.kind, section: editorSection({ ...entry, section: entry.section ?? catalog.entries.find(text => text.file === entry.file)?.section }), label: entry.label, context: safeLabel(entry.context, 'عنصر برنامه'), visible: entry.visible, ...(entry.icon !== undefined ? { icon: entry.icon } : {}), nativeIcon: Boolean(entry.nativeIcon), textEntryIds: (entry.textEntryIds ?? []).map(value => sourceToPublic.get(value)).filter(Boolean), deletable: entry.deletable !== false, ...(entry.deleteReason ? { deleteReason: entry.deleteReason } : {}) });
  }
  const entryByPublicId = new Map(entries.map(entry => [entry.id, entry])), imageIds = new Set();
  let imageBytes = 0;
  const publicImages = images.map((image, index) => {
    if (!isObject(image)) fail('INVALID_PACKAGE_IMAGE', 'تصویر راهنما معتبر نیست.');
    const id = typeof image.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(image.id) ? image.id : 'image-' + (index + 1);
    if (imageIds.has(id)) fail('INVALID_PACKAGE_IMAGE', 'شناسهٔ تصویر راهنما تکراری است.');
    imageIds.add(id);
    const dataUrl = rasterDataUrl(image.dataUrl); imageBytes += dataUrl.length;
    if (imageBytes > 64 * 1024 * 1024) fail('INVALID_PACKAGE_IMAGE', 'اندازهٔ مجموع تصویرهای راهنما بیش از حد است.');
    const regions = [];
    if (image.regions !== undefined && (!Array.isArray(image.regions) || image.regions.length > 2000)) fail('INVALID_PACKAGE_IMAGE', 'محل نوشته‌های تصویر معتبر نیست.');
    for (const region of image.regions ?? []) {
      if (!isObject(region) || !Array.isArray(region.sourceIds) || region.sourceIds.length > 50 || !validRect(region.rect)) fail('INVALID_PACKAGE_IMAGE', 'محل نوشته‌های تصویر معتبر نیست.');
      const entryIds = [...new Set(region.sourceIds.map(sourceId => sourceToPublic.get(sourceId)).filter(Boolean))];
      if (!entryIds.length) continue;
      regions.push({ entryIds, rect: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, region.rect[key]])) });
      for (const entryId of entryIds) { const entry = entryByPublicId.get(entryId); if (!entry.imageIds.includes(id)) entry.imageIds.push(id); }
    }
    return { id, label: safeLabel(image.label, 'نمای برنامه ' + new Intl.NumberFormat('fa-IR').format(index + 1)), section: sectionLabel(image.section), dataUrl, ...(regions.length ? { regions } : {}) };
  });
  const font = portableFont(fontDataUrl);
  const privateDirectory = join(root, '.local-test/copy-workbench/portable-packages');
  await mkdir(privateDirectory, { recursive: true });
  const version = interactive ? 2 : 1;
  await writeFile(join(privateDirectory, packageId + '.json'), JSON.stringify({ format: 'khaneyar-copy-package-private', version, packageId, createdAt, revision: catalog.revision, entries: mapping, ...(interactive ? { visualEntries: visualMapping } : {}) }, null, 2), { encoding: 'utf8', flag: 'wx' });
  return { format: PACKAGE_FORMAT, version, packageId, createdAt, title: 'ویرایش بصری خانه‌یار', entries, images: publicImages, ...(interactive ? { revision: packageId, visualEntries, iconOptions: visualCatalog?.icons ?? [], sprite: visualCatalog?.sprite ?? '' } : {}), ...(font ? { fontDataUrl: font } : {}) };
}

/** Validate returned edits and stage local source IDs without writing any application source. */
export async function preparePortableImport(workspaceRoot, catalog, returnFile) {
  const root = await realpath(resolve(workspaceRoot));
  let result;
  try {
    const serialized = typeof returnFile === 'string' ? returnFile : JSON.stringify(returnFile);
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > maxReturnBytes) fail('INVALID_PORTABLE_RETURN', 'فایل ویرایش نامعتبر یا بیش از حد بزرگ است.');
    result = typeof returnFile === 'string' ? JSON.parse(serialized) : returnFile;
  } catch (error) { if (error instanceof CatalogError) throw error; fail('INVALID_PORTABLE_RETURN', 'فایل ویرایش خوانده نشد.'); }
  if (!isObject(result) || Object.keys(result).some(key => !['format', 'version', 'packageId', 'changes', ...(result.version === 2 ? ['visualChanges'] : [])].includes(key)) || result.format !== RETURN_FORMAT || ![1, 2].includes(result.version) || !hexId.test(result.packageId ?? '') || !Array.isArray(result.changes) || result.changes.length > 10000 || result.version === 2 && (!Array.isArray(result.visualChanges) || result.visualChanges.length > 10000)) fail('INVALID_PORTABLE_RETURN', 'ساختار فایل ویرایش معتبر نیست.');
  if (!catalog || typeof catalog.revision !== 'string' || !Array.isArray(catalog.entries)) fail('INVALID_PACKAGE', 'فهرست فعلی نوشته‌ها معتبر نیست.');
  let manifest;
  try { manifest = JSON.parse(await readFile(join(root, '.local-test/copy-workbench/portable-packages', result.packageId + '.json'), 'utf8')); }
  catch { fail('UNKNOWN_PORTABLE_PACKAGE', 'این بسته در این پروژه ساخته نشده است؛ فایل اصلی بسته را بررسی کن.', 404); }
  if (manifest.format !== 'khaneyar-copy-package-private' || manifest.version !== result.version || manifest.packageId !== result.packageId || !Array.isArray(manifest.entries)) fail('INVALID_PACKAGE', 'اطلاعات محلی بستهٔ ویرایش معتبر نیست.');
  const mapping = new Map(manifest.entries.map(entry => [entry.id, entry])), currentEntries = new Map(catalog.entries.map(entry => [entry.id, entry]));
  const changes = [], conflicts = [], seen = new Set(), currentHashes = new Map();
  let unchanged = 0;
  for (const change of result.changes) {
    if (!isObject(change) || Object.keys(change).some(key => !['id', 'text'].includes(key)) || !hexId.test(change.id ?? '')) fail('INVALID_PORTABLE_RETURN', 'شناسهٔ یکی از ویرایش‌ها معتبر نیست.');
    if (seen.has(change.id)) fail('DUPLICATE_CHANGE', 'یک نوشته چند بار در فایل ویرایش آمده است.');
    seen.add(change.id); validateText(change.text);
    const original = mapping.get(change.id);
    if (!original) fail('UNKNOWN_ENTRY', 'یکی از نوشته‌ها متعلق به این بسته نیست.');
    validateTokens(change.text, original.tokens);
    const current = currentEntries.get(original.sourceId);
    if (current?.file === original.file && current.text === change.text) { unchanged++; continue; }
    if (change.text === original.original) { unchanged++; continue; }
    let reason;
    if (!current || current.file !== original.file) reason = 'محل این نوشته در پروژه تغییر کرده یا حذف شده است.';
    else if (current.text !== original.original) reason = 'متن این نوشته پس از ساخت بسته تغییر کرده است.';
    else if (!original.registered && manifest.revision !== catalog.revision) {
      if (!currentHashes.has(original.file)) currentHashes.set(original.file, await sourceHash(root, original.file));
      if (currentHashes.get(original.file) !== original.fileHash) reason = 'محل این نوشته پس از ساخت بسته نیاز به بررسی دوباره دارد.';
    }
    if (reason) { conflicts.push({ id: original.sourceId, before: original.original, after: change.text, current: current?.text ?? null, reason }); continue; }
    if (JSON.stringify(tokenNames(current)) !== JSON.stringify(original.tokens)) { conflicts.push({ id: original.sourceId, before: original.original, after: change.text, current: current.text, reason: 'بخش‌های متغیر این نوشته پس از ساخت بسته تغییر کرده‌اند.' }); continue; }
    changes.push({ id: original.sourceId, expectedText: current.text, text: change.text });
  }
  const visualChanges = [];
  const visualMapping = new Map((manifest.visualEntries ?? []).map(entry => [entry.id, entry]));
  const currentVisuals = new Map((catalog.visualEntries ?? []).map(entry => [entry.id, entry]));
  const iconIds = new Set((catalog.iconOptions ?? []).map(icon => icon.id));
  for (const change of result.visualChanges ?? []) {
    if (!isObject(change) || Object.keys(change).some(key => !['id', 'visible', 'icon', 'deleted'].includes(key)) || !hexId.test(change.id ?? '') || typeof change.visible !== 'boolean' || Object.hasOwn(change, 'deleted') && typeof change.deleted !== 'boolean') fail('INVALID_PORTABLE_RETURN', 'تغییر عنصر نامعتبر است.');
    if (seen.has(change.id)) fail('DUPLICATE_CHANGE', 'یک عنصر چند بار در فایل آمده است.');
    seen.add(change.id);
    const original = visualMapping.get(change.id);
    if (!original) fail('UNKNOWN_ENTRY', 'این عنصر متعلق به بسته نیست.');
    const current = currentVisuals.get(original.sourceId);
    if (change.deleted && !original.deletable) fail('INVALID_VISUAL_CHANGES', 'این عنصر امکان حذف مستقل ندارد.');
    if (Object.hasOwn(change, 'icon') && change.icon !== null && !iconIds.has(change.icon) || change.icon === null && !original.nativeIcon || Object.hasOwn(change, 'icon') && current && current.kind !== 'icon') fail('INVALID_VISUAL_CHANGES', 'آیکون پیشنهادی معتبر نیست.');
    let reason;
    if (!current || current.file !== original.file) reason = 'محل این عنصر در پروژه تغییر کرده یا حذف شده است.';
    else if (current.visible !== original.expected.visible || (current.icon ?? '') !== (original.expected.icon ?? '')) reason = 'وضعیت این عنصر پس از ساخت بسته تغییر کرده است.';
    else {
      if (!currentHashes.has(original.file)) currentHashes.set(original.file, await sourceHash(root, original.file));
      if (currentHashes.get(original.file) !== original.fileHash) reason = 'کد این عنصر پس از ساخت بسته تغییر کرده است؛ بستهٔ تازه بساز.';
    }
    const desired = { visible: change.visible, ...(Object.hasOwn(change, 'icon') ? { icon: change.icon } : {}), ...(change.deleted ? { deleted: true } : {}) };
    if (reason) { conflicts.push({ id: original.sourceId, kind: 'visual', before: original.expected, after: desired, current: current ? { visible: current.visible, icon: current.icon } : null, reason }); continue; }
    if (!desired.deleted && desired.visible === current.visible && (!Object.hasOwn(desired, 'icon') || desired.icon === current.icon)) { unchanged++; continue; }
    visualChanges.push({ id: original.sourceId, expected: original.expected, ...desired });
  }
  return { packageId: result.packageId, createdAt: manifest.createdAt, revision: catalog.revision, changes, ...(result.version === 2 ? { visualChanges } : {}), conflicts, unchanged };
}
