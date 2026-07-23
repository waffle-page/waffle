# Contributing to Waffle

Thanks for wanting to help. Two documents govern everything here:

- **`docs/08-code-conventions.md`** — the legibility SLO, the dependency budget, the quarantine list. Read it before your first PR; changes are reviewed against it, not against taste.
- **`docs/03-adr.md`** — the load-bearing decisions. If your change fights an ADR, open an issue first; don't ship a workaround.

## Ground rules

- **Zero new dependencies by default.** Every package is a thing the next contributor must learn. A new dependency needs a one-line justification in the PR; prefer 30 lines of our own code over a 30 kB package.
- **Tokens only, no raw colors.** A hex literal in a component is a review-blocker (`packages/ui/src/tokens.css`).
- **Extension seams have recipes.** Adding a renderer or a property type follows `docs/recipes/`; if your PR changes a seam, update its recipe in the same PR.
- **SQL is the query language.** No ORM.

## Developer Certificate of Origin (DCO)

All contributions must be signed off, certifying the [Developer Certificate of Origin 1.1](https://developercertificate.org/):

```bash
git commit -s -m "…"
```

This adds a `Signed-off-by:` line matching your commit author identity. PRs with unsigned commits cannot be merged.

## Dev setup

```bash
pnpm install
pnpm dev          # app at localhost:5173; append ?dev for the dev-spine harness
pnpm typecheck    # all packages
pnpm build
```

There is no test framework yet by deliberate omission; verification is typecheck + build + a live exercise of the affected surface. State what you verified in the PR description.
