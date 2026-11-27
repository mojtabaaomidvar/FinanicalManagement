import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, ROUTES, createPreviewSession, handlePreviewRequest } from './fixtures.mjs';

const create = (scenario = 'full-owner', route = 'hub') => createPreviewSession(scenario, route, { now: '2026-11-16T08:00:00.000Z' });
const request = (session, path, method = 'GET', body) => handlePreviewRequest(session, { path, method, body });

test('payment fixtures retain online choice, reject tariffs, and cascade only linked fee', () => {
  const session = create(), bank = session.data.accounts.find(row => row.kind === 'bank');
  const fields = { member_id: session.data.actor.id, type: 'expense', amount: 1000, category: 'food',
    date: session.data.today, account_id: bank.id, payment_method: 'online', transfer_fee_method: null };
  const before = session.data.transactions.length;
  const tx = request(session, '/transactions', 'POST', fields).body;
  assert.equal(tx.payment_method, 'online');
  const older = { ...fields, note: 'Older client note' };
  delete older.payment_method;
  delete older.transfer_fee_method;
  assert.equal(request(session, '/transactions/' + tx.id, 'PATCH', older).status, 200);
  assert.equal(session.data.transactions.find(row => row.id === tx.id).payment_method, 'online');
  assert.equal(session.data.transactions.length, before + 1);
  assert.equal(request(session, '/transactions', 'POST', { ...fields, transfer_fee_method: 'internal' }).status, 422);
  assert.equal(request(session, '/transactions/' + tx.id, 'PATCH', { ...fields, payment_method: 'bank_transfer', transfer_fee_method: 'paya' }).status, 200);
  assert.equal(session.data.transactions.length, before + 2);
  assert.equal(request(session, '/transactions/' + tx.id, 'PATCH', fields).status, 200);
  assert.equal(session.data.transactions.length, before + 1);
});

test('assistant fixture preserves name-only recipe amounts as unknown with matching stock', () => {
  for (const quantity of [0, 2]) {
    const session = create('assistant-bread-zero');
    session.data.inventory.find(row => row.title === 'نان').quantity = quantity;
    session.data.dishes[0].ingredients[0].qty = null;
    const before = JSON.stringify([session.data.inventory, session.data.dishes, session.data.lists]);
    const result = request(session, '/assistant/report', 'POST', { text: 'برای صبحانه چه غذایی داریم؟' });
    assert.equal(result.status, 200);
    const dish = result.body.facts.find(fact => fact.dish_id === session.data.dishes[0].id);
    assert.equal(dish.status, 'unknown');
    assert.equal(dish.ingredients[0].qty, null);
    assert.equal(dish.ingredients[0].shortage, null);
    assert.equal(dish.ingredients[0].status, 'unknown');
    assert.equal(before, JSON.stringify([session.data.inventory, session.data.dishes, session.data.lists]));
  }
});

test('household report computes fixture stock and performs zero business writes', () => {
  const session = create('assistant-bread-zero');
  const paths = ['/transactions','/inventory','/shopping/lists','/tasks','/meals/dishes'];
  const before = paths.map(path => structuredClone(request(session,path).body));
  const body = { text:'نون نداریم برای صبحونه' };
  assert.equal(request(session, '/assistant/capabilities').body.protocol_version, 2);
  const result = request(session, '/assistant/report', 'POST', body);
  assert.equal(result.status,200);
  assert.deepEqual(result.body.proposals,[]);
  assert.equal(result.body.facts.find(row => row.kind === 'stock').status,'missing');
  assert.equal(result.body.facts.find(row => row.kind === 'dish' && row.title === 'تخم مرغ آب‌پز').status,'available');
  assert.equal(result.body.facts.find(row => row.kind === 'dish' && row.title === 'نان و پنیر').status,'missing');
  assert.deepEqual(paths.map(path => request(session,path).body),before);
  assert.equal(request(session, '/assistant/report', 'POST', {...body,text:'x'.repeat(8001)}).status,422);
  assert.equal(request(session, '/assistant/report', 'POST', {...body,scope:'auto'}).status,422);
  assert.equal(request(create('auth-login'), '/assistant/capabilities').status,401);
  assert.equal(request(create('loading'), '/assistant/report', 'POST', body).delayMs,20000);
  assert.equal(request(create('errors'), '/assistant/report', 'POST', body).status,502);
  assert.deepEqual(request(create('empty-owner'), '/assistant/report', 'POST', body).body.proposals,[]);
});

test('household fixtures distinguish unknown and conflicting stock rather than fixed extraction', () => {
  for (const [scenario,status,conflict] of [['assistant-bread-unknown','unknown',false],['assistant-bread-conflict','available',true]]) {
    const result = request(create(scenario),'/assistant/report','POST',{text:'نون نداریم برای صبحونه'}).body;
    const fact = result.facts.find(row => row.kind === 'stock');
    assert.equal(fact.status,status); assert.equal(fact.conflicts_with_request,conflict);
    assert.ok(result.questions.length); assert.deepEqual(result.proposals,[]);
  }
});

test('household fixture review needs confirmation and recovers one atomic execution receipt', () => {
  const session = create('assistant-bread-zero');
  const report = request(session,'/assistant/report','POST',{text:'نون نداریم برای صبحونه'}).body;
  const action = report.actions.find(row => row.kind === 'shopping_item');
  const fields = {report_token:report.report_token,action_id:action.id,list_id:session.data.lists[0].id,qty:1,unit:'عدد'};
  const review = request(session,'/assistant/prepare-action','POST',fields).body;
  assert.equal(session.data.lists[0].items.length,0);
  assert.equal(request(session,'/assistant/execute','POST',{review_token:review.review_token,confirmed:false}).status,422);
  const body = {review_token:review.review_token,confirmed:true};
  const first = request(session,'/assistant/execute','POST',body).body;
  const replay = request(session,'/assistant/execute','POST',body).body;
  assert.equal(first.entity_id,replay.entity_id); assert.equal(replay.replayed,true);
  assert.equal(session.data.lists[0].items.length,1); assert.equal(session.data.lists[0].items[0].price,null);
  assert.equal(request(session,'/assistant/receipt/'+review.operation_id).body.entity_id,first.entity_id);
  const changed = request(session,'/assistant/prepare-action','POST',{...fields,qty:2}).body;
  assert.equal(request(session,'/assistant/execute','POST',{review_token:changed.review_token,confirmed:true}).status,409);
});

test('household duplicate fixture does not add a second open shopping item', () => {
  const session = create('assistant-duplicate');
  const report = request(session,'/assistant/report','POST',{text:'نون نداریم برای صبحونه'}).body;
  const action = report.actions.find(row => row.kind === 'shopping_item');
  assert.deepEqual(action.existing_in,[session.data.lists[0].id]);
  const review = request(session,'/assistant/prepare-action','POST',{report_token:report.report_token,action_id:action.id,list_id:session.data.lists[0].id,qty:1}).body;
  assert.equal(request(session,'/assistant/execute','POST',{review_token:review.review_token,confirmed:true}).body.status,'existing');
  assert.equal(session.data.lists[0].items.length,1);
});

test('transaction assistant previews success, empty, error and waiting without financial writes', () => {
  const body = { items: [{ raw_text: 'امروز ۲۵۰ هزار تومان برای خرید میوه خرج کردم.' }] };
  const session = create(), before = structuredClone(session.data);
  const result = request(session, '/sms/assistant/analyze', 'POST', body);
  assert.equal(result.status, 200);
  assert.equal(result.body.candidates[0].raw_text, body.items[0].raw_text);
  assert.equal(result.body.candidates[0].amount, '250000');
  assert.equal(result.body.candidates[0].amount_unit, 'toman');
  assert.deepEqual({ ...session.data, requests: [] }, before);
  assert.deepEqual(request(create('empty-owner'), '/sms/assistant/analyze', 'POST', body).body.candidates, []);
  assert.equal(request(create('loading'), '/sms/assistant/analyze', 'POST', body).delayMs, 20000);
  for (const mode of ['errors', 'save-errors']) {
    assert.equal(request(create(mode), '/sms/assistant/analyze', 'POST', body).status, 502);
  }
  assert.equal(request(session, '/sms/assistant/analyze', 'POST', { items: [] }).status, 422);
  assert.equal(request(session, '/sms/assistant/analyze', 'POST', { items: [{ raw_text: ' '.repeat(100) }] }).status, 422);
});

test('support preview uses independent metadata and a separate operator session', () => {
  const session = create('auth-login', 'support');
  const actorBefore = structuredClone(session.data.actor), moneyBefore = structuredClone(session.data.transactions);
  assert.deepEqual(request(session, '/support/session').body, { authenticated: false });
  assert.equal(request(session, '/support/users').status, 401);
  assert.equal(request(session, '/support/login', 'POST', { username: 'support', password: 'fixture' }).status, 200);
  const users = request(session, '/support/users').body;
  assert.equal(users.items.length, 25);
  assert.equal(users.total, 31);
  assert.deepEqual(Object.keys(users.items[0]).sort(), ['attention_reason','created_at','last_login_at','membership_state','registered_at','registration_state','stage','support_code']);
  assert.ok(!session.data.members.some(member => member.id === users.items[0].support_code));
  assert.equal(request(session, '/support/users?code=' + users.items[0].support_code).body.items.length, 1);
  assert.equal(request(session, '/support/users?offset=25').body.items.length, 6);
  assert.equal(request(session, '/support/overview?days=30').body.daily.length, 30);
  assert.equal(request(session, '/support/logout', 'POST', {}).status, 204);
  assert.equal(request(session, '/support/technical').status, 401);
  assert.deepEqual(session.data.actor, actorBefore);
  assert.deepEqual(session.data.transactions, moneyBefore);
});

test('support preview exposes empty, failed and delayed display states', () => {
  assert.deepEqual(request(create('empty-owner', 'support'), '/support/users').body.items, []);
  assert.equal(request(create('empty-owner', 'support'), '/support/overview').body.registered, 0);
  assert.equal(request(create('errors', 'support'), '/support/session').status, 200);
  assert.equal(request(create('errors', 'support'), '/support/overview').status, 503);
  assert.equal(request(create('loading', 'support'), '/support/users').delayMs, 20000);
  const session = create();
  const own = request(session, '/members/me/support-code').body.support_code;
  assert.ok(!session.data.members.some(member => member.id === own));
  assert.equal(request(session, '/auth/join', 'POST', {}).body.support_code.length, 36);
});

test('catalog preview publishes only reviewed metadata without modifying household data', () => {
  const session = create('auth-login', 'support'), before = structuredClone(session.data);
  assert.equal(request(session, '/support/catalog').status, 401);
  assert.equal(request(session, '/support/catalog/review', 'POST', {}).status, 401);
  request(session, '/support/login', 'POST', { username: 'support', password: 'fixture' });
  const list = request(session, '/support/catalog').body;
  assert.equal(list.total, 1);
  assert.deepEqual(Object.keys(list.items[0]).sort(), ['category','id','published_at','reviewed_at','status','submitted_at','title','unit']);
  const body = { id: list.items[0].id, status: 'approved', title:'نمونه: نام اصلاح‌شده', category:'personal_care', unit:'پاکت' };
  assert.equal(request(session, '/support/catalog/review', 'POST', body).body.status, 'approved');
  assert.equal(request(session, '/support/catalog/review', 'POST', body).status, 200);
  assert.equal(request(session, '/support/catalog/review', 'POST', { ...body, status: 'rejected' }).status, 409);
  assert.equal(request(session, '/support/catalog').body.total, 0);
  assert.equal(request(session, '/support/catalog?status=approved').body.total, 2);
  assert.deepEqual(session.publishedCatalog, [{ id:body.id, title:body.title, group:body.category, unit:body.unit, aliases:[], common:false }]);
  assert.deepEqual({ ...session.data, requests: [] }, before);
});

test('catalog fixture exposes published additions to the household while keeping pending reviews private', () => {
  const session = create('full-owner', 'support');
  const [pending] = request(session, '/support/catalog').body.items;
  assert.deepEqual(request(session, '/inventory/catalog').body, []);
  request(session, '/support/catalog/review', 'POST', { id:pending.id, status:'approved' });
  assert.equal(request(session, '/inventory/catalog').body[0].title, pending.title);
  assert.equal(request(create('auth-login'), '/inventory/catalog').status, 401);
  assert.equal(request(create('errors'), '/inventory/catalog').status, 503);
  assert.equal(request(create('loading'), '/inventory/catalog').delayMs, 20000);
});

test('catalog preview includes empty, loading, read/write errors and review conflict states', () => {
  assert.deepEqual(request(create('empty-owner', 'support'), '/support/catalog').body.items, []);
  assert.equal(request(create('loading', 'support'), '/support/catalog').delayMs, 20000);
  assert.equal(request(create('errors', 'support'), '/support/catalog').status, 503);
  const full = create('full-owner', 'support');
  const proposal = request(full, '/support/catalog').body.items[0];
  for (const [scenario, code] of [['save-errors',503], ['conflict',409]]) {
    assert.equal(request(create(scenario, 'support'), '/support/catalog/review', 'POST', { id:proposal.id, status:'rejected' }).status, code);
  }
});

test('SMS import remains pending and each actor can only read or change own messages', () => {
  for (const role of ['full-owner', 'full-admin', 'full-member']) {
    const session = create(role, 'sms');
    const foreign = { ...session.data.sms[0], id: 'foreign-sms', member_id: session.data.members.find(member => member.id !== session.data.actor.id).id, status: 'pending' };
    session.data.sms.push(foreign);
    assert.equal(request(session, '/sms', 'POST', { items: [{ raw_text: 'برداشت 100 ریال', amount: 100, type: 'expense' }] }).body, 1);
    const pending = request(session, '/sms?status=pending').body;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].member_id, session.data.actor.id);
    assert.equal(request(session, '/sms/foreign-sms', 'PATCH', { status: 'recorded' }).status, 404);
    assert.equal(foreign.status, 'pending');
    assert.equal(request(session, '/sms/' + pending[0].id, 'PATCH', { status: 'recorded' }).status, 409);
    const account = session.data.accounts.find(row => row.member_id === session.data.actor.id);
    const fields = { member_id: session.data.actor.id, type: 'income', category: 'ride',
      amount: 100, date: session.data.today, account_id: account.id, note: 'Reviewed note', time: '14:37:52' };
    const recorded = request(session, '/sms/' + pending[0].id + '/record', 'POST', { transaction: fields });
    assert.equal(recorded.status, 200);
    const replay = request(session, '/sms/' + pending[0].id + '/record', 'POST', { transaction: fields });
    assert.equal(replay.body.id, recorded.body.id);
    assert.equal(recorded.body.note, 'Reviewed note');
    assert.equal(recorded.body.time, '14:37:52');
    assert.deepEqual(request(session, '/sms?status=pending').body, []);
  }
});

test('recurring acknowledgements are idempotent owner or manager actions without financial writes', () => {
  for (const role of ['full-owner', 'full-admin']) {
    const session = create(role), transaction = session.data.transactions.find(row => row.repeat === 'monthly');
    const before = structuredClone(session.data.transactions), path = '/transactions/' + transaction.id + '/occurrences';
    assert.equal(request(session, path, 'POST', { due_date: session.data.today }).status, 204);
    assert.equal(request(session, path, 'POST', { due_date: session.data.today }).status, 204);
    assert.deepEqual(transaction.handled_occurrences, [session.data.today]);
    assert.deepEqual(session.data.transactions.map(row => ({ ...row, handled_occurrences: [] })), before);
    assert.equal(request(session, path, 'POST', { due_date: '2026-02-30' }).status, 422);
    assert.equal(request(session, path, 'GET').status, 405);
  }
  const member = create('full-member'), tx = member.data.transactions.find(row => row.repeat === 'monthly');
  assert.equal(request(member, '/transactions/' + tx.id + '/occurrences', 'POST', { due_date: member.data.today }).status, 204);
  tx.member_id = member.data.members.find(row => row.role === 'owner').id;
  assert.equal(request(member, '/transactions/' + tx.id + '/occurrences', 'POST', { due_date: member.data.today }).status, 404);
});

test('bill payment and reversal create and remove one linked expense without changing other records', () => {
  const session = create(), bill = session.data.bills.find(row => row.state === 'unpaid');
  const before = structuredClone(session.data.transactions), accountId = session.data.accounts[0].id;
  const paid = request(session, '/bills/' + bill.id + '/pay', 'POST', { account_id: accountId }).body;
  const transaction = session.data.transactions.find(row => row.id === paid.transaction_id);
  assert.equal(transaction.type, 'expense'); assert.equal(transaction.amount, String(bill.amount));
  assert.equal(transaction.category, 'bills'); assert.equal(transaction.account_id, accountId);
  assert.equal(transaction.date, session.data.today); assert.equal(transaction.note, bill.title);
  assert.equal(session.data.transactions.length, before.length + 1);
  assert.equal(request(session, '/bills/' + bill.id + '/pay', 'POST').status, 409);
  assert.equal(request(session, '/bills/' + bill.id, 'DELETE').status, 409);
  assert.equal(request(session, '/bills/' + bill.id, 'PATCH', { amount: 1 }).status, 409);
  assert.equal(request(session, '/bills/' + bill.id + '/unpay', 'POST').status, 200);
  assert.deepEqual(session.data.transactions, before);
  assert.equal(bill.state, 'unpaid'); assert.equal(bill.transaction_id, null);
  assert.equal(request(session, '/bills/' + bill.id + '/unpay', 'POST').status, 409);
});

test('bill cancellation makes no expense and undo permissions match the backend', () => {
  const session = create('full-member'), bill = session.data.bills.find(row => row.state === 'unpaid');
  const before = structuredClone(session.data.transactions);
  assert.equal(request(session, '/bills/' + bill.id + '/cancel', 'POST').status, 200);
  assert.equal(bill.state, 'cancelled');
  assert.equal(request(session, '/bills/' + bill.id + '/pay', 'POST').status, 409);
  assert.deepEqual(session.data.transactions, before);
  const foreign = session.data.bills.find(row => row.state === 'paid');
  foreign.paid_by_member_id = session.data.members.find(row => row.role === 'owner').id;
  assert.equal(request(session, '/bills/' + foreign.id + '/unpay', 'POST').status, 403);
});

test('bill create and edit validate dates and numeric identifiers while keeping state out of the write contract', () => {
  const session = create();
  const input = { kind: 'water', title: ' Water ', amount: '100.25', due_date: '2026-11-18', bill_no: ' ۰۰۱ ۲۳ ', payment_no: '00456', state: 'paid' };
  const bill = request(session, '/bills', 'POST', input).body;
  assert.equal(bill.title, 'Water'); assert.equal(bill.bill_no, '00123'); assert.equal(bill.state, 'unpaid');
  assert.equal(request(session, '/bills/' + bill.id, 'PATCH', { ...input, title: ' Edited ' }).body.title, 'Edited');
  const before = structuredClone(session.data.bills);
  for (const invalid of [{ amount: -1 }, { amount: Infinity }, { due_date: '2026-02-30' }, { title: 'x'.repeat(121) }, { bill_no: '012x' }, { payment_no: '0'.repeat(41) }]) {
    assert.equal(request(session, '/bills', 'POST', { ...input, ...invalid }).status, 422);
    assert.equal(request(session, '/bills/' + bill.id, 'PATCH', { ...input, ...invalid }).status, 422);
  }
  assert.deepEqual(session.data.bills, before);
});

test('category and label retries keep identities while type and parent remain separate', () => {
  const session = create();
  const expense = request(session, '/custom-categories', 'POST', { type: 'expense', name: ' Same name ' }).body;
  assert.equal(expense.name, 'Same name');
  assert.equal(request(session, '/custom-categories', 'POST', { type: 'expense', name: 'Same name' }).body.id, expense.id);
  const income = request(session, '/custom-categories', 'POST', { type: 'income', name: 'Same name' }).body;
  assert.notEqual(income.id, expense.id);
  const label = request(session, '/subcategories', 'POST', { category: ' food ', name: ' Label ' }).body;
  assert.equal(label.category, 'food'); assert.equal(label.name, 'Label');
  assert.equal(request(session, '/subcategories', 'POST', { category: 'food', name: 'Label' }).body.id, label.id);
  assert.notEqual(request(session, '/subcategories', 'POST', { category: 'salary', name: 'Label' }).body.id, label.id);
  assert.equal(request(session, '/custom-categories', 'POST', { type: 'transfer', name: 'Invalid' }).status, 422);
});

test('used categories cannot be deleted and unused categories remove dependent labels and budgets', () => {
  const session = create();
  const used = request(session, '/custom-categories', 'POST', { type: 'expense', name: 'Used' }).body;
  request(session, '/transactions', 'POST', { category: used.id, amount: 100 });
  const before = structuredClone({ categories: session.data.customCategories, labels: session.data.subcategories,
    budgets: session.data.categoryBudgets, transactions: session.data.transactions });
  assert.equal(request(session, '/custom-categories/' + used.id, 'DELETE').status, 409);
  assert.deepEqual({ categories: session.data.customCategories, labels: session.data.subcategories,
    budgets: session.data.categoryBudgets, transactions: session.data.transactions }, before);
  const unused = request(session, '/custom-categories', 'POST', { type: 'expense', name: 'Unused' }).body;
  request(session, '/subcategories', 'POST', { category: unused.id, name: 'Dependent' });
  request(session, '/category-budgets', 'POST', { category: unused.id, amount: 1000 });
  const transactions = structuredClone(request(session, '/transactions').body);
  assert.equal(request(session, '/custom-categories/' + unused.id, 'DELETE').status, 204);
  assert.equal(request(session, '/subcategories').body.some(row => row.category === unused.id), false);
  assert.equal(request(session, '/category-budgets').body.some(row => row.category === unused.id), false);
  assert.deepEqual(request(session, '/transactions').body, transactions);
});

test('deleting a label clears its link and preserves every financial field', () => {
  const session = create(), label = request(session, '/subcategories').body[0];
  const before = structuredClone(request(session, '/transactions').body);
  assert.equal(request(session, '/subcategories/' + label.id, 'DELETE').status, 204);
  const after = request(session, '/transactions').body;
  assert.deepEqual(after, before.map(row => ({ ...row, subcategory_id: row.subcategory_id === label.id ? null : row.subcategory_id })));
});

test('deleting an account with history is blocked and preserves the ledger', () => {
  const session = create(), accounts = request(session, '/accounts').body;
  const source = accounts[0].id, destination = accounts[1].id;
  request(session, '/transactions', 'POST', { type: 'transfer', amount: 100, category: 'transfer', date: '2026-11-16',
    member_id: session.data.actor.id, account_id: source, to_account_id: destination, note: 'Account removal regression' });
  const before = structuredClone(request(session, '/transactions').body);
  assert.equal(request(session, '/accounts/' + source, 'DELETE').status, 422);
  assert.equal(request(session, '/accounts/' + source, 'DELETE', { confirmation: accounts[0].title }).status, 409);
  const after = request(session, '/transactions').body;
  assert.deepEqual(after, before);
  assert.equal(after.find(row => row.note === 'Account removal regression').to_account_id, destination);
});

test('all scenarios and routes have stable distinct IDs and safe defaults', () => {
  assert.equal(new Set(SCENARIOS.map(item => item.id)).size, SCENARIOS.length);
  assert.equal(new Set(ROUTES.map(item => item.id)).size, ROUTES.length);
  for (const scenario of SCENARIOS) {
    const session = createPreviewSession(scenario.id);
    assert.ok(session.id); assert.equal(session.scenario.role, scenario.role);
    assert.ok(ROUTES.some(item => item.id === session.route));
  }
  assert.throws(() => createPreviewSession('unknown'));
  assert.throws(() => createPreviewSession('full-owner', 'https://production.invalid'));
});

test('all app routes, independent support and settings sections are represented', () => {
  assert.equal(ROUTES.filter(item => !item.baseRoute).length, 27);
  assert.ok(ROUTES.some(item => item.id === 'support'));
  assert.equal(ROUTES.filter(item => item.baseRoute === 'settings').length, 13);
  assert.equal(create('full-owner', 'settings/notifications').routeInfo.sectionLabel, 'اعلان‌ها');
});

test('fake auth/session identities match scenario and return public member DTOs', () => {
  for (const [scenario, role, phone] of [['full-owner', 'owner', '09000000001'], ['full-admin', 'admin', '09000000003'], ['full-member', 'member', '09000000002']]) {
    const session = create(scenario), login = request(session, '/api/v1/auth/login', 'POST', { phone, password: 'Test12345!' });
    assert.equal(login.status, 200); assert.equal(login.body.member.role, role);
    assert.equal(login.body.member.phone, phone); assert.equal(login.body.session_token, session.token);
    assert.equal(request(session, '/auth/session').body.member.id, login.body.member.id);
    assert.equal(login.body.member.membership_state, 'active');
    assert.equal('password_hash' in login.body.member, false);
  }
});

test('every core provider and online summary endpoint supplies complete wire containers', () => {
  const session = create();
  for (const path of ['/auth/family', '/auth/members', '/transactions', '/accounts', '/subcategories', '/custom-categories', '/events', '/category-budgets', '/bills', '/shopping/lists', '/inventory', '/shopping/offline', '/notifications/prefs', '/documents', '/equipment', '/vehicles', '/goals', '/activities', '/children', '/pets', '/holdings', '/market/prices', '/meals/dishes', '/meals/plan']) {
    assert.equal(request(session, path).status, 200, path);
  }
  for (const [path, key] of [['/vehicles', 'vehicles'], ['/goals', 'goals'], ['/activities', 'activities'], ['/children', 'children'], ['/pets', 'pets']]) {
    const body = request(session, path).body;
    assert.ok(Array.isArray(body[key]) && body[key].length > 0, path);
    assert.equal(typeof body.can_create, 'boolean', path);
  }
  assert.equal(request(session, '/subcategories').body[0].category, 'food');
});

test('sample data activates pending, overdue, completed, unknown-date and paid states', () => {
  const session = create(), data = session.data;
  assert.ok(data.tasks.some(task => !task.completed && task.due_date < data.today));
  assert.ok(data.tasks.some(task => task.completed && task.completion_photo_url));
  assert.ok(data.tasks.some(task => task.due_date === null));
  assert.deepEqual(new Set(data.bills.map(bill => bill.state)), new Set(['unpaid', 'paid', 'cancelled']));
  assert.deepEqual(new Set(data.activities.map(item => item.status)), new Set(['planned', 'done', 'cancelled']));
  assert.deepEqual(new Set(data.vehicleServices.map(item => item.cost_status)), new Set(['recorded', 'none', 'unavailable']));
  assert.ok(data.inventory.some(item => item.quantity === 0));
  assert.ok(data.inventory.every(item => !('threshold' in item)));
  assert.ok(data.lists.some(list => !list.items.length));
  assert.ok(data.lists[0].items.some(item => item.price === null));
});

test('empty household preserves own identity and returns correctly shaped empty data', () => {
  const session = create('empty-owner');
  assert.equal(request(session, '/auth/session').body.members.length, 1);
  assert.equal(request(session, '/transactions').body.length, 0);
  assert.equal(request(session, '/vehicles').body.vehicles.length, 0);
  assert.equal(request(session, '/goals').body.goals.length, 0);
  assert.deepEqual(request(session, '/shopping/offline').body.tasks, []);
  assert.equal(session.data.family.budget, 0);
});

test('role and age capabilities are reflected in manager-owned modules', () => {
  const member = create('full-member');
  assert.equal(request(member, '/children').body.can_create, false);
  assert.equal(request(member, '/pets').body.can_create, false);
  assert.equal(request(member, '/auth/join-requests').status, 403);
  assert.equal(request(member, '/children', 'POST', { name: 'test' }).status, 403);
  assert.equal(request(create('minor-member'), '/vehicles').body.can_create, false);
  assert.equal(request(create('missing-birth'), '/vehicles').body.can_create, false);
  assert.equal(request(create('full-member'), '/vehicles').body.can_create, true);
  assert.equal(request(create('full-admin'), '/children').body.can_create, true);
  for (const scenario of ['minor-member', 'missing-birth']) {
    const restricted = create(scenario), vehicle = request(restricted, '/vehicles').body.vehicles[0];
    assert.equal(vehicle.can_view_history, false); assert.equal(vehicle.can_edit, false); assert.equal(vehicle.plate, null);
    assert.equal(request(restricted, '/documents').status, 403);
    assert.equal(request(restricted, `/vehicles/${vehicle.id}/services`).status, 403);
    assert.equal(request(restricted, '/vehicles', 'POST', { title: 'test' }).status, 403);
  }
});

test('child and pet detail endpoints contain canonical task and activity links', () => {
  const session = create(), child = request(session, '/children').body.children[0], pet = request(session, '/pets').body.pets[0];
  const childDetail = request(session, `/children/${child.id}`).body;
  assert.equal(childDetail.child.id, child.id); assert.ok(childDetail.tasks.length); assert.ok(childDetail.activities.length);
  assert.ok(childDetail.birthday.id);
  const petDetail = request(session, `/pets/${pet.id}`).body;
  assert.equal(petDetail.pet.id, pet.id); assert.ok(petDetail.care_tasks.length); assert.equal(petDetail.can_create_care, true);
});

test('offline snapshot is limited to household tasks and shopping without finances or PII', () => {
  const snapshot = request(create(), '/shopping/offline').body;
  assert.deepEqual(Object.keys(snapshot).sort(), ['inventory', 'lists', 'task_notification_prefs', 'tasks']);
  assert.equal('price' in snapshot.lists[0].items[0], false);
  assert.equal('member' in snapshot, false);
  assert.equal('phone' in snapshot.tasks[0], false);
});

test('offline mutations are isolated and operation retries do not duplicate records', () => {
  const session = create(), other = create(), operation = { operation_id: 'copy-operation-1', kind: 'task.create', entity_id: 'cf000000-0000-4000-8000-999999999999', base_revision: null,
    payload: { title: 'نمونه: آزمایش', description: null, assignee_id: null, due_date: null } };
  const initial = session.data.tasks.length;
  assert.equal(request(session, '/shopping/offline/mutations', 'POST', operation).body.replayed, false);
  assert.equal(request(session, '/shopping/offline/mutations', 'POST', operation).body.replayed, true);
  assert.equal(session.data.tasks.length, initial + 1); assert.equal(other.data.tasks.length, initial);
  const stored = session.data.tasks.at(-1);
  assert.equal(request(session, '/shopping/offline/mutations', 'POST', { ...operation, operation_id: 'copy-operation-2', kind: 'task.update', base_revision: stored.revision - 1 }).status, 409);
});

test('personal Home prefs use revisions and never overwrite canonical identifiers', () => {
  const session = create(), original = request(session, '/members/me/home-preferences').body;
  const preferences = { ...original.preferences, pins: ['bills'] };
  assert.equal(request(session, '/members/me/home-preferences', 'PATCH', { revision: original.revision, preferences }).body.revision, 1);
  assert.equal(request(session, '/members/me/home-preferences', 'PATCH', { revision: 0, preferences }).status, 409);
  assert.equal(session.data.actor.currency, 'تومان');
});

test('transaction receipt responses keep their identity across caption edits and deletion', () => {
  const session = create();
  const transaction = session.data.transactions[0];
  const photo = request(session, `/transactions/${transaction.id}/photos`, 'POST', {
    url: '/__copy/sample-image.svg', caption: 'receipt',
  });
  assert.equal(photo.status, 201);
  assert.ok(photo.body.id);
  const id = photo.body.id;
  assert.equal(transaction.photos.find(item => item.id === id).caption, 'receipt');
  assert.equal(request(session, `/photos/${id}`, 'PATCH', { caption: 'edited receipt' }).status, 204);
  assert.equal(transaction.photos.find(item => item.id === id).caption, 'edited receipt');
  assert.equal(request(session, `/photos/${id}`, 'DELETE').status, 204);
  assert.ok(!transaction.photos.some(item => item.id === id));
  assert.equal(request(session, `/photos/${id}`, 'DELETE').status, 404);
});

test('errors, loading and save-conflict cases activate only the intended operation class', () => {
  assert.equal(request(create('errors'), '/equipment').status, 503);
  assert.equal(request(create('errors'), '/auth/login', 'POST').status, 200);
  assert.equal(request(create('loading'), '/equipment').delayMs, 20_000);
  assert.equal(request(create('loading'), '/auth/config').delayMs, undefined);
  assert.equal(request(create('save-errors'), '/equipment').status, 200);
  assert.equal(request(create('save-errors'), '/equipment', 'POST', { title: 'test' }).status, 503);
  assert.equal(request(create('conflict'), '/equipment', 'POST', { title: 'test' }).status, 409);
});

test('auth and invite exceptional responses match existing REST contracts', () => {
  assert.equal(request(create('auth-invalid'), '/auth/login', 'POST').body.error, 'INVALID_CREDENTIALS');
  assert.equal(request(create('auth-suspended'), '/auth/login', 'POST').body.error, 'MEMBERSHIP_INACTIVE');
  assert.equal(request(create('auth-otp'), '/auth/config').body.otp_enabled, true);
  assert.equal(request(create('auth-pre-registered'), '/auth/pre-registered', 'POST').body.pre_registered, true);
  assert.equal(request(create('invite-expired'), '/auth/invite/sample').status, 404);
  assert.equal(request(create('invite-expired'), '/auth/accept-invite', 'POST').status, 404);
  assert.equal(request(create('auth-otp'), '/auth/login', 'POST', { code: '000000' }).body.error, 'INVALID_OTP');
  assert.equal(request(create('auth-otp'), '/auth/login', 'POST', { code: '123456' }).status, 200);
  assert.equal(request(create('auth-otp'), '/auth/register', 'POST', { otp_code: '000000' }).body.error, 'INVALID_OTP');
  assert.equal(request(create('auth-otp'), '/auth/register', 'POST', { otp_code: '123456' }).status, 200);
  assert.equal(request(create('invite-valid'), '/auth/accept-invite', 'POST').body.state, 'pending');
  assert.equal(request(create('reminders-off'), '/notifications/prefs').body.enabled, false);
});

test('sample document downloads contain permitted actual bytes matching their metadata', () => {
  const session = create();
  for (const document of session.data.documents) {
    const download = request(session, `/documents/${document.id}/file`);
    assert.equal(download.status, 200); assert.equal(download.raw, true);
    assert.equal(download.headers['Content-Type'], document.mime_type);
    assert.ok(Buffer.isBuffer(download.body)); assert.equal(download.body.length, document.file_size);
    if (document.mime_type === 'application/pdf') assert.equal(download.body.subarray(0, 5).toString(), '%PDF-');
    else assert.equal(download.body.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
});

test('writes and returned DTO mutations never affect another session', () => {
  const one = create(), two = create(), result = request(one, '/accounts');
  result.body[0].title = 'changed externally'; assert.notEqual(one.data.accounts[0].title, 'changed externally');
  const count = two.data.accounts.length;
  request(one, '/accounts', 'POST', { title: 'new account', kind: 'wallet' });
  assert.equal(two.data.accounts.length, count);
});

test('account metadata preserves opening balance and rejects balance rewrites', () => {
  const session = create(); const account = request(session, '/accounts').body[0];
  const updated = request(session, '/accounts/' + account.id, 'PATCH', { title: 'Renamed account', card_number: account.card_number, initial_balance: null });
  assert.equal(updated.status, 200); assert.equal(updated.body.initial_balance, account.initial_balance);
  assert.equal(updated.body.title, 'Renamed account');
  const rejected = request(session, '/accounts/' + account.id, 'PATCH', { card_number: account.card_number, initial_balance: 0 });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error, 'BALANCE_CORRECTION_REQUIRED');
  assert.equal(session.data.accounts.find(row => row.id === account.id).initial_balance, account.initial_balance);
});

test('unknown, absolute or unsupported requests fail locally without fallback', () => {
  const session = create();
  assert.equal(request(session, '/unmapped-endpoint').status, 404);
  assert.equal(request(session, '/accounts', 'PUT').status, 405);
  const result = request(session, 'https://production.invalid/unmapped-endpoint');
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'PREVIEW_ENDPOINT_NOT_FOUND');
});
