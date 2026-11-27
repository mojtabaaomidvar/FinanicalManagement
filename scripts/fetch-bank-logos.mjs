// Vendor only the pinned catalog's 128px PNGs. No runtime network dependencies.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve('backend/app/data/iranian-banks');
const source = JSON.parse(await readFile(resolve(directory, 'source.json'), 'utf8'));
const banks = JSON.parse(await readFile(resolve(directory, 'banks.json'), 'utf8'));
const base = `https://raw.githubusercontent.com/mehrnet/IranianBanks/${source.commit}/`;
const treeResponse = await fetch(`https://api.github.com/repos/mehrnet/IranianBanks/git/trees/${source.commit}?recursive=1`);
assert.equal(treeResponse.ok, true, 'Pinned logo tree unavailable');
const tree = (await treeResponse.json()).tree;
const target = resolve('public/bank-logos');
await mkdir(target, { recursive: true });
let bytes = 0;
for (let start = 0; start < banks.length; start += 6) {
  await Promise.all(banks.slice(start, start + 6).map(async bank => {
    assert.match(bank.id, /^[a-z-]+$/);
    const path = `logos/png/128x128/${bank.id}.png`;
    const entry = tree.find(entry => entry.path === path);
    assert.ok(entry, 'Missing pinned bank logo: ' + bank.id);
    const response = await fetch(base + path);
    assert.equal(response.ok, true, 'Logo download failed: ' + bank.id);
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex'), entry.sha);
    assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(16) <= 128);
    assert.ok(buffer.readUInt32BE(20) > 0 && buffer.readUInt32BE(20) <= 128);
    const output = resolve(target, bank.id + '.png');
    const existing = await readFile(output).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (existing) assert.deepEqual(existing, buffer, 'Refusing to replace modified bank logo: ' + bank.id);
    else await writeFile(output, buffer, { flag: 'wx' });
    bytes += buffer.length;
  }));
}
const licensePath = resolve(target, 'LICENSE');
const license = await readFile(resolve(directory, 'LICENSE'));
const previous = await readFile(licensePath).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
if (previous) assert.deepEqual(previous, license, 'Refusing to replace modified license');
else await writeFile(licensePath, license, { flag: 'wx' });
console.log(`Verified ${banks.length} pinned local logos; ${bytes} bytes; MIT notice retained.`);
