import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { scanReleaseHistory } from './release-history.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const privateCatalogs = new WeakMap();
const persian = /[\u0600-\u06ff]/u;
const visibleNames = new Set(['title', 'label', 'placeholder', 'alt', 'aria-label', 'aria-description', 'aria-valuetext', 'hint', 'help', 'helpText', 'description', 'desc', 'message', 'msg', 'text', 'emptyText', 'loadingText', 'errorText', 'caption', 'sub', 'cta', 'note']);
const internalNames = new Set(['id', 'key', 'value', 'code', 'role', 'kind', 'type', 'currency', 'relation', 'gender', 'status', 'membershipState', 'icon', 'glyph', 'symbol', 'route', 'tone', 'className', 'href', 'src', 'name', 'unit', 'storeUnit', 'phone', 'password', 'pattern', 'source']);
const callProcessingNames = new Set(['includes', 'startsWith', 'endsWith', 'replace', 'replaceAll', 'match', 'matchAll', 'split', 'indexOf', 'getItem', 'setItem', 'removeItem', 'querySelector', 'querySelectorAll', 'getElementById', 'getAttribute', 'setAttribute', 'createElement', 'dispatchEvent', 'execute']);
const entityNames = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', hellip: '…', laquo: '«', raquo: '»', ndash: '–', mdash: '—', copy: '©', times: '×', minus: '−', thinsp: '\u2009', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', zwnj: '\u200c' };

export class CatalogError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'CatalogError'; this.code = code; this.status = status; }
}

const digest = value => createHash('sha256').update(value).digest('hex');
const slash = value => value.split(sep).join('/');
const decodeHtml = value => value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (raw, entity) => {
  if (entity[0] !== '#') return entityNames[entity] ?? raw;
  const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : raw;
});
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const escapeTemplate = value => value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
const normalizeBody = value => decodeHtml(value).replace(/[\t\r\n ]+/g, ' ').trim();
const copyKeyPattern = '[A-Za-z0-9_./:@-]+';
const copyMarker = new RegExp('^\\s*@copy-text\\s+(' + copyKeyPattern + ')(?:\\s+(jsx-body|attribute:[\\w:-]+))?\\s*$');
const copyComment = id => `/* @copy-text ${id} */ `;
const isRenderingFile = file => /\.(?:tsx|jsx)$/.test(file) && /(?:^src\/(?:pages|widgets|shared\/ui)\/|\/ui\/)/.test(file);

function markerBefore(source, node, sourceFile) {
  const start = node.getStart(sourceFile), fullStart = node.getFullStart();
  const trivia = source.slice(fullStart, start);
  const match = /\/\*([^*]*(?:\*(?!\/)[^*]*)*)\*\/\s*$/.exec(trivia);
  const marker = match && copyMarker.exec(match[1]);
  return marker ? { id: marker[1], format: marker[2], start: fullStart + match.index } : null;
}

function renderedJsxText(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  for (let index = 0; index < lines.length; index++) if (/[^ \t]/.test(lines[index])) lastNonEmpty = index;
  return lines.map((line, index) => {
    let text = line.replaceAll('\t', ' ');
    if (index !== 0) text = text.replace(/^ +/, '');
    if (index !== lines.length - 1) text = text.replace(/ +$/, '');
    return text ? text + (index !== lastNonEmpty ? ' ' : '') : '';
  }).join('');
}

function inside(root, path) {
  const distance = relative(root, path);
  return distance && !distance.startsWith(`..${sep}`) && distance !== '..' && !resolve(distance).startsWith('\\\\') && !/^[a-z]:/i.test(distance);
}

async function sourceFiles(root) {
  const files = [];
  async function walk(path) {
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const absolute = join(path, entry.name);
      if (entry.isSymbolicLink()) continue;
      const file = slash(relative(root, absolute));
      if (/\/(?:node_modules|tests?|fixtures?|dev|__pycache__|\.git)\//.test('/' + file + '/') || /\.(?:test|spec)\.[^.]+$/.test(file)) continue;
      if (entry.isDirectory()) await walk(absolute);
      else if (['.ts', '.tsx', '.js', '.jsx', '.py', '.html', '.css'].includes(extname(absolute))) {
        const actual = await realpath(absolute);
        if (!inside(root, actual) || actual !== absolute) continue;
        files.push({ file, absolute, source: await readFile(absolute, 'utf8') });
      }
    }
  }
  await Promise.all([walk(join(root, 'src')), walk(join(root, 'backend', 'app')), walk(join(root, 'site')), walk(join(root, 'public'))]);
  const entry = join(root, 'index.html');
  try { if ((await stat(entry)).isFile() && await realpath(entry) === entry) files.push({ file: 'index.html', absolute: entry, source: await readFile(entry, 'utf8') }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const history = join(root, 'release-history.json');
  try { if ((await stat(history)).isFile() && await realpath(history) === history) files.push({ file: 'release-history.json', absolute: history, source: await readFile(history, 'utf8') }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return files.sort((a, b) => a.file.localeCompare(b.file, 'en'));
}

function sectionFor(file) {
  if (file === 'release-history.json') return 'تاریخچهٔ نسخه‌ها';
  const sections = [
    [/HubPage|domain\/home/, 'خانه'], [/DashboardPage|TransactionsPage|transaction|weekly-flow|ReportsPage|domain\/report/, 'مالی و گزارش‌ها'],
    [/AccountsPage|domain\/account|repositories\/account/, 'کیف پول'], [/BudgetsPage|domain\/budget/, 'بودجه‌ها'],
    [/BillsPage|domain\/bill/, 'قبوض'], [/CalendarPage|domain\/event|jalali/, 'تقویم و مناسبت‌ها'],
    [/ShoppingPage|domain\/shopping|features\/shopping/, 'خرید و انبار'], [/InventoryPage/, 'خرید و انبار'],
    [/TasksPage|domain\/task|features\/tasks/, 'کارهای خانه'], [/DocumentsPage|domain\/document|features\/documents/, 'اسناد خانه'],
    [/MealsPage|domain\/meal|features\/meals/, 'برنامهٔ غذایی'], [/EquipmentPage|domain\/equipment|features\/equipment/, 'وسایل خانه'],
    [/VehiclesPage|domain\/vehicle|features\/vehicles/, 'خودرو'], [/GoalsPage|domain\/goal|features\/goals/, 'اهداف شخصی'],
    [/ActivitiesPage|domain\/activity|features\/activities/, 'برنامه‌های خانوادگی'], [/ChildrenPage|domain\/child|features\/children/, 'فرزندان'],
    [/PetsPage|domain\/pet|features\/pets/, 'حیوانات خانگی'], [/MarketPage|domain\/market|features\/market/, 'بازار'],
    [/SettingsPage|domain\/family|features\/invite/, 'پروفایل و تنظیمات'], [/features\/auth|domain\/auth/, 'ورود و عضویت'],
    [/onboarding|install-prompt|pwaUpdate/, 'شروع و نصب برنامه'], [/notification/, 'اعلان‌ها'], [/^site\//, 'صفحه‌های معرفی و دریافت'],
  ];
  if (file.startsWith('backend/')) return 'پیام‌های سرور';
  return sections.find(([pattern]) => pattern.test(file))?.[1] ?? 'اجزای مشترک برنامه';
}

function propertyName(node, sourceFile) {
  if (!node) return '';
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return node.getText(sourceFile);
}

function ancestors(node) { const result = []; for (let parent = node.parent; parent; parent = parent.parent) result.push(parent); return result; }
function calledName(node) { return ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''; }

function classifyTs(node, sourceFile, file, value, annotation) {
  const chain = ancestors(node);
  const declaration = chain.find(ts.isVariableDeclaration);
  const declarationName = declaration?.name?.getText(sourceFile) ?? '';
  const displayMap = /(?:^|_)(?:LABELS?|TEXTS?|TITLES?|CAPTIONS?|DESCRIPTIONS?|DISPLAY|UNITS?)(?:_|$)/i.test(declarationName)
    && declaration?.initializer && ts.isObjectLiteralExpression(declaration.initializer)
    && !declaration.initializer.properties.some(property => ['familyId', 'family_id', 'phone', 'password', 'membershipState', 'ownerId', 'owner_id'].includes(propertyName(property.name, sourceFile)));
  const attribute = chain.find(ts.isJsxAttribute);
  const callbackInsideAttribute = attribute && chain.slice(0, chain.indexOf(attribute)).some(parent => ts.isArrowFunction(parent) || ts.isFunctionExpression(parent));
  if (chain.some(parent => ts.isTypeNode(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent))) return { reason: 'نوع یا قرارداد داخلی' };
  if (chain.some(parent => ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.InKeyword].includes(parent.operatorToken.kind))) return { reason: 'شرط یا مقدار ذخیره‌شونده' };
  if (attribute && !callbackInsideAttribute) {
    const name = propertyName(attribute.name, sourceFile);
    const opening = chain.find(parent => ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent));
    const tag = opening?.tagName?.getText(sourceFile) ?? '';
    if (name === 'value' && /^[A-Z]/.test(tag) && !/Input|Field|Select|Textarea|Autocomplete|Combobox|Picker|FormControl/i.test(tag) && annotation) return { visible: true, context: 'مقدار نمایشی ' + tag };
    if (internalNames.has(name) || name.startsWith('data-') || name.startsWith('on')) return { reason: 'شناسه، مقدار ورودی یا ویژگی داخلی' };
    return { visible: visibleNames.has(name) || persian.test(value), context: name };
  }
  if (ts.isJsxText(node)) return { visible: true, context: propertyName(node.parent?.openingElement?.tagName ?? node.parent?.tagName, sourceFile) || 'متن صفحه' };
  const inputState = chain.find(parent => ts.isCallExpression(parent) && calledName(parent) === 'useState');
  if (inputState && /^(?:name|title|description|notes|phone|relation|currency|gender|password)$/i.test(declarationName.replace(/[\[\] ]/g, '').split(',')[0] ?? '')) return { reason: 'پیش‌فرض ورودی کاربر' };
  if (inputState && chain.some(parent => ts.isPropertyAssignment(parent) && ['name', 'title', 'description', 'notes', 'phone', 'relation', 'currency', 'gender', 'password', 'value'].includes(propertyName(parent.name, sourceFile)))) return { reason: 'پیش‌فرض ورودی کاربر' };
  const renderedExpression = chain.some(parent => ts.isJsxExpression(parent) && (ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent)));
  for (const ancestor of chain) {
    if (ts.isTypeNode(ancestor) || ts.isImportDeclaration(ancestor) || ts.isExportDeclaration(ancestor)) return { reason: 'نوع یا قرارداد داخلی' };
    if (ts.isTaggedTemplateExpression(ancestor)) return { reason: 'قالب فنی یا پردازش داخلی' };
    if (ts.isPropertyAssignment(ancestor) && ancestor.name === node) return { reason: 'کلید داده' };
    if (ts.isBinaryExpression(ancestor)) {
      if ([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.InKeyword].includes(ancestor.operatorToken.kind)) return { reason: 'شرط یا مقدار ذخیره‌شونده' };
    }
    if (ts.isCaseClause(ancestor) && ancestor.expression === node) return { reason: 'شناسهٔ وضعیت یا مسیر' };
    if (ts.isElementAccessExpression(ancestor) && ancestor.argumentExpression === node) return { reason: 'کلید داده' };
    if (ts.isCallExpression(ancestor) || ts.isNewExpression(ancestor)) {
      const name = calledName(ancestor);
      if (name === 'AppError' || name === 'Error') {
        const index = ancestor.arguments?.findIndex(arg => arg === node || arg.pos <= node.pos && arg.end >= node.end) ?? -1;
        if (index === (name === 'AppError' ? 1 : 0)) {
          if (name === 'Error' && (/\b(?:Provider|useApp|Context|PwaUpdateProvider)\b/.test(value) || !persian.test(value) && !chain.some(parent => ts.isCallExpression(parent) && /^(?:show|toast|alert|setError|setMessage)$/.test(calledName(parent))))) return { reason: 'خطای فنی داخلی' };
          return { visible: true, context: 'پیام خطا', errorCode: name === 'AppError' && ts.isStringLiteral(ancestor.arguments[0]) ? ancestor.arguments[0].text : undefined };
        }
        return { reason: 'کد داخلی خطا' };
      }
      if (callProcessingNames.has(name) || /^(?:console|logger)\./.test(ancestor.expression.getText(sourceFile))) return { reason: 'پردازش یا گزارش داخلی' };
      if (/^(?:fetch|navigate|setRoute|setSection|require|import|get|post|put|patch|delete)$/.test(name) && ancestor.arguments?.[0]
        && ancestor.arguments[0].pos <= node.pos && ancestor.arguments[0].end >= node.end) return { reason: 'شناسه، مسیر یا کلید پردازش داخلی' };
      if (/^(?:show|toast|alert|confirm|setError|setMessage)$/.test(name)) return { visible: true, context: 'پیام رابط' };
      if (/sms[_-]?parser|sms[_-]?banks/i.test(file)) return { reason: 'دادهٔ داخلی پارسر پیامک' };
      if (name === 'useState' && /^(?:name|title|description|notes|phone|relation|currency|gender|password)$/i.test(chain.find(ts.isVariableDeclaration)?.name?.getText(sourceFile)?.replace(/[\[\] ]/g, '').split(',')[0] ?? '')) return { reason: 'پیش‌فرض ورودی کاربر' };
    }
    if (ts.isPropertyAssignment(ancestor)) {
      const name = propertyName(ancestor.name, sourceFile);
      const recordFields = ts.isObjectLiteralExpression(ancestor.parent) ? ancestor.parent.properties.map(property => propertyName(property.name, sourceFile)) : [];
      const optionValue = name === 'value' && ts.isObjectLiteralExpression(ancestor.parent) && ancestor.parent.properties.some(property => ts.isPropertyAssignment(property)
        && propertyName(property.name, sourceFile) === 'label' && (ts.isStringLiteral(property.initializer) || ts.isNoSubstitutionTemplateLiteral(property.initializer)));
      const userContent = ['name', 'title', 'description', 'notes'].includes(name) && !/domain\/notification\//.test(file) && recordFields.some(field => ['familyId', 'family_id', 'phone', 'password', 'membershipState', 'assigneeId', 'assignee_id', 'accountId', 'account_id', 'forMemberId', 'for_member_id', 'ownerId', 'owner_id', 'dueDate', 'due_date', 'revision', 'completed', 'createdAt', 'created_at'].includes(field));
      if (displayMap && ancestor.initializer === node && !optionValue && !userContent) return { visible: true, context: declarationName };
      const declaredType = declaration?.type?.getText(sourceFile) ?? '';
      const displayOnlyValue = name === 'value' && !userContent && !optionValue && (declaredType === 'RowTrailing'
        || annotation && isRenderingFile(file) && !recordFields.some(field => ['id', 'familyId', 'family_id', 'ownerId', 'owner_id', 'revision', 'createdAt', 'created_at'].includes(field)));
      if (displayOnlyValue) return { visible: true, context: 'مقدار نمایشی' };
      if (internalNames.has(name) && name !== 'name' || userContent) return { reason: 'شناسه یا مقدار ذخیره‌شوندهٔ داده', review: name === 'value' && !optionValue && isRenderingFile(file) && /[\p{L}]/u.test(value) && !recordFields.some(field => ['id', 'familyId', 'family_id', 'ownerId', 'owner_id', 'revision', 'createdAt', 'created_at'].includes(field)) };
      if (name === 'name') return { visible: true, context: name };
      if (visibleNames.has(name)) return { visible: true, context: name };
    }
    if (ts.isVariableDeclaration(ancestor)) {
      const name = ancestor.name.getText(sourceFile);
      if (internalNames.has(name) && name !== 'name') return { reason: 'قرارداد یا مقدار ذخیره‌شوندهٔ داده' };
      if (/MEMBER_RELATIONS|BANK_NAMES|BANK_BINS|(?:^|_)(?:CURRENCY|CURRENCIES|RELATIONS|REGEX|PATTERN)(?:_|$)/i.test(name)) return { reason: 'قرارداد یا مقدار ذخیره‌شوندهٔ داده' };
      if (/^(?:displayUnitLabels|memberDisplayLabels)$/.test(name)) return { visible: true, context: 'نام نمایشی' };
      if (/^(?:label|title|description|desc|message|msg|hint|text|caption|note|errorText|emptyText)$/i.test(name)) return { visible: true, context: name };
    }
  }
  if (/shared\/lib\/currency\.ts$/.test(file)) return { reason: 'واحد پول در قرارداد ذخیره‌سازی' };
  if (/sms[_-]?parser|sms[_-]?banks/i.test(file)) return { reason: 'دادهٔ داخلی پارسر پیامک' };
  if (annotation) return { visible: true, context: 'نوشتهٔ ثبت‌شده' };
  if (renderedExpression) return { visible: true, context: 'متن صفحه' };
  const fallback = chain.find(parent => ts.isBinaryExpression(parent) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(parent.operatorToken.kind)
    && parent.right.pos <= node.pos && parent.right.end >= node.end);
  if (fallback && (isRenderingFile(file) || /Presentation\.ts$/.test(file))) return { visible: true, context: 'نوشتهٔ جایگزین در نمایش' };
  return { visible: persian.test(value), context: chain.find(n => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n))?.name?.getText(sourceFile) ?? 'متن برنامه' };
}

function scanTs(source, file, offset = 0, language = extname(file)) {
  const scriptKind = ['.tsx', '.jsx'].includes(language) ? ts.ScriptKind.TSX : language === '.js' ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const entries = [], excluded = [], needsReview = [];
  let ordinal = 0;
  function add(node, plan, value) {
    const annotation = markerBefore(source, node, sourceFile);
    if (plan.tokens?.length) {
      const fixed = plan.tokens.reduce((text, token) => text.replaceAll(token.token, ''), value);
      if (!/[\p{L}\p{N}]/u.test(fixed) && !annotation) {
        excluded.push({ line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          text: value, reason: 'قالب نمایش دادهٔ پویا بدون نوشتهٔ ثابت' });
        return;
      }
    }
    const classification = classifyTs(node, sourceFile, file, value, annotation);
    if (!value.trim() && !annotation) return;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    if (classification.reason) {
      if (persian.test(value) || annotation) excluded.push({ line, text: value, reason: classification.reason });
      if (classification.review || annotation) needsReview.push({ line, text: value, reason: annotation ? 'نوشتهٔ ثبت‌شده در مسیر داده یا پردازش داخلی قرار گرفته است.' : 'مقدار نمایشی نیازمند ثبت صریح نوشته است.' });
      return;
    }
    if (!classification.visible) return;
    let padding;
    if (annotation?.format === 'jsx-body') {
      padding = { leading: value.match(/^\s*/u)[0], trailing: value.match(/\s*$/u)[0] };
      value = value.replace(/[\t\r\n ]+/g, ' ').trim();
    }
    entries.push({ ordinal, line, start: offset + (ts.isJsxText(node) ? node.pos : annotation?.start ?? node.getStart(sourceFile)), end: offset + node.end,
      nodeStart: offset + node.getStart(sourceFile), nodeEnd: offset + node.end, text: value,
      annotationId: annotation?.id, annotationFormat: annotation?.format, padding,
      context: classification.context, errorCode: classification.errorCode, ...plan });
  }
  function visit(node) {
    if (ts.isTemplateExpression(node)) {
      ordinal++;
      const tokens = [], expressions = [], chunks = [node.head.text];
      let previous = node.head;
      for (const span of node.templateSpans) {
        const token = `{slot${tokens.length + 1}}`;
        tokens.push({ token, example: 'نمونه' });
        expressions.push(source.slice(previous.end, span.literal.getStart(sourceFile)));
        chunks.push(token, span.literal.text); previous = span.literal;
      }
      add(node, { kind: 'typescript-template', tokens, expressions }, chunks.join(''));
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      ordinal++;
      const jsxAttribute = ts.isJsxAttribute(node.parent);
      add(node, { kind: jsxAttribute ? 'jsx-attribute' : ts.isNoSubstitutionTemplateLiteral(node) ? 'typescript-template' : 'typescript-string', tokens: [], expressions: [] }, jsxAttribute ? decodeHtml(node.text) : node.text);
      return;
    }
    if (ts.isJsxText(node)) {
      ordinal++;
      const raw = source.slice(node.pos, node.end);
      const leading = raw.match(/^\s*/u)[0], trailing = raw.match(/\s*$/u)[0];
      const rendered = renderedJsxText(raw);
      add(node, { kind: 'jsx-text', leading, trailing, renderedLeading: rendered.match(/^\s*/u)[0], renderedTrailing: rendered.match(/\s*$/u)[0] }, normalizeBody(raw)); return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { entries, excluded, needsReview, diagnostics: sourceFile.parseDiagnostics, scriptKind };
}

function scanHtml(source, file) {
  const entries = [], excluded = [], needsReview = [], stack = [], attributeMarkers = new Map();
  let bodyMarker = null;
  let cursor = 0, ordinal = 0;
  const tags = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g;
  const lineAt = position => source.slice(0, position).split('\n').length;
  function body(start, end) {
    const raw = source.slice(start, end), value = normalizeBody(raw); ordinal++;
    const annotation = bodyMarker; bodyMarker = null;
    if (stack.some(tag => ['script', 'style', 'head'].includes(tag)) && stack.at(-1) !== 'title') {
      if (annotation) needsReview.push({ line: lineAt(start), text: value, reason: 'نوشتهٔ ثبت‌شده داخل بخش فنی HTML قرار گرفته است.' });
      return;
    }
    if (!value && !annotation) return;
    const leading = raw.match(/^\s*/u)[0], trailing = raw.match(/\s*$/u)[0];
    entries.push({ ordinal, line: lineAt(start), start: annotation?.start ?? start, end, nodeStart: start, nodeEnd: end,
      annotationId: annotation?.id, text: value, kind: 'html-text', leading, trailing, context: stack.at(-1) ?? 'متن صفحه' });
  }
  for (let match; (match = tags.exec(source));) {
    body(cursor, match.index);
    const raw = match[0], start = match.index;
    cursor = tags.lastIndex;
    if (raw.startsWith('<!--')) {
      const annotation = copyMarker.exec(raw.slice(4, -3));
      if (annotation) {
        if (annotation[2]?.startsWith('attribute:')) attributeMarkers.set(annotation[2].slice('attribute:'.length), { id: annotation[1], start });
        else bodyMarker = { id: annotation[1], start };
      }
      continue;
    }
    if (raw.startsWith('<!')) continue;
    const tag = raw.match(/^<\/?([\w-]+)/)?.[1].toLowerCase();
    if (raw.startsWith('</')) { const index = stack.lastIndexOf(tag); if (index >= 0) stack.splice(index); continue; }
    const attributes = [...raw.matchAll(/([\w:-]+)\s*=\s*("[^"]*"|'[^']*')/g)];
    const type = attributes.find(attribute => attribute[1].toLowerCase() === 'type')?.[2].slice(1, -1);
    for (const attribute of attributes) {
      ordinal++;
      const name = attribute[1].toLowerCase(), value = decodeHtml(attribute[2].slice(1, -1));
      const annotation = attributeMarkers.get(name);
      const visible = visibleNames.has(name) || name === 'value' && ['button', 'submit', 'reset'].includes(type);
      if (!visible) {
        if (persian.test(value) || annotation) excluded.push({ line: lineAt(start), text: value, reason: 'ویژگی یا دادهٔ غیرنمایشی HTML' });
        if (annotation) needsReview.push({ line: lineAt(start), text: value, reason: 'ویژگی ثبت‌شده مربوط به داده یا پردازش داخلی است.' });
        continue;
      }
      const at = start + attribute.index + attribute[0].indexOf(attribute[2]);
      entries.push({ ordinal, line: lineAt(at), start: at, end: at + attribute[2].length, nodeStart: at, nodeEnd: at + attribute[2].length,
        annotationId: annotation?.id, markerInsert: annotation ? undefined : start, attributeName: name,
        text: value, kind: 'html-attribute', context: name });
    }
    attributeMarkers.clear();
    if (tag === 'script' || tag === 'style') {
      const closing = new RegExp(`</${tag}\\s*>`, 'ig'); closing.lastIndex = cursor;
      const end = closing.exec(source);
      if (end) {
        if (tag === 'script' && type !== 'application/ld+json') {
          const scanned = scanTs(source.slice(cursor, end.index), file, cursor, '.js');
          for (const entry of scanned.entries) { ordinal++; entries.push({ ...entry, ordinal, line: lineAt(entry.start), embeddedJs: true }); }
          excluded.push(...scanned.excluded.map(entry => ({ ...entry, line: entry.line + lineAt(cursor) - 1 })));
          needsReview.push(...scanned.needsReview.map(entry => ({ ...entry, line: entry.line + lineAt(cursor) - 1 })));
        }
        cursor = closing.lastIndex; tags.lastIndex = cursor;
      }
      continue;
    }
    if (!raw.endsWith('/>') && !['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(tag)) stack.push(tag);
  }
  body(cursor, source.length);
  return { entries, excluded, needsReview };
}

function scanCss(source) {
  const entries = [];
  let ordinal = 0;
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length));
  for (const match of withoutComments.matchAll(/(?:^|[;{])\s*content\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g)) {
    ordinal++;
    const text = match[1].slice(1, -1).replace(/\\([\da-f]{1,6})\s?|\\(.)/gi, (_, hex, char) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : char);
    const start = match.index + match[0].lastIndexOf(match[1]);
    const trivia = source.slice(match.index, start);
    const comment = /\/\*([^*]*(?:\*(?!\/)[^*]*)*)\*\/\s*$/.exec(trivia);
    const annotation = comment && copyMarker.exec(comment[1]);
    if (!annotation && !persian.test(text)) continue;
    entries.push({ ordinal, line: source.slice(0, start).split('\n').length, start: annotation ? match.index + comment.index : start,
      end: start + match[1].length, nodeStart: start, nodeEnd: start + match[1].length, annotationId: annotation?.[1],
      text, kind: 'css-content', context: 'متن CSS' });
  }
  return { entries, excluded: [] };
}

async function python(payload) {
  return new Promise((done, reject) => {
    const child = spawn(process.env.COPY_WORKBENCH_PYTHON || (process.platform === 'win32' ? 'python.exe' : 'python3'), ['-X', 'utf8', join(moduleDirectory, 'catalog-python.py')], { windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject); child.stdin.on('error', reject);
    child.on('close', code => {
      if (code !== 0) reject(new CatalogError('SOURCE_SYNTAX', 'فایل پایتون قابل بررسی نیست: ' + (output || error).slice(0, 600)));
      else { try { done(JSON.parse(output)); } catch { reject(new CatalogError('SOURCE_SYNTAX', 'پاسخ بررسی پایتون نامعتبر است.')); } }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

/** Analyze current source. No application modules, database or credentials are loaded. */
export async function collectCatalog(workspaceRoot) {
  const root = await realpath(resolve(workspaceRoot));
  const files = await sourceFiles(root), plans = new Map(), excluded = [], needsReview = [], entries = [];
  const pythonFiles = files.filter(file => file.file.endsWith('.py'));
  const pythonResults = pythonFiles.length ? await python({ files: pythonFiles.map(({ file, source }) => ({ file, source })) }) : [];
  const pythonByFile = new Map(pythonResults.map(result => [result.file, result]));
  const scannedFiles = files.map(file => {
    const extension = extname(file.file);
    const result = file.file === 'release-history.json' ? scanReleaseHistory(file.source)
      : extension === '.py' ? pythonByFile.get(file.file) : extension === '.html' ? scanHtml(file.source, file.file) : extension === '.css' ? scanCss(file.source) : scanTs(file.source, file.file);
    return { file, result };
  });
  const registeredIds = new Set();
  for (const { result } of scannedFiles) for (const plan of result.entries) {
    if (!plan.annotationId) continue;
    if (registeredIds.has(plan.annotationId)) throw new CatalogError('DUPLICATE_COPY_ID', 'شناسهٔ نوشته بیش از یک بار در کد ثبت شده است: ' + plan.annotationId);
    registeredIds.add(plan.annotationId);
  }
  for (const { file, result } of scannedFiles) {
    for (const plan of result.entries) {
      const automaticId = `${file.file}:${plan.ordinal}:${plan.kind}`;
      let id = plan.annotationId ?? automaticId;
      if (!plan.annotationId && registeredIds.has(id)) {
        id = 'auto:' + automaticId;
        let collision = 0;
        while (registeredIds.has(id) || plans.has(id)) id = `auto:${++collision}:` + automaticId;
      }
      if (plans.has(id)) throw new CatalogError('DUPLICATE_COPY_ID', 'شناسهٔ نوشته بیش از یک بار در کد ثبت شده است: ' + id);
      const entry = { id, file: file.file, line: plan.line, kind: plan.kind, text: plan.text, section: sectionFor(file.file), context: plan.context, editable: true,
        sourceStart: plan.start, sourceEnd: plan.end, nodeStart: plan.nodeStart ?? plan.start, nodeEnd: plan.nodeEnd ?? plan.end, registered: Boolean(plan.annotationId) };
      if (plan.tokens?.length) entry.tokens = plan.tokens;
      if (plan.errorCode) entry.errorCode = plan.errorCode;
      entries.push(entry); plans.set(id, { ...plan, file });
    }
    excluded.push(...result.excluded.map(entry => ({ file: file.file, ...entry })));
    needsReview.push(...(result.needsReview ?? []).map(entry => ({ file: file.file, ...entry })));
  }
  const revision = digest(files.map(file => `${file.file}\0${digest(file.source)}`).join('\n'));
  const bySection = Object.fromEntries([...new Set(entries.map(entry => entry.section))].map(section => [section, entries.filter(entry => entry.section === section).length]));
  const catalog = { revision, entries, stats: { entries: entries.length, files: files.length, protected: excluded.length, needsReview: needsReview.length, bySection }, audit: { excluded, needsReview } };
  privateCatalogs.set(catalog, { root, plans, files });
  return catalog;
}

function templateChunks(text, tokens) {
  const expected = tokens.map(item => item.token);
  const actual = [...text.matchAll(/\{slot\d+\}/g)].map(match => match[0]);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new CatalogError('TEMPLATE_TOKENS', 'بخش‌های پویا باید دقیقاً یک بار و با همان ترتیب در متن بمانند.');
  const chunks = []; let cursor = 0;
  for (const token of expected) { const at = text.indexOf(token, cursor); chunks.push(text.slice(cursor, at)); cursor = at + token.length; }
  chunks.push(text.slice(cursor)); return chunks;
}

function replacement(plan, text, id) {
  if (plan.kind === 'release-history-text') return JSON.stringify(text);
  const inlineEscape = value => plan.embeddedJs ? value.replaceAll('<', '\\u003c').replaceAll('>', '\\u003e') : value;
  if (plan.kind === 'typescript-string') return `/* @copy-text ${id}${plan.annotationFormat === 'jsx-body' ? ' jsx-body' : ''} */ `
    + inlineEscape(JSON.stringify((plan.padding?.leading ?? '') + text + (plan.padding?.trailing ?? '')));
  if (plan.kind === 'jsx-attribute') return '{' + copyComment(id) + inlineEscape(JSON.stringify(text)) + '}';
  if (plan.kind === 'html-attribute') return '"' + escapeHtml(text) + '"';
  if (plan.kind === 'jsx-text') return `{/* @copy-text ${id} jsx-body */ ` + JSON.stringify((plan.renderedLeading ?? '') + text + (plan.renderedTrailing ?? '')) + '}';
  if (plan.kind === 'html-text') return `<!-- @copy-text ${id} -->` + plan.leading + escapeHtml(text) + plan.trailing;
  if (plan.kind === 'typescript-template') {
    const chunks = templateChunks(text, plan.tokens ?? []);
    return copyComment(id) + '`' + chunks.map((chunk, index) => inlineEscape(escapeTemplate(chunk)) + (index < plan.expressions.length ? '${' + plan.expressions[index] + '}' : '')).join('') + '`';
  }
  const pythonExpression = value => plan.annotationMode === 'statement' ? value : `(# @copy-text ${id}\n${value}\n)`;
  if (plan.kind === 'python-string') return pythonExpression(JSON.stringify(text));
  if (plan.kind === 'python-template') {
    const chunks = templateChunks(text, plan.tokens);
    const escaped = chunk => JSON.stringify(chunk).slice(1, -1).replaceAll('{', '{{').replaceAll('}', '}}');
    return pythonExpression('f"' + chunks.map((chunk, index) => escaped(chunk) + (index < plan.expressions.length ? plan.expressions[index] : '')).join('') + '"');
  }
  if (plan.kind === 'css-content') return copyComment(id) + '"' + text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\a ').replaceAll('\r', '\\d ').replaceAll('\f', '\\c ') + '"';
  throw new CatalogError('UNKNOWN_KIND', 'نوع متن برای ویرایش شناخته نشد.');
}

/** Prepare allowlisted, parsed source edits. The caller owns atomic writes/build/rollback. */
export async function prepareChanges(workspaceRoot, suppliedCatalog, request) {
  if (!request || typeof request.revision !== 'string' || !Array.isArray(request.changes) || !request.changes.length || request.changes.length > 10000) throw new CatalogError('INVALID_CHANGES', 'فهرست تغییرهای متن نامعتبر است.');
  const catalog = await collectCatalog(workspaceRoot);
  if (request.revision !== catalog.revision || suppliedCatalog?.revision !== catalog.revision) throw new CatalogError('STALE_CATALOG', 'کد از زمان بازکردن فهرست تغییر کرده است؛ فهرست را دوباره دریافت کن.', 409);
  const { plans } = privateCatalogs.get(catalog), groups = new Map(), seen = new Set();
  for (const change of request.changes) {
    if (!change || typeof change.id !== 'string' || typeof change.text !== 'string' || typeof change.expectedText !== 'string' || change.text.length > 16000 || change.text.includes('\0')) throw new CatalogError('INVALID_TEXT', 'متن یا شناسهٔ تغییر نامعتبر است.');
    if (seen.has(change.id)) throw new CatalogError('DUPLICATE_CHANGE', 'یک متن بیش از یک بار در تغییرها آمده است.');
    seen.add(change.id);
    const plan = plans.get(change.id);
    if (!plan) throw new CatalogError('UNKNOWN_ENTRY', 'این مورد در فهرست نوشته‌های قابل‌ویرایش نیست.');
    if (plan.text !== change.expectedText) throw new CatalogError('STALE_TEXT', 'متن اصلی تغییر کرده است؛ فهرست را دوباره دریافت کن.', 409);
    if (change.text === plan.text) continue;
    const edits = groups.get(plan.file.file) ?? { file: plan.file.file, original: plan.file.source, edits: [] };
    edits.edits.push({ start: plan.start, end: plan.end, replacement: replacement(plan, change.text, change.id), plan });
    if (plan.kind === 'html-attribute' && Number.isInteger(plan.markerInsert)) {
      const insert = edits.edits.find(edit => edit.start === plan.markerInsert && edit.end === plan.markerInsert);
      const marker = `<!-- @copy-text ${change.id} attribute:${plan.attributeName} -->`;
      if (insert) insert.replacement += marker;
      else edits.edits.push({ start: plan.markerInsert, end: plan.markerInsert, replacement: marker, plan });
    }
    groups.set(plan.file.file, edits);
  }
  const result = [];
  for (const group of groups.values()) {
    const edits = group.edits.sort((a, b) => b.start - a.start);
    for (let index = 1; index < edits.length; index++) if (edits[index].end > edits[index - 1].start) throw new CatalogError('OVERLAPPING_CHANGES', 'ویرایش قالب و متن داخل همان قالب تداخل دارند؛ آن‌ها را جداگانه اعمال کن.');
    let updated = group.original;
    for (const edit of edits) updated = updated.slice(0, edit.start) + edit.replacement + updated.slice(edit.end);
    const extension = extname(group.file);
    if (group.file === 'release-history.json') scanReleaseHistory(updated);
    if (['.ts', '.tsx', '.js', '.jsx'].includes(extension)) {
      const parsed = scanTs(updated, group.file);
      if (parsed.diagnostics.length) throw new CatalogError('SOURCE_SYNTAX', 'تغییر متن، ساختار فایل را نامعتبر کرده است.');
    }
    if (extension === '.html') {
      // Only escaped body/attribute strings can change markup; embedded JS is parsed separately.
      const parsed = scanHtml(updated, group.file);
      if (parsed.entries.some(entry => entry.embeddedJs && !Number.isInteger(entry.start))) throw new CatalogError('SOURCE_SYNTAX', 'متن صفحه نامعتبر است.');
      for (const match of updated.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
        if (/type=["']application\/ld\+json/.test(match[0])) continue;
        if (scanTs(match[1], group.file, 0, '.js').diagnostics.length) throw new CatalogError('SOURCE_SYNTAX', 'تغییر متن، اسکریپت صفحه را نامعتبر کرده است.');
      }
    }
    result.push({ file: group.file, original: group.original, updated });
  }
  const pythonUpdates = result.filter(file => file.file.endsWith('.py')).map(({ file, updated: source }) => ({ file, source }));
  if (pythonUpdates.length) await python({ action: 'validate', files: pythonUpdates });
  return result;
}
