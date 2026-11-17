import { resolve, relative, sep, extname } from 'node:path';
import ts from 'typescript';
import { collectCatalog } from './catalog.mjs';
import { collectVisualCatalog } from './visual-catalog.mjs';

const slash = value => value.split(sep).join('/');
const nodeKey = (start, end) => start + ':' + end;
function nativeSvgMarkup(source) {
  if (typeof source !== 'string' || !source) return undefined;
  const parsed = ts.createSourceFile('native.tsx', '(' + source + ')', ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (parsed.parseDiagnostics.length) return undefined;
  const aliases = { className: 'class', strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin',
    fillRule: 'fill-rule', clipRule: 'clip-rule', strokeDasharray: 'stroke-dasharray', strokeDashoffset: 'stroke-dashoffset',
    fillOpacity: 'fill-opacity', strokeOpacity: 'stroke-opacity', xlinkHref: 'href', clipPath: 'clip-path' };
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function render(node, root = false) {
    if (!node || !(ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))) return null;
    const opening = ts.isJsxElement(node) ? node.openingElement : node, tag = opening.tagName.getText(parsed);
    if (!['svg', 'g', 'path', 'circle', 'line', 'rect', 'polyline', 'polygon', 'ellipse', 'use'].includes(tag)) return null;
    const attributes = [];
    for (const attribute of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) { if (root) continue; return null; }
      const name = attribute.name.getText(parsed); if (/^on[A-Z]/.test(name)) return null;
      if (root && name !== 'viewBox') continue;
      let value = attribute.initializer;
      if (value && ts.isJsxExpression(value)) value = value.expression;
      while (value && ts.isParenthesizedExpression(value)) value = value.expression;
      if (value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) || ts.isNumericLiteral(value))) value = value.text;
      else if (value?.kind === ts.SyntaxKind.TrueKeyword) value = 'true';
      else if (value?.kind === ts.SyntaxKind.FalseKeyword) value = 'false';
      else if (!value) value = '';
      else { if (root) continue; return null; }
      if ((name === 'href' || name === 'xlinkHref') && !/^#i-[A-Za-z0-9_-]+$/.test(value)) return null;
      attributes.push((aliases[name] ?? name) + '="' + escape(value) + '"');
    }
    if (root) attributes.push('xmlns="http://www.w3.org/2000/svg"');
    const children = [];
    if (ts.isJsxElement(node)) for (const child of node.children) {
      if (ts.isJsxText(child) && !child.text.trim()) continue;
      const content = render(child); if (content === null) return null; children.push(content);
    }
    return '<' + tag + (attributes.length ? ' ' + attributes.join(' ') : '') + '>' + children.join('') + '</' + tag + '>';
  }
  const expression = parsed.statements[0]?.expression;
  return render(expression && ts.isParenthesizedExpression(expression) ? expression.expression : expression, true) ?? undefined;
}
function isPureCondition(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)
    || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true;
  if (ts.isParenthesizedExpression(node)) return isPureCondition(node.expression);
  if (ts.isPropertyAccessExpression(node)) return isPureCondition(node.expression);
  if (ts.isElementAccessExpression(node)) return isPureCondition(node.expression) && isPureCondition(node.argumentExpression);
  if (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.PlusToken,
    ts.SyntaxKind.MinusToken, ts.SyntaxKind.TildeToken].includes(node.operator)) return isPureCondition(node.operand);
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanToken,
    ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.LessThanEqualsToken].includes(node.operatorToken.kind)) return isPureCondition(node.left) && isPureCondition(node.right);
  return false;
}

/** Add source IDs to the isolated preview build without changing app source or markup structure. */
export function instrumentCopySource(source, file, entries = [], visualEntries = [], { portable = false } = {}) {
  const language = extname(file);
  if (!['.ts', '.tsx', '.js', '.jsx'].includes(language)) return null;
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    ['.tsx', '.jsx'].includes(language) ? ts.ScriptKind.TSX : language === '.js' ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  if (parsed.parseDiagnostics.length) return null;
  const byNode = new Map();
  for (const entry of entries) {
    const start = entry.nodeStart ?? entry.sourceStart, end = entry.nodeEnd ?? entry.sourceEnd;
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    const key = nodeKey(start, end), items = byNode.get(key) ?? [];
    items.push(entry); byNode.set(key, items);
  }
  const byOpening = new Map();
  const visualNodes = new Map(), visualOpening = new Map(), iconObjects = new Map(), extraEdits = [];
  const visualRecord = entry => ({ id: entry.id, kind: entry.kind, visible: entry.visible !== false,
    ...(Object.hasOwn(entry, 'icon') ? { icon: entry.icon } : {}), ...(entry.nativeIcon ? { nativeIcon: true, nativeSvg: nativeSvgMarkup(entry.originalSvg) } : {}), label: entry.label, ...(portable ? {} : { file: entry.file ?? file, line: entry.line }),
    context: entry.context, textEntryIds: entry.textEntryIds ?? [] });
  for (const entry of visualEntries) {
    if (Number.isInteger(entry.nodeStart) && Number.isInteger(entry.nodeEnd)) {
      const key = nodeKey(entry.nodeStart, entry.nodeEnd), items = visualNodes.get(key) ?? [];
      items.push(entry); visualNodes.set(key, items);
    }
    if (entry.visible === false && Number.isInteger(entry.hiddenGateStart) && Number.isInteger(entry.hiddenGateEnd)
      && source.slice(entry.hiddenGateStart, entry.hiddenGateEnd).trim() === 'false') {
      extraEdits.push({ at: entry.hiddenGateStart, end: entry.hiddenGateEnd, text: 'true' });
    }
  }
  function register(node) {
    const items = byNode.get(nodeKey(node.getStart(parsed), node.end));
    if (!items) return;
    let parent = node.parent, attribute, opening;
    const conditions = [];
    while (parent) {
      if (ts.isFunctionLike(parent)) return;
      if (ts.isJsxAttribute(parent)) attribute = parent.name.getText(parsed);
      if (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) { opening = parent; break; }
      if (ts.isJsxElement(parent)) { opening = parent.openingElement; break; }
      if (ts.isConditionalExpression(parent) && isPureCondition(parent.condition)) {
        const condition = parent.condition.getText(parsed);
        if (parent.whenTrue.pos <= node.pos && parent.whenTrue.end >= node.end) conditions.push('(' + condition + ')');
        else if (parent.whenFalse.pos <= node.pos && parent.whenFalse.end >= node.end) conditions.push('!(' + condition + ')');
      }
      if (ts.isBinaryExpression(parent) && parent.right.pos <= node.pos && parent.right.end >= node.end && isPureCondition(parent.left)) {
        const left = parent.left.getText(parsed), operator = parent.operatorToken.kind;
        if (operator === ts.SyntaxKind.QuestionQuestionToken) conditions.push('(' + left + ') == null');
        else if (operator === ts.SyntaxKind.BarBarToken) conditions.push('!(' + left + ')');
        else if (operator === ts.SyntaxKind.AmpersandAmpersandToken) conditions.push('(' + left + ')');
      }
      parent = parent.parent;
    }
    if (!opening) return;
    const recorded = byOpening.get(opening) ?? [];
    for (const entry of items) {
      if (recorded.some(value => value.id === entry.id)) continue;
      recorded.push({ id: entry.id, text: entry.text, ...(attribute ? { attribute } : {}), ...(portable ? {} : { file: entry.file ?? file,
        line: entry.line }), context: entry.context, ...(entry.tokens?.length ? { tokens: portable ? entry.tokens.map(token => typeof token === 'string' ? { token } : { token: token.token, example: token.example }) : entry.tokens } : {}),
        ...(conditions.length ? { activeExpression: conditions.map(value => '(' + value + ')').join(' && ') } : {}) });
    }
    byOpening.set(opening, recorded);
  }
  function registerVisual(node) {
    const matches = visualNodes.get(nodeKey(node.getStart(parsed), node.end));
    if (!matches) return;
    for (const entry of matches) {
      if (entry.kind === 'icon' && entry.visible === false && ts.isStringLiteral(node) && node.text === '' && entry.icon) {
        const value = entry.iconPrefix && entry.icon.startsWith(entry.iconPrefix) ? entry.icon.slice(entry.iconPrefix.length) : entry.icon;
        extraEdits.push({ at: node.getStart(parsed), end: node.end, text: JSON.stringify(value) });
      }
      const opening = ts.isJsxElement(node) ? node.openingElement
        : ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node : null;
      if (opening) {
        const records = visualOpening.get(opening) ?? [];
        if (!records.some(record => record.id === entry.id)) records.push(visualRecord(entry));
        visualOpening.set(opening, records);
        continue;
      }
      let parent = node.parent;
      if (Number.isInteger(entry.ownerNodeStart)) {
        while (parent && !(ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) && !ts.isFunctionLike(parent)) parent = parent.parent;
        if (parent && parent.getStart(parsed) === entry.ownerNodeStart && parent.end === entry.ownerNodeEnd) {
          const records = visualOpening.get(parent) ?? [];
          if (!records.some(record => record.id === entry.id)) records.push(visualRecord(entry));
          visualOpening.set(parent, records);
        }
        continue;
      }
      while (parent && !ts.isObjectLiteralExpression(parent) && !ts.isFunctionLike(parent)) parent = parent.parent;
      if (!parent || !ts.isObjectLiteralExpression(parent)) continue;
      if (Number.isInteger(entry.ownerObjectStart) && (parent.getStart(parsed) !== entry.ownerObjectStart || parent.end !== entry.ownerObjectEnd)) continue;
      const records = iconObjects.get(parent) ?? [];
      const property = ts.isPropertyAssignment(node.parent) ? node.parent.name.getText(parsed).replace(/^['"]|['"]$/g, '') : 'icon';
      if (!records.some(record => record.id === entry.id)) records.push({ ...visualRecord(entry), property });
      iconObjects.set(parent, records);
    }
  }
  const mapBindings = new Map();
  function decorativeParent(node) {
    const parent = node.parent;
    if (!parent || !ts.isJsxElement(parent) || !['span', 'i'].includes(parent.openingElement.tagName.getText(parsed))) return node;
    if (parent.openingElement.attributes.properties.some(property => ts.isJsxAttribute(property) && /^on[A-Z]|^(?:role|tabIndex)$/.test(property.name.getText(parsed)))) return node;
    const children = parent.children.filter(child => !(ts.isJsxText(child) && !child.getText(parsed).trim()));
    return children.length === 1 && children[0] === node ? parent.openingElement : node;
  }
  function registerMapBinding(node) {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
    const component = node.tagName.getText(parsed);
    const property = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute)
      && ['name', 'icon', 'href'].includes(attribute.name.getText(parsed)) && attribute.initializer && ts.isJsxExpression(attribute.initializer)
      && attribute.initializer.expression);
    if (!property || !(component === 'Icon' || property.name.getText(parsed) === 'icon' || component === 'use')) return;
    const supplied = property.initializer.expression;
    const expression = ts.isTemplateExpression(supplied) && supplied.templateSpans.length === 1 ? supplied.templateSpans[0].expression : supplied;
    if (!(ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) || !isPureCondition(expression.expression)) return;
    if (ts.isPropertyAccessExpression(expression) && !/^(?:icon|iconName|glyph|light|dark)$/.test(expression.name.text)) return;
    if (ts.isElementAccessExpression(expression) && !isPureCondition(expression.argumentExpression)) return;
    const owner = expression.expression.getText(parsed), field = ts.isPropertyAccessExpression(expression)
      ? JSON.stringify(expression.name.text) : expression.argumentExpression.getText(parsed);
    let target = decorativeParent(node);
    if (component === 'use' && node.parent && ts.isJsxElement(node.parent) && node.parent.openingElement.tagName.getText(parsed) === 'svg') {
      target = decorativeParent(node.parent.openingElement);
    }
    mapBindings.set(target, { expression: '(' + owner + ').__copyIconSource?.filter(source => source.property === (' + field + ')) ?? []' });
    if (component === 'Icon') {
      const name = expression.getText(parsed);
      extraEdits.push({ at: expression.getStart(parsed), end: expression.end,
        text: '(' + name + ' || (' + owner + ').__copyIconSource?.find(source => source.property === (' + field + '))?.icon || ' + name + ')' });
    }
  }
  function visit(node) { register(node); registerVisual(node); registerMapBinding(node); ts.forEachChild(node, visit); }
  visit(parsed);
  const edits = [...extraEdits];
  for (const [opening, records] of byOpening) {
    if (opening.attributes.properties.some(property => ts.isJsxAttribute(property) && property.name.getText(parsed) === 'data-copy-sources')) continue;
    const at = opening.end - (ts.isJsxSelfClosingElement(opening) ? 2 : 1);
    const values = records.map(({ activeExpression, ...record }) => activeExpression
      ? JSON.stringify(record).slice(0, -1) + ',"active":Boolean(' + activeExpression + ')}' : JSON.stringify(record));
    const metadata = records.some(record => record.activeExpression)
      ? 'JSON.stringify([' + values.join(',') + '])' : JSON.stringify(JSON.stringify(records));
    edits.push({ at, end: at, text: ' data-copy-sources={' + metadata + '}' });
  }
  for (const opening of new Set([...visualOpening.keys(), ...mapBindings.keys()])) {
    if (opening.attributes.properties.some(property => ts.isJsxAttribute(property) && property.name.getText(parsed) === 'data-copy-visual')) continue;
    const records = visualOpening.get(opening) ?? [], binding = mapBindings.get(opening);
    const value = binding ? 'JSON.stringify([' + records.map(record => JSON.stringify(record)).join(',')
      + (records.length ? ',' : '') + '...(' + binding.expression + ')])' : JSON.stringify(JSON.stringify(records));
    const at = opening.end - (ts.isJsxSelfClosingElement(opening) ? 2 : 1);
    edits.push({ at, end: at, text: ' data-copy-visual={' + value + '}' });
  }
  for (const [object, records] of iconObjects) {
    if (object.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(parsed) === '__copyIconSource')) continue;
    const at = object.end - 1, comma = object.properties.length && !object.properties.hasTrailingComma ? ',' : '';
    edits.push({ at, end: at, text: comma + ' __copyIconSource: ' + JSON.stringify(records) + ' ' });
  }
  if (!edits.length) return null;
  let updated = source;
  const ranges = new Set();
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    if (edit.end > edit.at) { const key = nodeKey(edit.at, edit.end); if (ranges.has(key)) continue; ranges.add(key); }
    updated = updated.slice(0, edit.at) + edit.text + updated.slice(edit.end ?? edit.at);
  }
  return { code: updated, map: null };
}

export function copySourcePlugin({ root } = {}) {
  let workspaceRoot, byFile = new Map(), visualByFile = new Map();
  return {
    name: 'copy-workbench-source-ids', enforce: 'pre', apply: 'build',
    async configResolved(config) { workspaceRoot = resolve(root ?? config.root); },
    async buildStart() {
      const catalog = await collectCatalog(workspaceRoot);
      const visuals = await collectVisualCatalog(workspaceRoot, catalog);
      byFile = new Map();
      for (const entry of catalog.entries) {
        const items = byFile.get(entry.file) ?? []; items.push(entry); byFile.set(entry.file, items);
      }
      visualByFile = new Map();
      for (const entry of visuals.entries) {
        const items = visualByFile.get(entry.file) ?? []; items.push(entry); visualByFile.set(entry.file, items);
      }
    },
    transform(source, id) {
      const path = id.split('?')[0], file = slash(relative(workspaceRoot, path));
      if (!file.startsWith('src/') || !['.ts', '.tsx', '.js', '.jsx'].includes(extname(path))) return null;
      return instrumentCopySource(source, file, byFile.get(file), visualByFile.get(file));
    },
  };
}
