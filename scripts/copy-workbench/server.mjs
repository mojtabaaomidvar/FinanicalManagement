import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative, dirname, extname, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { collectCatalog, prepareChanges } from './catalog.mjs';
import { collectVisualCatalog, collectIconOptions, prepareVisualChanges } from './visual-catalog.mjs';
import { createPortablePackage, preparePortableImport } from './portable-package.mjs';
import { collectPortableScreenshots } from './portable-screenshots.mjs';
import { renderInteractivePortable } from './portable-runtime.mjs';
import { atomicReplace } from './atomic-write.mjs';
import { SCENARIOS, ROUTES, createPreviewSession, handlePreviewRequest } from './fixtures.mjs';

const ownDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(ownDirectory, '../..');
const hash = text => createHash('sha256').update(text).digest('hex');
const jsonScript = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
class WorkbenchError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

function run(command, args, cwd) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-14000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? done(output) : reject(new WorkbenchError('BUILD_FAILED', 'بررسی کد موفق نبود؛ تغییر متن برگردانده شد.', 422)));
  });
}

async function within(base, path) {
  const actual = await realpath(path);
  const distance = relative(await realpath(base), actual);
  if (!distance || distance === '..' || distance.startsWith('..' + sep) || resolve(base, distance) !== actual) {
    throw new WorkbenchError('PATH_DENIED', 'مسیر فایل مجاز نیست.', 403);
  }
  return actual;
}

export async function createWorkbench({ root = defaultRoot, port = 5701, build, captureScreenshots = collectPortableScreenshots } = {}) {
  root = await realpath(root);
  const workDirectory = join(root, '.local-test', 'copy-workbench');
  const uiDirectory = join(root, 'tools', 'copy-workbench');
  const backupDirectory = join(workDirectory, 'backups');
  const buildDirectory = join(workDirectory, 'builds');
  const exportDirectory = join(workDirectory, 'portable-exports');
  await mkdir(backupDirectory, { recursive: true });
  await mkdir(buildDirectory, { recursive: true });
  await mkdir(exportDirectory, { recursive: true });
  const secret = randomBytes(32).toString('hex');
  let origin = `http://127.0.0.1:${port}`, activeBuild, activeBuildRevision, activeCompilerRevision, catalog, visualCatalog, busy = false, ready = false, initError, operation, latestBatch = null, history = [], restartClaim = null, restartTimer;
  const sessions = new Map(), knownBuilds = [], previewReplacements = new Map();
  const changeStreams = new Map();
  const status = () => ({ ready, busy, message: initError ?? operation?.message ?? (busy ? 'در حال بررسی و آماده‌سازی پیش‌نمایش…' : 'آماده'), entries: catalog?.entries.length ?? 0,
    sourceRevision: catalog?.revision ?? null, buildRevision: activeBuildRevision ?? null,
    previewCurrent: Boolean(catalog?.revision && activeBuildRevision === catalog.revision),
    operation: operation ?? null, latestBatch, restarting: Boolean(restartClaim), visualEntries: visualCatalog?.entries.length ?? 0 });
  const phase = (stage, message) => { operation = { ...operation, stage, message }; };

  async function readCatalog() {
    const text = await collectCatalog(root);
    const visual = await collectVisualCatalog(root, text);
    catalog = text; visualCatalog = visual;
    catalog.visualEntries = visual.entries;
    catalog.iconOptions = visual.icons;
    return catalog;
  }

  function claimRestart() {
    // There is no await between checking the mutation lock and claiming it.
    if (busy || (!ready && !initError)) throw new WorkbenchError('BUSY', 'عملیات قبلی هنوز تمام نشده است؛ اجرای دوباره باید صبر کند.', 409);
    const previousOperation = operation;
    restartClaim = { expiresAt: new Date(Date.now() + 5000).toISOString() };
    busy = true;
    operation = { kind: 'restart', startedAt: new Date().toISOString(), stage: 'claimed', message: 'در حال آماده‌سازی اجرای دوبارهٔ ویرایشگر…' };
    restartTimer = setTimeout(() => { restartClaim = null; restartTimer = undefined; busy = false; operation = previousOperation; }, 5000);
    restartTimer.unref?.();
    return { claimed: true, expiresAt: restartClaim.expiresAt };
  }

  async function refreshHistory() {
    const directories = (await readdir(backupDirectory, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && /^\d+-[\da-f]{16}$/.test(entry.name)).map(entry => entry.name).sort().reverse();
    const results = await Promise.allSettled(directories.map(async id => {
      const manifest = JSON.parse(await readFile(join(backupDirectory, id, 'manifest.json'), 'utf8'));
      if (manifest.id !== id || !manifest.completedAt || manifest.failedAt) return null;
      const files = (manifest.files ?? []).filter(file => typeof file.file === 'string' && /^(?:src\/|backend\/app\/|site\/|public\/|index\.html$)/.test(file.file));
      const changes = (manifest.changes ?? []).filter(change => typeof change.id === 'string' && typeof change.text === 'string' && typeof change.expectedText === 'string').map(change => {
        const entry = catalog?.entries.find(value => value.id === change.id);
        const file = entry?.file ?? files.find(value => change.id.startsWith(value.file + ':'))?.file ?? null;
        return { id: change.id, file, line: entry?.line ?? null, context: entry?.context ?? null, before: change.expectedText, after: change.text };
      });
      const visualChanges = (manifest.visualChanges ?? []).filter(change => typeof change.id === 'string' && change.expected && typeof change.visible === 'boolean').map(change => {
        const entry = visualCatalog?.entries.find(value => value.id === change.id);
        return { id: change.id, file: change.file ?? entry?.file ?? null, label: change.label ?? entry?.label ?? 'عنصر نمایشی',
          before: change.expected, after: { visible: change.visible, ...(change.deleted ? { deleted: true } : {}), ...(Object.hasOwn(change, 'icon') ? { icon: change.icon } : {}) } };
      });
      return { id, createdAt: manifest.createdAt, completedAt: manifest.completedAt, kind: manifest.restoreOf ? 'undo' : 'apply',
        restoreOf: manifest.restoreOf ?? null, count: changes.filter(change => change.before !== change.after).length + visualChanges.length,
        files: files.map(file => file.file), changes, visualChanges, hashes: files.map(file => ({ file: file.file, afterHash: file.afterHash })) };
    }));
    const completed = results.filter(result => result.status === 'fulfilled' && result.value).map(result => result.value);
    const latest = completed.find(batch => batch.kind === 'apply') ?? null;
    latestBatch = null;
    if (latest) {
      const undone = completed.some(batch => batch.kind === 'undo' && batch.restoreOf === latest.id);
      const matches = await Promise.allSettled(latest.hashes.map(async file => hash(await readFile(await within(root, resolve(root, file.file)), 'utf8')) === file.afterHash));
      const { hashes, ...record } = latest;
      latestBatch = { ...record, undone, sourceMatches: !undone && matches.every(result => result.status === 'fulfilled' && result.value) };
    }
    history = completed.slice(0, 12).map(({ hashes, ...batch }) => ({ ...batch, undone: batch.kind === 'apply' && completed.some(value => value.restoreOf === batch.id) }));
  }

  async function refreshStatus() {
    if (ready && !busy) await readCatalog();
    await refreshHistory();
    return status();
  }

  async function compilerRevision() {
    const fingerprint = createHash('sha256');
    for (const file of ['vite.config.ts', 'scripts/copy-workbench/catalog.mjs', 'scripts/copy-workbench/catalog-python.py', 'scripts/copy-workbench/visual-catalog.mjs', 'scripts/copy-workbench/instrument.mjs']) {
      let content;
      try { content = await readFile(join(root, file)); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      fingerprint.update(file).update('\0').update(content).update('\0');
    }
    return fingerprint.digest('hex');
  }

  async function buildPreview(revision) {
    const target = join(buildDirectory, Date.now() + '-' + randomBytes(4).toString('hex'));
    const compiler = await compilerRevision();
    if (build) await build(target);
    else {
      phase('checking', 'در حال بررسی کد…');
      await run(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-b'], root);
      phase('building', 'در حال ساخت پیش‌نمایش جدید…');
      await run(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'copy-workbench', '--outDir', target], root);
    }
    const source = await readFile(join(target, 'index.html'), 'utf8');
    if (!source.includes('محیط تست محلی') || /https:\/\/api\.khaanehyar\.ir/.test(source)) throw new WorkbenchError('BUILD_ENV', 'پیش‌نمایش باید از ساخت محلی برنامه باشد.', 500);
    activeBuild = target; activeBuildRevision = revision; activeCompilerRevision = compiler; knownBuilds.unshift(target);
    await writeFile(join(workDirectory, 'state.json'), JSON.stringify({ buildDirectory: relative(root, target), revision, compilerRevision: compiler }), 'utf8');
  }

  async function loadInitial() {
    busy = true;
    operation = { kind: 'initialize', startedAt: new Date().toISOString(), stage: 'catalog', message: 'در حال دریافت نوشته‌های برنامه…' };
    try {
      await readCatalog();
      try {
        const saved = JSON.parse(await readFile(join(workDirectory, 'state.json'), 'utf8'));
        const path = resolve(root, saved.buildDirectory);
        if (saved.revision === catalog.revision && saved.compilerRevision === await compilerRevision() && (await within(buildDirectory, path))) {
          await readFile(join(path, 'index.html')); activeBuild = path; activeBuildRevision = saved.revision; activeCompilerRevision = saved.compilerRevision; knownBuilds.push(path);
        }
      } catch { /* The first run or changed source needs a new preview build. */ }
      try {
        const replacements = JSON.parse(await readFile(join(workDirectory, 'preview-replacements.json'), 'utf8'));
        for (const [from, to] of replacements) previewReplacements.set(from, to);
      } catch { /* No prior source edits. */ }
      if (!activeBuild) await buildPreview(catalog.revision);
      await refreshHistory();
      ready = true;
      phase('complete', 'آماده');
    } catch (error) { initError = error.message; }
    finally { busy = false; }
  }

  async function transaction(files, changes, restoreOf, visualChanges = []) {
    const id = Date.now() + '-' + randomBytes(8).toString('hex');
    const backup = join(backupDirectory, id);
    await mkdir(backup);
    const manifest = { id, createdAt: new Date().toISOString(), changes, visualChanges, restoreOf, files: [] };
    operation = { ...operation, backupId: id };
    phase('backup', 'در حال نگهداری پشتیبان نوشته‌ها…');
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const absolute = await within(root, resolve(root, file.file));
      if (!/^(?:src\/|backend\/app\/|site\/|public\/|index\.html$)/.test(file.file.replaceAll('\\', '/'))) throw new WorkbenchError('PATH_DENIED', 'این فایل در محدودهٔ نوشته‌های برنامه نیست.', 403);
      if (await readFile(absolute, 'utf8') !== file.original) throw new WorkbenchError('SOURCE_CHANGED', 'فایل هم‌زمان تغییر کرده است؛ فهرست را دوباره دریافت کن.', 409);
      const snapshot = index + '.before.txt';
      await writeFile(join(backup, snapshot), file.original, 'utf8');
      manifest.files.push({ file: file.file, snapshot, beforeHash: hash(file.original), afterHash: hash(file.updated) });
    }
    await writeFile(join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    const written = [];
    try {
      phase('writing', restoreOf ? 'در حال بازگرداندن نوشته‌ها در کد…' : 'در حال ذخیرهٔ نوشته‌ها در کد…');
      for (const file of files) {
        const absolute = await within(root, resolve(root, file.file));
        if (await readFile(absolute, 'utf8') !== file.original) throw new WorkbenchError('SOURCE_CHANGED', 'فایل هم‌زمان تغییر کرده است؛ تغییرها اعمال نشدند.', 409);
        await atomicReplace(absolute, file.updated, file.original); written.push(file);
      }
      const next = await readCatalog();
      await buildPreview(next.revision);
      catalog = next;
      manifest.completedAt = new Date().toISOString();
      await writeFile(join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      return id;
    } catch (error) {
      let conflict = false;
      for (const file of written.reverse()) {
        const absolute = await within(root, resolve(root, file.file));
        if (await readFile(absolute, 'utf8') !== file.updated) { conflict = true; continue; }
        await atomicReplace(absolute, file.original, file.updated);
      }
      manifest.failedAt = new Date().toISOString(); manifest.rollbackConflict = conflict;
      await writeFile(join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      if (conflict) throw new WorkbenchError('ROLLBACK_CONFLICT', 'فایل هم‌زمان تغییر کرده است؛ پشتیبان تغییرها با شناسهٔ ' + id + ' نگه داشته شد.', 409);
      throw error;
    }
  }

  async function apply(request) {
    if (!ready || busy) throw new WorkbenchError('BUSY', 'بررسی قبلی هنوز تمام نشده است.', 409);
    busy = true;
    operation = { kind: 'apply', startedAt: new Date().toISOString(), count: (Array.isArray(request?.changes) ? request.changes.length : 0) + (Array.isArray(request?.visualChanges) ? request.visualChanges.length : 0), stage: 'validate', message: 'در حال بررسی ویرایش‌های پیشنهادی…' };
    try {
      if (!request || typeof request.revision !== 'string' || (request.changes !== undefined && !Array.isArray(request.changes)) || (request.visualChanges !== undefined && !Array.isArray(request.visualChanges))) throw new WorkbenchError('INVALID_CHANGES', 'فهرست تغییرها نامعتبر است.');
      const textChanges = request.changes ?? [], visualChanges = request.visualChanges ?? [];
      if (!textChanges.length && !visualChanges.length) throw new WorkbenchError('INVALID_CHANGES', 'تغییری برای اعمال انتخاب نشده است.');
      const before = await readCatalog(), beforeVisual = visualCatalog;
      const textFiles = textChanges.length ? await prepareChanges(root, before, { revision: request.revision, changes: textChanges }) : [];
      const visualFiles = visualChanges.length ? await prepareVisualChanges(root, beforeVisual, { revision: request.revision, changes: visualChanges }, { sourceOverrides: textFiles.filter(file => file.file.startsWith('src/')) }) : [];
      const merged = new Map(textFiles.map(file => [file.file, file]));
      for (const file of visualFiles) merged.set(file.file, file);
      const files = [...merged.values()];
      if (!files.length) { phase('complete', 'ویرایش تازه‌ای برای ذخیره وجود ندارد.'); return { applied: 0, revision: before.revision, sourceRevision: before.revision, buildRevision: activeBuildRevision, saved: true, built: activeBuildRevision === before.revision }; }
      const visualRecords = visualChanges.filter(change => {
        const entry = beforeVisual.entries.find(value => value.id === change.id);
        return entry && (change.deleted === true || entry.visible !== change.visible || (Object.hasOwn(change, 'icon') && entry.icon !== change.icon));
      }).map(change => { const entry = beforeVisual.entries.find(value => value.id === change.id); return { ...change, file: entry.file, label: entry.label }; });
      const backupId = await transaction(files, textChanges, undefined, visualRecords);
      for (const change of textChanges) previewReplacements.set(change.expectedText, change.text);
      let warning;
      try { await writeFile(join(workDirectory, 'preview-replacements.json'), JSON.stringify([...previewReplacements]), 'utf8'); }
      catch { warning = 'نوشته‌ها در کد ذخیره شدند؛ نگهداری جایگزینی پیام‌های نمونه کامل نشد.'; }
      try { await refreshHistory(); } catch { warning ??= 'نوشته‌ها در کد ذخیره شدند؛ دریافت سابقهٔ ویرایش نیاز به تلاش دوباره دارد.'; }
      phase('complete', 'تغییرها در کد ذخیره شدند و ساخت پیش‌نمایش تمام شد.');
      return { applied: textChanges.filter(c => c.text !== c.expectedText).length + visualRecords.length, revision: catalog.revision, sourceRevision: catalog.revision, buildRevision: activeBuildRevision, backupId, saved: true, built: true, ...(warning ? { warning } : {}) };
    } catch (error) {
      operation = { ...operation, stage: 'failed', message: error.message, error: error.code ?? 'WORKBENCH_ERROR' }; throw error;
    } finally { busy = false; }
  }

  async function exportPackage() {
    if (!ready || busy) throw new WorkbenchError('BUSY', 'عملیات قبلی هنوز تمام نشده است.', 409);
    busy = true;
    operation = { kind: 'package', startedAt: new Date().toISOString(), stage: 'catalog', message: 'در حال آماده‌سازی بستهٔ واگذاری متن‌ها…' };
    try {
      const before = await readCatalog();
      if (activeBuildRevision !== before.revision) throw new WorkbenchError('STALE_PREVIEW', 'ابتدا ویرایشگر را دوباره اجرا کن تا تصویرها با کد فعلی هماهنگ شوند.', 409);
      const interactive = await stat(join(root, 'src/main.tsx')).then(value => value.isFile(), () => false);
      const images = interactive ? [] : await captureScreenshots({ origin, root, catalog: before, onProgress: progress => phase('images', typeof progress === 'string' ? progress : 'تصویر ' + (progress.completed ?? 0) + ' از ' + (progress.total ?? 0) + '؛ ' + (progress.label ?? 'صفحهٔ نمونه')) });
      const current = await readCatalog();
      if (current.revision !== before.revision) throw new WorkbenchError('SOURCE_CHANGED', 'کد هنگام ساخت بسته تغییر کرده است؛ بسته را دوباره بساز.', 409);
      phase('packaging', 'در حال ساخت محیط مستقل و پیش‌نمایش تعاملی…');
      const font = await readFile(join(root, 'node_modules/vazirmatn/fonts/webfonts/Vazirmatn[wght].woff2')).catch(() => null);
      const order = entry => entry.file.includes('/pages/HubPage/') ? 0 : entry.file.includes('/features/auth/') ? 1 : entry.file.includes('/features/onboarding/') ? 2 : entry.file.includes('/pages/') ? 3 : entry.file.includes('/features/') ? 4 : entry.file.startsWith('src/') ? 5 : entry.file.startsWith('backend/') ? 7 : 6;
      const ordered = { ...before, entries: [...before.entries].sort((a, b) => order(a) - order(b)) };
      const portable = await createPortablePackage(root, ordered, { images, interactive, visualCatalog, ...(font ? { fontDataUrl: 'data:font/woff2;base64,' + font.toString('base64') } : {}) });
      const html = interactive ? await renderInteractivePortable(root, portable, { catalog: ordered, visualCatalog }) : (await readFile(join(uiDirectory, 'portable.html'), 'utf8')).replace('__PORTABLE_DATA__', () => jsonScript(portable));
      if ((await readCatalog()).revision !== before.revision) throw new WorkbenchError('SOURCE_CHANGED', 'کد هنگام ساخت بسته تغییر کرده است؛ بسته را دوباره بساز.', 409);
      await writeFile(join(exportDirectory, portable.packageId + '.html'), html, { encoding: 'utf8', flag: 'wx' });
      phase('complete', 'بستهٔ مستقل ویرایش بصری آماده شد.');
      return { packageId: portable.packageId, entries: portable.entries.length, visualEntries: portable.visualEntries?.length ?? 0, interactive, images: portable.images.length, downloadUrl: '/__copy/package/download/' + portable.packageId };
    } catch (error) { operation = { ...operation, stage: 'failed', message: error.status ? error.message : 'ساخت بستهٔ واگذاری کامل نشد؛ دوباره تلاش کن.' }; throw error; }
    finally { busy = false; }
  }

  async function undo(request) {
    if (!ready || busy) throw new WorkbenchError('BUSY', 'بررسی قبلی هنوز تمام نشده است.', 409);
    if (!/^[\d]+-[\da-f]{16}$/.test(request?.backupId ?? '')) throw new WorkbenchError('INVALID_BACKUP', 'شناسهٔ بازگردانی نامعتبر است.');
    busy = true;
    operation = { kind: 'undo', startedAt: new Date().toISOString(), stage: 'validate', message: 'در حال بررسی نسخهٔ پیش از ویرایش…' };
    try {
      const backup = await within(backupDirectory, join(backupDirectory, request.backupId));
      const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'));
      if (!manifest.completedAt || manifest.failedAt) throw new WorkbenchError('INVALID_BACKUP', 'این تغییر با موفقیت اعمال نشده است.');
      const files = [];
      for (const file of manifest.files) {
        const absolute = await within(root, resolve(root, file.file));
        const current = await readFile(absolute, 'utf8');
        if (hash(current) !== file.afterHash) throw new WorkbenchError('SOURCE_CHANGED', 'پس از این ویرایش، فایل دوباره تغییر کرده است؛ بازگردانی خودکار ممکن نیست.', 409);
        const snapshot = await within(backup, join(backup, file.snapshot));
        const original = await readFile(snapshot, 'utf8');
        if (hash(original) !== file.beforeHash) throw new WorkbenchError('INVALID_BACKUP', 'پشتیبان با نسخهٔ اصلی مطابقت ندارد.');
        files.push({ file: file.file, original: current, updated: original });
      }
      await transaction(files, [], manifest.id);
      for (const change of manifest.changes) previewReplacements.delete(change.expectedText);
      let warning;
      try { await writeFile(join(workDirectory, 'preview-replacements.json'), JSON.stringify([...previewReplacements]), 'utf8'); }
      catch { warning = 'نوشته‌ها بازگردانده شدند؛ نگهداری پیام‌های نمونه کامل نشد.'; }
      try { await refreshHistory(); } catch { warning ??= 'نوشته‌ها بازگردانده شدند؛ دریافت سابقهٔ ویرایش نیاز به تلاش دوباره دارد.'; }
      phase('complete', 'نوشته‌ها در کد بازگردانده شدند و ساخت پیش‌نمایش تمام شد.');
      return { restored: manifest.changes.length + (manifest.visualChanges?.length ?? 0), revision: catalog.revision, sourceRevision: catalog.revision, buildRevision: activeBuildRevision, saved: true, built: true, ...(warning ? { warning } : {}) };
    } catch (error) {
      operation = { ...operation, stage: 'failed', message: error.message, error: error.code ?? 'WORKBENCH_ERROR' }; throw error;
    } finally { busy = false; }
  }

  async function body(request) {
    if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) throw new WorkbenchError('CONTENT_TYPE', 'درخواست باید JSON باشد.', 415);
    const chunks = []; let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) throw new WorkbenchError('TOO_LARGE', 'تعداد تغییرها بیش از حد است.', 413);
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new WorkbenchError('INVALID_JSON', 'درخواست نامعتبر است.'); }
  }

  function send(response, code, content, headers = {}) {
    response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    response.end(JSON.stringify(content));
  }
  async function file(response, base, path) {
    let absolute;
    try { absolute = await within(base, resolve(base, path)); } catch { throw new WorkbenchError('NOT_FOUND', 'فایل یافت نشد.', 404); }
    const content = await readFile(absolute);
    response.writeHead(200, { 'Content-Type': mime[extname(absolute)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(content);
  }

  function updateFixtureCopy(value) {
    if (Array.isArray(value)) return value.map(updateFixtureCopy);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, text]) => [key,
      key === 'message' && typeof text === 'string' ? previewReplacements.get(text) ?? text : updateFixtureCopy(text)]));
    return value;
  }

  const server = http.createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host) throw new WorkbenchError('HOST_DENIED', 'این محیط فقط روی نشانی محلی خودش در دسترس است.', 403);
      const url = new URL(request.url, origin);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      if (url.pathname.startsWith('/__copy/') && !['GET', 'HEAD'].includes(request.method)) {
        if (request.headers.origin !== origin || request.headers['x-copy-workbench-token'] !== secret) throw new WorkbenchError('ORIGIN_DENIED', 'این تغییر باید از صفحهٔ ویرایش متن‌ها ارسال شود.', 403);
      }
      if (url.pathname === '/__copy/status' && request.method === 'GET') return send(response, 200, url.searchParams.get('quick') === '1' ? status() : await refreshStatus());
      if (url.pathname === '/__copy/history' && request.method === 'GET') { await refreshHistory(); return send(response, 200, { batches: history, latestBatch }); }
      if (url.pathname === '/__copy/restart-claim' && request.method === 'POST') { await body(request); return send(response, 200, claimRestart()); }
      if (url.pathname === '/__copy/catalog' && request.method === 'GET') {
        await readCatalog(); return send(response, 200, catalog);
      }
      if (url.pathname === '/__copy/sprite.svg' && request.method === 'GET') {
        const icons = await collectIconOptions(root);
        response.writeHead(200, { 'Content-Type': mime['.svg'], 'Cache-Control': 'no-store' }); return response.end(icons.sprite);
      }
      if (url.pathname === '/__copy/scenarios' && request.method === 'GET') return send(response, 200, { scenarios: SCENARIOS, routes: ROUTES });
      if (url.pathname === '/__copy/apply' && request.method === 'POST') return send(response, 200, await apply(await body(request)));
      if (url.pathname === '/__copy/undo' && request.method === 'POST') return send(response, 200, await undo(await body(request)));
      if (url.pathname === '/__copy/package/export' && request.method === 'POST') { await body(request); return send(response, 200, await exportPackage()); }
      if (url.pathname === '/__copy/package/import' && request.method === 'POST') {
        const input = await body(request);
        if (!ready || busy) throw new WorkbenchError('BUSY', 'عملیات قبلی هنوز تمام نشده است.', 409);
        const current = await readCatalog(); return send(response, 200, await preparePortableImport(root, current, input));
      }
      if (url.pathname.startsWith('/__copy/package/download/') && request.method === 'GET') {
        const id = url.pathname.slice('/__copy/package/download/'.length);
        if (!/^[a-f0-9]{32}$/.test(id)) throw new WorkbenchError('NOT_FOUND', 'بستهٔ واگذاری پیدا نشد.', 404);
        response.setHeader('Content-Disposition', 'attachment; filename="khaneyar-text-editor-' + id.slice(0, 8) + '.html"');
        return await file(response, exportDirectory, id + '.html');
      }
      if (url.pathname === '/__copy/preview' && request.method === 'POST') {
        const input = await body(request);
        if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
        const session = createPreviewSession(input.scenarioId, input.route);
        const id = randomBytes(16).toString('hex'); sessions.set(id, session);
        return send(response, 200, { url: '/preview/?session=' + id });
      }
      if (url.pathname.startsWith('/__copy/preview/') && request.method === 'GET') {
        const session = sessions.get(url.pathname.slice('/__copy/preview/'.length));
        if (!session) throw new WorkbenchError('NO_PREVIEW', 'پیش‌نمایش را دوباره باز کن.', 404);
        return send(response, 200, { scenario: session.scenario, route: session.route, routeMeta: session.routeInfo, credentials: session.credentials, allowedIconIds: visualCatalog?.icons.map(icon => icon.id) ?? [] });
      }
      if (url.pathname.startsWith('/api/v1/')) {
        const session = sessions.get(request.headers['x-copy-preview-session']);
        if (!session) throw new WorkbenchError('NO_PREVIEW', 'نشست پیش‌نمایش موجود نیست.', 401);
        if (url.pathname === '/api/v1/household/changes' && request.method === 'GET') {
          if (request.headers.authorization !== `Bearer ${session.token}`) return send(response, 401, { error:'UNAUTHORIZED' });
          response.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-store' });
          response.write('event: ready\ndata: {}\n\n');
          if (!changeStreams.has(session)) changeStreams.set(session, new Set());
          changeStreams.get(session).add(response);
          const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 12000);
          heartbeat.unref();
          response.on('close', () => { clearInterval(heartbeat); changeStreams.get(session)?.delete(response); });
          return;
        }
        const beforeChange = !['GET', 'HEAD'].includes(request.method) ? JSON.stringify(session.data) : null;
        const input = !['GET', 'HEAD'].includes(request.method) && /^application\/json\b/i.test(request.headers['content-type'] ?? '')
          ? await body(request) : undefined;
        if (input === undefined && !['GET', 'HEAD'].includes(request.method)) request.resume();
        const result = handlePreviewRequest(session, { method: request.method, path: url.pathname.slice('/api/v1'.length), query: url.searchParams, body: input });
        if (beforeChange !== null && result.status >= 200 && result.status < 300 && beforeChange !== JSON.stringify(session.data)) {
          for (const stream of changeStreams.get(session) ?? []) if (!stream.destroyed) stream.write('event: invalidate\ndata: {}\n\n');
        }
        if (result.delayMs) await new Promise(done => setTimeout(done, Math.min(result.delayMs, 30000)));
        if (result.raw && !response.destroyed) {
          response.writeHead(result.status, { 'Cache-Control': 'no-store', ...result.headers });
          response.end(result.body); return;
        }
        if (!response.destroyed) return send(response, result.status, updateFixtureCopy(result.body), result.headers);
        return;
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const source = await readFile(join(uiDirectory, 'index.html'), 'utf8');
        const config = `<script>window.__COPY_WORKBENCH__=${jsonScript({ csrfToken: secret, origin })};</script>`;
        response.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; font-src 'self'; base-uri 'none'" });
        return response.end(source.replace('</head>', config + '</head>'));
      }
      if (url.pathname.startsWith('/__copy/ui/')) return await file(response, uiDirectory, decodeURIComponent(url.pathname.slice('/__copy/ui/'.length)));
      if (url.pathname === '/workbench/Vazirmatn.woff2') return await file(response, join(root, 'node_modules', 'vazirmatn', 'fonts', 'webfonts'), 'Vazirmatn[wght].woff2');
      if (url.pathname.startsWith('/workbench/')) return await file(response, uiDirectory, decodeURIComponent(url.pathname.slice('/workbench/'.length)));
      if (url.pathname === '/__copy/font.woff2') return await file(response, join(root, 'node_modules', 'vazirmatn', 'fonts', 'webfonts'), 'Vazirmatn[wght].woff2');
      if (url.pathname === '/sw.js' || url.pathname === '/registerSW.js') return send(response, 404, { error: 'NO_WORKER' });
      if (url.pathname === '/preview/' || url.pathname === '/preview') {
        if (!ready) throw new WorkbenchError('BUILDING', status().message, 503);
        const id = url.searchParams.get('session'), session = sessions.get(id);
        if (!session) throw new WorkbenchError('NO_PREVIEW', 'پیش‌نمایش را از فهرست حالت‌ها باز کن.', 404);
        const source = await readFile(join(activeBuild, 'index.html'), 'utf8');
        const app = source.match(/<script\s+type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
        if (!app) throw new WorkbenchError('BUILD_ENV', 'ساخت برنامه آماده نیست.', 500);
        const bridge = `<script>window.__COPY_PREVIEW__=${jsonScript({ session: id, scenario: session.scenario, route: session.route, routeInfo: session.routeInfo, routeMeta: session.routeInfo, credentials: session.credentials, allowedIconIds: visualCatalog?.icons.map(icon => icon.id) ?? [] })};</script><script src="/__copy/ui/preview-bridge.js"></script><script type="module">await window.__COPY_PREVIEW_READY__;await import(${jsonScript(app[1])});</script>`;
        const html = source.replace(app[0], bridge).replace(/<script[^>]*src="\/registerSW\.js"[^>]*><\/script>/g, '');
        response.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; worker-src 'none'; base-uri 'none'" });
        return response.end(html);
      }
      if (ready && request.method === 'GET') {
        const path = decodeURIComponent(url.pathname).replace(/^\//, '');
        for (const directory of knownBuilds) {
          try { await file(response, directory, path); return; } catch (error) { if (error.status !== 404) throw error; }
        }
      }
      throw new WorkbenchError('NOT_FOUND', 'این مسیر موجود نیست.', 404);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) send(response, error.status ?? 500, { error: error.code ?? 'WORKBENCH_ERROR', message: error.status ? error.message : 'عملیات کامل نشد؛ دوباره تلاش کن.' });
    }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const initialized = loadInitial();
  return { server, origin, initialized, status, close: () => {
    clearTimeout(restartTimer);
    for (const streams of changeStreams.values()) for (const stream of streams) stream.end();
    changeStreams.clear();
    return new Promise(done => server.close(done));
  } };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const workbench = await createWorkbench();
  console.log('Copy workbench: ' + workbench.origin);
  await workbench.initialized;
  console.log(workbench.status().ready ? 'Copy workbench ready.' : 'Copy workbench initialization failed: ' + workbench.status().message);
}
