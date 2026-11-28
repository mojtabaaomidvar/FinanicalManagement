import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewSession, handlePreviewRequest } from './fixtures.mjs';

const read = (session, path) => {
  const url = new URL(path, 'http://copy-preview.invalid');
  return handlePreviewRequest(session, { path: url.pathname, query: url.searchParams, method: 'GET' });
};

test('member fixture hides peer account/holding details and exposes only transfer identifiers', () => {
  const session = createPreviewSession('full-member', 'accounts');
  const before = structuredClone(session.data.accounts);
  const accounts = read(session, '/accounts').body;
  assert.ok(accounts.length && accounts.every(row => row.member_id === session.data.actor.id));
  const targets = read(session, '/accounts?view=transfer-targets').body;
  assert.ok(targets.some(row => row.member_id !== session.data.actor.id));
  assert.ok(targets.every(row => Object.keys(row).sort().join(',') === 'family_id,id,kind,member_id'));
  const holdings = read(session, '/holdings').body;
  assert.ok(holdings.items.every(row => row.member_id === session.data.actor.id));
  assert.equal(holdings.total, holdings.items.reduce((sum, row) => sum + row.value, 0));
  assert.deepEqual(session.data.accounts, before);
});

test('both manager fixtures retain all family wallets while transfer targets omit balances', () => {
  for (const scenario of ['full-owner', 'full-admin']) {
    const session = createPreviewSession(scenario, 'accounts');
    assert.equal(read(session, '/accounts').body.length, session.data.accounts.length);
    assert.ok(read(session, '/accounts?view=transfer-targets').body.every(row => !('initial_balance' in row)));
  }
});
