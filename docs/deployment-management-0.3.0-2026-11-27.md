# Management analytics coordinated upgrade — 27 November 2026

The owner supplied console evidence for PWA `0.12.0`, management `0.2.0`, running API image `khaneyar-api:v0.11.0`, successful `/healthz`, and database revision `0037_wallet_corrections`. The API health version `0.1.0` is its existing package version; it is not the installed PWA version.

This package updates the household API and independent management service/web to support aggregate AI reporting, classified offline counters, runtime controls, Excel reports and configuration import. It keeps the installed PWA, marketing site, APK, private AI gateway, uploads, management configuration, password and TOTP identity. Gateway upgrade remains separate; an old gateway cannot report provider token metadata it does not emit.

## Package and installation boundaries

- Build the management web with `npm run management:build`, then run `python scripts/package-management-analytics.py` in this worktree. Only explicitly collected code and built web assets enter the archive. A private-value scan runs before packaging.
- Archive, manifest, bootstrap and SHA-256 values are under `.local-test/management-analytics-release/`. The bootstrap pins the archive hash and rejects unsafe archive entries and modified retained packages.
- Execute only from the owner's root VNC console. Installation by the agent is not authorized in this continuation; the owner requested short commands to execute personally.
- Existing API dependencies must match the official `v0.11.0` source. The Docker build inherits the exact installed image and replaces reviewed application/migration code; it does not fetch Python dependencies. Source comparisons normalize CRLF/LF only.
- Management source must match the checked `0.2.0` baseline. Existing configuration and runtime flags are preserved. Only the API image/build, runtime-file environment variable and read-only runtime bind mount may change in resolved Compose configuration.

## Data and failure handling

The installer takes the release, management-web and privileged-operation locks. Pending management jobs block installation. It stops management/API, saves private PostgreSQL and management backups, restores the PostgreSQL dump into a uniquely named temporary database, and rehearses the actual migrations there before migrating production. The temporary database is dropped; production data is never restored or downgraded automatically.

Migrations `0038` and `0039` execute within one PostgreSQL transaction. All existing public tables are locked against writes; their row fingerprints, columns, constraints, policies, triggers and privileges must remain identical. New tables start empty. Application privileges are limited to the operations required by the aggregate counter and capacity services; PUBLIC receives none. Existing wallet audit rows and schema are retained.

Before activation, a handled failure restores previous deployment files and services while retaining any committed additive schema. A retained pre-activation journal requires inspection before a new attempt; it is not silently discarded. After activation begins, failures leave API and management stopped, preserve the new database/history and permit resuming the same verified package. Completed installation can be verified again with the same package. Previous hashed management assets remain available to already-open pages.

Runtime probes check API controls, management version/session isolation, anonymous analytics rejection, the independent AI report, unchanged management identity/configuration and the unchanged complete PWA tree. No authenticated family request, synthetic financial write or paid AI call is used for production verification.

## Validation

The release adds isolated PostgreSQL tests for historical-row/schema preservation, atomic rollback between migrations, refusing a partial schema, and rejecting excess application privileges. Installer tests cover source/dependency checks, safe extraction, identity preservation, Compose invariants, backup rehearsal, rollback before activation, service shutdown after activation failure, recovery and repeat execution. Docker/systemd/HTTP are explicit doubles in the filesystem lifecycle tests; PostgreSQL migration tests use a new native cluster.

Linux Docker/systemd execution and production acceptance are not claimed by the local Windows tests. The package is intended for the owner's reviewed manual console installation, with its own restore rehearsal and preflight before activation. Test counts and published checksums belong in the accompanying validation record; package publication is not evidence of installation.

## Read-only preflight diagnostic

The owner's first console attempt verified both download checksums but stopped before the first numbered installation phase. The generic exception message did not identify the failing check. The original installer/archive remain unchanged. The separate `diagnose.py` asset is generated from `backend/deploy/management/diagnose-analytics.py` and is verified with its own SHA-256 before execution.

The diagnostic pins the original manifest, checks bundle/configuration/runtime/source versions and pending jobs, reads service status and executes only source comparisons and a read-only database transaction in the existing API container. It does not call the installer's `main`, `preflight` or `apply`, create an installation journal, alter configuration, stop/start services or run migrations. Reports contain check names, booleans, version strings and at most three differing code-file paths; private configuration and source contents are withheld. Three additional isolated filesystem tests verify corrupt-manifest rejection, extra-file detection, successful baseline checks, source drift reporting and unchanged files before/after diagnosis.
