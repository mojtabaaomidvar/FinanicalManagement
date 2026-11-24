# Meals library — isolated review build

## Status and scope

This document records the isolated review and its original validation checkpoints.
On 24 November the user explicitly approved the official release. The reviewed
meals commits, including the mobile-width correction, are promoted onto official
`v0.7.2` for `v0.8.0`; the test baseline below remains historical. Exact release
scope and installation status are recorded in
[`deployment-0.8.0-2026-11-24.md`](deployment-0.8.0-2026-11-24.md).

The original local test implementation of the approved
[`2026-11-23-meals-library-design.md`](superpowers/specs/2026-11-23-meals-library-design.md),
was not an official release or production installation. Its branch is
`codex/meals-test-2026-11-23`, based on official `v0.6.0`
(`0faa080f7c272e4b3842d19f57ed1e10d56ab992`). The version displayed by the
application identified that baseline; no release number had been chosen then.

The meals interface now contains a selected-day breakfast/lunch/dinner menu, a
seven-day selector and optional full-week view, a searchable public food library,
and a separate household dish list. A searchable chooser replaces the long dish
dropdown. Local culinary line illustrations, kitchen-notebook composition, Persian
RTL typography, and the existing light/dark themes provide the visual direction.

The reviewed source remains unchanged. All 4,583 foods and 5,832 whole ingredient
variants are projected into a same-origin search index and 256 lazily loaded detail
shards. The library preserves all 10 source meal labels and 50 food-type paths,
including the source's ambiguous placeholder. It does not invent classifications,
recipe quantities, nutrition, preparation time or cooking instructions.

Only an explicitly reviewed selection is saved into household dishes. Switching
variants resets that variant's selections rather than merging recipes. Alternatives
and open choices require one concrete name; optional items remain selectable;
equipment is separated and excluded from writes; unresolved expressions must be
corrected or explicitly omitted. Existing household dishes are not overwritten.

## Persistence and compatibility

- A name-only ingredient is persisted as `qty: null`, not as zero or one.
- Existing numeric amounts and units remain intact, even when their form fields
  are hidden. Non-null quantities retain numeric validation.
- Existing JSONB storage accepts nullable amounts; no migration or backfill is
  required. Existing title, ingredient-count and household-dish limits remain.
- A group containing an unknown amount remains unknown when aggregating meals.
- Shopping retains its separate numeric schema, explicit review, idempotency and
  preservation of existing shopping amounts/prices. The user must supply a shopping
  amount for a name-only ingredient. There is no new quantity-calculation workflow.
- Saving a family dish and assigning a slot are separate writes. If slot assignment
  conflicts, the saved family dish remains and the partial-success error is shown.
- Creator/admin permissions, revisions and household boundaries remain enforced by
  the backend. Offline, forbidden and session transitions clear private meal/form data.
- Fixed UI copy remains in the local copy editor. Public food/ingredient names and
  classification data are protected separately, including picker/draft collisions.

## Running the review

The isolated launcher is outside the source worktree:

```powershell
# From the source worktree, without using the ordinary dev server:
$env:KHANEYAR_MEALS_PREVIEW_PORT = '12266'
node ../launch-preview.mjs
```

It uses `createWorkbench` with this source tree and patches the preview bridge's
port guard **in memory only**. The corrected origin is `http://127.0.0.1:12266`; the current
review link, including its in-memory session, is written to `../preview-url.txt`.
Open that link rather than reusing a session from an older launcher run. The copy
editor for this isolated version is available at the origin's root URL.

All API requests in this review use fictional in-memory fixture data. This is
neither a production connection nor a persistent manual sandbox. Review changes
remain available during the server session and reset when it restarts. The original
copy editor on port 5701, manual sandbox on port 5700 and its database/uploads are
independent and have not been refreshed or changed by this work.

## Recorded validation

| Check | Result |
| --- | --- |
| Complete frontend suite | 689 passing tests in 85 files |
| Projection integrity | 5 passing tests; exact source counts, hash and item-kind totals |
| Source reproduction | Unchanged reviewed source reproduces the exact index and all 256 shards |
| Backend meals/shopping/batch/authorization | 126 passing PostgreSQL/HTTP tests; zero failures, errors or skips |
| Backend lint | Ruff passes for both changed backend modules and meal tests |
| Copy extraction/editing/preview regression suite | 122 passing tests |
| Copy coverage | 4,721 editable UI texts; no unregistered display candidates |
| TypeScript and local-sandbox build | Passing |
| TypeScript and production-shape build | Passing; not deployed or installed |
| Static/PWA packaging | All data shards included; library JSON excluded from shell precache |
| Chrome visual/interaction review | Passing at 360 px and 1440 px, including dark theme |
| Firefox interaction review | Passing at 360 px and 1440 px, including dark theme |
| Live copy picker, English/empty drafts and data protection | Passing; all 195 meals-source copy entries discovered |

The backend launcher `../run-backend.py` provisions a disposable PostgreSQL
cluster. Migration/cleanup use its bootstrap role; actual API checks use a
`NOSUPERUSER NOBYPASSRLS` application role. The cluster is stopped after execution.
Machine-local evidence is in `../backend-report/pytest.xml` and
`../backend-report/result.json` (exit code zero). This is the targeted related suite,
not a claim that the entire backend test suite was rerun.

Both browsers pass every source tag/category filter, search/empty/reset, whole-variant
selection, nullable save requests, hidden numeric-amount preservation, day/full-week
planning, the searchable slot chooser, and shopping's explicit unknown-amount
validation. They also pass index/detail failure, loading and retry states; empty-home
selection; partial slot-save conflicts; alternatives/custom choices; unresolved-item
omission; equipment exclusion; offline/forbidden clearing; complete Tab/Shift+Tab
focus containment and Escape; and read-only versus creator-editable household dish
controls. There are no page errors or horizontal overflow in the captured layouts.
These are fixture-browser checks; backend persistence and authorization use the
separate real PostgreSQL tests above. Session identity/request-capture safeguards
are also covered by the meal repository's frontend tests, not by a claim of a live
production account-transition test.

At the original test checkpoint, `git diff --check` passed and all work remained
local; no remote branch, tag, release, production install or manual-sandbox refresh
had been run.

Projection source SHA-256:
`da49cd9a2241b402b5cf1ccbf9a5ac1a30bde5135ed96c712447706a645af36a`.
The index is 1,510,627 bytes (224,993 bytes gzipped); index and data shards together
are approximately 7.63 MB, not a 35 MB JavaScript dependency.

The production-shape build still emits the application's existing large-chunk
warning. This work does not introduce a general application bundling refactor.

## Repeating the browser checks

```powershell
node scripts/check-meal-library.mjs
node scripts/check-meal-copy.mjs

# Requires Playwright's Firefox runtime:
$env:KHANEYAR_TEST_BROWSER = 'firefox'
node scripts/check-meal-library.mjs
Remove-Item Env:KHANEYAR_TEST_BROWSER
```

The scripts use `../preview-url.txt` by default; `KHANEYAR_MEALS_PREVIEW_URL` can
select another isolated localhost preview. They refuse ports 5700/5701. Reports and
360 px/1440 px screenshots are written under `../browser-report/`, with separate
Chrome, Firefox and copy subdirectories. The copy check only stages and resets
drafts; source Apply/Undo requests are blocked and source bytes are checked unchanged.
It uses a freshly read snapshot of the real source catalogue and the server's quick
status endpoint, avoiding repeated workspace scans exceeding the editor's 20-second
request deadline on this Windows host. Source metadata, picking and draft rendering
use the actual editor/preview bridge, not mock elements. The full extraction and
source-apply suite is covered separately by the 122 passing copy tests above. A fresh
full-catalogue request in the editor can still time out on a busy host; this is not
a claim that the editor's startup-performance issue has been fixed.

Publication originally required separate user approval after review of the running
UI; that approval was given on 24 November. Production installation remains separate,
and unrelated active worktrees are not merged into the release.

## Mobile-width review correction

The user found the meals surface too wide for the mobile application and explicitly
selected a consistent mobile column, including when opened on a larger display.
The earlier meals-only 960 px content and 672 px sheet overrides were inconsistent
with the rest of the application. A browser at an 800 px viewport reproduced the
content/header mismatch. The earlier no-horizontal-overflow checks did not catch
that the column itself was much wider than the rest of the app.

The correction removes those overrides rather than adding a new width system:
`.meals-content` inherits the shared `.content` 520 px maximum, and `.meals-sheet`
inherits the shared `.modal-sheet` 552 px maximum. Both shrink to the actual viewport
on a phone. Library and full-week views stay single-column, and the hero/illustrations
retain the compact composition even on larger displays. No copy, functionality,
API, stored data or application-wide layout rules are changed.

The browser regression script now asserts standard column/sheet widths and one-column
library/week layout, not just document overflow. It also walks day, full-week, library
and detail views at 320, 360, 390, 430, 768 and 1440 px. The earlier preview on port
12265 remains independent; no existing
fixture session or persistent manual-sandbox data is discarded by preparing the
corrected review on port 12266.

Correction validation completed:

- Chrome and Firefox both passed the updated responsive matrix and the existing
  meals browser suite, with no page errors. On phone viewports content and sheets
  measured the actual viewport width; on larger viewports content stayed at 520 px
  and sheets at 552 px. Library and full-week layouts remained single-column.
- Inspected saved compact-phone, desktop, library, full-week and detail screenshots.
  The in-app Review tab renders the corrected planner; at an 800 px viewport it
  measures a 520 px content column and 552 px header without document overflow.
- Build/TypeScript passed, including copy coverage for all 4,721 editable UI texts.
  Related meals domain/library/repository tests passed: 32 tests in four files.
- The initial expanded browser attempts timed out during animation/action checks.
  The final responsive cases use independent fixture pages and reduced motion to
  avoid measuring transient entrance transforms; the existing functionality suite
  continues to run with default motion. Both final browser runs passed.

Reports and responsive screenshots are under `../browser-report/chrome/` and
`../browser-report/firefox/`. Read `../preview-url.txt` for the corrected running
review session. At that correction checkpoint no push, merge, release or production
installation had been performed.
