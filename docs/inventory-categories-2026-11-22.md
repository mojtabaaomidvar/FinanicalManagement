# Inventory categories and anonymous catalog review

Implemented the approved design in `docs/superpowers/specs/2026-11-22-inventory-categories-design.md`. This supersedes the previous inventory refresh's shortage-threshold behavior. Changes remain uncommitted and unpublished.

## Delivered behavior

- Ten main-page category tiles reveal subgroup filters for saved household inventory. Recognizable legacy names/aliases receive a subgroup; unknown legacy names remain uncategorized without renaming them.
- The add/edit sheet has a grouped native category selector beside the item name. Compact suggestions wrap below the name, search the full catalog and fill title, unit and subgroup. Picking a suggestion or pressing Enter in the name does not save. Quantity and unit remain editable.
- Categories persist through REST, encrypted snapshots, optimistic projection and queued mutations. Historical queued operation IDs, original payloads and receipt hashes remain intact; the retired threshold is ignored only during validation of historical offline inventory writes.
- Migration `0033` removes the threshold constraint and column, backfills recognizable categories and creates the proposal queue. Inventory RLS remains enabled and forced. Deleted threshold values cannot be recovered by a downgrade.
- Empty stock, actual quantities, relative consumption/increases and inventory-linked shopping remain. Purchase quantity starts at one editable unit, not a calculated shortage. Inventory no longer creates low-stock counts, filters or notifications.
- Unknown categorized items produce deduplicated proposals in the same transaction as their inventory write. Support receives title, subgroup and unit plus workflow metadata, not stock quantity, note, household ID or member ID. Failed transactions roll back both inventory and proposals.
- The independent operator-cookie support panel can review pending proposals and export approved entries from the current page. Writes require the trusted Origin. Approval does not publish or modify the static catalog; maintainer review and a later release are still required.
- Copy-preview fixtures cover the support queue's review, empty, loading, read/write error and conflict states. All 39 section/subgroup labels remain extractable after English and empty-string edits, with category keys unchanged.

## Verification

| Check | Result |
| --- | --- |
| `npx tsc -b --pretty false` | Passed |
| Relevant inventory/shopping/offline/home/notification/support Vitest files | 156 tests across 16 files passed |
| Selected PostgreSQL inventory/catalog/shopping/offline/concurrency/support/checkout/RLS tests | 177 tests passed, with one unrelated classification test excluded after its failure was observed |
| `npm run copy:studio:test` | 122 tests passed |
| `npm run copy:studio:coverage` | 4,893 editable UI texts; no unregistered display candidates |
| `npm run copy:studio:inventory-categories-check` | Chrome checks passed at 360 px and 1,440 px; explicit save, wrapping suggestions, subgroup filtering, category reload, support review/export and empty/error/loading states |
| `npm run copy:studio:inventory-check` | Firefox checks passed: validation, custom unit/category, empty/search/category filters, fractional adjustments, linked purchases, editable/empty unit labels and offline reconnection |
| `npm run sandbox:refresh` | Passed; updated build served at `http://127.0.0.1:5700` |
| Served asset verification | All seven emitted JavaScript/CSS assets matched the refreshed build byte for byte |
| Read-only sandbox fingerprints around refresh | Inventory, shopping, finance and household records unchanged |
| `npm run sandbox:check` | Passed; its disposable checks were removed and manual records preserved |

The PostgreSQL run used `khaneyar_inventory_test`, not the manual sandbox database. API tests ran with the non-superuser application role; schema migrations and cleanup used the local migration administrator. The seeded legacy-migration test ran inside a disposable schema and rolled back the entire schema transaction.

The excluded failure is `tests/test_rls_database.py::test_every_family_id_table_is_classified`: the existing classification list does not include `household_setups` and `household_setup_receipts` from the concurrent onboarding work. Those tables and that unrelated test were not changed to make this task pass. This is not a claim that the full backend suite is green.

## Re-running browser checks

Start the isolated preview with `npm run copy:studio -- -NoOpen`, then run:

```powershell
npm run copy:studio:inventory-categories-check
npm run copy:studio:inventory-check
```

The Firefox check needs Firefox and Selenium in the selected Python environment. For this verification, Selenium was installed in an isolated temporary tools directory rather than added to application dependencies. Screenshots are under `.local-test/inventory-categories/` and `.local-test/inventory-refresh/`. Both browser checks use fictional preview data on port 5701, not manual sandbox data or a production backend.

Recipe preparation remains separate: the retained software-ready output is `غذا/processed/recipes.json`; this inventory change does not claim to import recipes into the running meal planner.
