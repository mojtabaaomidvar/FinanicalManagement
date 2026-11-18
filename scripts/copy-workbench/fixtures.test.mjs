import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, ROUTES, createPreviewSession, handlePreviewRequest } from './fixtures.mjs';

const create = (scenario = 'full-owner', route = 'hub') => createPreviewSession(scenario, route, { now: '2026-11-16T08:00:00.000Z' });
const request = (session, path, method = 'GET', body) => handlePreviewRequest(session, { path, method, body });

test('recurring acknowledgements are idempotent manager actions without financial writes', () => {
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
  assert.equal(request(member, '/transactions/' + tx.id + '/occurrences', 'POST', { due_date: member.data.today }).status, 403);
});

test('bill payment and reversal create and remove one linked expense without changing other records', () => {
  const session = create(), bill = session.data.bills.find(row => row.state === 'unpaid');
  const before = structuredClone(session.data.transactions), accountId = session.data.accounts[0].id;
  const paid = request(session, '/bills/' + bill.id + '/pay', 'POST', { account_id: accountId }).body;
  const transaction = session.data.transactions.find(row => row.id === paid.transaction_id);
  assert.equal(transaction.type, 'expense'); assert.equal(transaction.amount, bill.amount);
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
  const input = { kind: 'water', title: ' Water ', amount: 100.25, due_date: '2026-11-18', bill_no: ' ۰۰۱ ۲۳ ', payment_no: '00456', state: 'paid' };
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

test('deleting an account preserves the ledger and clears only its transfer and direct account links', () => {
  const session = create(), accounts = request(session, '/accounts').body;
  const source = accounts[0].id, destination = accounts[1].id;
  request(session, '/transactions', 'POST', { type: 'transfer', amount: 100, category: 'transfer', date: '2026-11-16',
    member_id: session.data.actor.id, account_id: source, to_account_id: destination, note: 'Account removal regression' });
  const before = structuredClone(request(session, '/transactions').body);
  assert.equal(request(session, '/accounts/' + source, 'DELETE').status, 204);
  const after = request(session, '/transactions').body;
  assert.deepEqual(after.map(row => row.id), before.map(row => row.id));
  for (const [index, row] of after.entries()) assert.deepEqual(row, { ...before[index],
    account_id: before[index].account_id === source ? null : before[index].account_id,
    to_account_id: before[index].to_account_id === source ? null : before[index].to_account_id });
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

test('all 23 actual app routes and settings sections are represented', () => {
  assert.equal(ROUTES.filter(item => !item.baseRoute).length, 23);
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
  assert.ok(data.inventory.some(item => item.quantity < item.threshold));
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

test('account edits preserve a null opening balance while explicit zero remains a valid update', () => {
  const session = create(); const account = request(session, '/accounts').body[0];
  const updated = request(session, '/accounts/' + account.id, 'PATCH', { title: 'Renamed account', initial_balance: null });
  assert.equal(updated.status, 200); assert.equal(updated.body.initial_balance, account.initial_balance);
  assert.equal(updated.body.title, 'Renamed account');
  assert.equal(request(session, '/accounts/' + account.id, 'PATCH', { initial_balance: 0 }).body.initial_balance, 0);
});

test('unknown, absolute or unsupported requests fail locally without fallback', () => {
  const session = create();
  assert.equal(request(session, '/unmapped-endpoint').status, 404);
  assert.equal(request(session, '/accounts', 'PUT').status, 405);
  const result = request(session, 'https://production.invalid/unmapped-endpoint');
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'PREVIEW_ENDPOINT_NOT_FOUND');
});
