# KhanehYar 0.7.2 — household response contract repair

Based on published `v0.7.1`, commit
`7c4cd61e6887d084125a184a3782a51019f59522`, in independent branch
`codex/release-0.7.2`. No prior tag or published asset is replaced.

## Confirmed failure

The shared DeepSeek transport required a `transactions` list in every decoded
response. That is the SMS contract, not the household proposal, contextual plan
or contextual report contract. Consequently valid household JSON was rejected
before route-level validation. The API then collapsed the gateway error into a
misleading connection failure. The original route tests replaced the transport
function rather than its HTTP boundary; the installer's paid probes tested SMS.

New tests replace only the official provider's HTTP response. Against the parent
runtime, the SMS test succeeds and all three household success cases fail with
`AI_INVALID_RESULT`. These same cases pass after the repair.

## Scope

The common HTTP transport retains exact Decimal parsing, non-finite rejection,
bounded content, complete-response checks and the fixed approved model/provider.
A generic JSON-object helper feeds each household route's existing strict schema.
The existing SMS entry point retains its `transactions` list and 80-row limit.
No retry, model/provider fallback, financial quota or inference allowance is added.

Recognized gateway failures select only existing local editable messages and safe
codes. Unknown/malformed errors and remote prose never become application copy.
No user content, key or provider response is added to diagnostics.

Gateway candidate preflight now exercises the actual image's transport and all
four route schemas with fictional HTTP responses, using `--network none`, no
private environment and no published port, before paid verification or activation.
The existing two synthetic SMS installation probes remain billable.

The full public API-to-gateway-to-parser tests exercise two inferences, read
permitted fixture household context, return grounded food/shopping findings,
verify no business writes, and cover first/second-stage safe failures without retry.
They run against disposable PostgreSQL and fictional HTTP, not real DeepSeek.

## Patch installation

This package upgrades only the exact verified 0.7.1 API/PWA on existing
`0034_assistant_receipts`, or resumes the exact 0.7.2 version. It refuses unknown
sources and the pre-receipt schema. No Alembic file changes and no migration is
invoked; the receipt table, its data and tenant/member RLS remain unchanged.

The official installer retains consistent database/upload/PWA/configuration
backups. It upgrades the gateway before API downtime and preserves its `.env`
byte-for-byte. A code-only failure restores previous API settings/PWA and restarts
only a source/schema pair that passes the read-only checker; otherwise it stays
off for explicit review. It never restores or downgrades a database automatically.

UI, navigation, the independent left purple assistant button, inventory/meal/
shopping calculations, confirmation/receipt flows, SMS prompts and existing
transaction/account contracts are unchanged from 0.7.1.

## Evidence boundaries

Exact evidence and hashes are in `validation.json`. Local HTTP simulations and
COPY-only tests are not real provider responses or actual Docker execution.
The local Docker daemon was unavailable; the installer verifies the actual server
image offline. At preparation, independent public checks and the owner's console
showed 0.7.1 installed, but the owner's real household submission failed.

Publication, installation, protocol readiness and verified real household
inference are separate milestones. Do not declare the last one complete based
only on capabilities or synthetic tests. After installation, verify public
`version.json` and inspect one owner-submitted household response before any
optional confirmed business action.
