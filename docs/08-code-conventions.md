# Code Conventions

The standing order: **any competent TS developer arriving cold must become productive in a day.** Simplicity here is a budget, enforced — not a vibe. 80% of the codebase is boring on purpose; the irreducible 20% is quarantined.

## The legibility SLO

1. A new developer can trace "user hits save" → "row in SQLite" in one sitting.
2. A new developer can ship a new renderer on day one, a new property type in week one, a new connector in week two — each via a written recipe, not archaeology.
3. If a change breaks either of the above, the change is wrong — redesign it.

## Simple by construction

- **Boring stack**: React, TypeScript, SQLite, mainstream libraries. Nothing bespoke where standard exists.
- **SQL is the query language.** Views and widgets are readable queries, not ORM incantations. No ORM.
- **One shape per concept**: one `toppings` table (no type hierarchies); every layout = one file with the `(rows, view) → props` signature; every connector = the same small interface.
- **Platform code lives only in adapters** (`fs / db / net / share`). Everything above them is pure TS, runnable in a plain test.
- **Tokens only, no raw colors.** Components reference semantic CSS custom properties (`--bg`, `--accent`, …) exclusively; a hex/rgb literal in a component is a review-blocker. This is what makes user-configurable themes free (see 02-architecture.md → Theming).
- **Types are documentation.** Interfaces stay small, named in domain language (topping, view, grant, dataset), colocated with what they describe.

## The quarantine list (irreducibly complex — fence it)

File watching + hash re-association · shared-folder sync (LWW, tombstones) · sandbox RPC bridge · CodeMirror wiring · virtualized masonry.

Rules for these modules: keep each in **one small directory**; header comment states *why it is hairy* and the invariants it protects; tests double as the spec; no application logic inside — they expose a plain interface and the rest of the app never knows the pain.

## Anti-entropy rules

- **No premature abstraction.** Duplicate twice; abstract on the third occurrence. Delete the abstraction if it drops back to one caller.
- **Dependency budget.** Every package is a thing the next coder must learn. Additions need a one-line justification in the PR; prefer 30 lines of our own code over a 30kB dependency.
- **Small files, flat structure.** No barrel-file sprawl, no `utils.ts` dumping grounds; a file is findable by what it's named.
- **Recipes over patterns.** `docs/recipes/` holds the how-to for each extension seam (add-a-renderer, add-a-connector, add-a-property-type). Recipes are updated in the same PR that changes a seam.
- **Comments state constraints, not narration.** Write *why this can't be the obvious way*, never *what the next line does*.
- **Musk step 2 applies to code review**: before optimizing or abstracting, ask if the thing should exist. Delete > simplify > optimize, in that order.

## Why this also matters for velocity

Code that is simple for the next human is the code AI agents navigate fastest. The legibility SLO is simultaneously the maintainability contract and the build-speed multiplier.
