# Meals library and kitchen-centered planner — test scope

## Approval and isolation

The user approved connecting the prepared food list, then narrowed the scope to
source-defined food categories and ingredient names, without quantities or cooking
instructions. They approved a substantial, planner-first UI/UX redesign and asked
that the surface genuinely feel like food and a kitchen rather than an administrative
dashboard. This document records that direction for review before implementation.

Work is isolated on `codex/meals-test-2026-11-23`, based on official tag `v0.6.0`
(`0faa080f7c272e4b3842d19f57ed1e10d56ab992`). Do not modify other worktrees,
the manual sandbox database, production, remote branches, or releases. A release
version and publication require a later, explicit approval.

## Experience and visual direction

The hero is the family's table for the selected day: a compact seven-day selector,
the Persian date, and breakfast/lunch/dinner as readable menu sections. Ingredient
names and food titles are the content, not counters and statistics. The complete
week remains available as an alternate view.

Use a warm, kitchen-notebook composition within the existing house style: paper-like
surfaces, generous Persian typography, food/ingredient line illustrations and restrained
category markers. Keep the app's Vazirmatn font, RTL behavior, green action color,
existing light/dark themes, and local assets. No invented recipe photos, remote image
dependencies, new UI library, decorative blue/purple accents, or noisy animations.
Use the project's spacing, type, radius, and motion tokens; add missing type tokens
centrally only if required rather than scattering new numerical scales.

Review correction (explicitly approved after the initial running build): keep a
consistent mobile-app column even on a larger display. Inherit the existing shared
content and sheet width limits rather than making meals wider than other screens.
Library and full-week views remain single-column, and culinary artwork uses the
compact composition. Test actual column/sheet dimensions as well as page overflow.

Official release approval (24 November): promote the reviewed meals implementation
onto the latest official `v0.7.2` for `v0.8.0`, preserving all released assistant
features and repairs. The existing assistant fact adapter must retain `qty: null`
as unknown rather than attempting Decimal conversion; this compatibility guard
does not add a quantity-calculation workflow. The deployment is API/PWA only, on
the unchanged `0034_assistant_receipts` schema, without a gateway upgrade or billed
inference. Publication does not imply production installation.

Three navigation sections:

1. «برنامهٔ هفته»: selected-day menu by default; optional full-week view; existing
   previous/current/next-week behavior and fixed three calendar meal slots remain.
2. «کتابخانهٔ غذاها»: searchable prepared list with all meal/category labels from
   the source, including dessert, snack, afternoon meal, appetizer, iftar, and suhoor.
3. «غذاهای خانواده»: existing manually entered dishes plus explicitly saved library
   selections; preserve manual records and existing creator/admin permissions.

Dessert and other source labels classify the library; they do not silently create
new calendar slot types. Foods with several labels appear in every matching filter.
Unknown/ambiguous source labels are not silently reclassified.

## Library delivery and data integrity

Source of truth: the unchanged `غذا/processed/recipes.json` in the original workspace.
It contains 4,583 foods and 5,832 distinct ingredient variants, but no preparation steps.
Keep its original review decisions, stable source IDs, and explicit whole-variant
selection policy. Do not regenerate or overwrite the reviewed source dataset.

Create a reproducible, versioned display projection containing source IDs, titles,
aliases, source meal labels, food-type labels, and ingredient names/selection structure.
Exclude audit-only payloads, source row lists, quantities, servings, and cooking steps
from the application projection. Record a source SHA-256 and projection counts.

Deliver a compact search index and lazily fetched variant details as same-origin
static data, not a 35 MB initial JavaScript dependency. Use bounded/paginated results,
Persian-normalized searching of titles/aliases, and filters keyed independently of
editable display copy. Retain all source classifications without inventing health,
nutrition, difficulty, popularity, or time estimates.

The library is read-only. Saving a food creates only the user's selected, reviewed
household dish; it never imports the entire catalogue into each family or mutates
an existing similarly named manual dish. Enforce the existing household dish limit.

## Ingredient selection and persistence

Show one whole variant at a time. Switching variants resets its ingredient selections;
never union ingredient lists across variants. Explicit alternatives require one choice
for each included choice group. Optional ingredients can be selected/deselected.
Open choices require the user's own ingredient name before inclusion. Equipment is
display-only, separated from ingredients, and cannot become a shopping ingredient.
The two unresolved source items must be visibly flagged; do not permit silent import
of unresolved ingredients. Permit a resolved user-entered replacement, or omission
with explicit user selection. All selected names are reviewable before saving.

Persist an ingredient with a name and `qty: null` when no quantity was supplied.
Do not synthesize a recipe quantity of 1 or an unknown unit. New library selections
need no quantity/unit form. Existing numeric household ingredients keep their stored
quantities and units unchanged, including when their dish is viewed or edited.

Extend the existing meal ingredient schema and TypeScript mapping narrowly to
accept explicit null quantities for dishes. Map null to null, never `Number(null)`.
Keep numeric validation for every non-null value. Preserve existing duplicate-name
and unit-conflict rules; if a combined group has any unknown amount, its recipe total
must not be presented as fully known. Existing JSONB records require no destructive
backfill; verify whether any schema migration is actually needed before adding one.

The existing shopping import remains available for existing numeric dishes, with
its idempotency, existing-item preservation, and session checks unchanged. Automatic
quantity computation and a new shopping workflow for library foods are out of scope.
An unknown ingredient must not be silently submitted as a numeric shopping item;
the current explicit shopping form may accept a user-entered amount, but this stage
does not add the previously discussed automatic suggested-1 behavior.

## Calendar selection flow

Replace the long dish dropdown with a searchable chooser. Allow switching between
family dishes and the source library; show food titles, source labels, and ingredient
previews. Selecting a source food opens its variant/ingredient review before an
explicit save to the family. Then it can be selected for the calendar slot using
the existing meal-entry API.

Saving a family dish and assigning a calendar slot are separate existing writes.
If the second write fails or conflicts, keep the successfully saved family dish and
show the slot error; never report the whole flow as rolled back or silently overwrite
an occupied slot. No new combined transaction endpoint is needed for this test scope.
Creator/admin authorization and revision conflicts remain enforced server-side.

## Copy, accessibility, and failure states

All fixed interface copy—including categories' display fallbacks, search-empty,
library loading/failure/retry, unresolved-choice validation, save failures, and
accessibility labels—must appear in the local copy editor. Source food/ingredient
names and classification keys are data, not editable application copy. Preserve
source metadata; use stable `@copy-text` annotations for unusual display paths and
keep behavior independent of Persian wording, English replacements, or empty copy.

Maintain keyboard-accessible controls, visible focus, touch targets at least 44 px,
RTL day navigation, readable long food names, appropriate dialog focus, light/dark
contrast, and reduced-motion support. Loading/error/offline/session-change states
must not retain another household's private dishes or unsaved modal state. Public
catalogue data may be cached independently, but household writes remain online.

## Validation and human review

- Run catalogue projection integrity tests: counts/hash, all source labels, aliases,
  whole-variant selection, explicit/open choices, optional/equipment/unresolved items,
  null quantities, and bounded results.
- Run relevant frontend meal/domain/repository tests and real PostgreSQL/HTTP meal
  tests: nullable persistence, old numeric data preservation, permissions, tenant
  boundaries, revision/slot conflicts, limits, and shopping numeric validation.
- Run TypeScript/build, `npm run copy:studio:coverage`, and
  `npm run copy:studio:test`; verify new visible/failure/empty/loading copy is listed.
- Launch an isolated fixture-backed application preview on its own local port using
  the existing copy-workbench launcher architecture. No production proxy and no
  manual database writes. Clearly label fixture data as test data.
- Exercise day/full-week navigation, every library filter, Persian search, details,
  multi-variant/choice review, save-to-family and calendar selection, manual dish
  preservation, failure/retry, offline clearing, and no-overflow layouts.
- Inspect saved screenshots at 360 px and desktop widths, including food detail,
  chooser, selected-day menu, library and dark mode; verify the kitchen atmosphere
  visually before claiming completion.

Deliver the running test URL and a concise validation report. The user reviews the
real interface and requests refinements. Do not publish or install until they approve
the tested result separately.
