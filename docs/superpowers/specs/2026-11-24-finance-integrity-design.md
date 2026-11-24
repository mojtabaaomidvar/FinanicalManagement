# Approved financial transaction integrity correction

Approved in conversation on 2026-11-24, based on official v0.8.0. Local implementation only; publication and production installation require separate authorization.

## Causes and boundaries

- The form lists `ride`, `rent-home`, and `rent-shop`, while server transaction validation omits them. Fixed categories currently bypass type checks; legacy categories are inconsistently accepted by the client.
- Both SMS parsers match `دی` inside unrelated words. The review model persists a generated bank/type/raw-unit summary as transaction notes.
- SMS parsing/storage/review has no transaction-time field. Invalid calendar dates can roll over; absent dates become today.
- Financial creation and SMS acknowledgement use separate commits. Browser receipts cannot prevent duplicates after a lost response or across devices.
- Assistant financial proposals can populate financial forms, despite the requirement that financial registration has no AI role.

## Implementation contract

Retain React/TypeScript, Persian RTL UI, FastAPI, PostgreSQL and tenant/recipient ownership. Keep existing category IDs. Share a display-independent category/type contract; retain old categories for editing/history and allow an unchanged historically mismatched fixed category when editing the same record, never for a new write.

Bank parsing uses complete Unicode-aware tokens, explicit bank names/aliases and specific-before-general matches. Unknown or conflicting banks remain unknown. Raw message and transport metadata stay in SMS records; notes contain only user-entered text. Never globally remove a bank name from historical notes.

SMS records gain nullable parsed time, transport receipt timestamp, transport identity, parser version, identity key and transaction link. A date or time comes only from explicit valid message evidence or explicit user review. Preserve seconds when supplied. Do not substitute transport/server timestamps for transaction timestamps. Validate Jalali dates by round trip and Gregorian dates by calendar validation. Ambiguous dates/times require review.

Use an atomic SMS recording endpoint. Lock message identity before message/account rows, validate ownership and all financial fields, create the transaction and any transfer fee without committing, attach the SMS link and mark recorded in the same commit. Replays return the already linked transaction, including after a lost response. Deleted linked transactions leave a recorded tombstone, never become permission to create another. Legacy browser receipts may attach a verified existing owned transaction to an unlinked legacy SMS, not manufacture another write. Old recorded messages without a reliable link stop for manual history review.

Deduplicate ingestion by recipient and full normalized message identity, not by amount/date alone. Explicit stable transport IDs distinguish independently delivered identical messages. Without transport identity, an exact-body replay is treated as the same message; transport receipt time is never an idempotency key. Keep legacy rows untouched; compare exact identities on access under a transaction advisory lock. Never delete historical duplicates or infer historical links.

Remove financial assistant handoffs and reject financial-only assistant analysis before inference. Filter financial proposals from old gateway responses; keep nonfinancial assistant actions, keys, saved text and integrations intact. Do not upgrade the gateway or perform paid inference.

## Safety and validation

Additive Alembic revision after `0034_assistant_receipts`; nullable new columns, no historical UPDATE/DELETE/backfill. Enforce same-family transaction links and unique new SMS identities in PostgreSQL. Test migration preservation, full category matrix, custom categories, exact bank identification, valid/invalid/ambiguous dates and times, raw metadata separation, atomic rollback/fees, replay/concurrency, legacy recovery, deletion, recipient isolation and assistant exclusion. Use disposable PostgreSQL with a non-superuser RLS role, never the manual sandbox database. Run frontend tests, TypeScript/PWA build, copy coverage/tests and local fixture browser checks. Report limitations honestly: live Android/forwarder execution and production installation are separate from local automated evidence.

## Approved payment extension

Retain three explicit expense choices in the existing payment control: card, online and bank transfer. Card and online payments have no transfer tariff. Persist the choice separately from `transfer_fee_method`; a nullable additive migration must not infer historical choices. Reject unknown/non-expense methods and card/online with a transfer tariff. Older-client omission on edits preserves a recorded choice.

Keep generated, linked fee rows internally for existing balance/history calculations. Collapse those rows beneath their parent in transaction and recent lists, displaying the fee and total account debit without double counting. Provide a fee-only filter and total respecting date, source account, category, transaction type and search. Never attribute the source account's fee to the transfer destination. Do not backfill or rewrite old records.

Implementation preservation fallback: orphaned historical fee rows remain visible rather than silently losing information. This is not a historical backfill or cleanup, and was not a separately discussed presentation decision.

Apply the same payment contract to manual forms, editable SMS drafts, atomic SMS recording and recurring settlement. Switching from bank transfer to card/online removes only the linked fee in the same unit of work; editing/deleting parents continues to manage their fee. Validate free online/card writes, edit/reset behavior, replay/concurrent SMS requests, historical preservation, settlement and editable English/empty display labels.
