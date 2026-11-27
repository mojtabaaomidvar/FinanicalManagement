import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewSession, handlePreviewRequest } from './fixtures.mjs';

const ingredient = { title: 'برنج', catalog_id: 'preset:برنج', qty: null, unit: null };
const call = (session, path, body) => handlePreviewRequest(session, { path, method: 'POST', body });

test('meal preview distinguishes zero, positive and unresolved stock without mutations', () => {
  const session = createPreviewSession('full-owner', 'meals');
  session.data.inventory = [{ title: 'برنج', catalog_id: 'preset:برنج', quantity: 0 }];
  const body = { ingredients: [ingredient, { title: 'مادهٔ ناشناخته' }] };
  const check = () => call(session, '/meals/ingredients/check', body).body;
  assert.deepEqual(check().map(row => row.status), ['missing', 'unresolved']);
  session.data.inventory[0].quantity = 2;
  assert.equal(check()[0].status, 'available');
  assert.equal(session.data.inventory[0].quantity, 2);
});

test('meal preview preserves cancellation, explicit decisions and one atomic replay', () => {
  const session = createPreviewSession('full-owner', 'meals');
  const data = session.data;
  data.inventory = []; data.mealEntries = []; data.dishes = [];
  const list = data.lists[0]; list.items = [];
  const beforeMoney = structuredClone(data.transactions);
  const body = { operation_id: 'reviewed-meal', date: data.today, meal_type: 'snack',
    dish: { title: 'برنج ساده', ingredients: [ingredient] }, list_id: list.id, decisions: [] };
  assert.equal(call(session, '/meals/plan/confirm', body).status, 409);
  assert.equal(data.dishes.length, 0); assert.equal(list.items.length, 0);
  body.decisions = [{ key: 'ingredient:0', action: 'shopping', qty: 1.25, unit: 'کیلو' }];
  const first = call(session, '/meals/plan/confirm', body);
  assert.equal(first.status, 200); assert.equal(first.body.added_count, 1);
  assert.equal(call(session, '/meals/plan/confirm', body).body.replayed, true);
  assert.equal(data.dishes.length, 1); assert.equal(data.mealEntries.length, 1);
  assert.equal(list.items.length, 1); assert.equal(list.items[0].qty, 1.25);
  assert.deepEqual(data.transactions, beforeMoney); assert.deepEqual(data.inventory, []);
  assert.equal(call(session, '/meals/plan/confirm', { ...body, operation_id: 'another' }).status, 409);
  assert.equal(list.items.length, 1); assert.equal(data.dishes.length, 1);
});

test('meal stock review remains accessible in the save-error copy scenario', () => {
  const session = createPreviewSession('save-errors', 'meals');
  assert.equal(call(session, '/meals/ingredients/check', { ingredients: [ingredient] }).status, 200);
  assert.equal(call(session, '/meals/plan/confirm', {}).status, 503);
});
