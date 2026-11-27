# Silent household updates — continuation of the approved design

The original request and the 2026-11-26 continuation authorize completing the
remaining household work before installation. Keep React/FastAPI/PostgreSQL,
the encrypted outbox and existing authorization rules.

## Household updates

- A PostgreSQL trigger emits a family identifier after a committed business
  change. No record identifiers, titles, amounts or private content enter it.
- One listener per API process distributes invalidations to authorized streams.
  Every stream derives its family from the bearer session, checks continued
  membership and expires periodically. No bearer is placed in URLs.
- The client rereads existing authorized endpoints, coalesces bursts, reconnects
  silently and refreshes after reconnect/focus. Existing outbox changes remain
  intact. Unmounted or changed identities cannot accept earlier responses.
- Remove all visible synchronization status as explicitly selected in the
  previous conversation. Keep business reminders and installation updates.
- Reload open modules without resetting forms or navigating away.

## Food/inventory work to follow

Keep breakfast, lunch, dinner and snacks in that order. Resolve ingredients to
stable catalog identities with exact normalized aliases or explicit links,
never fuzzy name similarity. Show each ingredient's stock state. Recheck at
final save and resolve every missing ingredient independently before committing
the meal and any shopping additions together. Cancellation makes no writes.
Inventory is never automatically consumed or increased.

The previous conversation explicitly selected presence-only checks for recipes
without amounts; require user-entered quantity/unit when adding those to
shopping. Do not invent recipe amounts.

## Verification

Use disposable PostgreSQL and restricted application credentials to verify
commit/rollback, cross-process delivery, tenant isolation and session revocation.
Exercise reconnect/coalescing/cleanup, preserve unsent offline edits, and check
two browser views update without sync messages. Complete domain, copy coverage,
TypeScript and production build checks before preparing installation.
