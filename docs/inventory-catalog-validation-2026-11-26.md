# Inventory catalog phase 1 validation

Date: 2026-11-26

Branch: `codex/inventory-catalog`

## Scope completed

The approved first phase now publishes operator-reviewed inventory metadata
through the catalog API while keeping the packaged catalog available offline.
Operators can edit a proposal's title, category and unit before publishing or
rejecting it. Existing approvals stay private until explicitly published.
Household inventory continues to save through the existing encrypted outbox.

Touch selection, exact-name and alias defaults, required metadata for new
unknown items, additional units and complete wrapped item names are covered by
the checks below. Public catalog responses exclude proposal history, household
identity, inventory amounts and notes.

## Completed checks

| Command | Result |
| --- | --- |
| `python -u scripts/test-inventory-catalog-isolated.py` | All 95 backend tests passed across catalog, shopping, offline shopping and support. |
| `npm test -- --reporter=dot` | 976 tests passed in 105 files. |
| `npm run copy:studio:test` | 140 tests passed. |
| `node scripts/check-inventory-categories.mjs` | Mobile and desktop categories, keyboard selection, reload, support export and empty/error/loading states passed. |
| `node scripts/check-inventory-catalog.mjs` | Four groups passed: touch/full names/validation, published catalog metadata, failed-refresh fallback and operator editing/publication/rejection. |
| `npm run build` | TypeScript, production assets and service worker built successfully. |
| Build precheck: `npm run copy:studio:coverage` | 5,161 editable texts; no unregistered display candidates. |
| `git diff --check` | Passed. |

The backend runner creates a fresh temporary PostgreSQL cluster and an
application role with `NOSUPERUSER NOBYPASSRLS`. All migrations are applied to
that cluster, and the cluster is stopped after testing. The tests verify
normalized duplicates, concurrent publication, review conflicts, transaction
rollback, cross-household visibility of public metadata, tenant isolation and
historical offline replay.

Browser checks run against the copy preview on port 5701, with in-memory
fixtures and external requests blocked. Screenshots are stored under
`.local-test/inventory-catalog/` and `.local-test/inventory-categories/`.

## Issues resolved while completing validation

- Windows PostgreSQL startup inherited a captured pipe and prevented the test
  runner from returning. Bootstrap output now goes to a file, subprocesses have
  bounded timeouts, and test progress is printed.
- The publication concurrency test accidentally submitted two names that were
  correctly deduplicated before review. It now creates distinct proposals and
  concurrently reviews them into equivalent normalized names. A separate
  assertion covers Persian/Arabic spelling deduplication on submission.
- Reloading a preview restored its inventory route, but the preview bridge
  waited exclusively for the dashboard. It now waits for the authenticated
  application shell before navigating to the requested preview route.

## Remaining scope and release status

This is a locally verified implementation. No release was published or installed,
and neither production nor the manual sandbox database was used by these checks.

Silent real-time household updates and recipe/inventory/shopping integration
remain later phases of the original request. Recipe quantities missing from
source data must remain unknown rather than being invented.

The build reports a large application bundle warning. Backend tests report
existing Alembic and Starlette dependency deprecation warnings. None prevented
the checks from passing.
