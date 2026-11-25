# KhanehYar 0.12.0 — PWA-only wallet refinement

## Approved deployment boundary

- New tag/assets: `v0.12.0`; immutable baseline: `v0.11.0` at
  `b6ab5bffd63f42725c6d9faeb86e570e6e8ce8db`.
- Only `/var/www/khaneyar` PWA files are staged/replaced. Existing API remains
  running; no container rebuild, database migration/restore or configuration edit.
- The backend application, Alembic, dependencies, gateway, Android and marketing
  site are byte-identical to the baseline. Deployment tooling is intentionally
  extended to recognize the two approved PWA-only version pairs.
- Canonical money remains toman; display preference uses the existing private
  member endpoint. There is no production financial test write.

## Installation safeguards

`backend/deploy/install-pwa-release.sh` and `check-pwa-release.py` enforce:

1. Exact incoming PWA inventory/hashes and version metadata.
2. Existing decimal-v1 client gate/CORS/no-store using unauthenticated GET and
   OPTIONS only. No financial data or credentials are fetched.
3. Exact matching of every baseline PWA file; unknown or manually changed files
   stop installation and are preserved.
4. A release lock, compressed old-PWA backup, verified staging directory, and
   same-filesystem directory swaps.
5. Every new public PWA hash plus unchanged API contract and health after swap.
6. Verified old-PWA rollback on ordinary staging/swap/public verification failure.
   This never rolls back a database or restarts old money code.

Release packaging uses clean committed source and the original `v0.11.0`
checksums. All 37 pinned local bank logos and the service-worker precache are
byte-checked. No sandbox database, credentials, private keys or uploads enter
the archive. `scripts/package-wallet-ui-release.py` retains validation and hashes
under `.local-test/release-v0.12.0/`.

## Verification and remaining acceptance

- 971 frontend tests; 139 copy-editor tests; 5,133 editable texts.
- 22 isolated wallet browser checks; 3 financial-contract browser checks;
  16 contextual-assistant browser checks.
- 25 PWA installer/checker tests, including repeated installation and failure
  preservation with command doubles.
- Production build passes; the existing large-application-chunk warning remains.
- Physical-phone keyboard/Back and installed-PWA acceptance require the actual
  phone after installation. No claim of server installation follows from local
  tests or publication alone.

The user explicitly approved PWA-only delivery. VNC installation commands should
be short and provided separately, with a pinned installer SHA-256 checked before
execution. Published `v0.11.0` recovery evidence and assets remain untouched.
