# KhanehYar 0.16.1 / Management 0.4.2

This patch refines the installed release-history screen. The PWA presents one
continuous list with a heading for each version and small bullet points for
all its notes. Category headings and per-version expanders are removed from
the public screen. Note text is 13 pixels and version headings are 14 pixels,
using the existing application type scale. Management keeps its complete
history and technical views.

The public build includes only PWA releases with the installed version’s
major number, up to that version. A future 1.x build excludes 0.x notes from
the application while retaining every entry and stable copy-editor identity
in the source and management build. Offline history, update notices, keyboard
navigation and editing notes as English or empty text remain supported.

The exact prerequisite is the official v0.16.0 source at
`b794b15ed29dd86a2d5d77830bf1917016508127`, PWA 0.16.0 and management 0.4.1.
All released compact-wallet behavior and persistent member filters are retained.
The installer verifies that release’s completed journal, pinned manifest and
web inventories before activation. An incomplete or unrelated installation
stops for review. New version-specific staging and previous-web directories
preserve the prior release’s journal and backups.

Only PWA and management web files are replaced. The API remains the official
0.14.0 source and dependencies; the database remains
`0042_meal_inventory_links`. There is no migration, database restore, Docker
image replacement, service restart or dependency download. Runtime settings,
encryption keys, uploads, financial history, management credentials, TOTP,
nginx and private AI gateway configuration are preserved. Management assets
from previous builds remain available to open tabs.

The installer takes existing deployment and management locks, saves protected
web backups, stages both builds on their own filesystems and records durable
progress. Interruption between swaps or failure of public verification can
be resumed by rerunning this exact verified release. Unknown state is retained
for review. Successful execution prints:

`UPGRADE COMPLETE: release history / PWA 0.16.1 / management 0.4.2`

The following line identifies the protected backup and log directory under
`/var/backups/khaneyar/history-0.16.1/`.

Validation evidence ships as `verification.json` and is maintained in
`docs/history-compact-release-validation.json`. Installer lifecycle tests use local
Docker/systemd/HTTP doubles; browser tests use fictional, isolated data and
the actual service worker. Production and the manual sandbox receive no test
writes. Existing backend runtime source and schema are unchanged.

The isolated frontend run passed all 1,013 tests. The 147 copy-editor tests,
25 history-installer tests, 13 retained compact-wallet installer tests, five
Home 2 installer tests and five wallet-access installer tests passed.
TypeScript, both production builds, Ruff and generated bootstrap shell syntax
passed; copy coverage found 6,192 editable texts. Dependencies were installed
offline in this dedicated worktree. See the validation record for browser
results and the explicit limits of the web-only test scope.

All 48 browser checks passed: five history/offline/copy-editor checks,
21 retained wallet checks and 22 management checks, producing 62 screenshots.
No uncaught JavaScript errors or external runtime requests were recorded;
management also recorded no console errors. Selected mobile, desktop and
management history images were visually inspected.

All 79 checked live application/management files matched the official 0.16.0
baseline. The server verifies its complete PWA inventory, including the unchanged
recipe corpus, before activation. The predecessor manifest and archive were
downloaded from the pinned official tag and verified by SHA-256.

Publication and verified public downloads do not establish installation.
Installation awaits the owner’s two checksum-pinned root VNC commands and
completion output, followed by live version, hash and health verification.
