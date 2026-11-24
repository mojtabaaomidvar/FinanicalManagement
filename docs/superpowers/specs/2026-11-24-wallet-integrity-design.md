# Wallet precision, balance corrections and account-scoped history

Chat design approved on 2026-11-24. The user selected a live reconciled balance, rather than an unchanged last-reported snapshot, and approved retiring an earlier reconciliation when a ledger correction is applied. Written-spec review precedes implementation.

Baseline: official `v0.10.0`, commit `06fd1140620e94c5eb6cc309a517f5677acbec17`. Work branch: `codex/wallet-integrity`. This task authorizes local development and validation, not publication, a version bump or production installation.

## 1. Existing system and scope

Keep React/TypeScript, Persian RTL, FastAPI, PostgreSQL, existing account/transaction entities and the approved navigation shell. Preserve manual sandbox records and unrelated work. Do not introduce a second ledger, rewrite historical transactions, change account ownership or change market-price history policy.

Relevant findings from current source:

- `backend/app/models/account.py` stores opening balances as `Numeric(19, 1)` in toman. `backend/app/models/transaction.py` stores transaction amounts as `Numeric(15, 2)`; legacy hundredths of a toman exist in the supported contract.
- `backend/app/schemas/data.py` serializes these `Decimal` values through `float`. `src/infrastructure/repositories/mappers.ts` converts monetary payloads to JavaScript numbers.
- `src/domain/report/report.rules.ts` calculates account balances, cash totals and their history by number arithmetic. `src/shared/lib/format.ts` and `useAccountsModel.openEdit` round displayed amounts.
- `src/features/accounts/model/useAccountsModel.ts` edits metadata, then separately creates an `adjust-i` or `adjust-e` transaction. The read/check/write sequence is not atomic and has no durable correction receipt.
- `AccountsFeature` is shared by the wallet page and account settings. Card activation edits metadata; there is no account-scoped history button.
- `TransactionListFeature` already supports type/account filters and collapses linked transfer fees. Its account restriction must become a fixed scope in an account-specific view, not a removable initial filter.
- `transactions.create_uncommitted` is the existing integration point for a standard financial row in a caller-owned transaction. Generated payments, fees, recurring settlement and deletion also affect wallet balances and must participate in the concurrency contract.

## 2. Exact monetary representation

Keep the existing database unit, toman. A wholesale conversion of stored financial data to integer rial is rejected: it is unnecessary and could discard supported legacy fractional rial values. A display-only fix is also rejected because it leaves arithmetic and transport precision failures in place.

Serialize financial amounts needed by the wallet as exact decimal strings. Preserve `Decimal` calculations on the server. In the client use a shared exact monetary representation with integer-scaled arithmetic, backed by `BigInt`; JSON transport remains decimal strings, never raw `BigInt` values. The wallet ledger must preserve at least the existing `0.01` toman precision (`0.1` rial). Never recover an exact amount by first converting an API string to `Number`, multiplying a binary float, applying an epsilon, or rounding the result.

Opening amounts, transaction amounts, recurring amounts, transfer-fee amounts, correction deltas, account totals and the cash history used by the wallet must pass through the same exact rules. Adapt existing domain/repository consumers where the type change requires it; do not create a second arithmetic path with different financial rules. Monetary comparisons, limits, sums, sign handling and unit conversion are exact. A chart may convert a normalized geometric coordinate to a JavaScript number only after its underlying financial values have been calculated exactly; chart geometry must never become a saved balance.

Formatting groups digits and shows the sign/unit without changing the amount. For example, `1499.9` stored toman displays as `۱۴٬۹۹۹` rial or `۱٬۴۹۹٫۹` toman. Legacy `1.01` toman displays as `۱۰٫۱` rial; do not silently turn it into 10 rial. Zero, negative values and values beyond JavaScript's safe integer range are handled without scientific notation or sign loss. Existing market valuations must not be silently rounded or reclassified as ledger money while combining the displayed wealth total.

Parse Persian/Arabic/Latin digits and supported separators directly into exact amounts. Reject invalid syntax, nonfinite values, overflow or precision unsupported by the destination rather than allowing database quantization to change the request silently. Preserve a valid legacy amount when an unchanged record is edited. Pin the input unit for an open correction form so a preference change cannot reinterpret its draft. Changing display units never writes monetary data.

## 3. Independent balances and corrections

Let `L` be the current ledger balance of an account: opening balance plus direct income, minus expense and outgoing transfer, plus incoming transfer. Include generated fee rows exactly once in ledger calculations. Restrict each effect by the actual source/destination account ID; do not treat transaction ownership as account identity.

Without active reconciliation, the current wallet balance is `L`.

A successful reconciliation stores the user's target `T0` and the ledger balance `L0` at application. Its live reconciled balance is:

`R = T0 + (L - L0)`

Its current discrepancy is `R - L`. The stored target, snapshots, date and description never change. A later successful reconciliation replaces the active anchor, rather than accumulating previous discrepancies. Changes made after reconciliation, including edits/deletion of earlier transactions or a newly recorded backdated transaction, change `L` and therefore `R`; this is an application-time ledger snapshot, not a filter based on transaction date.

### Transaction mode

Compute the delta against the current ledger: `delta = T - L`. Use the existing standard transaction service and system categories `adjust-i`/`adjust-e` to create one nonrecurring adjustment for the absolute nonzero delta. The same commit saves its correction record and retires the earlier reconciliation anchor. After success the ledger itself equals `T`, and there is no remaining active discrepancy to apply again.

Do not compute against `R` and then also clear the anchor: that would leave part of the correction unapplied. If `delta` is zero, do not create a zero-amount financial transaction; a correction receipt may still retire the old reconciliation and record that outcome. Do not split an oversized delta into silent multiple transactions to bypass the existing transaction limit.

Generated adjustments are identifiable, nonrecurring, fee-free and linked to their correction receipt. Their amount/account/source must not be silently changed or deleted through a generic transaction form, bypassing the audit record. Preserve existing legacy adjustment rows and their existing report behavior; do not infer historical receipt links or retrospectively classify real user transactions.

### Reconciliation-only mode

Save a new target/ledger snapshot and audit record. Do not create, edit or delete any income, expense, transfer or opening balance. Prior financial history is unchanged. The reconciliation is not an income/expense item and does not enter their report totals.

The wallet's prominently displayed current balance and existing available-funds checks use the reconciled balance when an anchor exists. The ledger balance remains separately accessible and labelled. Existing ledger cash history is not retroactively shifted by a reconciliation; its label continues to identify transaction-derived cash history. The current wealth headline may reflect reconciled wallet cash, but must not imply that the ledger chart was changed.

## 4. Atomicity, audit and authorization

Use additive database changes for durable correction history and concurrency/version metadata. Do not UPDATE, DELETE, infer or backfill historical amounts. A correction record is a financial-operation receipt, not another ledger: it records the mode, target, ledger/current snapshots before and after, applied delta, user description, server timestamp, actor, account, operation ID, request fingerprint, revision and optional standard transaction link. At most one reconciliation anchor is active; active state is unambiguously determined by committed operation order, not timestamp ordering alone. Keep completed receipts immutable and retain old anchors for inspection.

Corrections are permitted only to the account owner, matching existing edit policy. Family owner/admin viewing remains supported for visible family wallets; ordinary members cannot inspect someone else's wallet history or correct it. Enforce policy and tenant boundaries in the API and PostgreSQL, not just by hiding UI controls. Unknown/out-of-scope accounts and operations fail closed. Preserve existing age/source visibility rules in financial detail views; do not expose protected transaction descriptions through correction history.

The server provides an authoritative balance/revision for review, and one correction command. Under the same financial locking contract it rechecks permissions, ledger/current state and the submitted base revision, applies the correction and receipt, and commits once. The audit record, active anchor transition and optional transaction either all succeed or all roll back. No network calls or client-calculated delta are trusted inside this unit of work.

All account-affecting writes must share the synchronization/version contract, including manual transaction creation/edit/deletion, moving a transaction between accounts, incoming/outgoing transfers, generated fees, SMS recording, bills/shopping payments, vehicle expenses and recurring settlement. Lock the complete affected account set in deterministic order. Review existing source/transaction locks to avoid inverted acquisition or deadlocks. A correction must not race a deletion or an actor-less generated write that bypasses the ordinary payment check. Metadata-only title/card changes must not overwrite opening balances or reconciliation state.

Idempotency is scoped by tenant and operation identity and enforced durably. The client generates an operation ID once per reviewed request. An identical retry returns its prior committed outcome without another transaction/anchor. Reusing the ID with different content or actor/account is a conflict. Successful replay is checked before rejecting the now-old base revision, but after current authorization. A receipt/status read resolves an uncertain response; an unknown outcome must retain its operation identity and cannot silently become permission to submit a second correction with a new identity. Any retained request state is limited to the same family/member/account scope.

Concurrent corrections with distinct operation IDs and the same base revision cannot both apply. Stale state is returned as a conflict requiring fresh review and explicit confirmation; the client must not overwrite or reinterpret the user's target automatically. An account with correction history cannot be deleted as unused simply because reconciliation did not create a transaction. A linked correction receipt cannot vanish or authorize replay when its financial row is manipulated.

## 5. Approved interface and navigation

Reuse existing fonts, colors, compact card styling, forms, sheets and the `AppPage` shell. No visual redesign and no dependency-heavy financial dashboard.

- Preserve card activation for editing metadata. Add distinct, labelled `تراکنش‌ها` and owner-only `اصلاح موجودی` buttons without triggering card edit through event bubbling. Apply the same controls in the shared account settings view.
- Show the live reconciled amount prominently when applicable; show `موجودی حاصل از تراکنش‌ها` and discrepancy with explicit labels. Without reconciliation there is no misleading second balance. Keep masked card numbers and existing edit/delete behavior.
- Separate balance correction from metadata save. The correction flow collects the valid target and optional user description, then asks exactly `نحوه ثبت اصلاح موجودی را انتخاب کنید.` It presents `ثبت در تراکنش‌ها` and `صرفاً اصلاح جهت مغایرت‌گیری`, explains their different effects, previews the exact change and requires a final explicit submission. No method is silently selected and entering a target alone never writes.
- Show a read-only correction history with mode, before/after amounts, date, description and linked adjustment where applicable. Identify the latest active reconciliation without rewriting old records.
- Open an account-specific transaction subpage with the existing list/form components. Its fixed account scope covers both source and destination transfers. Clearing filters cannot expose other accounts. Provide type filters and an inclusive custom start/end date range; an invalid range does not apply. The header's current balance is independent of those filters.
- Preserve fee collapsing and orphan-fee visibility. A destination-account view must not show the source fee as its own debit. A transfer is one transaction, not duplicated into a new accounting model.
- Provide back to the wallet list and overlay/subpage-first browser Back with the existing navigation/guard rules. Preserve list scroll, drafts and per-account filters on appropriate returns; changing family/member clears protected retained state. Inactive retained pages do not own visible portals or active Back handlers.
- Loading, empty, invalid input, stale preview, denied access, server failure, uncertain outcome and successful replay are explicit states. Do not show a missing/failed balance as zero. All fixed visible copy, including backend errors and accessibility labels, remains discoverable/editable in Copy Studio, even when translated to English or replaced by an empty string. Do not annotate stored mode/category/unit keys or user descriptions as display copy.

## 6. Validation and delivery

Use the existing fixture browser workbench for UI checks, blocking external requests. Backend transactional tests require a disposable local PostgreSQL database and a non-superuser RLS application role. Follow `backend/tests/conftest.py` guards; these tests TRUNCATE their test database, so neither the manual sandbox nor production can be used. SQLite/mocks alone do not prove real atomicity, concurrency or tenant isolation. If suitable PostgreSQL is unavailable, record the blocker instead of claiming those checks passed.

Required automated evidence:

1. Exact rial/toman round trips, one-rial deltas, supported legacy fractions, zero/negative/large amounts, repeated additions/cancellations, limits and rejected precision; formatting/unit switching leaves stored values unchanged.
2. Exact opening/direct/transfer/fee balances and wallet cash history; source/destination fee attribution; unchanged metadata edit preserves amounts.
3. Reconciliation followed by new income/expense, another reconciliation, backdated creation, edit/deletion and transfer; original snapshots remain unchanged and discrepancies do not accumulate.
4. Transaction correction with/without an anchor, both delta signs, zero delta and over-limit delta; final ledger reaches target and previous anchor is retired once.
5. Receipt completeness, unchanged prior ledger rows, atomic failure before commit, exact replay after lost response, changed-payload ID conflict, two competing corrections, and correction competing with every relevant standard/generated write path.
6. Owner/manager/member/other-family permissions and RLS; history blocks unused-account deletion; generic edits cannot detach or corrupt a generated correction; uncertain client state is scoped and recoverable.
7. Dedicated card buttons, fixed account scope despite filter reset, inclusive date/type filters, current balance unaffected by filters, fee display, empty/error/loading states, Back/scroll/draft retention and mobile/desktop layouts.
8. Frontend tests, relevant/full backend checks where available, TypeScript/PWA build, `npm run copy:studio:coverage`, Copy Studio tests and relevant fixture browser checks. Verify new failure/empty/loading/accessibility texts in the copy inventory. Use sandbox launchers only if an isolated manual refresh is separately needed.

Record actual results and remaining limitations in a task validation report. Physical Android/iOS keyboard and installed-PWA tests are separate from simulated viewport checks. Do not claim a release, server installation, a migrated production database, APK changes or live financial-data acceptance from local evidence.
