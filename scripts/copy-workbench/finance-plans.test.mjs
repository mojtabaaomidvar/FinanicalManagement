import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewSession, handlePreviewRequest } from './fixtures.mjs';
const create = () => createPreviewSession('full-owner', 'settings', { now: '2026-11-19T08:00:00Z' });
const request = (session, path, method, body) => handlePreviewRequest(session, { path, method, body });

test('future plan edits preserve actual transactions and settlement retries return one payment', () => {
  const session = create(), row = session.data.transactions[0], original = structuredClone(row);
  const path = '/transactions/' + row.id;
  const updated = request(session, path + '/recurring', 'PATCH', { amount: 1000, category: 'salary', note: 'Future salary',
    start_date: '2026-11-26', repeat: 'weekly', repeat_end: '2027-01-01', revision: 0 });
  assert.equal(updated.status, 200);
  for (const key of ['amount', 'category', 'date', 'note', 'account_id']) assert.deepEqual(row[key], original[key]);
  const body = { due_date: '2026-11-26', revision: 1, account_id: session.data.accounts[0].id };
  const paid = request(session, path + '/settle', 'POST', body);
  assert.equal(paid.status, 200); assert.equal(paid.body.date, '2026-11-19'); assert.equal(paid.body.amount, 1000);
  assert.equal(paid.body.recurring_source_id, row.id); assert.equal(paid.body.repeat, 'none');
  assert.deepEqual(request(session, path + '/settle', 'POST', { ...body, revision: 0 }), paid);
  assert.equal(session.data.transactions.filter(item => item.recurring_source_id === row.id).length, 1);
  assert.equal(request(session, path, 'DELETE').status, 409);
  assert.equal(request(session, path + '/recurring', 'PATCH', { revision: 0 }).status, 409);
});

test('accounts enforce owner mutations and child additions, and require typed deletion', () => {
  const session = create(), actor = session.data.actor, child = session.data.members.find(row => row.relation === 'فرزند');
  const input = { member_id: child.id, title: 'Child card', kind: 'bank', card_number: '6037990000000099' };
  const card = request(session, '/accounts', 'POST', input);
  assert.equal(card.status, 201);
  assert.equal(request(session, '/accounts/' + card.body.id, 'PATCH', { title: 'Changed' }).status, 404);
  const adult = session.data.members.find(row => row.relation === 'همسر');
  assert.equal(request(session, '/accounts', 'POST', { ...input, member_id: adult.id }).status, 403);
  const own = request(session, '/accounts', 'POST', { member_id: actor.id, title: 'Own wallet', kind: 'wallet' });
  assert.equal(own.status, 201);
  assert.equal(request(session, '/accounts/' + own.body.id, 'DELETE', { confirmation: 'Wrong name' }).status, 422);
  assert.equal(request(session, '/accounts/' + own.body.id, 'DELETE', { confirmation: 'Own wallet' }).status, 204);
});
