import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { atomicReplace } from './atomic-write.mjs';

async function fixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'copy-atomic-test-'));
  try {
    const path = join(root, 'source.ts'); await writeFile(path, 'original');
    await action(path, root);
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.split(/[\\/]/).at(-1).startsWith('copy-atomic-test-'));
    await rm(root, { recursive: true, force: true });
  }
}

test('a transient Windows rename lock retries and replaces the exact expected source', async () => {
  await fixture(async (path, root) => {
    let attempts = 0; const waits = [];
    await atomicReplace(path, 'updated', 'original', {
      renameFile: async (temporary, destination) => {
        if (++attempts === 1) throw Object.assign(new Error('held file handle'), { code: 'EPERM' });
        await rename(temporary, destination);
      },
      wait: async delay => { waits.push(delay); assert.equal(await readFile(path, 'utf8'), 'original'); },
    });
    assert.equal(attempts, 2); assert.deepEqual(waits, [40]);
    assert.equal(await readFile(path, 'utf8'), 'updated');
    assert.deepEqual(await readdir(root), ['source.ts']);
  });
});

test('an external source edit during retry is preserved and the pending replacement is discarded', async () => {
  await fixture(async (path, root) => {
    let attempts = 0;
    await assert.rejects(atomicReplace(path, 'updated', 'original', {
      renameFile: async () => { attempts++; throw Object.assign(new Error('held file handle'), { code: 'EPERM' }); },
      wait: async () => { await writeFile(path, 'manual edit'); },
    }), { code: 'SOURCE_CHANGED', status: 409 });
    assert.equal(attempts, 1); assert.equal(await readFile(path, 'utf8'), 'manual edit');
    assert.deepEqual(await readdir(root), ['source.ts']);
  });
});

test('persistent rename failures stop after bounded retries without changing source or leaving a temporary file', async () => {
  await fixture(async (path, root) => {
    let attempts = 0, waits = 0;
    await assert.rejects(atomicReplace(path, 'updated', 'original', {
      renameFile: async () => { attempts++; throw Object.assign(new Error('persistent file lock'), { code: 'EPERM' }); },
      wait: async () => { waits++; }, delays: [1, 1],
    }), { code: 'EPERM' });
    assert.equal(attempts, 3); assert.equal(waits, 2);
    assert.equal(await readFile(path, 'utf8'), 'original'); assert.deepEqual(await readdir(root), ['source.ts']);
  });
});
