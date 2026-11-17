import { randomBytes } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';

const retryDelays = [40, 80, 120, 160, 200, 240];
const temporaryLocks = new Set(['EPERM', 'EBUSY', 'EACCES']);
const sourceChanged = () => Object.assign(new Error('فایل هم‌زمان تغییر کرده است؛ تغییرها اعمال نشدند.'), { code: 'SOURCE_CHANGED', status: 409 });

/** Replace one checked source file, allowing a briefly held Windows file handle to close. */
export async function atomicReplace(path, content, expected, { renameFile = rename, wait = ms => new Promise(done => setTimeout(done, ms)), delays = retryDelays } = {}) {
  const temporary = path + '.copy-' + randomBytes(6).toString('hex') + '.tmp';
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  try {
    for (let attempt = 0; ; attempt++) {
      let current;
      try { current = await readFile(path, 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') throw sourceChanged(); throw error; }
      if (current !== expected) throw sourceChanged();
      try { await renameFile(temporary, path); return; }
      catch (error) {
        if (!temporaryLocks.has(error.code) || attempt >= delays.length) throw error;
        await wait(delays[attempt]);
      }
    }
  } finally {
    // This unique file belongs to this replacement; never remove the source destination.
    await unlink(temporary).catch(() => {});
  }
}
