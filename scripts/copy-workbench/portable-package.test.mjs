import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { collectCatalog, prepareChanges } from './catalog.mjs';
import { createPortablePackage, preparePortableImport } from './portable-package.mjs';
import { collectVisualCatalog } from './visual-catalog.mjs';

const file = 'src/pages/Example/Example.tsx';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHqkAAAAASUVORK5CYII=';
async function workspace(source, action) {
  const root = await mkdtemp(join(tmpdir(), 'copy-portable-test-'));
  try {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), source);
    await action(root, await collectCatalog(root));
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.split(/[\\/]/).at(-1).startsWith('copy-portable-test-'));
    await rm(root, { recursive: true, force: true });
  }
}
const returnFile = (bundle, changes) => ({ format: 'khaneyar-copy-edits', version: 1, packageId: bundle.packageId, changes });
const sourceEntry = (catalog, text) => catalog.entries.find(entry => entry.text === text);
const publicEntry = (bundle, text) => bundle.entries.find(entry => entry.text === text);
const simpleSource = 'export const view=<main><p>راهنمای اول</p><p>راهنمای دوم</p></main>;';

test('interactive packages return exact text, icon and source deletion drafts without writing source', async () => {
  await workspace('export const view=<main><p>راهنمای اول</p><Icon name="i-home" /></main>;', async (root, catalog) => {
    await writeFile(join(root, 'index.html'), '<svg><symbol id="i-home" viewBox="0 0 24 24"><path d="M0 0"/></symbol><symbol id="i-wallet" viewBox="0 0 24 24"><path d="M1 1"/></symbol></svg>');
    catalog = await collectCatalog(root);
    const visualCatalog = await collectVisualCatalog(root, catalog), current = { ...catalog, visualEntries: visualCatalog.entries, iconOptions: visualCatalog.icons };
    const bundle = await createPortablePackage(root, catalog, { interactive: true, visualCatalog });
    assert.equal(bundle.version, 2); assert.equal(bundle.visualEntries.length, 2);
    const icon = bundle.visualEntries.find(entry => entry.kind === 'icon'), body = bundle.visualEntries.find(entry => entry.kind === 'text-element');
    assert.deepEqual(body.textEntryIds, [publicEntry(bundle, 'راهنمای اول').id]);
    for (const entry of bundle.visualEntries) { assert.match(entry.id, /^[a-f0-9]{32}$/); assert.ok(!Object.hasOwn(entry, 'file')); }
    const before = await readFile(join(root, file));
    const returned = { format: 'khaneyar-copy-edits', version: 2, packageId: bundle.packageId, changes: [{ id: publicEntry(bundle, 'راهنمای اول').id, text: 'English' }], visualChanges: [{ id: icon.id, visible: true, icon: 'i-wallet' }, { id: body.id, visible: true, deleted: true }] };
    const review = await preparePortableImport(root, current, returned);
    assert.equal(review.changes.length, 1); assert.equal(review.visualChanges.length, 2); assert.deepEqual(review.conflicts, []);
    assert.equal(review.visualChanges[1].deleted, true); assert.equal(review.visualChanges[0].icon, 'i-wallet');
    assert.deepEqual(await readFile(join(root, file)), before);
    await assert.rejects(preparePortableImport(root, current, { ...returned, visualChanges: [{ id: icon.id, visible: true, icon: 'i-not-listed' }] }), { code: 'INVALID_VISUAL_CHANGES' });
    await assert.rejects(preparePortableImport(root, current, { ...returned, visualChanges: [{ id: icon.id, visible: true, deleted: 'yes' }] }), { code: 'INVALID_PORTABLE_RETURN' });
    await writeFile(join(root, file), (await readFile(join(root, file), 'utf8')) + '\n// concurrent change');
    const changedText = await collectCatalog(root), changedVisual = await collectVisualCatalog(root, changedText);
    const stale = await preparePortableImport(root, { ...changedText, visualEntries: changedVisual.entries, iconOptions: changedVisual.icons }, returned);
    assert.equal(stale.visualChanges.length, 0); assert.equal(stale.conflicts.filter(entry => entry.kind === 'visual').length, 2);
  });
});

test('portable packages contain only public copy and opaque ids while the source map stays private', async () => {
  await workspace(simpleSource + '\nconst user={phone:"private-phone",name:"private-user",password:"private-secret"};', async (root, catalog) => {
    await writeFile(join(root, '.env.local'), 'SECRET=never-ship-me');
    const before = await readFile(join(root, file));
    const bundle = await createPortablePackage(root, catalog, { now: '2026-11-16T12:00:00Z' });
    assert.equal(bundle.format, 'khaneyar-copy-package'); assert.equal(bundle.version, 1); assert.match(bundle.packageId, /^[a-f0-9]{32}$/);
    assert.equal(bundle.createdAt, '2026-11-16T12:00:00.000Z'); assert.equal(bundle.entries.length, 2);
    const publicJson = JSON.stringify(bundle);
    for (const protectedValue of [file, catalog.revision, 'private-phone', 'private-user', 'private-secret', 'never-ship-me', 'sourceStart', 'nodeStart', 'export const']) assert.ok(!publicJson.includes(protectedValue), protectedValue);
    for (const entry of catalog.entries) assert.ok(!publicJson.includes(entry.id));
    for (const entry of bundle.entries) { assert.match(entry.id, /^[a-f0-9]{32}$/); assert.deepEqual(Object.keys(entry).sort(), ['id', 'imageIds', 'kind', 'label', 'section', 'text', 'tokens']); }
    const manifest = JSON.parse(await readFile(join(root, '.local-test/copy-workbench/portable-packages', bundle.packageId + '.json'), 'utf8'));
    assert.equal(manifest.entries[0].sourceId, catalog.entries[0].id); assert.equal(manifest.entries[0].original, catalog.entries[0].text);
    assert.deepEqual(await readFile(join(root, file)), before);
  });
});

test('screenshot regions map to opaque copy ids and extra image metadata cannot leak source paths', async () => {
  await workspace(simpleSource, async (root, catalog) => {
    const local = sourceEntry(catalog, 'راهنمای اول');
    const bundle = await createPortablePackage(root, catalog, { images: [{ id: 'sample', label: 'نمای صفحه', section: 'خانه', dataUrl: png, secret: 'do-not-copy', file,
      regions: [{ sourceIds: [local.id, 'unknown-source'], rect: { x: 3, y: 4, width: 20, height: 10, privateFile: file }, sourceSnippet: 'do-not-copy-either' }] }] });
    const entry = publicEntry(bundle, 'راهنمای اول');
    assert.deepEqual(entry.imageIds, ['sample']); assert.deepEqual(publicEntry(bundle, 'راهنمای دوم').imageIds, []);
    assert.deepEqual(bundle.images[0].regions, [{ entryIds: [entry.id], rect: { x: 3, y: 4, width: 20, height: 10 } }]);
    const data = JSON.stringify(bundle.images);
    for (const secret of [file, local.id, 'sourceSnippet', 'do-not-copy', 'privateFile', 'sourceIds']) assert.ok(!data.includes(secret));
    const safe = await createPortablePackage(root, catalog, { images: [{ id: 'src/private.tsx', label: file, section: file, dataUrl: png }] });
    assert.equal(safe.images[0].id, 'image-1'); assert.ok(!JSON.stringify(safe.images).includes(file));
  });
});

test('invalid or remotely loaded image/font resources are rejected before a private package is written', async () => {
  await workspace(simpleSource, async (root, catalog) => {
    for (const dataUrl of ['https://remote.example/picture.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,c2VjcmV0']) {
      await assert.rejects(createPortablePackage(root, catalog, { images: [{ dataUrl }] }), { code: 'INVALID_PACKAGE_IMAGE' });
    }
    await assert.rejects(createPortablePackage(root, catalog, { fontDataUrl: 'https://remote.example/font.woff2' }), { code: 'INVALID_PACKAGE_FONT' });
    await assert.rejects(createPortablePackage(root, catalog, { images: [{ dataUrl: png, regions: [{ sourceIds: [], rect: { x: 0, y: 0, width: -1, height: 2 } }] }] }), { code: 'INVALID_PACKAGE_IMAGE' });
  });
});

test('English and empty edits stage exact source ids without writing application source', async () => {
  await workspace(simpleSource, async (root, catalog) => {
    const bundle = await createPortablePackage(root, catalog), before = await readFile(join(root, file));
    const result = await preparePortableImport(root, catalog, returnFile(bundle, [{ id: publicEntry(bundle, 'راهنمای اول').id, text: 'English help' }, { id: publicEntry(bundle, 'راهنمای دوم').id, text: '' }]));
    assert.equal(result.revision, catalog.revision); assert.deepEqual(result.conflicts, []); assert.equal(result.unchanged, 0);
    assert.deepEqual(result.changes, [{ id: sourceEntry(catalog, 'راهنمای اول').id, expectedText: 'راهنمای اول', text: 'English help' }, { id: sourceEntry(catalog, 'راهنمای دوم').id, expectedText: 'راهنمای دوم', text: '' }]);
    assert.deepEqual(await readFile(join(root, file)), before);
  });
});

test('template placeholders stay ordered exactly once and cannot be introduced into plain copy', async () => {
  await workspace('export const message=`سلام ${user.name}، مبلغ ${amount}`; export const view=<p>راهنما</p>;', async (root, catalog) => {
    const bundle = await createPortablePackage(root, catalog), dynamic = bundle.entries.find(entry => entry.tokens.length);
    assert.deepEqual(dynamic.tokens.map(value => value.token), ['{slot1}', '{slot2}']);
    const good = await preparePortableImport(root, catalog, returnFile(bundle, [{ id: dynamic.id, text: 'Hello {slot1}, amount {slot2}' }])); assert.equal(good.changes.length, 1);
    for (const text of ['Hello', '{slot2} {slot1}', '{slot1} {slot1} {slot2}', '{slot1} {slot2} {slot3}']) await assert.rejects(preparePortableImport(root, catalog, returnFile(bundle, [{ id: dynamic.id, text }])), { code: 'TEMPLATE_TOKENS' });
    await assert.rejects(preparePortableImport(root, catalog, returnFile(bundle, [{ id: publicEntry(bundle, 'راهنما').id, text: '{slot1}' }])), { code: 'TEMPLATE_TOKENS' });
  });
});

test('unknown package/slot ids, duplicates, excessive text and hidden payload fields are rejected', async () => {
  await workspace(simpleSource, async (root, catalog) => {
    const bundle = await createPortablePackage(root, catalog), id = bundle.entries[0].id, before = await readFile(join(root, file));
    await assert.rejects(preparePortableImport(root, catalog, { ...returnFile(bundle, []), packageId: 'a'.repeat(32) }), { code: 'UNKNOWN_PORTABLE_PACKAGE' });
    await assert.rejects(preparePortableImport(root, catalog, returnFile(bundle, [{ id: '../../source', text: 'bad' }])), { code: 'INVALID_PORTABLE_RETURN' });
    await assert.rejects(preparePortableImport(root, catalog, returnFile(bundle, [{ id: 'b'.repeat(32), text: 'bad' }])), { code: 'UNKNOWN_ENTRY' });
    await assert.rejects(preparePortableImport(root, catalog, returnFile(bundle, [{ id, text: 'one' }, { id, text: 'two' }])), { code: 'DUPLICATE_CHANGE' });
    for (const text of ['\0', 'x'.repeat(16001)]) await assert.rejects(preparePortableImport(root, catalog, returnFile(bundle, [{ id, text }])), { code: 'INVALID_TEXT' });
    await assert.rejects(preparePortableImport(root, catalog, returnFile(bundle, [{ id, text: 'safe', file: '../../.env' }])), { code: 'INVALID_PORTABLE_RETURN' });
    await assert.rejects(preparePortableImport(root, catalog, { ...returnFile(bundle, []), sourceFiles: ['.env'] }), { code: 'INVALID_PORTABLE_RETURN' });
    await assert.rejects(preparePortableImport(root, catalog, 'x'.repeat(2 * 1024 * 1024 + 1)), { code: 'INVALID_PORTABLE_RETURN' });
    assert.deepEqual(await readFile(join(root, file)), before);
  });
});

test('changed and missing source slots produce conflicts and never overwrite current copy', async () => {
  await workspace(simpleSource, async (root, catalog) => {
    const bundle = await createPortablePackage(root, catalog);
    await writeFile(join(root, file), 'export const view=<main><p>ویرایش خودم</p></main>;');
    const fresh = await collectCatalog(root), before = await readFile(join(root, file));
    const result = await preparePortableImport(root, fresh, returnFile(bundle, bundle.entries.map(entry => ({ id: entry.id, text: 'ویرایش شخص دیگر' }))));
    assert.equal(result.changes.length, 0); assert.equal(result.conflicts.length, 2);
    assert.equal(result.conflicts[0].current, 'ویرایش خودم'); assert.equal(result.conflicts[1].current, null);
    assert.deepEqual(await readFile(join(root, file)), before);
  });
});

test('import is idempotent after applying the same returned file and preserves exact empty slots', async () => {
  await workspace(simpleSource, async (root, catalog) => {
    const bundle = await createPortablePackage(root, catalog), returned = returnFile(bundle, bundle.entries.map((entry, index) => ({ id: entry.id, text: index ? '' : 'Changed help' })));
    const first = await preparePortableImport(root, catalog, returned), prepared = await prepareChanges(root, catalog, { revision: catalog.revision, changes: first.changes });
    for (const updated of prepared) await writeFile(join(root, updated.file), updated.updated);
    const fresh = await collectCatalog(root), result = await preparePortableImport(root, fresh, JSON.stringify(returned));
    assert.deepEqual(result.changes, []); assert.deepEqual(result.conflicts, []); assert.equal(result.unchanged, 2);
    assert.ok(fresh.entries.some(entry => entry.text === '' && entry.registered));
  });
});

test('unregistered duplicate text identities conflict after their file changes, while unrelated files can evolve', async () => {
  await workspace('export const view=<main><p>یکسان</p><p>یکسان</p></main>;', async (root, catalog) => {
    const bundle = await createPortablePackage(root, catalog), returned = returnFile(bundle, [{ id: bundle.entries[1].id, text: 'Second occurrence' }]);
    await writeFile(join(root, 'src/other.tsx'), 'export const other=<p>متن تازه</p>;');
    const unrelated = await preparePortableImport(root, await collectCatalog(root), returned); assert.equal(unrelated.changes.length, 1); assert.equal(unrelated.changes[0].id, catalog.entries[1].id);
    await writeFile(join(root, file), '// changed surrounding code\nexport const view=<main><p>یکسان</p><p>یکسان</p></main>;');
    const changed = await preparePortableImport(root, await collectCatalog(root), returned); assert.deepEqual(changed.changes, []); assert.equal(changed.conflicts.length, 1);
  });
});

test('explicit stable source ids remain importable after unrelated edits in the same file', async () => {
  await workspace('export const heading=/* @copy-text heading.stable */ "راهنما"; export const count=1;', async (root, catalog) => {
    const bundle = await createPortablePackage(root, catalog), returned = returnFile(bundle, [{ id: publicEntry(bundle, 'راهنما').id, text: 'Guide' }]);
    await writeFile(join(root, file), 'export const heading=/* @copy-text heading.stable */ "راهنما"; export const count=2;');
    const result = await preparePortableImport(root, await collectCatalog(root), returned); assert.equal(result.changes.length, 1); assert.equal(result.changes[0].id, 'heading.stable'); assert.deepEqual(result.conflicts, []);
  });
});
