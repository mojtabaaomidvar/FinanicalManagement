import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { resolve, relative, sep, extname, join } from 'node:path';
import ts from 'typescript';
import { collectCatalog, CatalogError } from './catalog.mjs';

const catalogPlans = new WeakMap();
const digest = value => createHash('sha256').update(value).digest('hex');
const slash = value => value.split(sep).join('/');
const keyPattern = '[A-Za-z0-9_./:@-]+';
const visualMarker = new RegExp('^\\s*@copy-visual\\s+(' + keyPattern + ')(?:\\s+svg:([A-Za-z0-9_-]+))?\\s*$');
const bindingMarker = new RegExp('^\\s*@copy-visual-icon\\s+(' + keyPattern + ')\\s+(i-[A-Za-z0-9_-]+)(?:\\s+(short|full))?\\s*$');
const textMarker = new RegExp('@copy-text\\s+(' + keyPattern + ')');
const plainTags = new Set(['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'small', 'strong', 'b', 'em', 'i',
  'div', 'section', 'article', 'aside', 'header', 'footer', 'li']);
const svgGeometry = new Set(['svg', 'g', 'path', 'circle', 'line', 'rect', 'polyline', 'polygon', 'ellipse', 'use']);
const authoredFields = new Set(['familyId', 'family_id', 'memberId', 'member_id', 'accountId', 'account_id', 'phone', 'password', 'revision', 'ownerId', 'owner_id', 'birth_date', 'createdAt', 'created_at']);
const normalize = value => String(value).replace(/\s+/g, ' ').trim();
const tagOf = node => (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText();
const openingOf = node => ts.isJsxElement(node) ? node.openingElement : node;
const propertyName = node => ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : node.getText();
const unwrap = node => { while (node && ts.isParenthesizedExpression(node)) node = node.expression; return node; };
const literal = node => {
  node = unwrap(node);
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node : null;
};
const attributesOf = node => openingOf(node).attributes.properties.filter(ts.isJsxAttribute);
const unsafeAttributes = node => openingOf(node).attributes.properties.some(value => !ts.isJsxAttribute(value)
  || /^on[A-Z]|^(?:role|tabIndex|contentEditable|dangerouslySetInnerHTML|ref)$/.test(propertyName(value.name)));
const attribute = (node, name) => attributesOf(node).find(value => propertyName(value.name) === name);
const attributeLiteral = value => value?.initializer && (ts.isJsxExpression(value.initializer) ? literal(value.initializer.expression) : literal(value.initializer));
const quote = value => JSON.stringify(value);

function beforeComment(source, node, sf) {
  const start = node.getStart(sf), full = node.getFullStart();
  const match = /\/\*([\s\S]*?)\*\/\s*$/.exec(source.slice(full, start));
  return match ? { value: match[1], start: full + match.index } : null;
}

function markedWrapper(source, target, sf) {
  let right = target;
  while (right.parent && ts.isParenthesizedExpression(right.parent)) right = right.parent;
  const binary = right.parent;
  if (!binary || !ts.isBinaryExpression(binary) || binary.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken || binary.right !== right) return null;
  const left = unwrap(binary.left);
  if (![ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(left?.kind)) return null;
  const comment = beforeComment(source, left, sf), marker = comment && visualMarker.exec(comment.value);
  if (!marker) return null;
  let wrapper = binary;
  while (wrapper.parent && ts.isParenthesizedExpression(wrapper.parent)) wrapper = wrapper.parent;
  if (wrapper.parent && ts.isJsxExpression(wrapper.parent)) wrapper = wrapper.parent;
  let originalSvg;
  if (marker[2]) {
    try { originalSvg = Buffer.from(marker[2], 'base64url').toString('utf8'); } catch { return null; }
    if (Buffer.byteLength(originalSvg) > 16000) return null;
  }
  return { id: marker[1], visible: left.kind === ts.SyntaxKind.TrueKeyword, start: wrapper === binary ? comment.start : wrapper.getStart(sf), end: wrapper.end, wrapper,
    hiddenGateStart: left.getStart(sf), hiddenGateEnd: left.end, originalSvg };
}

function isInsideAuthoredRecord(node, sf) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent) && parent.expression.getText(sf).split('.').at(-1) === 'useState') return true;
    if (ts.isObjectLiteralExpression(parent) && parent.properties.some(value => value.name && authoredFields.has(propertyName(value.name)))) return true;
  }
  return false;
}

function staticBody(node, source, sf, textEntries, originalNode = node, originalSf = sf) {
  if (!ts.isJsxElement(node) || !plainTags.has(tagOf(node)) || unsafeAttributes(node)) return null;
  const textIds = [], words = [];
  const record = (child, text, originalChild) => {
    const comment = beforeComment(source, child, sf), marker = comment && textMarker.exec(comment.value);
    const original = originalChild && (ts.isJsxExpression(originalChild) ? literal(originalChild.expression) : originalChild);
    const matched = marker ? textEntries.filter(entry => entry.id === marker[1]) : textEntries.filter(entry =>
      original && (entry.nodeStart ?? entry.sourceStart) === original.getStart(originalSf) && (entry.nodeEnd ?? entry.sourceEnd) === original.end);
    // Rebase by the same JSX child, never by matching wording from another occurrence.
    const entries = matched;
    if (!entries.length && !normalize(text)) return true;
    if (!entries.length) return false;
    textIds.push(...entries.map(entry => entry.id)); words.push(text); return true;
  };
  function visit(parent, originalParent) {
    if (!originalParent || !ts.isJsxElement(originalParent) || tagOf(originalParent) !== tagOf(parent) || parent.children.length !== originalParent.children.length) return false;
    for (const [index, child] of parent.children.entries()) {
      const originalChild = originalParent.children[index];
      if (ts.isJsxText(child)) {
        const value = source.slice(child.pos, child.end);
        if (normalize(value) && !record(child, value, originalChild)) return false;
      } else if (ts.isJsxExpression(child)) {
        if (!child.expression) continue;
        const value = literal(child.expression);
        if (!value || !record(value, value.text, originalChild)) return false;
      } else if ((ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && tagOf(child) === 'Icon'
        && !unsafeAttributes(child) && attributeLiteral(attribute(child, 'name'))?.text?.startsWith('i-')) {
        continue;
      } else if (ts.isJsxElement(child) && tagOf(child) === 'svg' && safeSvg(child, sf)) {
        continue;
      } else if (ts.isJsxElement(child) && plainTags.has(tagOf(child)) && !unsafeAttributes(child)) {
        if (!visit(child, originalChild)) return false;
      } else return false;
    }
    return true;
  }
  return visit(node, originalNode) && textIds.length ? { ids: [...new Set(textIds)], label: normalize(words.join(' ')) } : null;
}

function decorativeParent(node) {
  const parent = node.parent;
  if (!parent || !ts.isJsxElement(parent) || tagOf(parent) !== 'span') return node;
  if (unsafeAttributes(parent)) return node;
  const children = parent.children.filter(value => !ts.isJsxText(value) || normalize(value.text));
  return children.length === 1 && children[0] === node ? parent : node;
}

function safeSvg(node, sf) {
  if (!node || !ts.isJsxElement(node) || tagOf(node) !== 'svg' || unsafeAttributes(node)) return false;
  function visit(element) {
    if (!svgGeometry.has(tagOf(element)) || unsafeAttributes(element)) return false;
    for (const value of attributesOf(element)) {
      const name = propertyName(value.name);
      if (/^on[A-Z]/.test(name) || ['dangerouslySetInnerHTML', 'ref'].includes(name)) return false;
      if (name === 'href' || name === 'xlinkHref') {
        const text = attributeLiteral(value)?.text;
        if (!text || !/^#i-[A-Za-z0-9_-]+$/.test(text)) return false;
      }
      const fixed = attributeLiteral(value)?.text;
      if (fixed && [...fixed.matchAll(/url\s*\(([^)]*)\)/gi)].some(match => !/^['"]?#/.test(match[1].trim()))) return false;
      if (element !== node && value.initializer && ts.isJsxExpression(value.initializer)) {
        const expression = unwrap(value.initializer.expression);
        if (!expression || !(literal(expression) || ts.isNumericLiteral(expression) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(expression.kind))) return false;
      }
    }
    if (ts.isJsxElement(element)) for (const child of element.children) {
      if (ts.isJsxText(child) && !normalize(child.text)) continue;
      if (!(ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) || !visit(child)) return false;
    }
    return true;
  }
  return visit(node);
}

function parsedSvg(source) {
  const sf = ts.createSourceFile('native-svg.tsx', '(' + source + ')', ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = unwrap(sf.statements[0]?.expression);
  return !sf.parseDiagnostics.length && safeSvg(node, sf) ? { sf, node } : null;
}

function iconContracts(files) {
  const types = new Map(), components = new Map();
  const parsed = files.map(file => ts.createSourceFile(file.file, file.source, ts.ScriptTarget.Latest, true,
    /\.(?:tsx|jsx)$/.test(file.file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
  for (const sf of parsed) {
    const visit = node => {
      if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) types.set(node.name.text, node.type ?? node);
      if (ts.isFunctionDeclaration(node) && node.name && node.parameters[0]?.type) components.set(node.name.text, node.parameters[0].type);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  function required(type, property, seen = new Set()) {
    if (!type || seen.has(type)) return undefined;
    seen.add(type);
    if (ts.isArrayTypeNode(type)) return required(type.elementType, property, seen);
    if (ts.isTypeReferenceNode(type)) {
      const name = type.typeName.getText();
      if (name === 'Partial') return false;
      if (['Array', 'ReadonlyArray', 'Readonly'].includes(name)) return required(type.typeArguments?.[0], property, seen);
      if (name === 'Record') return required(type.typeArguments?.[1], property, seen) ?? true;
      return required(types.get(name), property, seen);
    }
    if (ts.isTypeLiteralNode(type) || ts.isInterfaceDeclaration(type)) {
      const member = type.members.find(member => member.name && propertyName(member.name) === property);
      return member ? !member.questionToken : undefined;
    }
    return undefined;
  }
  return { required, components };
}

function bindingIsRequired(node, owner, asAttribute, sf, contracts, property) {
  if (asAttribute) return contracts.required(contracts.components.get(tagOf(owner)), property) === true;
  let value = owner;
  while (value.parent && ts.isParenthesizedExpression(value.parent)) value = value.parent;
  if (value.parent && ((ts.isBinaryExpression(value.parent) && value.parent.right === value
    && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(value.parent.operatorToken.kind))
    || ts.isConditionalExpression(value.parent))) return true;
  for (let parent = owner.parent; parent && !ts.isFunctionLike(parent); parent = parent.parent) {
    if (ts.isVariableDeclaration(parent)) {
      const result = contracts.required(parent.type, property);
      if (result !== undefined) return result;
      // Tuple/object literal inference with `as const` depends on all its keys.
      if (parent.initializer && ts.isAsExpression(parent.initializer) && parent.initializer.type.getText(sf) === 'const') return true;
      break;
    }
  }
  return false;
}

async function sources(root, sourceOverrides) {
  const files = [];
  const overrides = new Map(sourceOverrides.map(value => [value.file, value]));
  async function walk(path) {
    let children;
    try { children = await readdir(path, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const child of children) {
      const absolute = join(path, child.name), file = slash(relative(root, absolute));
      if (child.isSymbolicLink() || /(?:^|\/)(?:node_modules|tests?|fixtures?|__pycache__)\//.test(file)) continue;
      if (child.isDirectory()) await walk(absolute);
      else if (['.ts', '.tsx', '.js', '.jsx'].includes(extname(absolute)) && !/\.(?:test|spec)\./.test(file)) {
        const actual = await realpath(absolute);
        if (actual !== absolute || !actual.startsWith(root + sep)) continue;
        const original = await readFile(actual, 'utf8'), override = overrides.get(file);
        if (override && (override.original !== original || typeof override.updated !== 'string')) throw new CatalogError('SOURCE_CHANGED', 'فایل هم‌زمان تغییر کرده است.', 409);
        files.push({ file, original, source: override?.updated ?? original }); overrides.delete(file);
      }
    }
  }
  await walk(join(root, 'src'));
  if (overrides.size) throw new CatalogError('PATH_DENIED', 'مسیر تغییر بصری مجاز نیست.', 403);
  return files.sort((a, b) => a.file.localeCompare(b.file, 'en'));
}

export async function collectIconOptions(root) {
  let html = '';
  try { html = await readFile(join(root, 'index.html'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const icons = [], symbols = [];
  for (const match of html.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol\s*>/gi)) {
    const id = /\bid\s*=\s*["'](i-[A-Za-z0-9_-]+)["']/.exec(match[1])?.[1];
    if (!id || icons.some(icon => icon.id === id)) continue;
    const markup = match[0];
    if (/<(?:script|foreignObject|image|iframe)\b|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:)/i.test(markup)) continue;
    if (!parsedSvg(markup.replace(/^<symbol\b/i, '<svg').replace(/<\/symbol\s*>$/i, '</svg>'))) continue;
    icons.push({ id, label: id.slice(2).replaceAll('-', ' ') }); symbols.push(markup);
  }
  return { icons, sprite: '<svg xmlns="http://www.w3.org/2000/svg"><defs>' + symbols.join('') + '</defs></svg>' };
}

/** Static source-only visual allowlist. No modules, backend data or credentials are loaded. */
export async function collectVisualCatalog(workspaceRoot, textCatalog, { sourceOverrides = [] } = {}) {
  const root = await realpath(resolve(workspaceRoot));
  textCatalog ??= await collectCatalog(root);
  const files = await sources(root, sourceOverrides);
  const contracts = iconContracts(files);
  const { icons, sprite } = await collectIconOptions(root), symbolIds = new Set(icons.map(icon => icon.id));
  const plans = new Map(), pending = [];
  for (const file of files) {
    const sf = ts.createSourceFile(file.file, file.source, ts.ScriptTarget.Latest, true, /\.(?:tsx|jsx)$/.test(file.file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (sf.parseDiagnostics.length) throw new CatalogError('SOURCE_SYNTAX', 'فایل برای ویرایش بصری قابل بررسی نیست.');
    const textEntries = textCatalog.entries.filter(entry => entry.file === file.file);
    const originalSf = file.source === file.original ? sf : ts.createSourceFile(file.file, file.original, ts.ScriptTarget.Latest, true,
      /\.(?:tsx|jsx)$/.test(file.file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const originalJsxNodes = [];
    function originalVisit(node) { if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) originalJsxNodes.push(node); ts.forEachChild(node, originalVisit); }
    originalVisit(originalSf);
    let jsxOrdinal = 0, objectOrdinal = 0;
    const objectOrdinals = new Map();
    const normalizedIcon = value => symbolIds.has(value) ? { icon: value, prefix: '' } : symbolIds.has('i-' + value) ? { icon: 'i-' + value, prefix: 'i-' } : null;
    function addJsx(node, target, kind, idBase, icon, body, originalSvg, iconLiteral) {
      const marked = markedWrapper(file.source, target, sf);
      if (marked?.originalSvg && !parsedSvg(marked.originalSvg)) return;
      const id = marked?.id ?? idBase;
      const native = originalSvg || marked?.originalSvg;
      if (native && Buffer.byteLength(native) > 16000) return;
      const entry = { id, file: file.file, line: sf.getLineAndCharacterOfPosition(target.getStart(sf)).line + 1, kind,
        label: body?.label || (icon ? 'آیکون ' + icon : 'آیکون اصلی'), context: tagOf(target), visible: marked?.visible ?? true, deletable: true,
        ...(kind === 'icon' ? { icon: icon ?? null, nativeIcon: Boolean(native), ...(native ? { originalSvg: native } : {}) } : {}), textEntryIds: body?.ids ?? [],
        sourceStart: marked?.start ?? target.getStart(sf), sourceEnd: marked?.end ?? target.end, nodeStart: target.getStart(sf), nodeEnd: target.end,
        iconNodeStart: node.getStart(sf), iconNodeEnd: node.end, scope: 'jsx', ...(marked ? { hiddenGateStart: marked.hiddenGateStart, hiddenGateEnd: marked.hiddenGateEnd } : {}) };
      pending.push({ entry, plan: { file, sf, target, node, marked, iconLiteral, originalSvg: native } });
    }
    function addBinding(node, owner, idBase, bindingProperty, asAttribute) {
      if (isInsideAuthoredRecord(node, sf)) return;
      const comment = beforeComment(file.source, node, sf), marked = comment && bindingMarker.exec(comment.value);
      const normalized = normalizedIcon(node.text), originalIcon = marked?.[2];
      if (!normalized && !(marked && node.text === '' && symbolIds.has(originalIcon))) return;
      const icon = normalized?.icon ?? originalIcon;
      const prefix = normalized?.prefix ?? (marked?.[3] === 'short' ? 'i-' : '');
      const expression = asAttribute && ts.isJsxExpression(node.parent) ? node.parent : null;
      const requiredBinding = bindingIsRequired(node, owner, asAttribute, sf, contracts, bindingProperty);
      const entry = { id: marked?.[1] ?? idBase, file: file.file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        kind: 'icon', icon, nativeIcon: false, visible: node.text !== '', label: 'آیکون ' + icon, context: bindingProperty,
        deletable: !requiredBinding, ...(requiredBinding ? { deleteReason: 'این آیکون بخشی از قرارداد یک مؤلفه یا نگاشت است؛ حذف مستقل آن نیاز به تغییر همان مؤلفه دارد.' } : {}),
        textEntryIds: [], sourceStart: expression?.getStart(sf) ?? (marked ? comment.start : node.getStart(sf)), sourceEnd: expression?.end ?? node.end,
        nodeStart: node.getStart(sf), nodeEnd: node.end, scope: 'icon-binding', iconPrefix: prefix, bindingProperty,
        ...(ts.isObjectLiteralExpression(owner) ? { ownerObjectStart: owner.getStart(sf), ownerObjectEnd: owner.end } : { ownerNodeStart: owner.getStart(sf), ownerNodeEnd: owner.end }) };
      pending.push({ entry, plan: { file, sf, target: node, owner, prefix, asAttribute, marked: Boolean(marked) } });
    }
    function visit(node) {
      if (ts.isObjectLiteralExpression(node)) objectOrdinals.set(node, ++objectOrdinal);
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const ordinal = ++jsxOrdinal, tag = tagOf(node);
        if (tag === 'Icon') {
          const name = attributeLiteral(attribute(node, 'name'));
          if (name && symbolIds.has(name.text) && !unsafeAttributes(node)) addJsx(node, decorativeParent(node), 'icon', file.file + ':visual:' + ordinal + ':icon', name.text, null, null, name);
        } else if (tag === 'svg' && safeSvg(node, sf)) {
          const uses = [];
          function usesIn(element) {
            if ((ts.isJsxElement(element) || ts.isJsxSelfClosingElement(element)) && tagOf(element) === 'use') {
              const name = attributeLiteral(attribute(element, 'href') ?? attribute(element, 'xlinkHref'));
              if (name && symbolIds.has(name.text.slice(1))) uses.push(name);
            }
            ts.forEachChild(element, usesIn);
          }
          usesIn(node);
          const marked = markedWrapper(file.source, decorativeParent(node), sf);
          const original = marked?.originalSvg ?? (uses.length ? null : file.source.slice(node.getStart(sf), node.end));
          if (uses.length <= 1 && (uses.length || original)) addJsx(node, decorativeParent(node), 'icon', file.file + ':visual:' + ordinal + ':icon', uses[0]?.text.slice(1), null, original, uses[0]);
        } else {
          const body = staticBody(node, file.source, sf, textEntries, originalJsxNodes[ordinal - 1], originalSf);
          if (body) addJsx(node, node, 'text-element', file.file + ':visual:' + ordinal + ':text', null, body);
          for (const value of attributesOf(node)) {
            const name = propertyName(value.name), valueNode = attributeLiteral(value);
            if (name === 'icon' && valueNode) addBinding(valueNode, node, file.file + ':visual:' + ordinal + ':icon-attribute', name, true);
          }
        }
      }
      if (ts.isPropertyAssignment(node) && node.name && literal(node.initializer) && ts.isObjectLiteralExpression(node.parent)) {
        const name = propertyName(node.name), declaration = [];
        for (let parent = node.parent; parent; parent = parent.parent) if (ts.isVariableDeclaration(parent)) { declaration.push(parent.name.getText(sf)); break; }
        if (['icon', 'glyph', 'iconName'].includes(name) || declaration.some(value => /ICON/i.test(value))) addBinding(literal(node.initializer), node.parent,
          file.file + ':visual-object:' + objectOrdinals.get(node.parent) + ':' + name, name, false);
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }
  const reserved = new Set();
  for (const { entry, plan } of pending) if (plan.marked) {
    if (reserved.has(entry.id)) throw new CatalogError('DUPLICATE_VISUAL_ID', 'شناسهٔ عنصر بصری تکراری است.');
    reserved.add(entry.id);
  }
  for (const { entry, plan } of pending) {
    if (!plan.marked && reserved.has(entry.id)) entry.id = 'auto:' + entry.id;
    if (plans.has(entry.id)) throw new CatalogError('DUPLICATE_VISUAL_ID', 'شناسهٔ عنصر بصری تکراری است.');
    plans.set(entry.id, { ...plan, entry });
  }
  const result = { revision: textCatalog.revision, entries: pending.map(value => value.entry), icons, sprite,
    stats: { entries: pending.length, icons: pending.filter(value => value.entry.kind === 'icon').length, textElements: pending.filter(value => value.entry.kind === 'text-element').length } };
  catalogPlans.set(result, { root, files, plans }); return result;
}

function wrapJsx(plan, id, visible, code, originalSvg) {
  const marker = '/* @copy-visual ' + id + (originalSvg ? ' svg:' + Buffer.from(originalSvg).toString('base64url') : '') + ' */ ';
  const expression = marker + (visible ? 'true' : 'false') + ' && ' + code;
  const parent = plan.marked ? null : plan.target.parent;
  const inJsx = plan.marked ? ts.isJsxExpression(plan.target.parent?.parent?.parent) || plan.file.source[plan.marked.start] === '{'
    : parent && (ts.isJsxElement(parent) || ts.isJsxFragment(parent));
  return inJsx ? '{' + expression + '}' : '(' + expression + ')';
}

function replacedIcon(plan, icon) {
  let code = plan.file.source.slice(plan.target.getStart(plan.sf), plan.target.end);
  if (icon === plan.entry.icon) return code;
  if (plan.originalSvg && icon === null) {
    const nodeStart = plan.node.getStart(plan.sf) - plan.target.getStart(plan.sf), nodeEnd = plan.node.end - plan.target.getStart(plan.sf);
    return code.slice(0, nodeStart) + plan.originalSvg + code.slice(nodeEnd);
  }
  if (!icon) throw new CatalogError('INVALID_ICON', 'آیکون انتخاب‌شده معتبر نیست.');
  const spriteViewBox = updated => {
    if (tagOf(plan.node) !== 'svg') return updated;
    const viewBox = attribute(plan.node, 'viewBox'), base = plan.target.getStart(plan.sf);
    const start = viewBox ? viewBox.getStart(plan.sf) - base : plan.node.openingElement.end - base - 1;
    const end = viewBox ? viewBox.end - base : start;
    return updated.slice(0, start) + (viewBox ? '' : ' ') + 'viewBox="0 0 24 24"' + updated.slice(end);
  };
  if (plan.iconLiteral) {
    const value = tagOf(plan.node) === 'Icon' ? icon : '#' + icon;
    const start = plan.iconLiteral.getStart(plan.sf) - plan.target.getStart(plan.sf), end = plan.iconLiteral.end - plan.target.getStart(plan.sf);
    return spriteViewBox(code.slice(0, start) + quote(value) + code.slice(end));
  }
  if (tagOf(plan.node) === 'svg') {
    const start = plan.node.openingElement.end - plan.target.getStart(plan.sf), end = plan.node.closingElement.getStart(plan.sf) - plan.target.getStart(plan.sf);
    return spriteViewBox(code.slice(0, start) + '<use href=' + quote('#' + icon) + ' />' + code.slice(end));
  }
  throw new CatalogError('INVALID_ICON', 'آیکون این عنصر قابل جایگزینی نیست.');
}

function deletionEdit(plan) {
  if (plan.entry.scope === 'icon-binding') {
    let owned = plan.target;
    while (owned.parent && !(ts.isJsxAttribute(owned) || ts.isPropertyAssignment(owned))) owned = owned.parent;
    if (ts.isJsxAttribute(owned)) return { start: owned.getStart(plan.sf), end: owned.end, replacement: '', deleted: true };
    if (!ts.isPropertyAssignment(owned) || !ts.isObjectLiteralExpression(owned.parent)) throw new CatalogError('DELETE_UNSUPPORTED', 'محل حذف آیکون قابل تشخیص نیست.');
    const next = owned.parent.properties[owned.parent.properties.indexOf(owned) + 1];
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard,
      plan.file.source.slice(owned.end, next?.getStart(plan.sf) ?? owned.parent.end - 1));
    const commaEnd = scanner.scan() === ts.SyntaxKind.CommaToken ? scanner.getTextPos() : 0;
    return { start: owned.getStart(plan.sf), end: owned.end + commaEnd, replacement: '', deleted: true };
  }
  let owned = plan.marked?.wrapper ?? plan.target;
  if (!plan.marked) {
    while (owned.parent && ts.isParenthesizedExpression(owned.parent)) owned = owned.parent;
    if (owned.parent && ts.isJsxExpression(owned.parent) && owned.parent.expression === owned) owned = owned.parent;
  }
  const jsxChild = owned.parent && (ts.isJsxElement(owned.parent) || ts.isJsxFragment(owned.parent));
  return { start: plan.marked?.start ?? owned.getStart(plan.sf), end: owned.end, replacement: jsxChild ? '' : 'null', deleted: true };
}

/** Rebase private prepared text files, then prepare visual edits. No source writes. */
export async function prepareVisualChanges(workspaceRoot, suppliedCatalog, request, { sourceOverrides = [] } = {}) {
  if (!request || !Array.isArray(request.changes) || request.changes.length > 2000 || typeof request.revision !== 'string') throw new CatalogError('INVALID_VISUAL_CHANGES', 'تغییرهای بصری نامعتبرند.');
  const textCatalog = await collectCatalog(workspaceRoot), current = await collectVisualCatalog(workspaceRoot, textCatalog);
  if (request.revision !== current.revision || suppliedCatalog?.revision !== current.revision) throw new CatalogError('STALE_CATALOG', 'کد از زمان دریافت فهرست تغییر کرده است.', 409);
  const originalPlans = catalogPlans.get(current).plans, seen = new Set();
  for (const change of request.changes) {
    if (!change || typeof change.id !== 'string' || typeof change.visible !== 'boolean' || !change.expected || typeof change.expected.visible !== 'boolean'
      || (Object.hasOwn(change, 'deleted') && typeof change.deleted !== 'boolean')) throw new CatalogError('INVALID_VISUAL_CHANGES', 'تغییر بصری نامعتبر است.');
    if (seen.has(change.id)) throw new CatalogError('DUPLICATE_CHANGE', 'یک عنصر دو بار ویرایش شده است.');
    seen.add(change.id);
    const original = originalPlans.get(change.id);
    if (!original) throw new CatalogError('UNKNOWN_VISUAL_ENTRY', 'عنصر در فهرست ویرایش بصری نیست.');
    if (change.deleted && original.entry.deletable === false) throw new CatalogError('DELETE_UNSUPPORTED', original.entry.deleteReason ?? 'این عنصر حذف مستقل ندارد.');
    if (original.entry.visible !== change.expected.visible || (original.entry.kind === 'icon' && original.entry.icon !== change.expected.icon)) throw new CatalogError('STALE_VISUAL', 'وضعیت اصلی عنصر تغییر کرده است.', 409);
    if (Object.hasOwn(change, 'icon') && original.entry.kind !== 'icon') throw new CatalogError('INVALID_ICON', 'این عنصر آیکون نیست.');
    if (Object.hasOwn(change, 'icon') && !(change.icon === null && original.originalSvg) && !current.icons.some(icon => icon.id === change.icon)) throw new CatalogError('INVALID_ICON', 'آیکون انتخاب‌شده در نرم‌افزار وجود ندارد.');
  }
  const rebased = sourceOverrides.length ? await collectVisualCatalog(workspaceRoot, textCatalog, { sourceOverrides }) : current;
  const rebasedPlans = catalogPlans.get(rebased).plans, groups = new Map();
  for (const change of request.changes) {
    const plan = rebasedPlans.get(change.id);
    if (!plan) throw new CatalogError('OVERLAPPING_CHANGES', 'تغییر متن، محل عنصر بصری را تغییر داده است؛ آن‌ها را جدا اعمال کن.');
    const icon = Object.hasOwn(change, 'icon') ? change.icon : plan.entry.icon;
    if (!change.deleted && change.visible === plan.entry.visible && icon === plan.entry.icon) continue;
    const group = groups.get(plan.file.file) ?? { file: plan.file.file, original: plan.file.original, source: plan.file.source, edits: [] };
    if (change.deleted) {
      group.edits.push(deletionEdit(plan)); groups.set(plan.file.file, group); continue;
    }
    let replacement;
    if (plan.entry.scope === 'icon-binding') {
      const value = change.visible ? (plan.prefix ? icon.slice(2) : icon) : '';
      const content = '/* @copy-visual-icon ' + plan.entry.id + ' ' + icon + (plan.prefix ? ' short' : ' full') + ' */ ' + quote(value);
      replacement = plan.asAttribute ? '{' + content + '}' : content;
    } else {
      const code = plan.entry.kind === 'icon' ? replacedIcon(plan, icon) : plan.file.source.slice(plan.target.getStart(plan.sf), plan.target.end);
      replacement = wrapJsx(plan, plan.entry.id, change.visible, code, plan.originalSvg);
    }
    group.edits.push({ start: plan.entry.sourceStart, end: plan.entry.sourceEnd, replacement }); groups.set(plan.file.file, group);
  }
  const results = [];
  for (const group of groups.values()) {
    // A selected container deletion also removes drafts for its descendants.
    // Other overlaps remain errors; no text or icon is matched by wording.
    const outerFirst = group.edits.sort((a, b) => a.start - b.start || b.end - a.end || Number(Boolean(b.deleted)) - Number(Boolean(a.deleted)));
    const retained = [];
    for (const edit of outerFirst) {
      if (retained.some(parent => parent.deleted && parent.start <= edit.start && parent.end >= edit.end)) continue;
      retained.push(edit);
    }
    const edits = retained.sort((a, b) => b.start - a.start);
    for (let index = 1; index < edits.length; index++) if (edits[index].end > edits[index - 1].start) throw new CatalogError('OVERLAPPING_CHANGES', 'دو عنصر بصری انتخاب‌شده داخل هم هستند؛ آن‌ها را جدا اعمال کن.');
    let updated = group.source;
    for (const edit of edits) updated = updated.slice(0, edit.start) + edit.replacement + updated.slice(edit.end);
    const parsed = ts.createSourceFile(group.file, updated, ts.ScriptTarget.Latest, true, /\.(?:tsx|jsx)$/.test(group.file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (parsed.parseDiagnostics.length) throw new CatalogError('SOURCE_SYNTAX', 'تغییر بصری ساختار کد را نامعتبر کرده است.');
    results.push({ file: group.file, original: group.original, updated });
  }
  return results;
}
