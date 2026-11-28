# KhanehYar 0.15.1 / Management 0.4.1

This release installs local, offline version history on the official wallet
API/PWA 0.14.0 baseline at `9467abe718e91ae3c9189e36bc51cd4e2a1e54dd`.
It preserves the wallet member filter, role-scoped account/holding access,
private transfer destinations, compact amounts and all Home 2 behavior.
The new web versions are PWA 0.15.1 and independent management 0.4.1.
The API remains 0.14.0 and the database remains `0042_meal_inventory_links`.

History is available under Settings → About and on the management Releases
page. Notes ship in each build and remain readable offline. The PWA contains
only public application notes; the management build also contains non-sensitive
technical notes. Existing note identities remain editable in Copy Studio.
The permanent About entry is available on this first upgrade; later updates
accepted through the application can offer their notes once on that device.

The installer requires the complete published 0.14.0 PWA inventory, exact API
source/dependencies/schema and management 0.3.0 source/web/identity. It takes
the existing release, management web and privileged-operation locks, checks
for a previous history journal, and preserves unknown state for review.
Failures name the API, schema, management-service or web-baseline check.

Only the PWA and management web are replaced. Protected backups and durable
same-filesystem stages allow the same pinned release to resume between swaps
or after a public verification failure. Previous management assets remain
available for open tabs. Runtime settings, credentials, TOTP identity,
encryption keys, uploads, financial history, nginx and the private AI gateway
are preserved. No API image build/replacement, dependency download, database
migration/restore, service restart, Android or marketing-site change occurs.

The original v0.15.0 release remains unchanged. It supports only API/PWA
0.13.0 and correctly stopped before activation on the owner's now-installed
0.14.0 baseline. Use the separately published v0.15.1 installer for this host.
Each bootstrap, archive, manifest and checksum belongs to its own exact tag;
published assets are never overwritten.

Validation evidence is recorded in `docs/history-release-validation.json`
and shipped in the package. Tests use fictional data and isolated local
fixtures; production and the manual sandbox are not used for writes.
Docker/systemd installer lifecycle tests use explicit local doubles. Actual
Linux VPS execution and installed-phone acceptance are checked during the
owner's root VNC run. Publication does not establish installation.

Run the two independently measured commands supplied with the release:
download `/root/history-0151.sh`, then verify its SHA-256 and execute only
on a match. Both commands fit the owner's 400-character VNC limit.
Success prints:

`UPGRADE COMPLETE: release history / PWA 0.15.1 / management 0.4.1`

The next line names the protected backup/log directory under
`/var/backups/khaneyar/history-0.15.1/`. Installation remains pending until
the owner supplies console output and live versions/builds/health agree.

Validation completed: all 1,012 frontend tests, 147 copy-editor tests,
17 history-installer tests, five retained Home 2 installer tests and five
retained wallet installer tests passed. Independent management tests passed
132 checks and skipped four unchanged PostgreSQL integrations because native
binaries were not configured in this worktree. Both production builds and
Ruff passed; coverage found 6,174 editable texts. The 18 wallet, 22 management
and five history browser checks produced 53 screenshots with no uncaught
JavaScript errors or external runtime requests; management also reported no
console errors. The offline reload used the actual
service worker. Selected mobile and desktop screenshots were inspected.
The validation record preserves the corrected metadata/dependency failures
and local Docker/systemd, physical-phone and PostgreSQL test limits.
