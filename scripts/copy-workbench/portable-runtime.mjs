import { readFile } from 'node:fs/promises';
import { join, resolve, relative, sep, extname } from 'node:path';
import { build, transform } from 'esbuild';
import ts from 'typescript';
import { instrumentCopySource } from './instrument.mjs';
import { SCENARIOS, ROUTES } from './fixtures.mjs';
import { noteCopyId, projectReleaseHistory, summaryCopyId, validateReleaseHistory } from '../../src/domain/release-history/release-history.ts';

const jsonScript = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const inlineScript = value => '<script>' + value.replace(/<\/script/gi, '<\\/script') + '<' + '/script>';
const slash = value => value.split(sep).join('/');
const browserBuffer = `
const randomUUID = () => crypto.randomUUID();
const Buffer = {
  byteLength(value) { return typeof value === 'string' ? new TextEncoder().encode(value).byteLength : value.byteLength; },
  from(value, encoding) {
    if (typeof value !== 'string') return new Uint8Array(value);
    return encoding === 'base64' ? Uint8Array.from(atob(value), letter => letter.charCodeAt(0)) : new TextEncoder().encode(value);
  }
};
`;
const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'self' data: blob:; worker-src 'none'; form-action 'none'; base-uri 'none'";

function inlineAuthoredAssets(source, file, assets) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), edits = [];
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'src' && node.initializer && ts.isStringLiteral(node.initializer) && assets.has(node.initializer.text)) {
      edits.push({ start: node.initializer.getStart(sf), end: node.initializer.end, value: JSON.stringify(assets.get(node.initializer.text)) });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return source;
}

/** Compile the existing application with public source metadata, without loading any .env or backend. */
export async function buildPortablePreview(root, portable, { catalog, visualCatalog } = {}) {
  const manifest = JSON.parse(await readFile(join(root, '.local-test/copy-workbench/portable-packages', portable.packageId + '.json'), 'utf8'));
  const textIds = new Map(manifest.entries.map(entry => [entry.sourceId, entry.id]));
  const visualIds = new Map((manifest.visualEntries ?? []).map(entry => [entry.sourceId, entry.id]));
  const publicTexts = new Map(portable.entries.map(entry => [entry.id, entry]));
  const publicVisuals = new Map((portable.visualEntries ?? []).map(entry => [entry.id, entry]));
  const byFile = new Map(), visualByFile = new Map();
  for (const entry of catalog.entries) {
    const id = textIds.get(entry.id); if (!id) continue;
    const items = byFile.get(entry.file) ?? []; items.push({ ...entry, ...publicTexts.get(id), id }); byFile.set(entry.file, items);
  }
  for (const entry of visualCatalog?.entries ?? []) {
    const id = visualIds.get(entry.id); if (!id) continue;
    const items = visualByFile.get(entry.file) ?? []; items.push({ ...entry, ...publicVisuals.get(id), id }); visualByFile.set(entry.file, items);
  }
  const assets = new Map();
  const mark = await readFile(join(root, 'public/khaneyar-mark.svg')).catch(() => null);
  if (mark) assets.set('/khaneyar-mark.svg', 'data:image/svg+xml;base64,' + mark.toString('base64'));
  const app = await build({
    absWorkingDir: root, entryPoints: [join(root, 'src/main.tsx')], outfile: 'portable-app.js', bundle: true, write: false, platform: 'browser', format: 'iife',
    minify: true, legalComments: 'none', sourcemap: false, target: ['chrome110', 'firefox110', 'safari16'], jsx: 'automatic',
    alias: { '@': join(root, 'src') }, loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl' },
    define: { 'import.meta.env.MODE': '"copy-workbench"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_API_URL': '""', 'import.meta.env.VITE_SUPPORT_HOST': '""', 'import.meta.env.VITE_APP_URL': '""', '__BUILD_TIME__': JSON.stringify(new Date().toISOString()), 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'portable-public-source-metadata', setup(builder) {
      builder.onResolve({ filter: /^virtual:release-history$/ }, () => ({ path: 'release-history', namespace: 'portable-history' }));
      builder.onLoad({ filter: /.*/, namespace: 'portable-history' }, async () => {
        const history = validateReleaseHistory(JSON.parse(await readFile(join(root, 'release-history.json'), 'utf8')));
        const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
        const releases = projectReleaseHistory(history, 'pwa', version);
        const permitted = new Set(releases.flatMap(release => [summaryCopyId(release.id),
          ...Object.values(release.user_notes ?? {}).flatMap(notes => Array.isArray(notes) ? notes.map(note => noteCopyId(release.id, note.id)) : [])]));
        const sources = Object.fromEntries((byFile.get('release-history.json') ?? []).filter(entry => permitted.has(entry.annotationId)).map(entry => [entry.annotationId,
          { id: entry.id, text: entry.text, context: entry.context }]));
        return { contents: 'export default ' + JSON.stringify({ releases, sources }), loader: 'js' };
      });
      builder.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
        const file = slash(relative(root, args.path));
        if (!file.startsWith('src/')) return;
        const original = await readFile(args.path, 'utf8');
        const instrumented = instrumentCopySource(original, file, byFile.get(file), visualByFile.get(file), { portable: true })?.code ?? original;
        return { contents: inlineAuthoredAssets(instrumented, file, assets), loader: extname(args.path).slice(1), resolveDir: resolve(args.path, '..') };
      });
    } }],
  });
  const fixtureSource = await readFile(join(root, 'scripts/copy-workbench/fixtures.mjs'), 'utf8');
  const parser = fixtureSource.includes("import { parseSms } from './sms-fixture-parser.mjs';")
    ? await build({ entryPoints: [join(root, 'src/shared/lib/sms-parser.ts')], bundle: true, write: false,
      format: 'iife', globalName: '__SMS_PARSER__', platform: 'browser', minify: true, legalComments: 'none', sourcemap: false }) : null;
  const fixtureBody = fixtureSource.replace(/^import \{ randomUUID \} from 'node:crypto';\s*/, '')
    .replace("import { parseSms } from './sms-fixture-parser.mjs';", 'const { parseSms } = __SMS_PARSER__;');
  const fixtures = await build({ stdin: { contents: browserBuffer + (parser?.outputFiles[0].text ?? '') + fixtureBody, sourcefile: 'portable-fixtures.js', resolveDir: root },
    bundle: true, write: false, format: 'iife', globalName: '__COPY_FIXTURES__', platform: 'browser', minify: true, legalComments: 'none', sourcemap: false });
  let bridge = await readFile(join(root, 'tools/copy-workbench/preview-bridge.js'), 'utf8');
  bridge = bridge.replace("if (location.hostname !== '127.0.0.1' || location.port !== '5701' || !location.pathname.startsWith('/preview')) return;", "if (!window.__COPY_PREVIEW__?.portable) return;")
    .replace('String(input), location.href)', "String(input), 'https://portable.invalid')")
    .replace('address.origin !== location.origin', "address.origin !== 'https://portable.invalid'")
    .replace('window.parent.postMessage({ ...data, session }, location.origin)', "window.parent.postMessage({ ...data, session }, '*')")
    .replace('event.origin !== location.origin', "event.origin !== 'null'");
  let html = await readFile(join(root, 'index.html'), 'utf8');
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace('</head>', '<meta http-equiv="Content-Security-Policy" content="' + csp + '"></head>');
  const adapter = await readFile(join(root, 'tools/copy-workbench/portable-preview.js'), 'utf8');
  return { html, appJS: app.outputFiles.find(file => file.path.endsWith('.js')).text, appCSS: app.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '',
    fixturesJS: fixtures.outputFiles[0].text, adapterJS: (await transform(adapter, { minify: true, legalComments: 'none' })).code,
    bridgeJS: (await transform(bridge, { minify: true, legalComments: 'none' })).code, scenarios: SCENARIOS, routes: ROUTES };
}

/** Both owners and offline editors use the same shell and app script. Only source-write capabilities differ. */
export async function renderInteractivePortable(root, portable, options = {}) {
  const preview = options.preview ?? await buildPortablePreview(root, portable, options);
  const directory = join(root, 'tools/copy-workbench');
  const [shell, stylesheet, runtime, application] = await Promise.all(['index.html', 'style.css', 'portable-runtime.js', 'app.js'].map(file => readFile(join(directory, file), 'utf8')));
  const font = portable.fontDataUrl;
  const css = stylesheet.replace(/url\('\/workbench\/Vazirmatn\.woff2'\)/g, font ? "url('" + font + "')" : 'local(Vazirmatn)')
    + '\n.copy-item-source,.source-note{display:none!important}';
  const runtimeJS = (await transform(runtime, { minify: true, legalComments: 'none' })).code;
  const applicationJS = (await transform('(() => {\n' + application + '\n})();', { minify: true, legalComments: 'none' })).code;
  const data = '<script id="copy-package" type="application/json">' + jsonScript(portable) + '<' + '/script>'
    + '<script id="copy-preview-package" type="application/json">' + jsonScript(preview) + '<' + '/script>';
  return shell.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '')
    .replace('</head>', () => '<meta http-equiv="Content-Security-Policy" content="' + csp + '"><style>' + css + '</style></head>')
    .replace('</body>', () => data + inlineScript(runtimeJS) + inlineScript(applicationJS) + '</body>');
}
