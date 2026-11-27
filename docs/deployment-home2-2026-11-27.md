# KhanehYar 0.13.0 — Home 2 coordinated release

## Scope and current state

Continue the work in the OpenCode session titled `ادامه اصلاحات خانه 2`.
Its last user instruction was `خب برو بریم برای نصب`.
The final release source is `.local-test/release-home2-v0.13.0/source` relative
to the outer repository. It combines the reviewed Home 2 work with the already
installed management 0.3.0-r1 API, preserving both earlier worktrees.

The meal update saves the dish, meal slot and selected shopping rows in one
server transaction, replays the same operation safely, and rechecks stock
before committing. It supports independent decisions for missing/unresolved
ingredients and adds the snack slot. Selecting a meal does not consume stock
or create financial records.

The current source also depends on the reviewed inventory catalog and
household invalidation stream. Its migration chain is:

`0039` → `0040_inventory_catalog` → `0041_household_changes` →
`0042_meal_inventory_links`.

The API and PWA upgrade together to 0.13.0. The existing management web/service
remains 0.3.0. The management AI migrations keep their original 0038/0039
identities; the uninstalled experimental Home 2 migrations were moved after
that production chain, avoiding conflicting heads.

Publication provides files for the owner's manual root VNC installation. It
does not mean that production installation or migration has occurred.

## Final correction

The previous session's last form correction did not compile: TypeScript
reported TS2783 for the repeated `action`, `qty` and `unit` defaults in
`changePendingChoice`. The correction now selects the existing decision or
a typed empty decision before applying the change.

The isolated browser scenario additionally checks that changing a radio
selection or purchase quantity clears the prior validation error. Cancelling
still creates no shopping rows.

## Verified evidence

Evidence is retained in `.local-test/home2-release/` and summarized in
`docs/home2-0.13.0-validation.json`.

- The combined production build succeeds. Its coverage check discovers 6,040
  editable texts with no unregistered display candidates.
- All 995 frontend tests and 143 copy-editor tests pass.
- All 174 selected real PostgreSQL backend tests pass, including six checks
  of upgrading the installed management schema, replay, rollback after every
  migration step, partial-schema preservation and least-privilege grants.
- All 136 independent management tests pass. Its source and web are not replaced.
- Five Home 2 installer tests and 18 retained management installer tests pass.
  They cover source probing, immutable bootstrap targets, backup rehearsal,
  preservation of management identity, failure before/after activation, repeat
  execution and recovery using the same verified release.
- Both isolated browser tests pass against the corrected production build:
  mobile/desktop meal selection and live household synchronization.
- The browser reports confirm independent decisions, cancellation without
  writes, unchanged inventory/transactions, preservation of open drafts,
  and separation between households. The 360-pixel meal dialog screenshot
  was also inspected.
- The existing warning about an application chunk larger than 500 kB remains.

Tests use fresh disposable PostgreSQL clusters and fictional data; the manual
sandbox and production databases are not used. Docker/systemd and HTTP failure
paths use explicit local doubles; Linux VPS execution and physical installed-PWA
acceptance are performed during the owner's manual installation.

## Installed baseline and installation safeguards

The owner's new console image shows `khaneyar-api:management-0.3.0`. The
completed management-v0.3.0-r1 installation records database revision `0039`,
PWA `0.12.0` and management `0.3.0`. The installer verifies the exact installed
API source/dependencies against the published r1 manifest and every old PWA
file against the original 0.12.0 manifest before modifying deployment files.

The generic health version is not an image release identifier. Incoming app,
Alembic, helper and PWA bytes are pinned by the release manifest. The bootstrap
pins the archive checksum, rejects unsafe archive entries and preserves an
existing extraction whose bytes differ. Baseline license comparisons normalize
CRLF/LF without accepting changed or missing license contents.

The installer takes the application release, management web and privileged
operation locks. It inherits the installed image and replaces checked code
without downloading Python dependencies. Pending management jobs block the
upgrade. Existing encryption keys, runtime controls, private gateway settings,
uploads, financial rows, management password and TOTP identity are preserved.

Before migration it pauses API/management, backs up PostgreSQL, PWA and private
management state/configuration, restores the dump into a unique temporary
database, and rehearses all three migrations there. The actual migrations run
in one transaction. Fingerprints verify that every old public-table row is
unchanged (excluding only the new nullable columns); unrelated columns,
constraints, policies, triggers and grants are also retained. Existing AI
counter/capacity grants remain restricted. Only SELECT/INSERT are granted on
the new public catalog table; no historical catalog rows or links are invented.

The PWA uses same-filesystem directory swaps. Before activation, a handled
failure restores old deployment files/PWA/services while retaining additive
schema. After activation begins, failures leave services stopped and keep the
new history; the same pinned installer can resume. A previous pre-activation
journal is retained for private-log inspection. Production databases are never
automatically restored or downgraded.

Final checks verify API code/schema, local complete PWA hashes, public entry
points/scripts/styles, management health, anonymous-report rejection, the
independent AI report and unchanged management identity/source/web/runtime.
They do not create family financial records or call paid AI inference.

## Manual VNC commands

The owner confirmed that a paste block of up to 300 characters works. The
generated `install-commands.txt` contains two independently measured blocks:
download the installer, then verify its SHA-256 and execute it only on a match.
Commands and published checksums are supplied with the release. Completion
prints `UPGRADE COMPLETE: Home 2 / PWA 0.13.0` and the protected backup path.
