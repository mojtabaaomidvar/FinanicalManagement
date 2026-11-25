import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewSession, handlePreviewRequest } from './fixtures.mjs';

test('shopping preview checks the chosen basket, uses row totals and replays without another payment or stock bump', () => {
  const session = createPreviewSession('full-owner', 'shopping');
  const data = session.data, list = data.lists[0], source = data.accounts.find(row => row.member_id === data.actor.id && row.kind === 'bank');
  source.initial_balance = 9_000_000;
  const stock = data.inventory[0], quantity = Number(stock.quantity);
  list.items = [{ id: 'checked', checked: true, price: 30_000, qty: 3, inventory_item_id: stock.id },
    { id: 'pending', checked: false, price: 70_000, qty: 2 }];
  const call = body => handlePreviewRequest(session, { path: '/shopping/lists/' + list.id + '/complete', method: 'POST', body });
  const body = { item_ids: ['checked'], operation_id: 'invoice', amount: '80000.1', account_id: source.id,
    require_available_balance: true, transfer_fee_method: 'card_to_card' };
  const before = data.transactions.length;
  const first = call(body);
  assert.equal(first.status, 200);
  assert.equal(first.body.total, '80000.1');
  assert.equal(data.transactions.length, before + 2);
  assert.equal(Number(stock.quantity), quantity + 3);
  assert.deepEqual(list.items.map(item => item.id), ['pending']);
  const transaction = data.transactions.find(row => row.id === first.body.transaction_id);
  assert.equal(transaction.amount, '80000.1');
  assert.equal(transaction.category, 'shopping');
  list.items[0].checked = true;
  assert.equal(call(body).body.transaction_id, transaction.id);
  assert.equal(data.transactions.length, before + 2);
  assert.equal(Number(stock.quantity), quantity + 3);
  assert.equal(list.items.length, 1);
  assert.equal(call({ ...body, amount: 80_000 }).status, 409);
});

test('shopping preview never multiplies row prices and rejects stale selections before financial changes', () => {
  const session = createPreviewSession('full-owner', 'shopping'), list = session.data.lists[0];
  list.items = [{ id: 'checked', checked: true, price: 30_000, qty: 3 }, { id: 'other', checked: true, price: 10_000, qty: 4 }];
  const call = body => handlePreviewRequest(session, { path: '/shopping/lists/' + list.id + '/complete', method: 'POST', body });
  const before = structuredClone(session.data.transactions);
  assert.equal(call({ item_ids: ['checked'], create_transaction: false }).status, 409);
  assert.deepEqual(session.data.transactions, before);
  const result = call({ create_transaction: false });
  assert.equal(result.body.total, '40000');
  assert.equal(result.body.item_count, 2);
  assert.equal(result.body.transaction_id, null);
  assert.equal(list.items.length, 0);
});
