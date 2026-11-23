# KhanehYar 0.7.1 — gateway image packaging repair

This patch is based on published `v0.7.0`, commit
`aab2213b1984f2600ed9ac50371f388b77d34e91`, in the independent branch
`codex/release-0.7.1`. The published `v0.7.0` tag and assets are not replaced.

## Confirmed defect and correction

The 0.7.0 gateway application imports `app.services.household_ai_protocol`, but
its Dockerfile omitted that file from the image's COPY instructions. The allowlisted
archive contained the file, which meant source-level tests passed while the actual
container could not import the application or checker. The owner reproduced
`ModuleNotFoundError: No module named 'app.services.household_ai_protocol'` in
an isolated, network-disabled container on the server. The old 0.6.0 API and managed
gateway remained running; the receipt migration was not reached in that failed run.

The correction copies this one database-free protocol module into the image. New
tests reconstruct only Dockerfile COPY contents and import the application/checker
in an isolated interpreter, then verify authentication, protocol v2 capabilities
and invalid input without external network. A new installer check performs actual
image imports using `docker run --network none`, no private environment and no
ports, before any synthetic inference or live gateway activation.

The parent shell reports a stopped gateway upgrade without invoking Ubuntu's
secondary exception reporter. All gateway settings, rollback and concurrency checks
are retained. No new inference retries, provider/model fallback or billing quotas
are introduced. The existing two synthetic SMS probes remain billable, but missing
image modules now fail before either probe.

## Unchanged application and data contracts

All `backend/app`, Alembic migrations, `src`, application copy, copy fixtures, SMS
contracts, shopping checkout, navigation and purple assistant UI are byte-identical
to 0.7.0. Only version metadata, gateway packaging/preflight, installer version
checks, regression tests and release documentation change.

This package installs on the verified live 0.6.0 baseline. As in 0.7.0 it adds only
`0034_assistant_receipts` after `0033_inventory_categories`, with backups, an atomic
before/after check of every existing table and forced tenant/member RLS. There is no
new database revision relative to 0.7.0 and no backfill or business-data change.
Unknown source/PWA/schema combinations are still refused.

## Evidence and installation status

Exact patch evidence and hashes are recorded in the release's `validation.json`.
Local COPY-only tests are not described as actual Docker execution: the local
Docker daemon was unavailable. The production installer verifies the actual new
image offline before using the key or switching the live gateway.

Publication is not installation. Before preparing this patch, the public PWA
still reported 0.6.0; the owner showed the old API and healthy gateway/database.
The owner's non-mutating authenticated model-list check returned HTTP 200 and
confirmed the approved configured model. No real household inference or business
write is claimed by these checks.

Use the checksum-pinned installer from the 0.7.1 release. Capture its output in a
private `/root` log so the VNC console need not scroll, and inspect the final result
before retrying. Verify public `version.json` is 0.7.1 and protocol v2 readiness
after `RELEASE INSTALLED: v0.7.1`. Keep 0.7.0 artifacts as historical evidence.
