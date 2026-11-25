# Wallet integrity — local implementation and verification

Date: 2026-11-25. Task three only.

Baseline: official `v0.10.0`, commit `06fd1140620e94c5eb6cc309a517f5677acbec17`.
Branch: `codex/wallet-integrity`.
Approved specification: `docs/superpowers/specs/2026-11-24-wallet-integrity-design.md`, committed as `265ea34`.

This is local development evidence, not a release or production installation. The package version remains `0.10.0`. No task-three changes were pushed, published, installed or applied to production or the manual sandbox database.

Implementation commits: `35d4e66` (atomic backend corrections), `a9dddce` (legacy installer scope protection), and `6b258aa` (exact monetary client integration, recovery, scoped history and browser verification).

## Implemented behavior

- Stored financial units remain toman. Account, transaction, recurring, bill and shopping monetary boundaries use exact decimal strings; client arithmetic uses `BigInt` coefficients and backend arithmetic uses `Decimal`. One rial and historical `0.01` toman fractions survive conversion, formatting and unchanged edits.
- Account metadata editing no longer prefills a rounded balance or writes an opening balance/adjustment. Opening balance is supplied only when creating an account.
- Target entry alone never writes. The correction review asks exactly **«نحوه ثبت اصلاح موجودی را انتخاب کنید.»**, without a selected default method.
- **«ثبت در تراکنش‌ها»** computes `target - ledger`, creates one existing-model adjustment when nonzero, records its immutable receipt and retires any earlier reconciliation atomically. The UI and backend enforce the ordinary transaction ceiling; the UI does not substitute the wider database column limit. Zero delta creates no financial row.
- **«صرفاً اصلاح جهت مغایرت‌گیری»** records an immutable target/ledger snapshot and history without creating income/expense rows or rewriting previous records. Current balance follows `target_at_correction + (current_ledger - ledger_at_correction)`. A later reconciliation replaces the active anchor rather than accumulating old discrepancies.
- Authoritative current-wallet displays and existing available-funds checks use reconciliation-corrected balances. Ledger-derived charts and income/expense reports remain separately calculated. The wealth headline combines reconciled cash with represented market estimates without rounding those estimates into ledger amounts.
- Every card has separate **«تراکنش‌ها»** and owner-only **«اصلاح موجودی»** buttons. Activating the card itself still edits metadata. Account-scoped transaction pages retain immutable source/destination account scope, inclusive date/type filters, current balance independent of filters, source-only fee attribution and return navigation.
- Main wallet navigation retains separate `AppPage` visits; embedded settings navigation restores per-view scroll and preserves search/drafts. Identity changes clear protected retained views and stale financial-form requests cannot update a newer identity's state.
- Loading, missing-balance, receipt/history failure and recovery states remain explicit. Unavailable accounts retain their identity as disabled options; a failed balance read is neither zero nor proof of insufficient funds.
- Shopping prices and checkout totals are exact row totals, not unit prices multiplied by quantity. Decimal typing and invalid-precision rejection preserve unchanged historical prices.
- Calculator intermediate results are rational; finite final amounts and cancellation such as `1÷3×3` remain exact. Nonterminating final monetary results are rejected instead of rounded. Fractional/unsafe numeric SMS amounts require explicit review.

## Atomicity, authorization and recovery

- `0037_wallet_corrections` adds audit receipts, account revisions, tenant-composite transaction links, receipt shape/delta guards, immutable adjustment guards and deferred receipt/transaction consistency checks. It does not backfill or rewrite historical financial rows.
- Financial writers serialize within the family before acquiring transaction/account row locks. Database statement/row triggers cover direct writers and maintain revisions. Atomic correction tests cover competing corrections, deletion, manual and generated financial writes.
- Owner-only corrections and operation reads are enforced in the API and database. Owner/admin readers can inspect visible family-wallet history; ordinary readers remain limited to their wallets. Amount-only protected-source projection does not expose descriptions.
- The client securely stages the reviewed request before transmission, pinning family/member/account, operation ID, target, mode, revision and description. New browser operations require persistent encrypted storage and Web Locks.
- Lost/ambiguous responses, malformed successes and denied recovery retain the same identity. Recovery and same-ID resend are explicit; there is no automatic financial outbox. A receipt 404 is unknown, not permission to generate another correction.
- Successful replay precedes stale-revision rejection after current authorization. Confirmed server success remains success even if local cleanup or later balance/history refresh fails. Corrupt encrypted recovery data fails closed.
- Empty downgrade/reupgrade removes and recreates the wallet migration cleanly. Downgrade with correction history refuses without losing receipts, balances or the migration revision.

## Completed automated verification

All results below are from completed commands. Earlier interrupted browser output was not accepted as a suite result.

| Verification | Result |
| --- | --- |
| Full frontend regression, `npm test` | **954 passed**, 101 files |
| Full disposable PostgreSQL regression | **1294 passed**, 1 xfailed, 1 xpassed, 70 warnings; 1890.32 seconds |
| Targeted wallet/financial backend verification | **251 passed** |
| Latest migration, shopping and wallet backend run | **86 passed**, 5 warnings; 123.22 seconds |
| Targeted exact shopping frontend verification | **38 passed** |
| `npm run copy:studio:test` | **139 passed**, zero failures/cancellations |
| Final `npm run build` | TypeScript, Vite and PWA/service-worker generation **passed** |
| Final build's `npm run copy:studio:coverage` | **5115 editable UI texts**, no unregistered display candidates |
| Direct Copy Studio inventory assertions | **11 required wallet/shopping loading, error, recovery, empty and accessibility texts found** |
| Final `node scripts/check-wallet-integrity.mjs` | **13 passed**, including the added transaction-ceiling regression and exact shopping edit |
| `node scripts/check-finance-integrity.mjs` | **10 passed** |
| `python backend/deploy/test_release_server.py` | **4 passed**, without an application environment or database connection |
| `git diff --check` | Passed |

The completed 954-test frontend and 86-test backend runs were preserved after the server restart rather than repeated unnecessarily. Build and browser acceptance were repeated after the final correction-ceiling change. Copy Studio's final run includes strict monetary fixtures; recurring fixtures count their first actual payment once and do not turn future-plan edits into balance changes.

### Isolated test scope and evidence

Backend tests used disposable PostgreSQL at `127.0.0.1:55447`, database `khaneyar_wallet_integrity_v5_test`, with application role `wallet_test_app` configured as `NOSUPERUSER` and `NOBYPASSRLS`. The disposable runner did not load the application's `.env` or use manual/production records.

Latest targeted command:

```text
python C:/Users/383/AppData/Local/Temp/opencode/run-wallet-backend-tests.py -o addopts= -q --tb=short tests/test_wallet_migration.py tests/test_shopping.py tests/test_wallet_corrections.py
```

Browser suites launch the isolated Copy Studio fixtures on ephemeral loopback ports and block external requests. They do not contact the manual sandbox or production backend.

- Wallet results and mobile/desktop screenshots: `.local-test/wallet-integrity/result.json` and adjacent PNG files. Final result has 13 checks, zero errors, zero external requests, zero manual writes and zero production writes.
- Financial regression results/screenshots: `.local-test/finance-integrity/results.json` and adjacent PNG files. Final result has 10 checks, zero errors and zero external requests.
- Browser checks cover separate card controls, unchanged metadata, no default correction mode, transaction ceiling, reconciliation-only history preservation, immutable linked adjustments, reload recovery, explicit same-ID retry, fixed account scope, inclusive dates, Back/search/settings-scroll retention, balance/history/receipt failures, source-only fees, historical transaction fractions, SMS account availability and exact shopping editing.

## Deployment review and remaining limits

- Backend model constraints, precision and receipt links agree with migration `0037_wallet_corrections`. Local RLS tests grant only the restricted application's required wallet projection functions; the sandbox seeder grants these after migration to head.
- Legacy `backend/deploy/release-server.py` intentionally remains pinned to the support migration `0029`. Two premature wallet-function grants were removed in `a9dddce`, with a regression check, because those functions do not exist at that revision. This is not a wallet installer.
- Task three requires coordinated backend/API migration and PWA deployment, including explicit restricted-role grants for `public.wallet_ledger_balance(uuid,uuid)` and `public.wallet_account_has_transactions(uuid)`, backups, migration verification and compatible-client planning. The `0.10.0` PWA-only installer must not be reused unchanged. No wallet release installer or production deployment is claimed here.
- A wallet migration with audit history cannot be downgraded by discarding that history. Any future rollback plan must preserve it and account for immutable linked transactions.
- Older clients expecting JSON money numbers need compatibility planning before deployment. Budget and vehicle interfaces deliberately retain their bounded, whole-toman numeric contracts; they are not alternative ledger arithmetic paths. Market-price estimates and chart geometry remain distinct from saved monetary values.
- Real Android/iOS keyboard, physical-device Back and installed-PWA acceptance are **not verified** by headless desktop viewport tests. No APK, real-data or production acceptance is claimed.
- Vite's existing large-application-chunk warning remains (approximately 980 kB minified). It is a warning, not a failed build; bundle redesign is outside this task.
- Local implementation commits do not alter the published `v0.10.0` tag, `main` or the installed production release.
