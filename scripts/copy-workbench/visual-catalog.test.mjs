import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import ts from 'typescript';
import { collectCatalog, prepareChanges } from './catalog.mjs';
import { collectVisualCatalog, collectIconOptions, prepareVisualChanges } from './visual-catalog.mjs';

const sprite = '<svg><symbol id="i-home"><path d="M1 1"/></symbol><symbol id="i-cart"><path d="M2 2"/></symbol><symbol id="i-wallet"><path d="M3 3"/></symbol><symbol id="i-users"><path d="M4 4"/></symbol></svg>';
async function workspace(source, action, file = 'src/pages/Test/Test.tsx') {
  const root = await mkdtemp(join(tmpdir(), 'copy-visual-test-'));
  try {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), source); await writeFile(join(root, 'index.html'), sprite);
    await action(root, file);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function catalog(root) { return collectVisualCatalog(root, await collectCatalog(root)); }
function change(entry, desired) { return { id: entry.id, expected: { visible: entry.visible, ...(entry.kind === 'icon' ? { icon: entry.icon } : {}) }, visible: entry.visible, ...desired }; }
async function writePrepared(root, files) { for (const file of files) await writeFile(join(root, file.file), file.updated); }
const jsxSource = 'export function Screen({user}) {return <section><p>راهنمای ثابت</p><span>{user.name}</span><button onClick={()=>save(user)}>ثبت</button><span className="icon"><Icon name="i-home" size={20}/></span></section>;}';

test('visual allowlist includes decorative icons and static text but excludes controls and authored values', async () => {
  await workspace(jsxSource, async root => {
    const result = await catalog(root);
    assert.equal(result.icons.length, 4);
    assert.equal(result.entries.filter(entry => entry.kind === 'text-element').length, 1);
    const text = result.entries.find(entry => entry.kind === 'text-element');
    assert.equal(text.label, 'راهنمای ثابت'); assert.ok(text.textEntryIds.length);
    const icon = result.entries.find(entry => entry.kind === 'icon');
    assert.equal(icon.icon, 'i-home'); assert.equal(icon.context, 'span');
    assert.ok(icon.iconNodeStart > icon.nodeStart);
  });
});

test('hide and restore remove the static container from rendering while retaining its source and stable id', async () => {
  await workspace(jsxSource, async (root, file) => {
    const initial = await catalog(root), entry = initial.entries.find(entry => entry.kind === 'text-element'), bytes = await readFile(join(root, file), 'utf8');
    const prepared = await prepareVisualChanges(root, initial, { revision: initial.revision, changes: [change(entry, { visible: false })] });
    assert.equal(await readFile(join(root, file), 'utf8'), bytes);
    assert.match(prepared[0].updated, /@copy-visual/); assert.match(prepared[0].updated, /false && <p>راهنمای ثابت<\/p>/);
    assert.match(prepared[0].updated, /user\.name/); assert.match(prepared[0].updated, /onClick/);
    await writePrepared(root, prepared);
    const hidden = await catalog(root), same = hidden.entries.find(value => value.id === entry.id);
    assert.equal(same.visible, false); assert.ok(Number.isInteger(same.hiddenGateStart));
    const restored = await prepareVisualChanges(root, hidden, { revision: hidden.revision, changes: [change(same, { visible: true })] });
    await writePrepared(root, restored);
    const final = await catalog(root);
    assert.equal(final.entries.find(value => value.id === entry.id).visible, true);
    assert.match(restored[0].updated, /true && <p>راهنمای ثابت<\/p>/);
  });
});

test('sprite replacements and icon deletion preserve the containing button and the isolated decorative wrapper', async () => {
  await workspace('export const view=<button onClick={save} aria-label="ثبت"><span className="glyph"><Icon name="i-home"/></span></button>;', async (root, file) => {
    const initial = await catalog(root), icon = initial.entries.find(entry => entry.kind === 'icon');
    const replacements = await prepareVisualChanges(root, initial, { revision: initial.revision, changes: [change(icon, { visible: false, icon: 'i-cart' })] });
    await writePrepared(root, replacements);
    assert.match(replacements[0].updated, /<button onClick=\{save\}/);
    assert.match(replacements[0].updated, /false && <span className="glyph"><Icon name="i-cart"/);
    const next = await catalog(root), entry = next.entries.find(value => value.id === icon.id);
    assert.equal(entry.icon, 'i-cart'); assert.equal(entry.visible, false);
    const shown = await prepareVisualChanges(root, next, { revision: next.revision, changes: [change(entry, { visible: true })] });
    await writePrepared(root, shown);
    assert.equal((await catalog(root)).entries.find(value => value.id === icon.id).icon, 'i-cart');
  });
});

test('fixed icon maps and SettingsRow short ids survive hide, replacement and restart without editing user defaults', async () => {
  const source = 'const MODULES=[{id:"money",label:"مالی",icon:"i-wallet"}]; const THEME_ICON={light:"home",dark:"wallet"}; export function View(){ const [user,setUser]=useState({name:"شخص",icon:"i-home"});return <SettingsRow icon="users" label="اعضا"/>;}';
  await workspace(source, async (root, file) => {
    const initial = await catalog(root), bindings = initial.entries.filter(entry => entry.scope === 'icon-binding');
    assert.equal(bindings.length, 4);
    const short = bindings.find(entry => entry.context === 'light'), attr = bindings.find(entry => entry.ownerNodeStart);
    assert.equal(short.iconPrefix, 'i-'); assert.equal(attr.icon, 'i-users');
    const prepared = await prepareVisualChanges(root, initial, { revision: initial.revision, changes: [change(short, { visible: false }), change(attr, { icon: 'i-home', visible: false })] });
    await writePrepared(root, prepared);
    assert.match(prepared[0].updated, /useState\(\{name:"شخص",icon:"i-home"\}\)/);
    const hidden = await catalog(root), hshort = hidden.entries.find(entry => entry.id === short.id), hattr = hidden.entries.find(entry => entry.id === attr.id);
    assert.equal(hshort.visible, false); assert.equal(hshort.icon, 'i-home'); assert.equal(hshort.iconPrefix, 'i-');
    assert.equal(hattr.visible, false); assert.equal(hattr.icon, 'i-home'); assert.equal(hattr.iconPrefix, 'i-');
    const shown = await prepareVisualChanges(root, hidden, { revision: hidden.revision, changes: [change(hshort, { visible: true, icon: 'i-cart' }), change(hattr, { visible: true, icon: 'i-wallet' })] });
    await writePrepared(root, shown);
    assert.match(shown[0].updated, /light:\/\* @copy-visual-icon[^*]+ short \*\/ "cart"/);
    assert.match(shown[0].updated, /icon=\{\/\* @copy-visual-icon[^*]+ short \*\/ "wallet"\}/);
  });
});

test('local SVG use references can change while dynamic plots and user images remain outside the visual allowlist', async () => {
  await workspace('export const view=<><svg className="arrow"><use href="#i-home"/></svg><svg><path d={user.plot}/></svg><img src={user.photo}/></>;', async root => {
    const initial = await catalog(root), icons = initial.entries.filter(entry => entry.kind === 'icon');
    assert.equal(icons.length, 1);
    const prepared = await prepareVisualChanges(root, initial, { revision: initial.revision, changes: [change(icons[0], { icon: 'i-cart' })] });
    assert.match(prepared[0].updated, /href="#i-cart"/); assert.match(prepared[0].updated, /d=\{user.plot\}/);
  });
});

test('native static SVG geometry is retained for restoration after sprite replacement and hiding', async () => {
  await workspace('export const view=<span><svg viewBox="0 0 24 24"><path d="M0 0L1 1" stroke="currentColor"/></svg></span>;', async root => {
    const initial = await catalog(root), icon = initial.entries[0];
    assert.equal(icon.icon, null); assert.equal(icon.nativeIcon, true);
    const replaced = await prepareVisualChanges(root, initial, { revision: initial.revision, changes: [change(icon, { icon: 'i-wallet', visible: false })] });
    await writePrepared(root, replaced);
    const hidden = await catalog(root), same = hidden.entries.find(entry => entry.id === icon.id);
    assert.ok(same); assert.equal(same.icon, 'i-wallet'); assert.equal(same.nativeIcon, true); assert.equal(same.visible, false);
    const restored = await prepareVisualChanges(root, hidden, { revision: hidden.revision, changes: [change(same, { icon: null, visible: true })] });
    assert.match(restored[0].updated, /d="M0 0L1 1"/); assert.doesNotMatch(restored[0].updated, /<use/);
    await writePrepared(root, restored);
    assert.equal((await catalog(root)).entries.find(entry => entry.id === icon.id).icon, null);
  });
});

test('prepared text edits safely rebase a simultaneous visual hide and retain original bytes for atomic rollback', async () => {
  await workspace(jsxSource, async (root, file) => {
    const texts = await collectCatalog(root), visuals = await collectVisualCatalog(root, texts), text = texts.entries.find(entry => entry.text === 'راهنمای ثابت'), element = visuals.entries.find(entry => entry.kind === 'text-element');
    const textFiles = await prepareChanges(root, texts, { revision: texts.revision, changes: [{ id: text.id, expectedText: text.text, text: '' }] });
    const visualFiles = await prepareVisualChanges(root, visuals, { revision: visuals.revision, changes: [change(element, { visible: false })] }, { sourceOverrides: textFiles });
    assert.equal(visualFiles[0].original, textFiles[0].original);
    assert.match(visualFiles[0].updated, /@copy-text/); assert.match(visualFiles[0].updated, /@copy-visual/);
    assert.equal(await readFile(join(root, file), 'utf8'), jsxSource);
    await writePrepared(root, visualFiles);
    const after = await catalog(root);
    assert.equal(after.entries.find(entry => entry.id === element.id).visible, false);
    assert.equal((await collectCatalog(root)).entries.find(entry => entry.id === text.id).text, '');
  });
});

test('stale identities, forged icons, duplicate changes and nested visual edits are rejected without writing', async () => {
  await workspace('export const view=<p>ثابت <strong>توضیح</strong></p>;', async (root, file) => {
    const result = await catalog(root), parent = result.entries.find(entry => entry.context === 'p'), child = result.entries.find(entry => entry.context === 'strong'), before = await readFile(join(root, file), 'utf8');
    await assert.rejects(prepareVisualChanges(root, result, { revision: result.revision, changes: [change(parent, { visible: false }), change(child, { visible: false })] }), { code: 'OVERLAPPING_CHANGES' });
    await assert.rejects(prepareVisualChanges(root, result, { revision: result.revision, changes: [change(parent, { visible: false }), change(parent, { visible: false })] }), { code: 'DUPLICATE_CHANGE' });
    await assert.rejects(prepareVisualChanges(root, result, { revision: result.revision, changes: [{ id: 'forged', expected: { visible: true }, visible: false }] }), { code: 'UNKNOWN_VISUAL_ENTRY' });
    assert.equal(await readFile(join(root, file), 'utf8'), before);
    await writeFile(join(root, file), before + '\n// later change');
    await assert.rejects(prepareVisualChanges(root, result, { revision: result.revision, changes: [change(parent, { visible: false })] }), { code: 'STALE_CATALOG' });
  });
  await workspace('export const view=<Icon name="i-home"/>;', async root => {
    const result = await catalog(root), icon = result.entries[0];
    await assert.rejects(prepareVisualChanges(root, result, { revision: result.revision, changes: [change(icon, { icon: 'https://evil/icon.svg' })] }), { code: 'INVALID_ICON' });
    await assert.rejects(prepareVisualChanges(root, result, { revision: result.revision, changes: [change(icon, { expected: { visible: true, icon: 'i-cart' }, icon: 'i-wallet' })] }), { code: 'STALE_VISUAL' });
  });
});

test('icon options never include executable or externally loaded sprite content', async () => {
  await workspace('export const view=<p>متن</p>;', async root => {
    await writeFile(join(root, 'index.html'), sprite + '<symbol id="i-external"><image href="https://bad/"/></symbol><symbol id="i-script"><script>alert(1)</script></symbol>');
    const options = await collectIconOptions(root);
    assert.equal(options.icons.length, 4); assert.doesNotMatch(options.sprite, /https:|script|image/);
  });
});

test('adjacent English and empty text edits keep distinct occurrence links during visual rebasing and restoration', async () => {
  await workspace('export const view=<section><p>عنوان اولیه</p><p>راهنمای تکراری</p><p>راهنمای تکراری</p><span>{user.name}</span></section>;', async root => {
    const texts = await collectCatalog(root), initial = await collectVisualCatalog(root, texts);
    const title = texts.entries.find(entry => entry.text === 'عنوان اولیه'), duplicates = texts.entries.filter(entry => entry.text === 'راهنمای تکراری');
    const elements = initial.entries.filter(entry => entry.kind === 'text-element');
    const edits = await prepareChanges(root, texts, { revision: texts.revision, changes: [
      { id: title.id, expectedText: title.text, text: 'English title' }, { id: duplicates[0].id, expectedText: duplicates[0].text, text: '' },
    ] });
    const rebased = await collectVisualCatalog(root, texts, { sourceOverrides: edits });
    assert.deepEqual(rebased.entries.find(entry => entry.id === elements[2].id).textEntryIds, [duplicates[1].id]);
    assert.deepEqual(rebased.entries.find(entry => entry.id === elements[1].id).textEntryIds, [duplicates[0].id]);
    const hidden = await prepareVisualChanges(root, initial, { revision: initial.revision, changes: elements.map(entry => change(entry, { visible: false })) }, { sourceOverrides: edits });
    await writePrepared(root, hidden);
    const next = await catalog(root), nextTexts = await collectCatalog(root);
    assert.equal(nextTexts.entries.find(entry => entry.id === title.id).text, 'English title');
    assert.equal(nextTexts.entries.find(entry => entry.id === duplicates[0].id).text, '');
    assert.equal(next.entries.length, 3); assert.ok(next.entries.every(entry => entry.visible === false));
    assert.deepEqual(next.entries.map(entry => entry.id), elements.map(entry => entry.id));
    const restored = await prepareVisualChanges(root, next, { revision: next.revision, changes: next.entries.map(entry => change(entry, { visible: true })) });
    await writePrepared(root, restored);
    assert.ok((await catalog(root)).entries.every(entry => entry.visible));
    assert.match(restored[0].updated, /user\.name/);
  });
});

test('interactive attributes, spread props and authored records are excluded from destructive visual editing', async () => {
  const source = 'const record={familyId:"f",title:"داده",icon:"i-home"};const [state]=useState({icon:"i-cart"});'
    + 'export const view=<><span role="button">کنترل</span><p tabIndex={0}>کنترل دوم</p><span contentEditable>ورودی</span>'
    + '<p {...props}>محتوا</p><svg {...props}><path d="M0 0L1 1"/></svg><Icon {...props} name="i-home"/>'
    + '<svg><path d="M0 0L1 1" fill="url(https://example.com/image)"/></svg></>;';
  await workspace(source, async root => {
    assert.equal((await catalog(root)).entries.length, 0);
    assert.ok((await collectCatalog(root)).entries.some(entry => entry.text === 'کنترل'));
  });
});

test('native SVG metadata retains exact source and replacements use the sprite viewBox before exact restoration', async () => {
  const original = '<svg width={size} height={size} className={className} viewBox="0 0 48 48"><path d="M0 0L48 48" strokeWidth={2}/></svg>';
  await workspace('export const view=' + original + ';', async root => {
    const initial = await catalog(root), icon = initial.entries[0];
    assert.equal(icon.originalSvg, original);
    const replacement = await prepareVisualChanges(root, initial, { revision: initial.revision, changes: [change(icon, { icon: 'i-cart' })] });
    assert.match(replacement[0].updated, /viewBox="0 0 24 24"/);
    assert.match(replacement[0].updated, /width=\{size\} height=\{size\} className=\{className\}/);
    await writePrepared(root, replacement);
    const next = await catalog(root), same = next.entries.find(entry => entry.id === icon.id);
    assert.equal(same.originalSvg, original);
    const restored = await prepareVisualChanges(root, next, { revision: next.revision, changes: [change(same, { icon: null })] });
    assert.ok(restored[0].updated.includes(original));
    await writePrepared(root, restored);
    assert.equal((await catalog(root)).entries.find(entry => entry.id === icon.id).icon, null);
  });
});

test('sprite options reject JavaScript links, unknown elements and external CSS resources', async () => {
  await workspace('export const view=<p>متن</p>;', async root => {
    await writeFile(join(root, 'index.html'), sprite
      + '<symbol id="i-javascript"><use href="javascript:alert(1)"/></symbol>'
      + '<symbol id="i-linked"><a href="#local"><path d="M0 0"/></a></symbol>'
      + '<symbol id="i-resource"><path fill="url(https://example.com/image)" d="M0 0"/></symbol>');
    const options = await collectIconOptions(root);
    assert.equal(options.icons.length, 4); assert.doesNotMatch(options.sprite, /javascript:|example\.com|<a\b/);
  });
});

test('deletion removes the complete static source element, nested drafts and display text while retaining user content', async () => {
  const source = 'export const view=<section><div className="help"><p>راهنمای ثابت</p><Icon name="i-home"/></div><span>{user.name}</span><button onClick={save}>ثبت</button></section>;';
  await workspace(source, async (root, file) => {
    const texts = await collectCatalog(root), initial = await collectVisualCatalog(root, texts);
    const parent = initial.entries.find(entry => entry.context === 'div'), child = initial.entries.find(entry => entry.context === 'p'), icon = initial.entries.find(entry => entry.kind === 'icon');
    assert.ok(parent?.deletable); assert.ok(child); assert.ok(icon);
    const text = texts.entries.find(entry => entry.text === 'راهنمای ثابت');
    const textFiles = await prepareChanges(root, texts, { revision: texts.revision, changes: [{ id: text.id, expectedText: text.text, text: 'English help' }] });
    const files = await prepareVisualChanges(root, initial, { revision: initial.revision, changes: [
      change(parent, { deleted: true }), change(child, { deleted: true }), change(icon, { icon: 'i-cart' }),
    ] }, { sourceOverrides: textFiles });
    assert.equal(files[0].original, source); assert.equal(await readFile(join(root, file), 'utf8'), source);
    assert.equal(files[0].updated, 'export const view=<section><span>{user.name}</span><button onClick={save}>ثبت</button></section>;');
    assert.doesNotMatch(files[0].updated, /@copy-|false &&|راهنمای ثابت|English help|i-home|i-cart/);
    await writePrepared(root, files);
    assert.ok(!(await collectCatalog(root)).entries.some(entry => entry.id === text.id));
    assert.ok(!(await catalog(root)).entries.some(entry => entry.context === 'div'));
  });
});

test('deleting root, conditional and legacy hidden JSX keeps valid expressions and removes the original source', async () => {
  for (const source of [
    'export const view=<p>راهنما</p>;',
    'export const View=()=> <p>راهنما</p>;',
    'export const view=<>{<p>راهنما</p>}</>;',
    'export const view=<>{ready ? <p>راهنما</p> : null}</>;',
    'export const view=<>{/* @copy-visual old.help */ false && <p>راهنما</p>}</>;',
  ]) await workspace(source, async root => {
    const initial = await catalog(root), entry = initial.entries.find(entry => entry.kind === 'text-element');
    const files = await prepareVisualChanges(root, initial, { revision: initial.revision, changes: [change(entry, { deleted: true })] });
    assert.doesNotMatch(files[0].updated, /<p>|راهنما|@copy-visual/);
    assert.equal(ts.createSourceFile('check.tsx', files[0].updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0);
  });
});

test('deleting icon bindings removes their entire property or attribute, and required typed contracts are rejected', async () => {
  const source = 'type Optional={icon?:string}; type Required={icon:string}; function Row({icon}:{icon?:string}){return null;} '
    + 'const modules:Optional[]=[{icon:"i-home"},{icon:"i-cart"}]; const required:Required={icon:"i-home"}; const untyped={label:"عنوان",icon:"i-cart"};'
    + 'export const view=<Row icon="i-home"/>;';
  await workspace(source, async root => {
    const initial = await catalog(root), required = initial.entries.find(entry => !entry.deletable), removable = initial.entries.filter(entry => entry.deletable);
    assert.ok(required); assert.equal(removable.length, 4);
    await assert.rejects(prepareVisualChanges(root, initial, { revision: initial.revision, changes: [change(required, { deleted: true })] }), { code: 'DELETE_UNSUPPORTED' });
    const files = await prepareVisualChanges(root, initial, { revision: initial.revision, changes: removable.map(entry => change(entry, { deleted: true })) });
    assert.match(files[0].updated, /modules:Optional\[\]=\[\{\},\{\}\]/);
    assert.match(files[0].updated, /required:Required=\{icon:"i-home"\}/);
    assert.match(files[0].updated, /untyped=\{label:"عنوان",\}/);
    assert.match(files[0].updated, /<Row\s*\/>/);
    assert.doesNotMatch(files[0].updated, /@copy-visual|false &&/);
    assert.equal(ts.createSourceFile('check.tsx', files[0].updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0);
  });
});

test('binding deletion consumes its own trailing comment and comma, and rejects inferred fallback contracts', async () => {
  await workspace('const map={icon:"i-home" /* source comment */,label:"عنوان"}; const fallback=found ?? {name:"عنوان",icon:"i-cart"};', async root => {
    const initial = await catalog(root), icon = initial.entries.find(entry => entry.icon === 'i-home'), fallback = initial.entries.find(entry => entry.icon === 'i-cart');
    assert.equal(fallback.deletable, false);
    const files = await prepareVisualChanges(root, initial, { revision: initial.revision, changes: [change(icon, { deleted: true })] });
    assert.match(files[0].updated, /map=\{label:"عنوان"\}/); assert.doesNotMatch(files[0].updated, /source comment/);
    assert.match(files[0].updated, /icon:"i-cart"/);
  });
});
