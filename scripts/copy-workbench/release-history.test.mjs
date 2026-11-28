import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectCatalog, prepareChanges } from './catalog.mjs';
import { scanReleaseHistory } from './release-history.mjs';

const source = await readFile(new URL('../../release-history.json', import.meta.url), 'utf8');
test('history display fields survive English, empty, escaped text and reordering without editing contracts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-copy-'));
  try {
    const file = join(root, 'release-history.json');
    await writeFile(file, source);
    await writeFile(join(root, 'private.json'), '{"text":"NEVER_SCAN_PRIVATE"}');
    let catalog = await collectCatalog(root);
    assert.ok(catalog.entries.length > 50);
    assert.ok(catalog.entries.every(entry => entry.file === 'release-history.json' && entry.registered));
    const id = 'release-history.pwa-0.12.0.notes.wallet-cards';
    const initial = JSON.parse(source), contracts = data => data.releases.map(item => ({ id: item.id, version: item.version, status: item.notes_status }));
    for (const text of ['English', '', 'A "quote"\n<script> remains text']) {
      const entry = catalog.entries.find(item => item.id === id);
      const [change] = await prepareChanges(root, catalog, { revision: catalog.revision, changes: [{ id, expectedText: entry.text, text }] });
      const updated = JSON.parse(change.updated);
      assert.deepEqual(contracts(updated), contracts(initial));
      assert.equal(updated.releases.find(item => item.id === 'pwa-0.12.0').user_notes.improvements.find(item => item.id === 'wallet-cards').text, text);
      await writeFile(file, change.updated);
      catalog = await collectCatalog(root);
      assert.equal(catalog.entries.find(item => item.id === id).text, text);
    }
    const reordered = JSON.parse(await readFile(file, 'utf8'));
    reordered.releases.find(item => item.id === 'pwa-0.12.0').user_notes.improvements.reverse();
    await writeFile(file, JSON.stringify(reordered));
    assert.equal((await collectCatalog(root)).entries.find(item => item.id === id).text, 'A "quote"\n<script> remains text');
    await assert.rejects(prepareChanges(root, catalog, { revision: catalog.revision, changes: [{ id, expectedText: '', text: 'stale' }] }), { code: 'STALE_CATALOG' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('duplicate JSON keys cannot redirect a text edit to another source field', () => {
  assert.throws(() => scanReleaseHistory(source.replace('"summary":', '"summary":"duplicate", "summary":')));
});
