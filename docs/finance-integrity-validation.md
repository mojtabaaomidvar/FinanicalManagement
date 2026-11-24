# Financial integrity repair — local verification

Base: official `v0.8.0` (`e325d9e0debd5ea8edbf7f29a10ed705d15a0fd3`).
Branch: `codex/finance-integrity`. Job one only. GitHub publication of `v0.9.0` is now approved; server operation and device installation remain separate and have not been performed.

## Changes

- A shared display-independent category/type contract covers current, legacy and system IDs. Historical fixed-category mismatches can remain unchanged when editing the same transaction; new mismatches are rejected.
- All SMS ingestion paths parse raw messages server-side. Bounded bank matching avoids substring matches such as «موجودی» → «بانک دی». Unknown/conflicting banks remain unknown; parser-derived descriptions no longer populate user notes.
- Nullable SMS provenance, parsed time and financial links are added by `0035_sms_integrity`. The migration contains no historical backfill, cleanup or user-data UPDATE/DELETE.
- Valid event dates/times come from message evidence or explicit review. Seconds are preserved. Missing, invalid and ambiguous dates are not replaced by today; receipt/storage times remain separate metadata.
- `POST /sms/{id}/record` creates the payment, fee and SMS link in one database transaction. Recipient-scoped locks and persistent links protect retries/concurrent devices. A deleted transaction leaves a recorded SMS tombstone. Exact legacy aliases resolve to the canonical recorded message without a second transaction link or payment.
- Explicit browser receipt recovery is restricted to legacy SMS rows and existing owned, unlinked, non-derived financial transactions. It does not create or rewrite a payment.
- Financial assistant handoffs and form state are removed. Financial-only requests are rejected before inference; financial proposals are filtered. Nonfinancial assistance remains available.
- Android forwards receipt time and a PDU-derived delivery identity separately from raw SMS text.
- Expense payment methods are explicit: `card`, `online` and `bank_transfer`. Card/online have no transfer tariff; conflicting API writes are rejected. `0036_payment_method` adds a nullable column and constraints only, without inventing choices for historical records. Older-client omission preserves a stored choice during edits.
- Linked transfer fees remain internal ledger entries for account balances and expense reports, but transaction lists and recent widgets show the main payment once, with nested fee and total debit. The fee-only filter totals the fee component with date, account, type, category and search filters. Destination-account views do not attribute the source-account fee to the destination. Orphaned historical fees remain visible rather than silently disappearing.
- Changing a transfer-paid expense to online/card removes only its linked fee in the same server write. SMS atomic recording and saved review drafts also preserve the explicit payment choice.

## Verification commands

```powershell
npm test -- --reporter=json --outputFile=.local-test/finance-integrity/frontend-tests.json
npm run build
npm run copy:studio:test
npm run copy:studio:coverage
npm run copy:studio:finance-integrity-check
npm run copy:studio:assistant-check
node scripts/check-copy-portable-interactive.mjs
```

The browser checks use the Copy Studio fixture launcher on an ephemeral loopback port because Windows cannot bind port 5701 in this environment. Only the test's in-memory preview bridge is adapted to the port. No production proxy, source-Apply endpoint or manual database is used. Reports are under `.local-test/finance-integrity/`, `.local-test/household-assistant/` and `.local-test/copy-workbench/portable-interactive-check/`.

Backend tests must use the sibling disposable PostgreSQL launcher `../run-backend.py`, not the manual database. They truncate their test database. An earlier run under `../finance-integrity-all/` collected 1,183 cases and found five audit-log capture failures, one expected failure and one known-gap unexpected pass. That run predates the approved migration-logging correction and payment extension; it is retained as diagnostic history, not the latest result.

The official baseline's `backend/alembic/env.py` calls `logging.config.fileConfig()` with its default `disable_existing_loggers=True`. An isolated reproduction confirms that this disables all five service loggers if they exist before migration configuration. `git show v0.8.0:backend/alembic/env.py` confirms the original behavior. After user approval, the bounded repair sets `disable_existing_loggers=False`; a programmatic Alembic regression checks that existing service loggers stay enabled. No audit assertions or nonfinancial logging implementations were weakened or rewritten.

The original repair's focused run passed all 225 tests with zero failures, errors or skips and exit code 0 under `../finance-integrity-verified/`. It covers SMS integrity/ownership, account/recurring registration, assistant exclusion, financial text, transfer fees, transaction-edit concurrency, role authorization and database RLS, including recovery-ownership, generated-fee/link rejection and alias-after-deletion checks. An earlier fixture mistake omitted mandatory card numbers; it was corrected using `next_card()` without weakening account validation.

After the payment extension and logging correction, the expanded focused run under `../payment-method-verified/` passed all 368 tests with zero failures, errors or skips. This includes card/online persistence, fee removal, older-client edit preservation, atomic SMS payment choices, additive migration preservation, the migration-logging regression and all five previously failing audit modules. Its disposable PostgreSQL was stopped; manual and production records were untouched, and paid inference was zero.

The first final full run (`tests ai_gateway/tests`) under `../finance-integrity-final-all/` exceeded the shell's 1,800-second limit and was terminated with exit code 143. Its partial log had reached more than half the suite without a failure marker, but no final JUnit/result was produced, so that attempt is not a passing full-suite result. Process inspection after termination found no surviving test launcher, pytest or disposable PostgreSQL process.

The final rerun completed successfully with exit code 0 under `../finance-integrity-final-all-complete/`. Scope: `tests ai_gateway/tests`; JUnit: 1,371 cases, zero failures, zero errors, one expected failure (`pytest.xfail`). Pytest also reports one non-strict unexpected pass for the existing audit-table known-gap test. This corresponds to 1,369 ordinary passes, one XFAIL and one XPASS. The run includes the five new simultaneous-SMS/recurring-payment cases, all five previously failing audit modules, financial integrity/payment regression tests and gateway tests. Evidence: `result.json`, `pytest.xml` and `backend-tests.log`. The disposable PostgreSQL was stopped, billed inference was zero, and no manual/production records were touched.

The remaining preexisting expected failure is outside this repair: signed file URLs are bearer capabilities, so possessing a valid URL allows download without separately checking current household membership. The audit-table XPASS is an existing outdated known-gap expectation, not proof that every sensitive operation has comprehensive audit coverage. Neither known-gap assertion was changed or hidden. Local automated verification is complete; this does not authorize deployment or resolve the live-device limitations below.

Android Java compilation passed after generating Capacitor's local build dependencies with `npx cap sync android`:

```powershell
$env:JAVA_HOME = "$env:USERPROFILE\.jdks\jbr-21.0.11"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
# From android/
.\gradlew.bat :app:compileDebugJavaWithJavac --no-daemon --console=plain
```

## Evidence and limits

- Latest frontend verification passed all 806 tests in 92 files; report: `.local-test/finance-integrity/payment-frontend-tests.json`. This includes linked-fee presentation/no-double-counting, zero-fee transfers, payment validation/wire mapping and saved online SMS drafts.
- Copy coverage found 4,988 editable texts with no unregistered candidates. The latest full Copy Studio suite passed all 130 tests, including recurring-payment preservation and explicit online settlement. An initial new fixture assertion assumed HTTP 204; it was aligned with the preview's existing HTTP 200 PATCH contract, not by changing that contract.
- All 10 expanded financial browser checks passed, including 26 registrations across every offered income/expense category (25 current fixed categories plus the fixture's custom category). The new checks cover bank-transfer → online editing/fee removal, preserved online SMS drafts, nested fee rows/recent lists and fee-only totals under date, search, category and charged-account filtering. Earlier test selectors incorrectly assumed dialog/tab roles for the existing filter sheet/buttons and were corrected without altering shared UI semantics. The draft-reopen test now waits for the closing sheet to disappear before reopening.
- A direct Python/TypeScript parser comparison passed 565 synthetic bank, calendar, timestamp and amount cases with no database writes or paid inference; evidence is `.local-test/finance-integrity/parser-parity.json`.
- Final `npm run build` passed TypeScript compilation, the production bundle and PWA service-worker generation. The build still reports a non-blocking bundle-size warning; no bundle-size refactor is part of this repair.
- The same financial browser run also covers historical-category editing, lost responses/double clicks, actual seconds, missing/invalid/ambiguous timestamps and English/empty editable SMS/online-option copy. There were no external requests, billed inference or manual database writes; evidence: `.local-test/finance-integrity/results.json` and the five screenshots listed there.
- Nonfinancial assistant browser verification passed 14 checks, with zero billed inference or manual writes.
- The interactive offline copy package passed seven browser checks with no network requests.
- Java compilation is not a live-device SMS test. No real bank-SMS samples were provided; parser cases are synthetic. Runtime receiving still has the released plugin's foreground/warm-process limitation.
- Without a shared transport ID, complete normalized-body replay is treated as the same message. Different explicit delivery IDs distinguish independently delivered identical messages; cross-channel delivery-ID behavior needs real device/forwarder validation.
- Historical bank names/notes are not automatically rewritten. Old recorded messages lacking a reliable link stop for history review instead of risking another financial write.
- Final source review confirmed recipient/family-scoped locks, owned transaction receipt recovery, exact-body aliases and deleted-link tombstones. Dormant proposal-conversion helpers are only referenced by legacy tests, not production transaction forms; no unrelated cleanup was performed.
- This nested release checkout has no initialized manual-sandbox configuration. Browser validation used the in-memory Copy Studio launcher, not the parent workspace's manual database; no manual sandbox was started or refreshed.
- Production has not been changed. GitHub publication of `v0.9.0` is approved separately; passing local tests does not authorize server execution or historical data cleanup.

## Approved release preparation

The user approved a `v0.9.0` API/PWA release based only on official `v0.8.0`, with no new APK, server execution or device installation. Version metadata and lockfile were changed together without dependency changes. The production rebuild uses explicit public API/support origins, not a sandbox proxy. All 806 frontend tests and all 130 Copy Studio tests passed again with version `0.9.0`; build and coverage of 4,988 texts passed.

New bounded deployment files are `backend/deploy/check-finance-release.py`, `migrate-finance-release.py` and `install-finance-release.sh`. The installer validates exact released source/PWA hashes, preserves existing secrets and the nonfinancial gateway, backs up settings/PWA/database/uploads, applies only 0035/0036 atomically, and compares fingerprints of all historical tables. Failed checks roll back the migration transaction. Failed installation restores verified old code/PWA without restoring or downgrading the database; inability to verify old code/schema leaves the API off with the backup retained.

The additional release run under `../finance-release-0.9.0-verified/` passed all 81 tests with zero failures, errors or skips, using disposable PostgreSQL. This covers the bounded release migrator/checker, payment methods, SMS integrity and migration logging. The initial 81-case run found two test-message regex mismatches (`differ` versus `differs`); invalid constraints/indexes were correctly rejected. The expected regex was corrected without weakening the rejection or removing an assertion. Installer sequencing passed all 8 tests using real Bash and fictional Docker/HTTP/settings commands inside temporary directories, not by running Docker against a server. This includes success, preflight/backup/migration/local-health/public-health failures, restoration after a PWA swap and fail-closed rollback. Evidence: `../finance-installer-0.9.0-final/`. The first simulator run lacked a fictional `flock` command on Git Bash; that fixture was corrected without altering the installer's real lock requirement.

Publication artifacts and local tooling are isolated under `.local-test/release-v0.9.0/` in this source checkout. The latest official GitHub release was checked anonymously: `v0.8.0`; its published API/migration hashes match the baseline Git objects. Final packaging must use an explicitly allowlisted clean commit, exclude private settings/databases/uploads/APKs, validate the exact archived installer bytes and verify public downloads before reporting publication complete.
