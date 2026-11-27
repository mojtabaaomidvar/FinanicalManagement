# Inventory catalog — approved phase 1

The user approved phase 1 in the preceding «اصلاح بخش های خانه» conversation
and requested implementation here. Keep React/TypeScript, FastAPI/PostgreSQL,
the existing category keys and the encrypted inventory outbox.

## Deliverable

- Keep the packaged catalog as the offline baseline. Publish operator-approved
  additions from a persistent catalog table, with stable identifiers. The
  authenticated catalog API returns only public item metadata.
- Save household inventory immediately. Its anonymous proposal includes only
  name, an existing category and unit. Approval or rejection never modifies
  household quantities, notes or shopping lists.
- Extend the existing support workflow: edit name/category/unit and approve or
  reject. Publish and mark the proposal in one transaction. Normalize duplicate
  names, handle concurrent reviews and retain existing origin/session checks.
- Previous approvals meant “awaiting publication”; keep them unpublished until
  an operator explicitly publishes them through the new workflow.
- Fix pointer/touch selection, infer category/unit from exact known names or
  aliases, require category/unit for new unknown items, expand unit choices and
  display full names. Preserve the current layout and keyboard interactions.

## Verification

- [x] Catalog approval, rejection, editing, privacy, duplicates and rollback on
  a fresh isolated PostgreSQL cluster using the non-superuser application role.
- [x] Existing inventory/offline replay, tenant isolation and support tests.
- [x] Domain matching and repository tests; TypeScript and copy coverage.
- [x] Touch/keyboard/long-name/support review checks in the fixture preview.
- [x] Production build and validation report.

Validation completed on 2026-11-26. See
`docs/inventory-catalog-validation-2026-11-26.md` for commands and results.

## Later phases

The same original request also includes silent real-time household updates and
recipe/inventory/shopping integration. They remain pending. This phase does not
change financial behavior, install a release, modify manual sandbox data, or
guess recipe quantities that are absent from the source material.
