import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createWorkbench } from './server.mjs';
import { request as httpRequest } from 'node:http';
import ts from 'typescript';

async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'copy-workbench-test-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'tools', 'copy-workbench'), { recursive: true });
  await writeFile(join(root, 'tools', 'copy-workbench', 'index.html'), '<html><head></head><body>ویرایشگر</body></html>');
  await writeFile(join(root, 'src', 'sample.tsx'), 'export const Screen = () => <h1>خانهٔ نمونه</h1>;\n');
  await writeFile(join(root, 'src', 'labels.ts'), 'export const label = "پیام نمونه";\n');
  let failBuild = false;
  let buildGate = null;
  const workbench = await createWorkbench({ root, port: 0, build: async target => {
    if (buildGate) await buildGate.promise;
    if (failBuild) throw Object.assign(new Error('نسخه نامعتبر'), { status: 422, code: 'BUILD_FAILED' });
    await mkdir(join(target, 'assets'), { recursive: true });
    await writeFile(join(target, 'index.html'), '<html><title>محیط تست محلی</title><script type="module" src="/assets/app.js"></script><script src="/registerSW.js"></script><body>نمونه</body></html>');
    await writeFile(join(target, 'assets', 'app.js'), 'window.sample=true;');
  }, ...options });
  await workbench.initialized;
  assert.equal(workbench.status().ready, true);
  const html = await (await fetch(workbench.origin)).text();
  const config = JSON.parse(html.match(/window\.__COPY_WORKBENCH__=(.+?);<\/script>/)[1]);
  const headers = { Origin: workbench.origin, 'Content-Type': 'application/json', 'X-Copy-Workbench-Token': config.csrfToken };
  const request = async (path, body, extra = {}) => fetch(workbench.origin + path, {
    method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body),
  });
  const catalog = async () => (await fetch(workbench.origin + '/__copy/catalog')).json();
  const change = (data, file, text) => {
    const entry = data.entries.find(entry => entry.file === file);
    assert.ok(entry);
    return { id: entry.id, expectedText: entry.text, text };
  };
  return { root, workbench, headers, request, catalog, change,
    fail: () => { failBuild = true; },
    hold: () => { let release; const promise = new Promise(done => { release = done; }); buildGate = { promise }; return () => { buildGate = null; release(); }; },
    async close() {
      await workbench.close();
      // Recursive cleanup is restricted to the exact directory just created by mkdtemp.
      assert.equal(dirname(resolve(root)), resolve(tmpdir()));
      assert.ok(resolve(root).split(/[\\/]/).at(-1).startsWith('copy-workbench-test-'));
      await rm(root, { recursive: true, force: true });
    } };
}

test('portable package export downloads source-free HTML and returned edits stage without source writes', async () => {
  const f = await fixture({ captureScreenshots: async () => [] });
  try {
    await writeFile(join(f.root, 'tools/copy-workbench/portable.html'), '<html><script id="copy-package" type="application/json">__PORTABLE_DATA__</script></html>');
    const before = await readFile(join(f.root, 'src/sample.tsx'));
    const response = await f.request('/__copy/package/export', {}); const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
    const downloaded = await fetch(f.workbench.origin + result.downloadUrl); assert.equal(downloaded.status, 200); assert.match(downloaded.headers.get('content-disposition'), /attachment/);
    const html = await downloaded.text(); assert.ok(!html.includes('src/sample.tsx')); assert.ok(!html.includes('export const Screen'));
    const data = JSON.parse(html.match(/type="application\/json">([\s\S]+?)<\/script>/)[1]); assert.equal(data.packageId, result.packageId);
    const entry = data.entries.find(value => value.text === 'خانهٔ نمونه'); assert.ok(entry); assert.match(entry.id, /^[a-f0-9]{32}$/);
    const returned = { format: 'khaneyar-copy-edits', version: 1, packageId: data.packageId, changes: [{ id: entry.id, text: 'Home $& <script>plain</script>' }] };
    const imported = await f.request('/__copy/package/import', returned); assert.equal(imported.status, 200); const staged = await imported.json(); assert.equal(staged.changes.length, 1); assert.equal(staged.changes[0].text, returned.changes[0].text);
    assert.deepEqual(await readFile(join(f.root, 'src/sample.tsx')), before);
    const forbidden = await f.request('/__copy/package/import', returned, { Origin: 'https://foreign.example' }); assert.equal(forbidden.status, 403);
    const traversal = await fetch(f.workbench.origin + '/__copy/package/download/unknown'); assert.equal(traversal.status, 404);
  } finally { await f.close(); }
});

test('source Apply cannot race screenshot package creation and export failure always releases its lock', async () => {
  let release, fail = false;
  const gate = new Promise(done => { release = done; });
  const f = await fixture({ captureScreenshots: async () => { await gate; if (fail) throw new Error('test screenshot error'); return []; } });
  try {
    await writeFile(join(f.root, 'tools/copy-workbench/portable.html'), '<html><script type="application/json">__PORTABLE_DATA__</script></html>');
    const data = await f.catalog(), pending = f.request('/__copy/package/export', {});
    for (let i = 0; i < 100; i++) { if (f.workbench.status().busy && f.workbench.status().operation?.kind === 'package') break; await new Promise(done => setTimeout(done, 10)); }
    assert.equal(f.workbench.status().busy, true);
    const rejected = await f.request('/__copy/apply', { revision: data.revision, changes: [f.change(data, 'src/sample.tsx', 'new')] }); assert.equal(rejected.status, 409);
    fail = true; release(); const failed = await pending; assert.equal(failed.status, 500); assert.equal(f.workbench.status().busy, false);
    assert.equal((await f.request('/__copy/apply', { revision: data.revision, changes: [f.change(data, 'src/sample.tsx', 'new')] })).status, 200);
  } finally { release(); await f.close(); }
});

const visualChange = (entry, desired) => ({ id: entry.id, expected: { visible: entry.visible, ...(entry.kind === 'icon' ? { icon: entry.icon } : {}) }, visible: entry.visible, ...desired });

test('real source deletion saves atomically, removes catalog entries and undo restores exact files', async () => {
  const f = await fixture();
  try {
    await addVisualFixture(f);
    const original = await readFile(join(f.root, 'src/sample.tsx'));
    const data = await f.catalog(), heading = data.visualEntries.find(entry => entry.kind === 'text-element'), icon = data.visualEntries.find(entry => entry.kind === 'icon');
    const response = await f.request('/__copy/apply', { revision: data.revision,
      changes: [f.change(data, 'src/sample.tsx', 'English title')],
      visualChanges: [visualChange(heading, { deleted: true }), visualChange(icon, { deleted: true })] });
    const saved = await response.json(); assert.equal(response.status, 200, JSON.stringify(saved)); assert.equal(saved.applied, 3);
    const updated = await readFile(join(f.root, 'src/sample.tsx'), 'utf8');
    assert.doesNotMatch(updated, /<h1>|English title|خانهٔ نمونه|@copy-|name="i-home"|className="glyph"/);
    assert.match(updated, /user\.name/); assert.match(updated, /onClick=\{save\}/);
    const next = await f.catalog(); assert.equal(next.visualEntries.length, 0);
    const status = await (await fetch(f.workbench.origin + '/__copy/status')).json();
    assert.equal(status.latestBatch.visualChanges.length, 2); assert.ok(status.latestBatch.visualChanges.every(change => change.after.deleted));
    const undone = await f.request('/__copy/undo', { backupId: saved.backupId }); assert.equal(undone.status, 200);
    assert.deepEqual(await readFile(join(f.root, 'src/sample.tsx')), original);
  } finally { await f.close(); }
});

test('failed source deletion restores bytes and stale or invalid deletion requests cannot write', async () => {
  const f = await fixture();
  try {
    await addVisualFixture(f);
    const original = await readFile(join(f.root, 'src/sample.tsx')), data = await f.catalog(), heading = data.visualEntries.find(entry => entry.kind === 'text-element');
    const invalid = await f.request('/__copy/apply', { revision: data.revision, visualChanges: [visualChange(heading, { deleted: 'yes' })] });
    assert.equal(invalid.status, 400); assert.deepEqual(await readFile(join(f.root, 'src/sample.tsx')), original);
    f.fail();
    const failed = await f.request('/__copy/apply', { revision: data.revision, visualChanges: [visualChange(heading, { deleted: true })] });
    assert.equal(failed.status, 422); assert.deepEqual(await readFile(join(f.root, 'src/sample.tsx')), original);
    assert.ok((await f.catalog()).visualEntries.some(entry => entry.id === heading.id));
  } finally { await f.close(); }
});

async function addVisualFixture(f) {
  await writeFile(join(f.root, 'index.html'), '<svg><symbol id="i-home"><path d="M1 1"/></symbol><symbol id="i-cart"><path d="M2 2"/></symbol></svg><p>راهنمای سایت</p>');
  await writeFile(join(f.root, 'src/sample.tsx'), 'export const Screen = ({user}) => <section><h1>خانهٔ نمونه</h1><span>{user.name}</span><button onClick={save} aria-label="ثبت"><span className="glyph"><Icon name="i-home"/></span></button></section>;\n');
}

test('mixed text and visual edits across app and HTML sources save atomically and undo exact bytes', async () => {
  const f = await fixture();
  try {
    await addVisualFixture(f);
    const files = ['src/sample.tsx', 'index.html'], originals = await Promise.all(files.map(file => readFile(join(f.root, file))));
    const data = await f.catalog(), heading = data.visualEntries.find(entry => entry.kind === 'text-element'), icon = data.visualEntries.find(entry => entry.kind === 'icon');
    assert.ok(heading); assert.ok(icon); assert.equal(data.iconOptions.length, 2);
    const response = await f.request('/__copy/apply', { revision: data.revision,
      changes: [f.change(data, 'src/sample.tsx', ''), f.change(data, 'index.html', 'Site help')],
      visualChanges: [visualChange(heading, { visible: false }), visualChange(icon, { icon: 'i-cart' })] });
    const saved = await response.json(); assert.equal(response.status, 200, JSON.stringify(saved)); assert.equal(saved.applied, 4); assert.equal(saved.built, true);
    const updated = await readFile(join(f.root, 'src/sample.tsx'), 'utf8');
    assert.match(updated, /false && <h1>/); assert.match(updated, /name="i-cart"/); assert.match(updated, /user\.name/); assert.match(updated, /<button onClick=\{save\}/);
    assert.match(await readFile(join(f.root, 'index.html'), 'utf8'), /Site help/);
    const next = await f.catalog();
    assert.equal(next.visualEntries.find(entry => entry.id === heading.id).visible, false);
    assert.equal(next.visualEntries.find(entry => entry.id === icon.id).icon, 'i-cart');
    const status = await (await fetch(f.workbench.origin + '/__copy/status')).json();
    assert.equal(status.latestBatch.count, 4); assert.equal(status.latestBatch.visualChanges.length, 2); assert.equal(status.latestBatch.sourceMatches, true);
    const undone = await f.request('/__copy/undo', { backupId: saved.backupId });
    assert.equal(undone.status, 200); assert.equal((await undone.json()).restored, 4);
    for (let i = 0; i < files.length; i++) assert.deepEqual(await readFile(join(f.root, files[i])), originals[i]);
  } finally { await f.close(); }
});

test('visual-only saves preserve hidden identity, reject stale/icon forgeries and rollback failed builds', async () => {
  const f = await fixture();
  try {
    await addVisualFixture(f);
    const initial = await f.catalog(), icon = initial.visualEntries.find(entry => entry.kind === 'icon');
    const before = await readFile(join(f.root, 'src/sample.tsx'));
    const forged = await f.request('/__copy/apply', { revision: initial.revision, visualChanges: [visualChange(icon, { icon: 'https://foreign.example/icon.svg' })] });
    assert.equal(forged.status, 400); assert.deepEqual(await readFile(join(f.root, 'src/sample.tsx')), before);
    const applied = await f.request('/__copy/apply', { revision: initial.revision, visualChanges: [visualChange(icon, { visible: false })] });
    const saved = await applied.json(); assert.equal(applied.status, 200, JSON.stringify(saved)); assert.equal(saved.applied, 1);
    const next = await f.catalog(), hidden = next.visualEntries.find(entry => entry.id === icon.id); assert.equal(hidden.visible, false); assert.equal(hidden.icon, 'i-home');
    const stale = await f.request('/__copy/apply', { revision: initial.revision, visualChanges: [visualChange(icon, { visible: true })] }); assert.equal(stale.status, 409);
    const hiddenBytes = await readFile(join(f.root, 'src/sample.tsx')); f.fail();
    const failed = await f.request('/__copy/apply', { revision: next.revision, visualChanges: [visualChange(hidden, { visible: true, icon: 'i-cart' })] }); assert.equal(failed.status, 422);
    assert.deepEqual(await readFile(join(f.root, 'src/sample.tsx')), hiddenBytes);
    const status = await (await fetch(f.workbench.origin + '/__copy/status')).json(); assert.equal(status.latestBatch.id, saved.backupId); assert.equal(status.previewCurrent, true);
    assert.equal((await f.catalog()).visualEntries.find(entry => entry.id === icon.id).visible, false);
  } finally { await f.close(); }
});

test('source writes require the local editor origin, secret and JSON content type', async () => {
  const f = await fixture();
  try {
    const before = await readFile(join(f.root, 'src', 'sample.tsx'), 'utf8');
    const data = await f.catalog(), payload = { revision: data.revision, changes: [f.change(data, 'src/sample.tsx', 'ویرایش')] };
    assert.equal((await f.request('/__copy/apply', payload, { Origin: 'https://foreign.example' })).status, 403);
    assert.equal((await f.request('/__copy/apply', payload, { 'X-Copy-Workbench-Token': 'wrong' })).status, 403);
    assert.equal((await f.request('/__copy/apply', payload, { 'Content-Type': 'text/plain' })).status, 415);
    const hostStatus = await new Promise((done, reject) => {
      const req = httpRequest(f.workbench.origin + '/__copy/catalog', { headers: { Host: 'foreign.example' } }, response => {
        response.resume(); response.on('end', () => done(response.statusCode));
      });
      req.on('error', reject); req.end();
    });
    assert.equal(hostStatus, 403);
    assert.equal(await readFile(join(f.root, 'src', 'sample.tsx'), 'utf8'), before);
  } finally { await f.close(); }
});

test('saved edits and build revisions remain inspectable after restart and later manual source changes', async () => {
  const f = await fixture(); let restarted;
  try {
    const data = await f.catalog(), change = f.change(data, 'src/sample.tsx', 'عنوان ذخیره‌شده');
    const response = await f.request('/__copy/apply', { revision: data.revision, changes: [change] });
    const saved = await response.json(); assert.equal(response.status, 200); assert.equal(saved.saved, true);
    const status = await (await fetch(f.workbench.origin + '/__copy/status')).json();
    assert.equal(status.sourceRevision, saved.revision); assert.equal(status.buildRevision, saved.revision); assert.equal(status.previewCurrent, true);
    assert.equal(status.latestBatch.id, saved.backupId); assert.equal(status.latestBatch.count, 1); assert.equal(status.latestBatch.sourceMatches, true);
    assert.deepEqual(status.latestBatch.files, ['src/sample.tsx']);
    assert.equal(status.latestBatch.changes[0].before, change.expectedText); assert.equal(status.latestBatch.changes[0].after, change.text);
    const history = await (await fetch(f.workbench.origin + '/__copy/history')).json();
    assert.equal(history.batches[0].id, saved.backupId); assert.ok(!JSON.stringify(history).includes('beforeHash')); assert.ok(!JSON.stringify(history).includes('snapshot'));
    await f.workbench.close();
    restarted = await createWorkbench({ root: f.root, port: 0, build: async () => { throw new Error('A matching valid preview must be reused'); } }); await restarted.initialized;
    const durable = await (await fetch(restarted.origin + '/__copy/status')).json(); assert.equal(durable.latestBatch.id, saved.backupId); assert.equal(durable.previewCurrent, true);
    await writeFile(join(f.root, 'src', 'sample.tsx'), 'export const Screen = () => <h1>ویرایش دستی تازه</h1>;\n');
    const changed = await (await fetch(restarted.origin + '/__copy/status')).json();
    assert.equal(changed.latestBatch.id, saved.backupId); assert.equal(changed.latestBatch.sourceMatches, false); assert.equal(changed.previewCurrent, false); assert.notEqual(changed.sourceRevision, changed.buildRevision);
  } finally { await restarted?.close(); await f.close(); }
});

test('busy responses identify the running save while history excludes pending and failed operations', async () => {
  const f = await fixture(); let release;
  try {
    const data = await f.catalog(), payload = { revision: data.revision, changes: [f.change(data, 'src/sample.tsx', 'عنوان تازه')] };
    release = f.hold(); const pending = f.request('/__copy/apply', payload);
    let status;
    for (let count = 0; count < 50; count++) { status = await (await fetch(f.workbench.origin + '/__copy/status')).json(); if (status.busy && status.operation?.backupId) break; await new Promise(done => setTimeout(done, 10)); }
    assert.equal(status.busy, true); assert.equal(status.operation.kind, 'apply'); assert.equal(status.latestBatch, null);
    const busy = await f.request('/__copy/apply', payload); assert.equal(busy.status, 409); assert.equal((await busy.json()).error, 'BUSY');
    assert.equal((await (await fetch(f.workbench.origin + '/__copy/history')).json()).batches.length, 0);
    release(); release = null; const done = await pending; assert.equal(done.status, 200);
    const fresh = await f.catalog(); f.fail();
    const failed = await f.request('/__copy/apply', { revision: fresh.revision, changes: [f.change(fresh, 'src/sample.tsx', 'ویرایش نامعتبر')] }); assert.equal(failed.status, 422);
    const final = await (await fetch(f.workbench.origin + '/__copy/history')).json(); assert.equal(final.batches.length, 1); assert.equal(final.latestBatch.count, 1);
  } finally { release?.(); await f.close(); }
});

test('unchanged app source cannot reuse a preview after its compiler configuration changes', async () => {
  const f = await fixture(); let restarted;
  try {
    const before = JSON.parse(await readFile(join(f.root, '.local-test/copy-workbench/state.json'), 'utf8'));
    assert.match(before.compilerRevision, /^[\da-f]{64}$/);
    await writeFile(join(f.root, 'vite.config.ts'), 'export default { define: { copyCompilerVersion: 2 } };\n');
    const unchanged = await f.catalog(); assert.equal(unchanged.revision, before.revision);
    await f.workbench.close(); let rebuilds = 0;
    restarted = await createWorkbench({ root: f.root, port: 0, build: async target => {
      rebuilds++; await mkdir(join(target, 'assets'), { recursive: true });
      await writeFile(join(target, 'index.html'), '<html><title>محیط تست محلی</title><script type="module" src="/assets/app.js"></script></html>');
      await writeFile(join(target, 'assets/app.js'), 'window.updatedCompiler=true;');
    } }); await restarted.initialized;
    assert.equal(restarted.status().ready, true); assert.equal(rebuilds, 1);
    const after = JSON.parse(await readFile(join(f.root, '.local-test/copy-workbench/state.json'), 'utf8'));
    assert.equal(after.revision, before.revision); assert.notEqual(after.compilerRevision, before.compilerRevision); assert.notEqual(after.buildDirectory, before.buildDirectory);
  } finally { await restarted?.close(); await f.close(); }
});

test('a protected restart claim blocks mutations and releases itself if the launcher does not stop', async () => {
  const f = await fixture();
  try {
    const data = await f.catalog(), payload = { revision: data.revision, changes: [f.change(data, 'src/sample.tsx', 'عنوان تازه')] };
    const before = await readFile(join(f.root, 'src/sample.tsx'), 'utf8');
    assert.equal((await f.request('/__copy/restart-claim', {}, { Origin: 'https://foreign.example' })).status, 403);
    const response = await f.request('/__copy/restart-claim', {}); assert.equal(response.status, 200); assert.equal((await response.json()).claimed, true);
    const status = await (await fetch(f.workbench.origin + '/__copy/status')).json(); assert.equal(status.restarting, true); assert.equal(status.busy, true);
    for (const [path, body] of [['/__copy/apply', payload], ['/__copy/undo', { backupId: '123-0123456789abcdef' }], ['/__copy/restart-claim', {}]]) {
      const blocked = await f.request(path, body); assert.equal(blocked.status, 409); assert.equal((await blocked.json()).error, 'BUSY');
    }
    assert.equal(await readFile(join(f.root, 'src/sample.tsx'), 'utf8'), before);
    await new Promise(done => setTimeout(done, 5100));
    const released = await (await fetch(f.workbench.origin + '/__copy/status')).json(); assert.equal(released.busy, false); assert.equal(released.restarting, false);
    assert.equal((await f.request('/__copy/apply', payload)).status, 200);
  } finally { await f.close(); }
});

test('racing source Apply and restart cannot both acquire the mutation lock', async () => {
  const f = await fixture(); let release;
  try {
    const data = await f.catalog(), payload = { revision: data.revision, changes: [f.change(data, 'src/sample.tsx', 'عنوان تازه')] };
    release = f.hold();
    const pendingApply = f.request('/__copy/apply', payload), pendingClaim = f.request('/__copy/restart-claim', {});
    const claim = await pendingClaim; release(); release = null; const apply = await pendingApply;
    assert.deepEqual([claim.status, apply.status].sort(), [200, 409]);
    const blocked = claim.status === 409 ? claim : apply; assert.equal((await blocked.json()).error, 'BUSY');
  } finally { release?.(); await f.close(); }
});

test('batch apply changes only selected source text and undo restores exact files', async () => {
  const f = await fixture();
  try {
    const originals = await Promise.all(['sample.tsx', 'labels.ts'].map(file => readFile(join(f.root, 'src', file), 'utf8')));
    const data = await f.catalog();
    const response = await f.request('/__copy/apply', { revision: data.revision,
      changes: [f.change(data, 'src/sample.tsx', 'خانهٔ من <امن>'), f.change(data, 'src/labels.ts', 'پیام "نو" با فاصله')] });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.applied, 2); assert.equal(result.built, true);
    const savedSource = await readFile(join(f.root, 'src', 'sample.tsx'), 'utf8');
    const parsed = ts.createSourceFile('sample.tsx', savedSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(parsed.parseDiagnostics.length, 0);
    const tags = []; const visit = node => { if (ts.isJsxOpeningElement(node)) tags.push(node.tagName.getText(parsed)); ts.forEachChild(node, visit); }; visit(parsed);
    assert.deepEqual(tags, ['h1'], 'Edited angle brackets must remain text, never new markup');
    assert.match(await readFile(join(f.root, 'src', 'labels.ts'), 'utf8'), /\\"نو\\"/);
    const undo = await f.request('/__copy/undo', { backupId: result.backupId });
    assert.equal(undo.status, 200);
    assert.deepEqual(await Promise.all(['sample.tsx', 'labels.ts'].map(file => readFile(join(f.root, 'src', file), 'utf8'))), originals);
  } finally { await f.close(); }
});

test('stale catalog and unknown source IDs cannot write files', async () => {
  const f = await fixture();
  try {
    const data = await f.catalog(), change = f.change(data, 'src/sample.tsx', 'ویرایش');
    const external = 'export const Screen = () => <h1>ویرایش هم‌زمان</h1>;\n';
    await writeFile(join(f.root, 'src', 'sample.tsx'), external);
    assert.equal((await f.request('/__copy/apply', { revision: data.revision, changes: [change] })).status, 409);
    const fresh = await f.catalog();
    assert.equal((await f.request('/__copy/apply', { revision: fresh.revision, changes: [{ ...change, id: '../../outside' }] })).status, 400);
    assert.equal(await readFile(join(f.root, 'src', 'sample.tsx'), 'utf8'), external);
  } finally { await f.close(); }
});

test('failed validation rolls back the complete batch and keeps the previous preview', async () => {
  const f = await fixture();
  try {
    const before = await readFile(join(f.root, 'src', 'sample.tsx'), 'utf8');
    const data = await f.catalog(); f.fail();
    const result = await f.request('/__copy/apply', { revision: data.revision, changes: [f.change(data, 'src/sample.tsx', 'تغییر نامعتبر')] });
    assert.equal(result.status, 422);
    assert.equal(await readFile(join(f.root, 'src', 'sample.tsx'), 'utf8'), before);
    assert.equal((await fetch(f.workbench.origin + '/assets/app.js')).status, 200);
  } finally { await f.close(); }
});

test('undo refuses to overwrite a later manual source change', async () => {
  const f = await fixture();
  try {
    const data = await f.catalog();
    const saved = await (await f.request('/__copy/apply', { revision: data.revision, changes: [f.change(data, 'src/sample.tsx', 'ویرایش اول')] })).json();
    const later = 'export const Screen = () => <h1>ویرایش دستی بعدی</h1>;\n';
    await writeFile(join(f.root, 'src', 'sample.tsx'), later);
    assert.equal((await f.request('/__copy/undo', { backupId: saved.backupId })).status, 409);
    assert.equal((await f.request('/__copy/undo', { backupId: '../outside' })).status, 400);
    assert.equal(await readFile(join(f.root, 'src', 'sample.tsx'), 'utf8'), later);
  } finally { await f.close(); }
});

test('preview is a real local shell with worker removed and an isolated fictional API', async () => {
  const f = await fixture();
  try {
    const session = await (await f.request('/__copy/preview', { scenarioId: 'full-owner', route: 'hub' })).json();
    const id = new URL(session.url, f.workbench.origin).searchParams.get('session');
    const preview = await (await fetch(f.workbench.origin + session.url)).text();
    assert.ok(preview.includes('window.__COPY_PREVIEW__'));
    assert.ok(preview.includes('await window.__COPY_PREVIEW_READY__'));
    assert.ok(!preview.includes('src="/registerSW.js"'));
    assert.equal((await fetch(f.workbench.origin + '/sw.js')).status, 404);
    assert.equal((await fetch(f.workbench.origin + '/api/v1/auth/config')).status, 401);
    const config = await fetch(f.workbench.origin + '/api/v1/auth/config', { headers: { 'X-Copy-Preview-Session': id } });
    assert.equal(config.status, 200);
    const logout = await fetch(f.workbench.origin + '/api/v1/auth/logout', { method: 'POST', headers: { 'X-Copy-Preview-Session': id } });
    assert.ok([200, 204].includes(logout.status));
    assert.equal((await fetch(f.workbench.origin + '/workbench/../../package.json')).status, 404);
  } finally { await f.close(); }
});
