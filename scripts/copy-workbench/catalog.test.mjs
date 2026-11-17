import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { collectCatalog, prepareChanges } from './catalog.mjs';

async function workspace(files, run) {
  const root = await mkdtemp(join(tmpdir(), 'khaneyar-copy-catalog-'));
  try {
    for (const [file, source] of Object.entries(files)) { await mkdir(join(root, file, '..'), { recursive: true }); await writeFile(join(root, file), source, 'utf8'); }
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const textEntry = (catalog, text) => { const entry = catalog.entries.find(entry => entry.text === text); assert.ok(entry, 'Missing catalog text: ' + text); return entry; };
const request = (catalog, entry, text) => ({ revision: catalog.revision, changes: [{ id: entry.id, expectedText: entry.text, text }] });

test('finds JSX body, visible attributes, error messages and labels while protecting data/conditions/comments', async () => {
  const source = [
    '// فقط توضیح خصوصی',
    'const options = [{ value: "صاحب", label: "صاحب خانواده" }];',
    'const MEMBER_RELATIONS = ["خودم", "همسر"];',
    'const BANK_NAMES = ["بانک ملت"];',
    'type Unit = "تومان" | "ریال";',
    'if (currency === "ریال") console.info("گزارش داخلی");',
    'localStorage.setItem("کلید ذخیره", "مقدار خصوصی");',
    'const element = <main><h1>کارهای خانه</h1><input placeholder="عنوان کار" aria-label="نام کار" value="نام نمونه" /><button title="ذخیرهٔ تغییر">Save</button></main>;',
    'const handler = <button onClick={()=>show("پیام کلیک")}>کلیک</button>;',
    'const categories = [{id:"food",name:"خورد و خوراک"}];',
    'const KIND_LABEL = {currency:"ارز",gold:"طلا"}; const KIND_UNIT={currency:"واحد"};',
    'const user = {familyId:"f",name:"نام شخصی",title:"عنوان شخصی"};',
    'const errorState = {error:"خطای قابل نمایش"};',
    'throw new Error("Provider missing");',
    'throw new AppError("FORBIDDEN", "اجازه ندارید");',
  ].join('\n');
  await workspace({ 'src/Page.tsx': source, 'src/Page.test.ts': 'const x = "نمونه تست";' }, async root => {
    const catalog = await collectCatalog(root);
    for (const text of ['صاحب خانواده', 'کارهای خانه', 'عنوان کار', 'نام کار', 'ذخیرهٔ تغییر', 'Save', 'اجازه ندارید', 'پیام کلیک', 'خورد و خوراک', 'خطای قابل نمایش', 'ارز', 'واحد']) textEntry(catalog, text);
    for (const text of ['صاحب', 'خودم', 'همسر', 'بانک ملت', 'تومان', 'ریال', 'گزارش داخلی', 'کلید ذخیره', 'مقدار خصوصی', 'نام نمونه', 'نام شخصی', 'عنوان شخصی', 'نمونه تست', 'Provider missing']) assert.ok(!catalog.entries.some(entry => entry.text === text), text);
    assert.equal(textEntry(catalog, 'اجازه ندارید').errorCode, 'FORBIDDEN');
    assert.ok(catalog.audit.excluded.some(entry => entry.text === 'ریال'));
  });
});

test('source edits escape JSX and JS strings and leave surrounding code/user field values untouched', async () => {
  const source = 'const title = "عنوان ثابت";\r\nexport const view = <button title="راهنما">  ذخیره &amp; ادامه  </button>;\r\nconst input = {value:"نام واردشده"};\r\n';
  await workspace({ 'src/Page.tsx': source }, async root => {
    const catalog = await collectCatalog(root);
    const first = textEntry(catalog, 'عنوان ثابت'), body = textEntry(catalog, 'ذخیره & ادامه');
    const result = await prepareChanges(root, catalog, { revision: catalog.revision, changes: [
      { id: first.id, expectedText: first.text, text: 'عنوان "جدید"\n${danger}' },
      { id: body.id, expectedText: body.text, text: 'ادامه <script> & تمام' },
    ] });
    assert.equal(result.length, 1);
    assert.ok(result[0].updated.includes('"عنوان \\"جدید\\"\\n${danger}"'));
    assert.ok(result[0].updated.includes('ادامه <script> & تمام'));
    assert.ok(!result[0].updated.includes('<script> & تمام</button>'), 'User copy remains a string expression, never markup');
    assert.ok(result[0].updated.includes('const input = {value:"نام واردشده"};\r\n'));
    assert.equal(await readFile(join(root, 'src/Page.tsx'), 'utf8'), source, 'prepare is read-only');
  });
});

test('one template entry keeps immutable expressions and safely escapes literal interpolation/backticks', async () => {
  const source = 'const title = `خرج ${  money /* keep */ ( amount )  } تا ${days} روز`';
  await workspace({ 'src/Page.ts': source }, async root => {
    const catalog = await collectCatalog(root), entry = textEntry(catalog, 'خرج {slot1} تا {slot2} روز');
    const result = await prepareChanges(root, catalog, request(catalog, entry, 'مبلغ `{slot1}` در {slot2} روز ${evil}'));
    assert.equal(result[0].updated, 'const title = /* @copy-text ' + entry.id + ' */ `مبلغ \\`${  money /* keep */ ( amount )  }\\` در ${days} روز \\${evil}`');
    await assert.rejects(prepareChanges(root, catalog, request(catalog, entry, 'مبلغ {slot2} و {slot1}')), { code: 'TEMPLATE_TOKENS' });
    await assert.rejects(prepareChanges(root, catalog, request(catalog, entry, 'مبلغ {slot1}')), { code: 'TEMPLATE_TOKENS' });
    await assert.rejects(prepareChanges(root, catalog, request(catalog, entry, 'مبلغ {slot1} {slot1} {slot2}')), { code: 'TEMPLATE_TOKENS' });
  });
});

test('rejects overlapping whole-template and nested conditional label edits', async () => {
  await workspace({ 'src/Page.ts': 'const title = `حالت ${online ? "وصل" : "قطع"}`;' }, async root => {
    const catalog = await collectCatalog(root), template = textEntry(catalog, 'حالت {slot1}'), nested = textEntry(catalog, 'وصل');
    await assert.rejects(prepareChanges(root, catalog, { revision: catalog.revision, changes: [
      { id: template.id, expectedText: template.text, text: 'وضعیت {slot1}' },
      { id: nested.id, expectedText: nested.text, text: 'آنلاین' },
    ] }), { code: 'OVERLAPPING_CHANGES' });
  });
});

test('catalog ids survive length edits, and any source changes invalidate stale edits', async () => {
  await workspace({ 'src/Page.tsx': 'const label="اول"; export const view=<p>دوم</p>;' }, async root => {
    const catalog = await collectCatalog(root), entry = textEntry(catalog, 'اول');
    const [change] = await prepareChanges(root, catalog, request(catalog, entry, 'یک متن خیلی طولانی‌تر'));
    await writeFile(join(root, change.file), change.updated);
    const fresh = await collectCatalog(root);
    assert.equal(textEntry(fresh, 'یک متن خیلی طولانی‌تر').id, entry.id);
    await assert.rejects(prepareChanges(root, catalog, request(catalog, entry, 'سوم')), { code: 'STALE_CATALOG' });
    const second = textEntry(fresh, 'دوم');
    await assert.rejects(prepareChanges(root, fresh, { revision: fresh.revision, changes: [{ id: second.id, expectedText: 'نسخه اشتباه', text: 'سوم' }] }), { code: 'STALE_TEXT' });
  });
});

test('rejects unlisted ids, duplicate edits and NUL text without writing anything', async () => {
  await workspace({ 'src/Page.ts': 'const label="ذخیره";' }, async root => {
    const catalog = await collectCatalog(root), entry = textEntry(catalog, 'ذخیره');
    await assert.rejects(prepareChanges(root, catalog, { revision: catalog.revision, changes: [{ id: '../../secret', expectedText: '', text: 'متن' }] }), { code: 'UNKNOWN_ENTRY' });
    await assert.rejects(prepareChanges(root, catalog, request(catalog, entry, 'متن\0')), { code: 'INVALID_TEXT' });
    const change = request(catalog, entry, 'جدید').changes[0];
    await assert.rejects(prepareChanges(root, catalog, { revision: catalog.revision, changes: [change, change] }), { code: 'DUPLICATE_CHANGE' });
  });
});

test('HTML scans visible body/attributes/scripts but protects metadata, comments and field values', async () => {
  const source = '<!doctype html><html><head><title>عنوان برنامه</title><meta name="description" content="متادیتای داخلی"></head><body><!-- توضیح مخفی --><h1>متن اصلی</h1><input value="داده نمونه" placeholder="ورود نام"><button title="راهنما">Next</button><script>const label="پیام ثابت"; const code="abc";</script></body></html>';
  await workspace({ 'index.html': source }, async root => {
    const catalog = await collectCatalog(root);
    for (const text of ['عنوان برنامه', 'متن اصلی', 'ورود نام', 'راهنما', 'Next', 'پیام ثابت']) textEntry(catalog, text);
    for (const text of ['متادیتای داخلی', 'توضیح مخفی', 'داده نمونه']) assert.ok(!catalog.entries.some(entry => entry.text === text));
    const entry = textEntry(catalog, 'متن اصلی');
    const [change] = await prepareChanges(root, catalog, request(catalog, entry, '<img onerror="evil()">'));
    assert.ok(change.updated.includes('&lt;img onerror=&quot;evil()&quot;&gt;'));
    assert.ok(change.updated.includes('value="داده نمونه"'));
    const script = textEntry(catalog, 'پیام ثابت');
    const [inline] = await prepareChanges(root, catalog, request(catalog, script, '</script><img onerror="danger()">'));
    assert.ok(inline.updated.includes('\\u003c/script\\u003e\\u003cimg'));
    assert.equal((inline.updated.match(/<\/script>/g) ?? []).length, 1);
  });
});

test('Python errors retain code metadata and UTF-16/UTF-8 positions while excluding docs/logs/default values', async () => {
  const source = ['"""توضیح خصوصی"""', 'from somewhere import AppError', 'currency = "تومان"', 'record = FamilyEvent(title="عنوان رکورد خودکار", name="نام شخص")', 'if currency == "ریال":', '    print("گزارش مخفی")', 'def check():', '    marker = "😀"', '    raise AppError("BAD", "اجازه ندارید", 403)', ''].join('\r\n');
  await workspace({ 'backend/app/service.py': source }, async root => {
    const catalog = await collectCatalog(root), entry = textEntry(catalog, 'اجازه ندارید');
    assert.equal(entry.errorCode, 'BAD');
    for (const text of ['توضیح خصوصی', 'تومان', 'ریال', 'گزارش مخفی', 'عنوان رکورد خودکار', 'نام شخص']) assert.ok(!catalog.entries.some(entry => entry.text === text));
    const [change] = await prepareChanges(root, catalog, request(catalog, entry, 'خطای "جدید"\nبرای کاربر'));
    assert.ok(change.updated.includes('"خطای \\"جدید\\"\\nبرای کاربر"'));
    assert.ok(change.updated.includes('# @copy-text ' + entry.id));
    assert.ok(change.updated.includes('marker = "😀"\r\n'));
  });
});

test('Python f-string interpolation expressions remain immutable when displayed copy changes', async () => {
  const source = 'def check():\n    raise AppError("BAD", f"کار {name!r} تا {amount:.2f} روز", 400)\n';
  await workspace({ 'backend/app/service.py': source }, async root => {
    const catalog = await collectCatalog(root), entry = textEntry(catalog, 'کار {slot1} تا {slot2} روز');
    const [change] = await prepareChanges(root, catalog, request(catalog, entry, 'مورد {slot1}: {slot2} روز {نمونه}'));
    assert.ok(change.updated.includes('f"مورد {name!r}: {amount:.2f} روز {{نمونه}}"'));
  });
});

test('dynamic templates containing only values and layout separators are excluded from editable copy', async () => {
  await workspace({
    'src/Page.ts': [
      'const label = `${name} ${role}`;',
      'const title = `«${name}» / ${age} —`;',
      'const hint = `کاربر ${name}`;',
      'const message = `${count} item`;',
    ].join('\n'),
    'backend/app/service.py': [
      'def check(name, title):',
      '    raise AppError("EMPTY", f"{name} / {title}", 400)',
      'def shown(name):',
      '    raise AppError("WORD", f"کاربر {name}", 400)',
    ].join('\n'),
  }, async root => {
    const catalog = await collectCatalog(root);
    for (const text of ['{slot1} {slot2}', '«{slot1}» / {slot2} —', '{slot1} / {slot2}']) {
      assert.ok(!catalog.entries.some(entry => entry.text === text), 'Data-only formatting must not be editable: ' + text);
      assert.ok(catalog.audit.excluded.some(entry => entry.text === text && entry.reason === 'قالب نمایش دادهٔ پویا بدون نوشتهٔ ثابت'));
    }
    assert.equal(catalog.entries.filter(entry => entry.text === 'کاربر {slot1}').length, 2);
    textEntry(catalog, '{slot1} item');
  });
});

test('rendered fallback words and English JSX states are editable while input defaults and canonical values stay protected', async () => {
  await workspace({ 'src/pages/Page.tsx': [
    'const assigneeName = member => member?.name ?? "مسئول تعیین‌شده";',
    'const trailing: RowTrailing = {type:"value",value:"خاموش"};',
    'const form = useState(() => ({name:"نام خصوصی"}));',
    'const [name,setName] = useState(member?.name ?? "نام پیش‌فرض");',
    'const view = <main><p>{member?.name ?? "Deleted member"}</p><span>{busy ? "Loading" : "Ready"}</span><input value="private input" /><option value="stored kind">Choice</option><input title={currency === "ریال" ? "Amount" : "Total"} /></main>;',
  ].join('\n') }, async root => {
    const catalog = await collectCatalog(root);
    for (const text of ['مسئول تعیین‌شده', 'خاموش', 'Deleted member', 'Loading', 'Ready', 'Choice', 'Amount', 'Total']) textEntry(catalog, text);
    for (const text of ['نام خصوصی', 'نام پیش‌فرض', 'private input', 'stored kind', 'ریال']) assert.ok(!catalog.entries.some(entry => entry.text === text), text);
  });
});

test('registered source ids and text survive English, empty and later edits across every supported source format', async () => {
  await workspace({
    'src/Page.tsx': 'const label="پیام ثابت"; const view=<main title="عنوان راهنما"><p>  متن بدنه  </p></main>;',
    'public/page.html': '<main title="راهنمای صفحه"><p>متن صفحه</p></main>',
    'src/styles.css': '.hint::after { content: "نوشتهٔ سبک"; }',
    'backend/app/service.py': 'def check():\n    raise AppError("BAD", "خطای نمونه", 400)\n',
  }, async root => {
    let catalog = await collectCatalog(root);
    const ids = catalog.entries.map(entry => entry.id);
    assert.equal(ids.length, 7);
    for (const phase of ['english', 'empty', 'persian']) {
      const expected = ids.map((id, index) => phase === 'empty' ? '' : phase === 'english' ? 'Literal &amp; English ' + index : 'نوشتهٔ جدید ' + index);
      const changes = ids.map((id, index) => ({id, expectedText: catalog.entries.find(entry => entry.id === id).text, text: expected[index]}));
      const files = await prepareChanges(root, catalog, {revision: catalog.revision, changes});
      for (const file of files) await writeFile(join(root, file.file), file.updated);
      catalog = await collectCatalog(root);
      for (let index = 0; index < ids.length; index++) {
        const entry = catalog.entries.find(entry => entry.id === ids[index]);
        assert.ok(entry, 'An applied entry must remain addressable after ' + phase + ': ' + ids[index]);
        assert.equal(entry.text, expected[index]); assert.equal(entry.registered, true);
        assert.ok(entry.sourceStart <= entry.nodeStart && entry.nodeEnd <= entry.sourceEnd);
      }
    }
  });
});

test('explicit future annotations have stable keys after earlier literals are added and do not bypass technical or input protection', async () => {
  const page = [
    'const view=<main><Summary value={/* @copy-text summary.off */ "Off"} /><TextInput value={/* @copy-text unsafe.input */ "private"} /><option value={/* @copy-text unsafe.option */ "canonical"}>Label</option></main>;',
    'const internal = currency === /* @copy-text unsafe.condition */ "ریال";',
    'const CURRENCY = /* @copy-text unsafe.currency */ "تومان";',
    'const route = /* @copy-text unsafe.route */ "hub";',
    'fetch(/* @copy-text unsafe.url */ "/api/private");',
    'const greeting = /* @copy-text greeting.welcome */ `Hello ${member.name}`;',
  ].join('\n');
  await workspace({
    'src/pages/Page.tsx': page,
    'public/page.html': '<!-- @copy-text html.help attribute:title --><button title="Guide"><!-- @copy-text html.next -->Next</button>',
    'src/styles.css': '.hint::after{content:/* @copy-text css.hint */ "Help";}',
    'backend/app/service.py': '# @copy-text python.hint\nhint = "Help"\ndef check():\n    raise AppError((# @copy-text unsafe.code\n"INTERNAL"\n), "خطا", 400)\n',
  }, async root => {
    let catalog = await collectCatalog(root);
    for (const id of ['summary.off','greeting.welcome','html.help','html.next','css.hint','python.hint']) assert.ok(catalog.entries.some(entry => entry.id === id), id);
    for (const id of ['unsafe.input','unsafe.option','unsafe.condition','unsafe.currency','unsafe.code','unsafe.route','unsafe.url']) {
      assert.ok(!catalog.entries.some(entry => entry.id === id), id);
      assert.ok(catalog.audit.needsReview.some(entry => entry.text && entry.reason.includes('ثبت‌شده')));
    }
    await writeFile(join(root, 'src/pages/Page.tsx'), 'const label="Earlier text";\n' + page);
    catalog = await collectCatalog(root);
    assert.equal(catalog.entries.find(entry => entry.id === 'greeting.welcome').text, 'Hello {slot1}');
    const greeting = catalog.entries.find(entry => entry.id === 'greeting.welcome');
    const [file] = await prepareChanges(root, catalog, request(catalog, greeting, '{slot1}'));
    await writeFile(join(root, file.file), file.updated);
    catalog = await collectCatalog(root);
    assert.equal(catalog.entries.find(entry => entry.id === 'greeting.welcome').text, '{slot1}');
    assert.ok(file.updated.includes('${member.name}'));
    await writeFile(join(root, 'src/pages/Future.tsx'), 'const page=<p>Future feature copy</p>;');
    assert.ok((await collectCatalog(root)).entries.some(entry => entry.text === 'Future feature copy'));
  });
});

test('unregistered display values appear in coverage review while user records and native values do not', async () => {
  await workspace({ 'src/pages/Page.tsx': [
    'function summary(){ return {label: item.name, value: "No price"}; }',
    'const options=[{value:"canonical",label:"A visible label"}];',
    'const record={id:"r",value:"Private record"};',
    'const view=<input value="Private input" />;',
  ].join('\n') }, async root => {
    const catalog = await collectCatalog(root);
    assert.equal(catalog.audit.needsReview.length, 1);
    assert.equal(catalog.audit.needsReview[0].text, 'No price');
  });
});

test('registered ids stay reserved when inserted HTML markers shift intervening unedited body ordinals', async () => {
  await workspace({ 'public/page.html': '<p>اول</p><p>دوم</p><p>سوم</p><p>چهارم</p>' }, async root => {
    let catalog = await collectCatalog(root);
    const originals = ['اول','دوم','چهارم'].map(text => textEntry(catalog, text));
    const [file] = await prepareChanges(root, catalog, {revision:catalog.revision, changes:originals.map((entry,index)=>({id:entry.id,expectedText:entry.text,text:'Edited '+index}))});
    await writeFile(join(root, file.file), file.updated);
    catalog = await collectCatalog(root);
    assert.equal(new Set(catalog.entries.map(entry => entry.id)).size, catalog.entries.length);
    for (let index=0;index<originals.length;index++) assert.equal(catalog.entries.find(entry=>entry.id===originals[index].id).text,'Edited '+index);
    const untouched = textEntry(catalog,'سوم');
    assert.ok(untouched.id.startsWith('auto:'), 'An automatic ordinal collision cannot replace a registered entry');
    const [edited] = await prepareChanges(root,catalog,request(catalog,untouched,'Third edited later'));
    await writeFile(join(root,edited.file),edited.updated);
    catalog = await collectCatalog(root);
    assert.equal(catalog.entries.find(entry=>entry.id===untouched.id).text,'Third edited later');
  });
});

test('JSX registration preserves rendered spacing around immutable user expressions without adding DOM wrappers', async () => {
  const source = 'const view=<p>  اول {value} آخر  </p>;';
  const render = input => runInNewContext(ts.transpileModule(input + '\nview;', {compilerOptions:{jsx:ts.JsxEmit.React,jsxFactory:'h',target:ts.ScriptTarget.ES2022}}).outputText,
    {value:'[user]',h:(tag,props,...children)=>({tag,children})});
  await workspace({'src/Page.tsx':source},async root=>{
    const catalog=await collectCatalog(root),first=textEntry(catalog,'اول'),last=textEntry(catalog,'آخر');
    const [file]=await prepareChanges(root,catalog,{revision:catalog.revision,changes:[{id:first.id,expectedText:first.text,text:'First'},{id:last.id,expectedText:last.text,text:'Last'}]});
    const before=render(source),after=render(file.updated);
    assert.equal(before.children.join(''),'  اول [user] آخر  ');
    assert.equal(after.children.join(''),'  First [user] Last  ');
    assert.equal(after.tag,'p'); assert.equal(after.children.length,before.children.length);
    assert.ok(after.children.every(child=>typeof child==='string'),'Registration introduces no wrapper elements');
  });
});
