import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPreviewSession, handlePreviewRequest } from './fixtures.mjs';
import { walletCents, walletText } from './wallet-fixtures.mjs';

const create = (scenario = 'full-owner') => createPreviewSession(scenario, 'accounts', { now: '2026-11-24T08:00:00Z' });
const call = (session, path, method = 'GET', body) => handlePreviewRequest(session, { path, method, body });
const own = session => session.data.accounts.find(row => row.member_id === session.data.actor.id);
const pathFor = account => `/accounts/${account.id}`;
test('fractional and unsafe numeric fixtures are rejected instead of rounded', () => {
  for (const amount of [0.1, 0.01, 9007199254740992, NaN, Infinity]) assert.throws(() => walletCents(amount), /require exact text/);
  assert.equal(walletCents('0.1'), 10n);
  assert.equal(walletCents('0.01'), 1n);
});
test('recurring source money contributes once while changing a future plan leaves the balance unchanged', () => {
  const session = create(), account = own(session);
  session.data.transactions = [{ id: 'source', member_id: account.member_id, account_id: account.id, type: 'income', amount: '0.11', repeat: 'monthly', recurring_plan: { amount: '10' } }];
  account.initial_balance = '0.1';
  assert.equal(call(session, pathFor(account) + '/balance').body.ledger_balance, '0.21');
  session.data.transactions[0].recurring_plan.amount = '100';
  assert.equal(call(session, pathFor(account) + '/balance').body.ledger_balance, '0.21');
});
function correct(session, account, patch = {}) {
  const balance = call(session, pathFor(account) + '/balance').body;
  const request = { operation_id: randomUUID(), base_revision: balance.revision, target_balance: '1499.9', mode: 'reconciliation', description: 'User-authored reconciliation', ...patch };
  return { request, result: call(session, pathFor(account) + '/corrections', 'POST', request) };
}

test('wallet fixture projects exact large, signed and legacy fractional money without Number conversion', () => {
  const session = create(), account = own(session);
  account.initial_balance = '900719925474099.1'; session.data.transactions = [];
  const balance = call(session, pathFor(account) + '/balance');
  assert.equal(balance.status, 200); assert.equal(balance.body.ledger_balance, account.initial_balance);
  for (const text of ['0', '-1.01', '1499.9', '999999999999999', '-999999999999999']) assert.equal(walletText(walletCents(text)), text);
});
test('reconciliation leaves all financial rows unchanged and follows later backdated writers', () => {
  const session = create(), account = own(session), before = JSON.stringify([session.data.accounts, session.data.transactions]);
  const { result } = correct(session, account);
  assert.equal(result.status, 200); assert.equal(result.body.transaction_id, null);
  assert.equal(JSON.stringify([session.data.accounts, session.data.transactions]), before);
  assert.equal(call(session, pathFor(account) + '/balance').body.current_balance, '1499.9');
  session.data.transactions.push({ id: randomUUID(), account_id: account.id, type: 'income', amount: '0.01', repeat: 'none', date: '2020-01-01' });
  assert.equal(call(session, pathFor(account) + '/balance').body.current_balance, '1499.91');
  assert.deepEqual(call(session, pathFor(account) + '/corrections').body, [result.body]);
});
test('ledger correction retires an earlier anchor, reaches target and is immutable', () => {
  const session = create(), account = own(session);
  correct(session, account);
  const { result } = correct(session, account, { mode: 'ledger', target_balance: '-1.01' });
  assert.equal(result.status, 200); assert.ok(result.body.transaction_id);
  const balance = call(session, pathFor(account) + '/balance').body;
  assert.equal(balance.ledger_balance, '-1.01'); assert.equal(balance.current_balance, '-1.01'); assert.equal(balance.active_reconciliation_id, null);
  assert.equal(call(session, '/transactions/' + result.body.transaction_id, 'DELETE').body.error, 'SOURCE_IMMUTABLE');
});
test('same operation replays before stale check and changed payload cannot duplicate a correction', () => {
  const session = create(), account = own(session), { request, result } = correct(session, account, { mode: 'ledger' });
  const count = session.data.transactions.length;
  assert.deepEqual(call(session, pathFor(account) + '/corrections', 'POST', request).body, result.body);
  assert.equal(call(session, pathFor(account) + '/corrections', 'POST', { ...request, target_balance: '2' }).body.error, 'OPERATION_CONFLICT');
  assert.equal(call(session, pathFor(account) + '/corrections', 'POST', { ...request, operation_id: randomUUID() }).body.error, 'WALLET_CONFLICT');
  assert.equal(session.data.transactions.length, count);
});
test('zero ledger delta creates no transaction and correction history prevents deletion', () => {
  const session = create(), account = own(session); session.data.transactions = [];
  const { result } = correct(session, account, { mode: 'ledger', target_balance: String(account.initial_balance) });
  assert.equal(result.status, 200); assert.equal(result.body.transaction_id, null); assert.equal(session.data.transactions.length, 0);
  assert.equal(call(session, pathFor(account), 'DELETE', { confirmation: account.title }).body.error, 'ACCOUNT_IN_USE');
});
test('owner, manager reader and ordinary reader scopes remain distinct in preview', () => {
  const owner = create(), foreign = owner.data.accounts[1];
  foreign.member_id = owner.data.members.find(row => row.id !== owner.data.actor.id).id;
  assert.equal(call(owner, pathFor(foreign) + '/balance').status, 200);
  assert.equal(correct(owner, foreign).result.status, 403);
  const member = create('full-member');
  const other = member.data.accounts.find(row => row.member_id !== member.data.actor.id);
  for (const suffix of ['/balance', '/corrections', '/corrections/' + randomUUID()]) assert.equal(call(member, pathFor(other) + suffix).status, 404);
});
test('reconciled funds checks do not use the prior ledger as available money', () => {
  const session = create(), account = own(session);
  correct(session, account, { target_balance: '0.1' });
  const payment = { member_id: session.data.actor.id, type: 'expense', amount: 1, category: 'food', date: session.data.today,
    account_id: account.id, payment_method: 'online', require_available_balance: true };
  assert.equal(call(session, '/transactions', 'POST', payment).body.error, 'INSUFFICIENT_BALANCE');
});
