import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { instrumentCopySource } from './instrument.mjs';

function entryFor(source, text, id) {
  const parsed = ts.createSourceFile('src/Profile.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  function visit(node) {
    if ((ts.isStringLiteral(node) || ts.isJsxText(node)) && (node.text ?? node.getText(parsed)).trim() === text) {
      result = { id, text, file: 'src/Profile.tsx', line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
        nodeStart: node.getStart(parsed), nodeEnd: node.end };
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed); assert.ok(result, 'Test literal must exist'); return result;
}

test('portable instrumentation keeps source identity opaque and excludes paths and token expressions', () => {
  const source = 'const row = <p>{`سلام ${user.name}`}</p>;';
  const sf = ts.createSourceFile('src/Private.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let template; function visit(node) { if (ts.isTemplateExpression(node)) template = node; ts.forEachChild(node, visit); } visit(sf);
  const entry = { id: '0123456789abcdef0123456789abcdef', text: 'سلام {slot1}', file: 'src/Private.tsx', line: 1,
    nodeStart: template.getStart(sf), nodeEnd: template.end, tokens: [{ token: '{slot1}', example: 'نمونه', expression: 'user.name' }] };
  const result = instrumentCopySource(source, 'src/Private.tsx', [entry], [], { portable: true });
  assert.ok(result); assert.equal(result.code.includes('src/Private.tsx'), false); assert.equal(result.code.includes('"expression"'), false);
  assert.ok(result.code.includes(entry.id)); assert.ok(result.code.includes('{slot1}')); assert.ok(result.code.includes('${user.name}'));
  assert.equal(ts.createSourceFile('portable.tsx', result.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0);
});

test('preview instrumentation distinguishes forwarded custom titles and preserves real app source', () => {
  const source = 'const page = <SettingsSubPage title="Outer"><Card title="Inner">Body</Card></SettingsSubPage>;';
  const entries = [entryFor(source, 'Outer', 'outer'), entryFor(source, 'Inner', 'inner'), entryFor(source, 'Body', 'body')];
  const result = instrumentCopySource(source, 'src/Profile.tsx', entries);
  assert.ok(result); assert.equal(source.includes('data-copy-sources'), false);
  const output = ts.createSourceFile('src/Profile.tsx', result.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(output.parseDiagnostics.length, 0);
  const groups = [];
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(output) === 'data-copy-sources') groups.push(JSON.parse(node.initializer.expression.text));
    ts.forEachChild(node, visit);
  }
  visit(output);
  assert.deepEqual(groups.map(group => group.map(entry => entry.id)), [['outer'], ['inner', 'body']]);
  assert.equal(groups[0][0].attribute, 'title');
});

test('registered JSX expression and self-closing attribute carry durable IDs', () => {
  const source = 'const page = <><h1>{/* @copy-text heading */ "Hello"}</h1><input placeholder={/* @copy-text help */ ""} /></>;';
  const entries = [entryFor(source, 'Hello', 'heading'), entryFor(source, '', 'help')];
  const result = instrumentCopySource(source, 'src/Profile.tsx', entries);
  assert.ok(result); const parsed = ts.createSourceFile('src/Profile.tsx', result.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(parsed.parseDiagnostics.length, 0); assert.match(result.code, /data-copy-sources/);
});

test('callback messages and non-JSX helper text are not attached to unrelated UI elements', () => {
  const source = 'const text = "Helper"; const page = <button onClick={() => alert("Message")}>Button</button>;';
  assert.equal(instrumentCopySource(source, 'src/Profile.tsx', [entryFor(source, 'Helper', 'helper'), entryFor(source, 'Message', 'message')]), null);
});

test('a fallback source is active only when the rendered branch supplies the literal', () => {
  for (const name of ['User', null]) {
    const source = 'const member = {name: ' + JSON.stringify(name) + '}; const page = <h1>{member.name ?? "Fallback"}</h1>;';
    const result = instrumentCopySource(source, 'src/Profile.tsx', [entryFor(source, 'Fallback', 'fallback')]);
    const compiled = ts.transpileModule(result.code, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
    const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
    const page = new Function('React', compiled + '\nreturn page;')(React);
    assert.equal(JSON.parse(page.props['data-copy-sources'])[0].active, name === null);
    assert.equal(page.children[0], name ?? 'Fallback');
  }
});

test('source metadata does not re-evaluate callback conditions with side effects', () => {
  const source = 'const page = <h1>{getName() ?? "Fallback"}</h1>;';
  const result = instrumentCopySource(source, 'src/Profile.tsx', [entryFor(source, 'Fallback', 'fallback')]);
  assert.equal((result.code.match(/getName\(\)/g) ?? []).length, 1);
});

function visualNode(source, predicate, entry) {
  const parsed = ts.createSourceFile('src/Visual.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) { if (predicate(node, parsed)) found = node; ts.forEachChild(node, visit); }
  visit(parsed); assert.ok(found, 'Visual source node must exist');
  return { id: 'visual.' + entry.label, file: 'src/Visual.tsx', line: 1, textEntryIds: [],
    nodeStart: found.getStart(parsed), nodeEnd: found.end, ...entry };
}
function render(source) {
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
  return new Function('React', 'Icon', compiled + '\nreturn {page,modules:typeof modules!=="undefined"?modules:undefined};')(React, 'Icon');
}

test('only registered hidden visual gates render for the isolated preview and retain hidden metadata', () => {
  const source = 'const page = <>{/* @copy-visual icon */ false && <Icon name="i-star" />}{false && <p>unrelated</p>}</>;';
  const entry = visualNode(source, node => ts.isJsxSelfClosingElement(node) && node.tagName.text === 'Icon',
    { label: 'star', kind: 'icon', visible: false, icon: 'i-star', hiddenGateStart: source.indexOf('false'), hiddenGateEnd: source.indexOf('false') + 5 });
  const result = instrumentCopySource(source, 'src/Visual.tsx', [], [entry]);
  assert.ok(result); assert.match(result.code, /true && <Icon/); assert.match(result.code, /false && <p>unrelated/);
  const output = ts.createSourceFile('src/Visual.tsx', result.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(output.parseDiagnostics.length, 0);
  assert.match(result.code, /data-copy-visual/); assert.equal(source.includes('data-copy-visual'), false);
});

test('icon map metadata distinguishes identical glyphs and restores a hidden map icon in preview only', () => {
  const source = 'const modules = [{id:"one",icon:""},{id:"two",icon:"i-star",}]; const page = modules.map(m => <Icon name={m.icon} />);';
  const entries = ['', 'i-star'].map((icon, index) => visualNode(source,
    node => ts.isStringLiteral(node) && node.text === icon && ts.isPropertyAssignment(node.parent) && node.parent.name.text === 'icon',
    { id: 'map.' + index, label: String(index), kind: 'icon', visible: index !== 0, icon: 'i-star' }));
  const result = instrumentCopySource(source, 'src/Visual.tsx', [], entries); assert.ok(result);
  const { page, modules } = render(result.code);
  // The real source stays empty; isolated map restoration lets components which
  // skip empty icon names render a reversible hidden preview target.
  assert.equal(source.includes('icon:""'), true);
  assert.equal(modules[0].icon, 'i-star'); assert.equal(modules[1].icon, 'i-star');
  assert.deepEqual(page.map(node => node.props.name), ['i-star', 'i-star']);
  assert.deepEqual(page.map(node => JSON.parse(node.props['data-copy-visual'])[0].id), ['map.0', 'map.1']);
  assert.deepEqual(page.map(node => JSON.parse(node.props['data-copy-visual'])[0].visible), [false, true]);
});

test('unregistered user icon properties are never given a visual source identity', () => {
  const source = 'const member = {icon:"i-user",name:"Private"}; const page = <Icon name={member.icon} />;';
  const result = instrumentCopySource(source, 'src/Visual.tsx', [], []); assert.ok(result);
  const { page } = render(result.code);
  assert.equal(page.props.name, 'i-user'); assert.deepEqual(JSON.parse(page.props['data-copy-visual']), []);
  assert.equal(result.code.includes('__copyIconSource:'), false);
});

test('text element visual identity preserves text identities and never moves a button into its hide scope', () => {
  const source = 'const page = <><p>Help</p><button>Action</button></>;';
  const entry = visualNode(source, node => ts.isJsxElement(node) && node.openingElement.tagName.text === 'p',
    { label: 'help', kind: 'text-element', visible: true, textEntryIds: ['help.text'] });
  const result = instrumentCopySource(source, 'src/Visual.tsx', [entryFor(source, 'Help', 'help.text')], [entry]); assert.ok(result);
  const output = ts.createSourceFile('src/Visual.tsx', result.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(output.parseDiagnostics.length, 0);
  const paragraph = result.code.slice(result.code.indexOf('<p'), result.code.indexOf('</p>'));
  assert.match(paragraph, /data-copy-sources/); assert.match(paragraph, /data-copy-visual/);
  assert.equal(result.code.slice(result.code.indexOf('<button')).includes('data-copy-visual'), false);
});

test('native icon metadata serializes static SVG geometry without evaluating its dynamic presentation', () => {
  const source = 'const page = <svg viewBox="0 0 24 24"><use href="#i-money" /></svg>;';
  const originalSvg = '<svg width={getSize()} className={className} viewBox="0 0 48 48"><circle cx={24} cy="24" r={20} strokeWidth={2} /></svg>';
  const entry = visualNode(source, node => ts.isJsxElement(node) && node.openingElement.tagName.text === 'svg',
    { label: 'native', kind: 'icon', visible: true, icon: 'i-money', nativeIcon: true, originalSvg });
  const result = instrumentCopySource(source, 'src/Visual.tsx', [], [entry]);
  const { page } = render(result.code), metadata = JSON.parse(page.props['data-copy-visual'])[0];
  assert.equal(metadata.nativeIcon, true);
  assert.match(metadata.nativeSvg, /viewBox="0 0 48 48"/);
  assert.match(metadata.nativeSvg, /stroke-width="2"/);
  assert.equal(metadata.nativeSvg.includes('getSize'), false);
  assert.equal(metadata.nativeSvg.includes('className'), false);
});
