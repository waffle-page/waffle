# Agent instructions

Read **`CLAUDE.md`** at this repo's root before writing any code. It is the
binding working contract for ALL agents and humans here — read order,
invariants, verification discipline, current position, and the agreed next
steps. Everything in it applies to you regardless of which assistant you are.

The three rules most often broken by newcomers, restated:

1. **One write loop.** Files are canonical; SQLite is a disposable mirror.
   Every mutation goes: write the vault file → `rescanFile` → requery. Never
   write the index tables directly.
2. **User files are sacred.** Deletes are soft (`.trash/`); the Obsidian sync
   FREEZES rather than write anything it can't express into a user's `.base`.
3. **Verify live.** No test framework exists by design. Verification is
   `pnpm -r typecheck` + `pnpm -C apps/web build` + actually exercising the
   changed surface in a browser, stated in the commit body. Commits are
   signed off (`git commit -s`).
