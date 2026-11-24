# Navigation and page shell — job 2

Approved direction: preserve the existing Persian RTL appearance and lightweight router; use browser history for actual route visits, not a second route stack. Back buttons and browser Back consume the same history, with dialogs/subpages first. Direct-entry routes seed their logical parent. Navigation is scoped to the signed-in member and family.

Visited pages stay mounted only within that scope, preserving filters, selections and unsaved forms without automatic writes. Inactive pages are hidden/inert, have no visible portals or active Back guards, and restore their main-content scroll position on return. Restricted/offline mode must discard inaccessible cached pages, not leak previously accessible data.

A shared AppPage keeps the existing page header outside one main scroll region, inserts the Back control at a consistent RTL position, and reserves space for floating navigation and safe areas. The visible viewport controls keyboard layout; floating navigation hides during text editing. Modal scrolling remains separate only while a modal is open.

Exception requested by the user: assistant and SMS-entry text boxes reopen empty. SMS inbox records and pending financial review drafts are not deleted. Assistant operation identities with uncertain outcomes remain recoverable, while conversational text/results are discarded.

Verification: asynchronous router/guard unit tests; full existing frontend tests and copy coverage; isolated Copy Studio browser checks for real Back/Forward, deep entry, cached filters/forms/scroll, all module headers, overlays and simulated keyboard viewport. No production API, database, deployment or APK changes in this job.

## Retained overlays

An open Modal or JalaliDatePicker keeps its child tree mounted in a stable portal container. While its owning page is inactive, that container is detached from the document and its global listeners/Back guard are unregistered. Returning reattaches the same tree rather than recreating date input, picker or form state. Explicitly closing a modal still unmounts its children.

Back guards retain their original opening order across page activity changes. React registers descendant effects before parent effects on restoration, so ordered registrations are batched before writing history. Portal DOM order and the modal Escape/drag stack use that same opening order; a returned form must not cover its upper sheet or consume Back before it.

The browser regression script checks every one of the 24 main route headers at a 360-pixel viewport, date-picker month retention inside a cached form, and overlapping vehicle detail/edit sheets (including real pointer hit testing and Escape). Its launcher is fixture-only and rejects external requests; do not replace it with a normal development server.

AppPage snapshots scroll when activity changes, before React hides its DOM. Relying only on the browser's asynchronous scroll event loses the position when navigation happens immediately after scrolling. A regression performs scroll and route navigation within one JavaScript turn, then checks restoration on Back.
