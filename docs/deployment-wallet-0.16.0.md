# KhanehYar 0.16.0 — Compact wallets and persistent member filter

This PWA-only release is based on the verified official `v0.15.1` source,
commit `7b4854a97ddaed345f073a23d422500ed6f28fc4`. It retains the API 0.14.0
source, database revision `0042_meal_inventory_links`, management web 0.4.1,
management service/identity and offline release history. Android is separate.

The member filter and selected owner remain visible while scrolling the wallet
page. The account view in settings also offers the same owner selection.
Amounts and units are smaller and closer together, with less card padding.
Bank card numbers use four ordered groups in 14 px type; the eye button reveals
or hides the number without opening account editing. Returning to the page
conceals a previously revealed number. Cards retain the existing bank colors
and logos; photographs of bank cards are not included. The total-wealth label
follows the selected member.

## Installation safeguards

The installer accepts only the pinned complete 0.15.1 PWA inventory. It checks
root/tools, release hashes, the active API source and revision 0042 using
read-only probes, and the management 0.4.1 files and identity before mutation.
It takes the existing deployment, management-web and privileged-operation
locks. Pending management jobs and incomplete earlier history upgrades block it.

A protected, hash-verified PWA backup is made before staging and swapping on
the same filesystem. Only the PWA is an activation target. The API image,
database, encryption keys, uploads, nginx, gateway configuration, management
credentials/TOTP and runtime settings are not replaced. There is no migration,
dependency installation or service restart. The full static recipe corpus is
unchanged and included in the complete local inventory checks.

The durable journal preserves the old PWA and verified backup. Interruptions
between renames or after activation can resume with this same pinned installer.
Unexpected changed files or protected identity stop the process for review.
No production database restore or downgrade is performed. Completion requires
the new local/public PWA checks and unchanged API/schema/management probes.

## Verification

1012 frontend tests in 273 suites, 147 copy-editor tests, TypeScript and the
production build passed. All 6185 display texts are registered for editing.
Twenty-one wallet browser checks and five retained history checks passed with
24 screenshots, no page errors, no external requests and no production/manual
financial writes. These cover owner/admin/member scopes, mobile widths from
320 px, large/negative rial and toman amounts, sticky owner selection, settings,
number reveal/hide and 14 px type, transfer loading/error/retry, editable English
and empty text, update notices and the real service worker's offline history.

Thirteen installer tests cover PWA-only activation and repeat execution,
interruption between renames, failed health probes and same-release resume,
partial staging, changed incoming/baseline/management files, schema contracts,
incomplete prior journals and safe atomic archive extraction. Docker/systemd
are explicit local doubles. No backend application or schema code changes.

Seventy-nine public application/management files match the pinned prior release;
the large unchanged recipe corpus is checked against its full published inventory
locally during server preflight. Its public index was separately downloaded and
matched. Existing application chunk warnings above 500 kB remain. A physical
installed-PWA acceptance check and actual VPS execution belong to the owner.

## Manual root VNC installation

Run the two separately supplied commands: download the exact `v0.16.0/install.sh`
to `/root/wallet016.sh`, then check its SHA-256 and run only on a match. Each
complete command is measured below 300 characters, within the 400-character limit.

Successful completion prints:

`UPGRADE COMPLETE: Wallet / PWA 0.16.0; API/schema unchanged; management 0.4.1 preserved.`

The next line identifies revision 0042 and the protected backup/log directory
under `/var/backups/khaneyar/wallet-0.16.0/`.

Publication and installation are separate states. The source validation records
`installed_on_server: false`; this becomes installed and verified only after
the owner supplies successful VNC output and live version/health checks pass.
