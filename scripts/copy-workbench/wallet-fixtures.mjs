import { randomUUID } from 'node:crypto';

// Isolated in-memory UI fixture only. Real locking/RLS is tested in PostgreSQL.
// Legacy fixture integers are accepted; new command/response money is exact text.
export function walletCents(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Wallet fixtures require exact text for fractional amounts');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error('Invalid fixture money');
  return BigInt(match[2] + (match[3] ?? '').padEnd(2, '0')) * (match[1] ? -1n : 1n);
}
export function walletText(cents) {
  const negative = cents < 0n, digits = (negative ? -cents : cents).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`.replace(/0+$/, '').replace(/\.$/, '');
}
function relevant(data, accountId) {
  // A recurring source row is also its first actual payment. Future plans are
  // not rows; do not omit the original money merely because it has a reminder.
  return data.transactions.filter(row => row.account_id === accountId || row.type === 'transfer' && row.to_account_id === accountId);
}
function signature(data, account) {
  return JSON.stringify([account.initial_balance, relevant(data, account.id).map(row => [row.id, row.type, row.amount, row.account_id, row.to_account_id, row.date, row.note])]);
}
export function walletLedger(data, account, excluding) {
  return relevant(data, account.id).filter(row => !excluding || row.id !== excluding.id && row.transfer_fee_for_id !== excluding.id).reduce((sum, row) => sum
    + (row.account_id === account.id ? walletCents(row.amount) * (row.type === 'income' ? 1n : -1n) : 0n)
    + (row.type === 'transfer' && row.to_account_id === account.id ? walletCents(row.amount) : 0n), walletCents(account.initial_balance));
}
function stateFor(data, account) {
  const states = data.walletStates ??= new Map();
  const key = signature(data, account);
  let state = states.get(account.id);
  if (!state) { state = { revision: 0, signature: key, receipts: [], anchor: null }; states.set(account.id, state); }
  if (state.signature !== key) { state.revision++; state.signature = key; }
  return state;
}
export function walletBalanceFixture(data, account) {
  const state = stateFor(data, account), ledger = walletLedger(data, account);
  const current = ledger + (state.anchor ? walletCents(state.anchor.target_balance) - walletCents(state.anchor.ledger_after) : 0n);
  return { account_id: account.id, revision: state.revision, ledger_balance: walletText(ledger), current_balance: walletText(current),
    discrepancy: walletText(current - ledger), active_reconciliation_id: state.anchor?.id ?? null };
}
export function walletHasCorrections(data, accountId) { return !!data.walletStates?.get(accountId)?.receipts.length; }

export function walletEndpointFixture(session, segments, method, body, response, error) {
  if (segments[0] !== 'accounts' || !['balance', 'corrections'].includes(segments[2])) return null;
  const { data } = session, account = data.accounts.find(row => row.id === segments[1] && row.family_id === data.family.id);
  const owns = account?.member_id === data.actor.id;
  if (!account || !owns && session.scenario.role === 'member') return error('NOT_FOUND', 'حساب یافت نشد.', 404);
  const balance = walletBalanceFixture(data, account), state = stateFor(data, account);
  if (segments[2] === 'balance' && segments.length === 3 && method === 'GET') return response(balance);
  if (segments[2] !== 'corrections') return error('METHOD_NOT_ALLOWED', 'عملیات مجاز نیست.', 405);
  if (method === 'GET' && segments.length === 3) return response([...state.receipts].reverse());
  if (method === 'GET' && segments.length === 4) {
    const receipt = state.receipts.find(row => row.operation_id === segments[3] && row.created_by === data.actor.id);
    return receipt ? response(receipt) : error('NOT_FOUND', 'اصلاح یافت نشد.', 404);
  }
  if (method !== 'POST' || segments.length !== 3) return error('METHOD_NOT_ALLOWED', 'عملیات مجاز نیست.', 405);
  if (!owns) return error('FORBIDDEN', 'فقط صاحب حساب می‌تواند موجودی را اصلاح کند.', 403);
  let target;
  try { if (typeof body.target_balance !== 'string') throw new Error(); target = walletCents(body.target_balance); }
  catch { return error('INVALID_ACCOUNT', 'موجودی معتبر وارد کنید.', 422); }
  if (!Number.isSafeInteger(body.base_revision) || body.base_revision < 0 || !['ledger', 'reconciliation'].includes(body.mode)
    || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(body.operation_id)
    || !(body.description === null || typeof body.description === 'string' && body.description.length <= 200)
    || target < -99999999999999900n || target > 99999999999999900n) return error('INVALID_ACCOUNT', 'اطلاعات اصلاح معتبر نیست.', 422);
  const request = JSON.stringify([account.id, data.actor.id, body.base_revision, walletText(target), body.mode, body.description]);
  const operations = data.walletOperations ??= new Map(), saved = operations.get(body.operation_id);
  if (saved) return saved.request === request ? response(saved.receipt) : error('OPERATION_CONFLICT', 'شناسهٔ اصلاح با درخواست دیگری استفاده شده است.', 409);
  if (body.base_revision !== state.revision) return error('WALLET_CONFLICT', 'موجودی تغییر کرده است؛ دوباره بررسی کنید.', 409);
  const ledger = walletCents(balance.ledger_balance), current = walletCents(balance.current_balance);
  const delta = target - (body.mode === 'ledger' ? ledger : current);
  if (body.mode === 'ledger' && (delta < -999999999999999n || delta > 999999999999999n)) return error('INVALID_AMOUNT', 'مبلغ اصلاح از سقف تراکنش بیشتر است.', 422);
  const transactionId = body.mode === 'ledger' && delta !== 0n ? randomUUID() : null;
  if (transactionId) data.transactions.push({ id: transactionId, family_id: data.family.id, member_id: data.actor.id,
    type: delta > 0n ? 'income' : 'expense', amount: walletText(delta > 0n ? delta : -delta), category: delta > 0n ? 'adjust-i' : 'adjust-e',
    date: data.today, time: '12:00', account_id: account.id, to_account_id: null, note: body.description, source_kind: 'wallet_correction',
    transfer_fee_rial: null, transfer_fee_for_id: null, transfer_fee_method: null, payment_method: null, repeat: 'none', repeat_end: null,
    recurring_plan: null, recurring_source_id: null, recurring_due_date: null, subcategory_id: null, handled_occurrences: [], photos: [], created_at: data.timestamp });
  // Mirrors writer revision + receipt revision for the UI; it is not a DB trigger.
  if (transactionId) state.revision++;
  state.revision++;
  const receipt = { id: randomUUID(), family_id: data.family.id, account_id: account.id, created_by: data.actor.id,
    operation_id: body.operation_id, mode: body.mode, revision: state.revision, target_balance: walletText(target),
    ledger_before: walletText(ledger), current_before: walletText(current), ledger_after: walletText(body.mode === 'ledger' ? target : ledger),
    current_after: walletText(target), delta: walletText(delta), description: body.description, transaction_id: transactionId, created_at: data.timestamp };
  state.receipts.push(receipt); state.anchor = body.mode === 'reconciliation' ? receipt : null; state.signature = signature(data, account);
  operations.set(body.operation_id, { request, receipt });
  return response(receipt);
}
