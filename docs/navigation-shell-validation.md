# Navigation and page shell — local validation

Date: 2026-11-24. Branch: `codex/navigation-shell`, based on `80b22fb` (`v0.9.0`). Job-two implementation and local acceptance are complete. Release `0.10.0` is separately approved for publication and PWA-only server installation; its preparation is described in `docs/deployment-0.10.0-2026-11-24.md`. This report is not proof of publication or installation.

## Completed checks

| Check | Result |
| --- | --- |
| `npm test -- --reporter=json --outputFile=.local-test/navigation-shell/frontend-tests.json` | 817 passed, 0 failed |
| `npm run copy:studio:test` | 130 passed, 0 failed |
| `npm run build` | TypeScript, Vite and PWA build passed |
| Build-time `npm run copy:studio:coverage` | 4,990 editable UI texts; no unregistered display candidates |
| `git diff --check` | Passed |
| `npm run copy:studio:navigation-check` (no `NAV_CHECK` filter) | 15 isolated browser checks passed; all 24 route headers covered |
| `npm run copy:studio:assistant-check` | 16 isolated browser checks passed |
| `npm run copy:studio:finance-integrity-check` | 10 isolated browser checks passed |

All three browser result files report zero errors and zero external requests. Navigation captured 28 screenshots, financial integrity 5 and the contextual assistant 12. Local automated acceptance is complete; physical-device acceptance remains as described below.

All listed frontend, copy, build and browser checks passed again with `package.json` at `0.10.0` and explicit public build origins. Release logs are under `.local-test/release-v0.10.0/`. The PWA-only checker/installer passed 11 standard-library tests, including seven isolated failure paths and idempotent repetition; database or real server commands were not used in those tests. Before packaging, all 285 public files of active `0.9.0` matched the official release manifest.

## Continuation fixes and regression evidence

- An inactive Modal previously returned `null`, unmounting its date input and losing the nested picker. Stable detached portal containers now retain those children while removing inactive overlays from the document.
- Restored guard registrations, portal DOM order and modal Escape/drag ownership retain original opening order. Tests verify picker-month retention, top-layer-only Back and overlapping vehicle sheet hit testing/Escape without implicit saves.
- AppPage snapshots outgoing scroll before the DOM is hidden. The added rapid-navigation case changes scroll and navigates within the same JavaScript turn; all three restoration positions pass without waiting for a scroll event.
- The expanded run exposed an invalid Settings scroll assertion: clicking the top profile row first scrolled the list to zero. Click-event diagnostics confirmed that the browser had already changed the position before opening the subpage. The test now checks nonzero subpage scroll using the family row and the actual click-time position, then checks profile draft retention separately.
- Contextual-assistant checks cover closing/reopening during held analysis and confirmed execution, durable uncertain-operation recovery, and no unintended resubmission. Financial checks retain SMS review drafts and atomic-retry identities despite empty entry text on reopening.

## Scope and limitations

- Browser suites use `createWorkbench({ port: 0 })` with in-memory fictional data. External HTTP(S) requests are blocked. They do not use the production proxy or the manual sandbox database.
- Navigation checks cover actual Back/Forward, logical direct-entry parents, retained searches/forms/scroll, all 24 main route headers at 360 pixels, inactive overlays, nested picker state, layered vehicle sheets, offline eviction, and assistant/SMS input reset exceptions.
- Keyboard checks simulate `visualViewport`; physical Android/iOS keyboard, gesture Back and installed-PWA behavior still need device acceptance. This is not a claim of real-device verification.
- The build retains the existing large-bundle warning (the main application chunk exceeds 500 kB). Bundle splitting is outside job 2.
- Evidence is under `.local-test/navigation-shell/`, `.local-test/finance-integrity/` and `.local-test/household-assistant/`. Old `failure-*.json`/screenshots remain as diagnostics; the final `results.json` in each directory is the current acceptance record.
