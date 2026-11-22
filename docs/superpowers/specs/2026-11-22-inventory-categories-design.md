# Inventory categories and catalog review

Approved in chat on 2026-11-22. Keep React/TypeScript, Persian RTL, FastAPI/PostgreSQL and the encrypted shopping outbox. Do not commit, publish, or discard unrelated workspace changes.

## Interaction

The main inventory page displays the existing ten section tiles. One expanded section reveals subgroup filters for saved household stock, not catalog suggestions. Search and the all/empty filters remain. A separate uncategorized tile preserves unknown legacy stock.

The add/edit form places a grouped native category selector beside the item name. Suggestions search the full catalog from the first typed character and appear as small wrapping chips in a bounded popup below the name. Picking fills title, unit and subgroup; only form submission saves. A custom title requires a selected subgroup and is stored in that subgroup. Keep the existing palette, font and touch targets.

## Data

Store nullable `category` (stable catalog subgroup key) on inventory rows and carry it through REST, encrypted snapshots, queued writes and optimistic projection. Infer a category for recognizable legacy names/aliases; preserve unknown legacy names without guessing. Preserve existing queued commands and their operation IDs/request hashes.

Remove threshold input, rules, low-stock filters/counts, derived notifications and notification preferences. Drop the threshold column and its constraint in an explicit migration. This irreversible deletion was approved; do not delete stock quantities or notes. Purchase quantity defaults to one editable unit, not a calculated shortage.

## Operator review

When a categorized unknown title is saved, insert a deduplicated proposal in the same transaction as the inventory write/receipt. Store only title, category and unit plus proposal workflow metadata (random ID, content deduplication key, timestamps, status). No household/member linkage, quantity or note. Retries and duplicate submissions must not reopen reviewed proposals.

Use the existing independent support cookie for a paginated pending/approved/rejected queue. Review writes require the trusted Origin and operator authentication; ordinary family admins cannot review. Other support views remain read-only. Approval is review only: it never edits the shared catalog at runtime. A bounded JSON export lets a maintainer review approved entries and merge them into the static catalog for a later release.

Keep a packaged backend catalog snapshot synchronized with the frontend catalog (parity test). No new dynamic catalog endpoint or publishing service.

## Implementation and checks

1. Tests for category matching/filtering, persisted category projection and anonymous proposal deduplication/authentication.
2. Contract/model/migration and transactional proposal insertion; protect historical outbox compatibility.
3. Compact autocomplete, main-page category filters, removal of low-stock UI/notifications.
4. Support queue and reviewed-data export; maintain editable display-copy discovery.
5. Inventory/shopping/offline/notification tests, isolated PostgreSQL tests, TypeScript, copy coverage/workbench tests, mobile/desktop screenshots and sandbox refresh through the approved launcher.

Never run tests against the manual sandbox database; use the launcher's isolated `_test` database configuration. Preserve manual sandbox data except the approved removal of threshold values.
