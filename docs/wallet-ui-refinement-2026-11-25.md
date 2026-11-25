# Wallet UI refinement

## Approved scope

- Keep the existing Persian RTL React interface and exact-money/API contracts.
- Hide transaction/correction buttons on wallet overview cards. Touching the
  card, its masked number, or activating it by keyboard opens account actions.
- Keep account editing, transaction scope, navigation state and existing grants.
- Use restrained bank-specific color and local catalog logos, not photographs
  of a particular physical card. Unknown, ambiguous or contradictory metadata
  uses the neutral appearance. Never send a card number to an image service.
- Remove the explanatory paragraph above the wealth chart and the redundant
  reconciliation breakdown next to individual wallet balances. Chart calculations
  and the distinction expressed by its accessibility label remain unchanged.
- The initial correction form puts both explicit correction modes and their
  explanations above target balance. Review remains mandatory; Back preserves the
  selected mode. Keep limits, fresh revisions, same-ID recovery and immutable receipts.
- Display a compact success/history view without before/after/delta figures.
  Previous correction history remains separately accessible from account actions;
  removing visible figures does not remove or modify the stored audit data.
- Keep the first transaction line single-line with a separate first-name label;
  a details sheet preserves the entire authored description and transfer evidence.
  Date/time alone occupy line two; full amount and unit occupy the left of line three.
- Move Refresh inside the bank-accounts card, opposite its title. Interpolate the
  actual chart samples monotonically without averaging or inventing extrema.
- Unit labels switch the member's private display preference globally. In-flight
  requests are serialized and identity-guarded; errors roll back the display.
  Each form retains an independent input unit, with exact conversion only when
  its own unit control is clicked. Stored toman values remain unchanged.

## Local bank assets

`scripts/fetch-bank-logos.mjs` vendors all 37 catalog PNG logos from commit
`eaaa56ee8a9a777271bc375df100182aab44558d` of `mehrnet/IranianBanks`. Each file
is checked against its pinned Git blob hash and bounded PNG dimensions. Modified
existing files are not overwritten. The MIT notice is retained with the local
assets in `public/bank-logos/`. Total logo size is 265,811 bytes. Runtime uses
same-origin, precached files only; no new dependency or financial API is added.

## Verification

Unit, source-copy coverage, production build and isolated-fixture browser checks
are run before delivery. Browser checks include card-number and keyboard actions,
the compact initial form, exact corrections, lost-response recovery, immutable
history, account-scoped transactions, retained Back/search/scroll state and
long transaction content at 320/390/768/1280 pixels.

Recorded checks:

- `npm test`: 971 tests passed in 105 files.
- `npm run copy:studio:test`: 139 tests passed.
- `npm run copy:studio:coverage`: 5,133 editable texts; no unregistered display candidates.
- New wallet labels and loading, error, empty and recovery states were explicitly
  checked in the copy catalog.
- `npm run copy:studio:wallet-check`: all 22 isolated browser checks passed,
  including mode-hint separation, form/list amount sizing, immutable history,
  bank themes, read-only access, left-aligned complete transaction amounts,
  retained drafts, global currency persistence, rollback, rapid clicks and
  rejection of a mismatched member response.
- `node scripts/check-financial-contract.mjs`: 3 browser checks passed,
  including preservation of the draft after `CLIENT_UPDATE_REQUIRED`.
- `npm run build`: TypeScript, Vite and PWA build passed. The existing
  large-application-chunk warning remains; no bundle refactor is part of this work.
- All 37 bundled logos were byte-compared with the build and confirmed in the
  service-worker precache.
- `node scripts/check-household-assistant.mjs`: 16 isolated checks passed,
  including English/empty copy metadata and no billed inference or real-data writes.
- `python scripts/test-pwa-release.py`: 25 installer/checker tests cover both
  supported releases, repeated installation, failure rollback, preserved unknown
  files, immutable API/data scope and the existing decimal-v1/CORS/no-store gate.

The manual sandbox is not initialized in this checkout. The Copy Studio launcher
also found port 5701 occupied by another service and did not stop it. Acceptance
uses the existing isolated fixture launcher on an ephemeral loopback port;
screenshots, not an update of someone else's running local server, show this work.

The approved delivery is a new `v0.12.0` PWA-only release. It does not replace the
published `v0.11.0` tag/assets or change the running API, schema, credentials,
encryption keys, uploads, unrelated services or financial/audit records. The
installer matches every old PWA byte before staging and backs up those files.
Publication and server installation are separate outcomes; fixture checks are
not evidence of a completed installation. Physical-phone acceptance remains separate.
