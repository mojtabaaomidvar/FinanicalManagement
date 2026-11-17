import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderInteractivePortable } from './portable-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('shared standalone shell preserves script-looking copy and replacement tokens as data', async () => {
  const wording = 'متن $& </script><script>window.injected=true</script>';
  const portable = { format: 'khaneyar-copy-package', version: 2, packageId: '0123456789abcdef0123456789abcdef',
    entries: [{ id: 'fedcba9876543210fedcba9876543210', text: wording, tokens: [], section: 'خانه', kind: 'jsx-text' }],
    visualEntries: [], iconOptions: [], sprite: '<svg xmlns="http://www.w3.org/2000/svg"><defs></defs></svg>' };
  const preview = { html: '<html><head></head><body><main></main></body></html>', appJS: 'window.example="$& </script>";', appCSS: '',
    fixturesJS: '', adapterJS: '', bridgeJS: '', scenarios: [], routes: [] };
  const result = await renderInteractivePortable(root, portable, { preview });
  const scripts = [...result.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 4);
  assert.equal(JSON.parse(scripts.find(match => match[1].includes('id="copy-package"'))[2]).entries[0].text, wording);
  assert.equal(JSON.parse(scripts.find(match => match[1].includes('id="copy-preview-package"'))[2]).appJS, preview.appJS);
  for (const match of scripts.filter(match => !match[1].includes('application/json'))) assert.doesNotThrow(() => new Script(match[2]));
  assert.equal(result.includes('<script>window.injected=true</script>'), false);
  assert.equal(/<script\b[^>]*\bsrc=/i.test(result), false);
  assert.ok(result.includes("connect-src 'none'"));
});
