# KhanehYar 0.15.0 / Management 0.4.0

This release adds a local version history to the application’s About page and
the management Releases page. Notes ship inside each web build, work offline,
and require no GitHub or release-service request when read. The application
receives only public PWA notes; the management build also includes non-sensitive
technical notes for the independent components. Installed-version status comes
from the host and is distinct from the history snapshot.

After subsequent updates accepted through the application, a device-only marker
offers the new notes once. First installation, ordinary reload, rollback, and
unavailable browser storage do not invent an update. Versions before this feature
cannot create that marker, so the first upgrade uses the permanent About entry.
The notes remain editable in Copy Studio with stable source identities, including
English and empty text.

The manually executed installer updates only PWA and management web directories.
It requires the checked PWA/API 0.13.0 and management 0.3.0 baseline, verifies
published file hashes and the existing database revision
`0042_meal_inventory_links`, and takes the existing release/management locks.
It makes protected web backups and same-filesystem stages, retaining management
assets for already-open tabs. A durable journal permits the same pinned release
to resume between swaps or after an HTTP verification failure.

There is no API image replacement, dependency download, database migration,
database restore, service restart, or change to runtime controls, passwords,
TOTP identity, uploads, gateway, financial history, Android or the marketing site.
Unexpected installed source, files, schema or private-configuration changes stop
the upgrade. The published tag and bootstrap checksum pin the package; existing
release assets are never overwritten.

The package includes validation evidence for frontend/domain and copy-editor
regressions, the independent management service, web lifecycle failure scenarios,
production builds and isolated browser checks. Browser data is fictional; the
manual sandbox and production databases are not used. Linux Docker/systemd
preflight checks use explicit local doubles in installer tests. Physical-phone
acceptance and the actual VPS installation remain part of the owner’s VNC run.

The owner runs two separately measured commands: download the immutable installer,
then check SHA-256 and execute only on a match. Successful completion prints
`UPGRADE COMPLETE: release history / PWA 0.15.0 / management 0.4.0` and a protected
backup/log path. Publication and a local test do not mean the server is installed.

Validation completed: 1,009 frontend tests, 145 copy-editor tests, 13 installer
tests and 132 independent management tests passed. Four unchanged PostgreSQL
integration tests were skipped because native binaries were not configured for
this worktree; no manual or production database was substituted. Both production
builds and Ruff passed. Coverage discovers 6,149 editable texts. The 22 management
browser checks and five history checks produced 42 screenshots with no uncaught
JavaScript errors or external runtime requests. The real service worker was used
for the offline reload. See `docs/history-release-validation.json` for limits and
the corrected build/browser failures. The existing large application chunk warning
remains.
