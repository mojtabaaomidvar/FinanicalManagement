import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, ROUTES, createPreviewSession, handlePreviewRequest } from './fixtures.mjs';

const create = (scenario = 'full-owner', route = 'hub') => createPreviewSession(scenario, route, { now: '2026-11-16T08:00:00.000Z' });
const request = (session, path, method = 'GET', body) => handlePreviewRequest(session, { path, method, body });

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

test('unknown, absolute or unsupported requests fail locally without fallback', () => {
  const session = create();
  assert.equal(request(session, '/unmapped-endpoint').status, 404);
  assert.equal(request(session, '/accounts', 'PUT').status, 405);
  const result = request(session, 'https://production.invalid/unmapped-endpoint');
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'PREVIEW_ENDPOINT_NOT_FOUND');
});
