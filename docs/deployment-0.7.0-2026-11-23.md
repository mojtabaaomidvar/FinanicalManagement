# KhanehYar 0.7.0 — contextual household assistant

The owner approved an official release through the existing version-control system
on 2026-11-23. This is a new-feature release based on official `v0.6.0`, commit
`0faa080f7c272e4b3842d19f57ed1e10d56ab992`, on the independent branch
`codex/release-0.7.0`. The dirty development workspace is not the release source.

## Scope

- One independent purple button, physically left of the unchanged three-item
  floating navigation, opens free text and the Send button directly.
- Relevant permitted household records ground the report. Zero stock, absent
  records, incompatible units, limited coverage and conflicting statements remain
  distinct. Planning to buy food is not an incurred expense.
- Each proposed write collects its required fields, presents an exact signed
  review and requires explicit confirmation. Shopping lists/items, tasks and
  existing dishes in empty meal slots have atomic tenant/member-bound receipts.
- Execution and receipt recovery require no model inference. A submission uses at
  most two inferences. Reconnection never automatically submits or executes.
- Financial suggestions enter the existing financial form. The released SMS
  import UI/API, shopping checkout, account contracts and onboarding stay intact.
- Bounded relevant projections exclude full snapshots, private identifiers,
  credentials, images, PDFs and file content. The owner's existing DeepSeek key
  stays in the separate private gateway. `deepseek-flash`, no inference retries or
  fallback, and no financial caps/daily cost quotas are retained.

## Dependencies selected from development

The assistant API/services/UI/contracts and encrypted client recovery are new.
Shopping list/item creation exposes existing validation and row construction
without committing, so the assistant can commit the entity and receipt together;
the released public create endpoints still commit normally. Checkout is unchanged.
The existing meal service exposes its create-row operation without committing so
the confirmed meal and receipt share one transaction; its existing public endpoint
still commits normally. The market helper only projects the existing cache and
never starts an upstream price request. The shared account-masking helper accepts
the official Account model without unreleased `account_number`/`iban` columns.

No unfinished SMS/account/onboarding migrations `0030`–`0032`, independent checkout
redesign or unrelated financial work are selected. The official lineage is:

```text
0029 → 0033_inventory_categories → 0034_assistant_receipts
```

The additive migration creates only `assistant_execution_receipts`, forces family
and member RLS, grants the existing restricted API role access, and hashes every
existing table before/after inside the same transaction. A mismatch rolls back the
entire transaction. No household record is backfilled or changed.

## Package and installation are separate

Official release location:
https://github.com/mojtabaaomidvar/FinanicalManagement/releases/tag/v0.7.0

The release contains `khaneyar-v0.7.0.tgz`, `install.sh`, `validation.json` and
`SHA256SUMS`. The archive contains committed source, the production PWA, and the
19-file allowlisted private-gateway code archive, but no private `.env`, database,
uploads, local fixtures or credentials. `validation.json` records the exact source
commit, tests, migration lineage and runtime/PWA/gateway hashes.

`backend/deploy/install-assistant-release.sh` derives from the existing verified
inventory-release installer. It refuses unknown installed source/PWA/schema,
builds before downtime, and upgrades the existing managed gateway with its own
backup/rollback while preserving the gateway `.env` bytes. The gateway's existing
two synthetic SMS diagnostics are billable; contextual auth/capability/invalid-input
diagnostics do not call the model or send household records.

The main installer then stops the API, backs up the database/uploads/PWA/private
settings, preserves document encryption and signing keys, connects the API to the
existing private token without copying the DeepSeek key, applies the transactional
migration, and verifies exact runtime hashes and gateway protocol v2 readiness.
No production business write is used as an installation health check.

A pre-migration failure restores the previous API/settings. After a migration
attempt it fails closed with the API stopped, retains backups, and requires an
explicit retry; it never restores the database or downgrades automatically.

**Production installation is not claimed by publication.** The active official PWA
was read-only verified as `0.6.0` before packaging; all 26 public files matched its
official artifact. SSH to the configured server timed out. Run the checksum-pinned
installer in the server VNC console and retain its final result before describing
`0.7.0` as installed. Verify https://pwa.khaanehyar.ir/version.json afterward.

## Verification evidence

- Exact-release frontend: 727 tests across 88 files.
- Copy Studio: 127 tests; 4886 editable display texts, no unregistered candidates.
- TypeScript, production PWA and service worker build passed. Existing chunk-size
  warnings remain; no performance improvement is claimed.
- Fourteen exact-source in-memory browser scenarios passed with external network
  blocked, no billed inference, source apply or manual-data writes.
- Backend/gateway and migration/configuration checks use disposable PostgreSQL
  clusters and fictional inference. Counts and scopes are recorded in the release
  manifest, not inferred from the dirty workspace's earlier results.
- Fifteen installer-contract checks passed without running production commands.

The earlier local implementation report in `docs/household-assistant.md` is
historical development evidence, not a production installation record. Manual
sandbox records and reserved Windows ports remain untouched.
