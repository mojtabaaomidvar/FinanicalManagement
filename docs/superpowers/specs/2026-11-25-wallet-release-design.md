# Wallet release 0.11.0 — production installation design

Date: 2026-11-25. Branch: `codex/wallet-integrity`.

## Authorization and present state

The user approved installation on the main server, the proposed `0.11.0`
release, and requiring old financial clients to update before using the new
money contract. This document specifies that installation; it is not proof
of publication, migration, or installation. Written-design review precedes
implementation.

The published baseline is `v0.10.0`, commit
`06fd1140620e94c5eb6cc309a517f5677acbec17`, with database revision
`0036_payment_method`. The public PWA still reports `0.10.0`; public auth
configuration responds normally. A read-only SSH connection attempt timed
out. Delivery therefore follows the existing user-operated server-console
installation, with independent read-only public verification afterward.

Wallet behavior and completed regressions are specified in
`2026-11-24-wallet-integrity-design.md` and
`../../wallet-integrity-validation.md`. Do not repeat completed suites unless
new code affects them. Existing implementation commits remain unchanged.

## 1. Scope and chosen approach

Upgrade API and PWA together from the exact official baseline; apply only
`0037_wallet_corrections`. Do not run the legacy support installer, upgrade
an unknown schema, replace credentials, modify the gateway, touch the
marketing site/APK, rewrite old financial rows, or access local manual data.
Keep the existing architecture and appearance.

Chosen approach: a stable exact-money capability header on the existing API,
checked before financial route execution. It avoids lossy numeric backward
compatibility. A parallel legacy API would add maintenance/security scope;
postponing installation would avoid that work but not deliver the approved
wallet changes. Neither alternative is part of this release.

The header identifies the wire contract, not authorization, browser identity,
or the package version. All existing authentication, ownership, validation,
and RLS checks still apply. A matching header does not make numeric amounts
safe or permit a caller to bypass those checks.

## 2. Old-client compatibility boundary

- The shared `RestClient` sends an explicit exact-money contract header; the
  updated background/offline transport uses that same client.
- Missing or incompatible headers receive a stable `CLIENT_UPDATE_REQUIRED`
  JSON error and an editable Persian message instructing the user to update.
  No financial handler, body mutation, ledger write or correction runs first.
- Gate both reads and writes for accounts, transactions (including recurring
  payments), bills, financial shopping endpoints and member-facing SMS. Old
  clients must not consume decimal-string responses and then resubmit rounded
  values. Match actual path segments, including trailing slashes; do not
  accidentally gate names with the same prefix.
- Gate vehicle/equipment mutations that can create or remove linked expenses.
  Their intentionally bounded whole-toman contracts are otherwise unchanged.
- Health, authentication, nonfinancial household routes, operator support,
  public assets and machine-to-machine raw SMS ingestion keep their existing
  contracts. Strictly nonfinancial shopping offline snapshot/mutation routes
  may remain available only if their existing payload boundary continues to
  prohibit price/account/payment/checkout data. Do not add a financial outbox.
- CORS allows the new header only for the existing approved origins. Browser
  preflight is not subject to the financial gate, and update-error responses
  retain CORS and `no-store` headers. Cross-origin error visibility is tested.
- Keep the existing explicit PWA update flow. Do not silently reload the app,
  discard drafts, clear encrypted operations, or infer a fresh correction ID.
  The current old client already displays server error messages and has a
  settings update action; no redesign is needed.

## 3. Exact-baseline preflight and migration

Create wallet-specific checker, migration runner and installer under
`backend/deploy/`; keep the earlier installers and their revision contracts
intact. Verify exact incoming source, launch files, migrations and PWA bytes
against the release manifest, and installed API/PWA against official baseline
hashes. Unknown/modified source, symlinks, a mismatched schema, unrestricted
application role or invalid private configuration stop before replacement.

Build and checksum-check the incoming API image while the current service is
available. Before migration, serialize installers with the existing lock,
stop API writes and recheck the baseline. Preserve the previous image ID,
private Compose configuration, PWA, uploads and database in a root-only backup
directory. Check archive integrity and restore the database backup into a
uniquely named temporary database on the server before upgrading production;
never restore over the live database. Cleanup targets only that generated
temporary database. No record contents or secrets are printed or exported.

Within one database transaction, lock the revision and affected historical
tables, validate the exact `0036` lineage, fingerprint every existing public
table excluding only the new account revision column, execute `0037`, and
compare historical fingerprints. Existing accounts start at revision zero;
new correction history starts empty. Any mismatch rolls back the entire
migration and its grants. No application transaction is created as a check.

Grant only the restricted application role the required new-table access and
execution of `public.wallet_ledger_balance(uuid,uuid)` and
`public.wallet_account_has_transactions(uuid)`. PUBLIC execution remains
revoked, FORCE RLS remains enabled, and function definitions, tenant guards,
constraints and revision/immutability/link triggers are verified. Repeated
migration validates the already-installed schema/grants without rewriting
history or resetting revisions; it cannot accept a partial schema as success.

## 4. Activation and failure policy

Stage and checksum-check the PWA before its controlled replacement. Validate
the incoming API privately against the migrated database before public
activation. Only the deployment-owned API image/build override changes;
existing secret values, gateway connection and unrelated services remain.

Activation is coordinated: replace the PWA and start the verified new API,
then verify local source/schema/grants and public PWA/version/CORS/health.
There can be a short maintenance window, but no interval in which an old
client is permitted to write through the new money contract.

Before new API activation, a failed step may restore the verified old API/PWA
only when database inspection proves there are no wallet receipts or linked
wallet adjustments and the old source remains schema-compatible. Retain the
additive schema if it already committed; never automatically downgrade it.

Mark activation durably *before* exposing the new API. After that boundary,
failure must not restart the old API, discard receipts, restore a stale
database snapshot or overwrite newer records. Stop unsafe service, retain
the new PWA/image and backups, and report a clear maintenance/recovery state
for administrator review. A same-release retry can finish a verified partial
activation; unexpected/mixed states fail closed rather than guessing.

Successful repeats independently validate both installed API and PWA,
database and public checks before printing “already installed”. Do not claim
success on version text or generic health alone.

## 5. Verification and publication

- Test the gate with absent/wrong/matching headers, old-client JSON money,
  exact decimal strings, generated expense paths, unrelated routes, OPTIONS,
  trailing slashes, and cross-origin error responses. Assert rejected old
  writes leave all financial rows, revisions and receipts unchanged.
- Verify frontend header transmission and unchanged bearer, multipart,
  blob and background transport behavior. Test old-client update-message
  handling and the existing update action without a production write.
- Run migration/grant tests against disposable PostgreSQL, including exact
  historical fractions, repeat execution, schema/grant drift, wrong revision,
  unrestricted role, transaction rollback and receipt-preserving failure.
- Exercise installer success, locked/unknown baseline, failed backup/restore,
  image/manifest mismatch, migration failure, PWA rename failure, preactivation
  rollback, postactivation failure and safe same-release retry using command
  doubles. Distinguish simulated server commands from a real installation.
- Run relevant frontend/backend tests, Copy Studio coverage and final build
  with explicit public origins. Check archive Linux LF/no-BOM and Bash syntax,
  exact committed source and PWA hashes, and absence of credentials/data/APK.
- Bump only package version/lockfile to `0.11.0`; dependencies remain fixed.
  Record release evidence and limits. Commit task/release changes on the
  current branch; do not move `main` or earlier tags.
- Publish checksum-pinned source/PWA, validation manifest, installer and
  checksums under `v0.11.0`. Verify downloaded public assets independently
  before delivering the server-console command. Do not expose private backups.
- After the user's completed console run, verify all public PWA hashes and
  unauthenticated contract/CORS/health responses. Require local installer
  evidence for the API source, migration, permissions and backup; public
  health alone cannot prove them. Do not make real financial test records.

## Acceptance and remaining limits

Installation is complete only after successful local console evidence and
independent public verification agree on `0.11.0`. A release page or generated
installer is not installation. Physical-phone keyboard/Back and installed-PWA
financial acceptance remain separate; the user must update the phone before
using the new financial section. Existing bundle-size warnings remain out of
scope. Off-server backup hosting and unrelated refactoring are not authorized.
