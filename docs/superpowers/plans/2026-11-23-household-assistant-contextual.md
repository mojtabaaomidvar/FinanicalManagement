# Contextual household assistant — local implementation plan

Approved design: `docs/superpowers/specs/2026-11-23-household-assistant-contextual-design.md`.
Keep React/TypeScript, Persian RTL, FastAPI, existing purple controls and all unrelated work.
No live gateway install, publishing, billed inference, or migration of the manual database.

1. Add bounded version-two planning/report contracts; retain the SMS protocol and legacy extraction for compatibility. Verify synthetic gateway validation and exact nginx/package boundaries.
2. Add read-only context adapters using existing authorized service projections. Bound dates, fields and row counts; expose unavailable/unknown/truncated states. Compute ingredient sufficiency locally and never infer prices.
3. Add signed review preparation and tenant/member-bound action receipts. Reuse small uncommitted creation helpers; test confirmation, conflicts, double clicks and lost-response replay in fresh PostgreSQL.
4. Replace the home entry with floating-only access. Render sources, computed findings, alternatives and an inline explicit review. Keep financial confirmation in its existing form; preserve identity and late-response guards.
5. Update fixture semantics and browser assertions. Test bread zero/missing/conflicting, sufficient/insufficient ingredients, duplicate shopping, option selection, confirmation and offline failures without writing manual data.
6. Run frontend/typecheck/build, backend/gateway/installer/migration regressions, copy coverage/tests and visual mobile/desktop/dark review. Document only verified outcomes and compare the read-only manual baseline.

## Progress — 2026-11-23

- [x] Version-two planning/report contracts, exact gateway routes and compatibility checks.
- [x] Authorized sanitized section projections, ingredient facts and explicit coverage states.
- [x] Signed 15-minute reports/reviews, current dependency checks and atomic scoped receipts.
- [x] Floating-only purple access, direct text/Send, inline review and existing financial-form handoff.
- [x] Encrypted pending-operation persistence, reload recovery, no reconnect submission and storage-failure guard.
- [x] Synthetic fixture semantics and 14 browser scenarios, including reload receipt recovery and proxy timeouts after execution.
- [x] Frontend: 731 tests / 89 files; TypeScript/PWA build passed.
- [x] Copy Studio: 127 tests; latest coverage 5161 texts, no unregistered display candidates.
- [x] Gateway/installer/package regressions: 143 tests; contextual Ruff clean.
- [x] Read-only manual baseline comparison unchanged; manual PostgreSQL stopped again.
- [x] Earlier isolated PostgreSQL rerun completed successfully; its temporary database stopped.
- [x] Final isolated PostgreSQL rerun passed all 392 backend/gateway regressions, including later membership/concurrency/privacy/budget checks; temporary PostgreSQL stopped.
- [x] Read and review fresh 360px opening/report/exact-review/recovery and 1440px dark screenshots.
- [x] Final frontend rerun after the proxy-timeout guard: 731 tests passed; TypeScript/PWA/service-worker build and 5161-text coverage passed.
- [x] Final browser run passed all 14 scenarios, with no external requests, billed inference or manual writes.
- [x] Build and verify the local contextual-v2 archive: 19 allowlisted files match source bytes, no private config; SHA-256 `968eb46597ea74f32e28aee3c0cb6cbb72ad97a65eb1f1da9265cc8790779e61`.

No gateway installation, publishing, manual database migration, port reservation change or live inference.

Local implementation and verification complete. Consolidated evidence:
`.local-test/household-assistant/verification.json` and `docs/household-assistant.md`.
Live activation remains separately gated on gateway installation and manual migration authorization.
