# KhanehYar 0.14.0 — Wallet access and compact layout

This official API/PWA release upgrades the verified installed Home 2 0.13.0
source at `c2516e8078e9977989a750df0793c737cad8278f`. The management service and
web remain 0.3.0. The database remains `0042_meal_inventory_links`; there are
no schema migrations or dependency changes. The Android app is a separate
release and is not included.

Owners and administrators can select all wallets, their own wallets or a family
member by stable member ID. Bank accounts, cash wallets, holdings and totals
use that selection together. Ordinary members receive only their own account
and holding details from the API, including after an administrator is demoted.
Family isolation is enforced before account serialization and holding pricing.

Transfers between family members remain available. The destination lookup
returns only account, family, member and account-kind identifiers; it does not
fetch the recipient's title, balance, bank, card number or account identifiers.
The transaction form handles destination loading/failure/retry and validates
the selected destination again on save. Existing source-account permissions,
fee rules, exact decimal money and immutable balance-correction history remain.

Cash wallets use a compact row with the owner/title and amount/currency kept
together. Large and negative values use the existing adaptive text component;
the global rial/toman display control remains available. The member selector
scrolls horizontally inside the page on small screens. Empty, loading and error
states and accessibility labels remain in the local copy editor.

## Installation safeguards

The installer pins the exact 0.13.0 API and complete PWA file inventories and
checks the installed schema and management identity before activation. It
checks root/tools/paths and takes the existing release, management-web and
privileged-operation locks. Pending management jobs block an upgrade.

The new API image inherits the checked installed image without downloading
dependencies. API/management are paused while protected backups of PostgreSQL,
the old PWA and existing private configuration/state are taken. The database
backup is restored into a unique disposable database and checked at the same
revision. No migration is run in the rehearsal or production database.

The PWA is staged and swapped on the same filesystem. Encryption keys,
financial history, uploads, management credentials/TOTP, runtime settings,
gateway and nginx configuration are preserved. The installer checks activated
source/schema, complete local PWA hashes, public entry points/assets and the
existing management service and identity.

An ordinary failure before activation restores prior deployment files and
services while retaining the protected backup/log. An uncertain failure after
activation leaves services stopped and allows the same pinned installer to
resume. A production database is never automatically restored or downgraded.

## Verification

The validation artifact records the exact test results and browser evidence.
The completed regression runs include 998 frontend tests, 238 selected backend
tests, 145 copy-editor tests and 28 installer tests (five wallet, five retained
Home 2 and eighteen retained management checks). Four additional browser checks
cover correction review, reconciliation/history preservation and recovery.
The final wallet browser suite passes 18 checks, including five viewport widths
for each manager role, maximum negative rial/toman values at 320 pixels,
editable English/empty copy, empty selected members, loading/error/retry and
private transfer destinations. Three checks against the built PWA and a real
disposable API verify login, role-scoped account reads and one exact transfer
with resulting source/destination balances of 900/100. All 25 browser checks
report no external requests or real-data writes.
Application tests use fictional data and fresh disposable PostgreSQL clusters
with restricted application roles. Manual sandbox and production financial
records are not used. Installer lifecycle tests use explicit local doubles for
Docker/systemd and failure paths. The existing production-build warning about
an application chunk above 500 kB remains.

Linux VPS execution and acceptance on a physical installed PWA are completed
by the owner after publication. Publication alone does not establish that the
production server has been upgraded.

## Manual root VNC installation

Use the two separately measured commands supplied with the release: download
`install.sh` to `/root/wallet014.sh`, then verify its SHA-256 and execute only
on a match. The commands use the exact `v0.14.0` tag and are each below 300
characters, within the required 400-character VNC limit.

Successful completion prints:

`UPGRADE COMPLETE: Wallet / PWA 0.14.0; database 0042; management 0.3.0 preserved.`

The following line gives the protected backup/log directory under
`/var/backups/khaneyar/wallet-0.14.0/`. After the owner provides execution
output, verify the public PWA version/build and API/management health separately.
