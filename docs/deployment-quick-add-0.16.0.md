# KhanehYar 0.16.0 — Quick add

The first approved household-roadmap stage adds a floating quick-add button
above the existing navigation. Its compact vertical menu opens the existing
transaction, shopping-item, task, family-activity and meal forms. Transactions
retain separate expense, income and transfer choices. The button collapses
while the active page scrolls; menu controls support keyboard traversal,
Escape, outside click and browser Back.

Quick-add forms fill the mobile viewport and respect safe areas and the
existing keyboard viewport. The shared dialog and date picker coordinate
focus, background inertness and the topmost close action while preserving
retained pages, drafts and the existing Back stack. Other entry points keep
their existing form layout. No new business form, API or storage contract
is introduced.

An empty shopping household starts with the existing list form and continues
to an item in that list. Meals use the first empty slot in the current week;
an empty dish library starts with the existing dish form before continuing
to that slot. A full week explains why another meal cannot be added. Loading
and failed reads retain their existing retry and access checks. Shopping and
tasks keep their established offline queues; financial, activity and meal
operations retain their online requirements.

This is a **PWA-only release** on the exact published 0.15.1 history baseline
at `7b4854a97ddaed345f073a23d422500ed6f28fc4`. The installed API remains
0.14.0, independent management remains 0.4.1, and the database remains
`0042_meal_inventory_links`. Financial decimal precision, wallet visibility,
transfer destinations, correction history and local release history are
preserved. The remaining roadmap stages are outside this release.

The installer checks the full old PWA file inventory, installed API source,
dependencies and schema, management source/web and protected identity before
activation. It takes the existing release, management-web and privileged
operation locks. A protected PWA backup, same-filesystem stage and durable
journal allow the same pinned release to resume after interruption or a
public verification failure. Unknown or changed files stop the upgrade and
remain available for review.

No API image, dependency, database schema/data, management web/service,
gateway, nginx, credentials, TOTP identity, uploads, Android or marketing-site
files are replaced. No database migration/restore or service restart is run.
The package includes an allowlisted PWA build, installer helpers, manifest,
checksums and validation evidence. The exact tag and archive SHA-256 are
pinned by the bootstrap; existing published assets are never overwritten.

See `docs/quick-add-release-validation.json` for actual check results and
limits. Browser checks use the isolated in-memory fixture launcher with
external requests blocked and no source-apply route. Production and manual
sandbox data are not used for writes. Installer lifecycle tests use explicit
local Docker/systemd/HTTPS doubles; the actual Linux VPS and physical phone
remain installation/acceptance checks.

The owner runs the two independently measured root-console commands supplied
with this release: download `/root/quick016.sh`, then check its SHA-256 and
execute only after a match. Each command is below the 400-character VNC limit.
Successful completion prints:

`UPGRADE COMPLETE: Quick add / PWA 0.16.0 / API 0.14.0 / management 0.4.1 preserved`

The next line identifies the protected backup/log below
`/var/backups/khaneyar/quick-add-0.16.0/`. Publication is distinct from confirmed
installation; console execution evidence and live build/health verification
are required before reporting the server installed.
