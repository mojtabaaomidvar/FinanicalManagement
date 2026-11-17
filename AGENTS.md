# Project instructions

Keep the existing React/TypeScript, Persian RTL UI and FastAPI architecture. Preserve unrelated workspace changes and manual sandbox data.

## Editable application copy

All fixed user-facing application text must remain discoverable in the local copy editor, including empty states, loading, errors, validation, notifications, accessibility labels and display fallbacks. User content, field values stored by forms, route keys, identifiers, comparisons, parser constants and calculation units remain separate from display text.

Read `docs/copy-workbench.md` before changing the copy editor or adding unusual text-rendering paths. Ordinary JSX text and clearly named display labels are extracted automatically from new source files. For an unusual display-only literal/template, use a unique stable `@copy-text` annotation immediately before that literal. Keep its identifier unchanged when editing, moving or translating the text. Do not annotate stored values or internal contracts as display text.

Keep dynamic values and template expressions intact. An editable text slot must remain editable after replacing its wording with English or an empty string. Preserve source metadata used by the copy preview; do not implement unrestricted global string replacement over user data.

For a new feature, run `npm run copy:studio:coverage` and relevant tests. Check that its visible texts appear in the editor, including failure/empty/loading states. When changing extraction, applying source edits or preview picking, run `npm run copy:studio:test` and the relevant browser check. Use `npm run copy:studio` for the editor and `npm run sandbox:refresh` to update the isolated manual app after source text edits.

The copy preview uses in-memory fixture data on port 5701. The manual sandbox uses port 5700 and its own local database. Follow their launchers; avoid the ordinary development server for sandbox checks because its default proxy can target the production backend.
