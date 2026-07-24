# Status & Ratings

The personal-marks layer: per-user status ("reading", "want to go") and ratings on anything saveable — replicating Goodreads, IMDb watchlists, and Google Maps want-to-go/been, generalized across all domains. Three strictly separated layers, because conflating them is how products corrupt their own data.

## The three layers

| Layer | What | Ownership | Visibility |
| --- | --- | --- | --- |
| **Source rating** | Extracted at save/refresh from the page (Amazon stars, IMDb score, Google rating), client-side | Fact about the entity | Shared — part of catalog payload + local properties |
| **Personal interaction** | Your status + your rating + optional note/dates | Per-user × per-entity | **Private, always** — never syncs into shared folders; each member sees only their own overlay |
| **Waffle community rating** | Aggregate of users' personal ratings on a catalog entity | The network's | Public, k-thresholded aggregate (P3) |

## Decision 1 — Interaction state attaches to the *entity*, not the topping

`(owner, entity)` → `{status, rating}`, keyed by URL identity (`url_hash`,
later `entity_id`), **not** by topping id. Consequences, all deliberate:

- Two toppings resolved to the same entity show one status — no split-brain
  shelves.
- You can rate or queue something you've *never saved* (rate straight from the discovery feed, like rating a film on IMDb without listing it).
- In shared folders, each member's overlay is their own: Marta's "been", your "want to go", on the same place topping — exactly Google Maps shared-list semantics.
- The v1 entity key for a link hashes the trimmed URL string through one shared
  helper at mark time and scan time.
  (`toppings.content_hash` is NOT that hash — it is file-byte identity for the
  scanner's move re-association; a vault link's hash covers its `.url` carrier
  file.) This is an implementation bridge, not the final product identity:
  URL variants still split today.

## Decision 1a — Saved URLs are aliases, not entity identity

A user's `.url` file preserves the exact address they saved. Identity is a
separate derived layer:

```text
raw saved URL → normalized alias → provider identity → local entity
                                      └──────────────→ personal marks
```

The required behavior is explicit: two Google Maps URLs for the same Place
must show the same personal status and rating even when their host, path,
tracking/session parameters, or short-link form differ.

- Normalization is versioned, local, and performed on add/rescan—not in a
  renderer. Generic rules may normalize syntax and remove an allowlist of known
  tracking parameters; they must never discard every unknown query parameter.
- Provider adapters extract high-confidence stable keys when available (for
  example a Google Maps Place ID or CID). Coordinates or similar names alone
  are insufficient evidence to merge places.
- Scanning performs no network requests. Redirect resolution and
  `rel=canonical` discovery may run only during an explicit online Add/refresh
  action; an unresolved short link remains a provisional alias.
- Many aliases may resolve to one entity. High-confidence evidence merges
  automatically; ambiguous candidates remain separate until stronger evidence
  or an explicit **Same thing** action exists.
- Raw URLs never change as a side effect of resolution. Deterministic aliases
  must rebuild from files; manual or network-derived aliases require durable
  vault metadata under the identity ADR gate.
- Re-keying must be conflict preserving. If aliases being joined already carry
  different marks for the same owner/status set, neither row is silently
  overwritten; the operation retains both inputs and surfaces a resolution.

This private-library foundation moves before the P1 usability shell. It is not
the later P3 semantic clustering problem: connecting a Maps listing,
TripAdvisor page, and official site can remain catalog/entity-resolution work.
The bounded implementation and acceptance matrix live in
`docs/recipes/verify-url-entity-identity.md`.

## Decision 1b — Multiple status AXES per type (added 2026-07-22)

Some types need more than one exclusive status: a book has a reading status
AND an ownership status (own / borrowed / wishlist); a service has booking
AND vetting. The model: interactions key widens to **(owner, entity,
status_set)** — one slot per set, and a type may bind several sets. This is
Goodreads' actual shape: exclusive shelves = status sets; custom shelves =
tags and Lists (docs/11). Every axis becomes a view filter
(`status[read] = done`, `status[own] = queued`). Ships as a small migration
(v4) with the P1 status UI.

## Decision 2 — Semantic slots under domain vocabularies

Freeform statuses would fragment queries forever. Instead: every status normalizes to one of **four semantic slots** — `queued` (want to), `active` (doing), `done`, `dropped` — while **status sets** provide the domain-flavored labels:

| Set | queued | active | done | dropped | Binds to (default) |
| --- | --- | --- | --- | --- | --- |
| `read` | Want to read | Reading | Read | Abandoned | schema.org `Book`, `Article` |
| `watch` | Watchlist | Watching | Watched | Dropped | `Movie`, `TVSeries` |
| `visit` | Want to go | — | Been | — | `Place`, `Restaurant` |
| `buy` | Want it | — | Bought | Returned | `Product` |
| `do` | To do | Doing | Done | Dropped | fallback |

Bindings resolve by schema.org type first, then by tag (user-assignable: tag `recetas` → a custom `cook` set). Users can define custom sets — it's labels over the same four slots, so no schema change and **cross-domain queries stay universal**: "everything I finished in 2026", one query, every vocabulary. Free features that fall out: an automatic *Queue* smart folder per set ("Reading queue", "Places to go"), year-in-review, streaks.

## Decision 3 — One canonical rating scale

Personal ratings stored as REAL **0–10** (half-steps in UI); display maps to the user's preference (5-star, 10-point, thumbs). Source ratings normalize to 0–10 at extraction with the raw value + original scale + vote count preserved (`{raw: 4.6, scale: 5, count: 1284}`) — the units discipline from `06-schemas-and-units.md` applied to opinion.

## Community ratings (P3, on the catalog)

Contribution rides the existing catalog protocol: anonymous, opt-out-able, k-thresholded (no display below a minimum rater count — a niche rating reveals nothing about its rater). Aggregation and anti-abuse run server-side (ADR-019: catalog services are closed); the client's contract is only the contribution protocol above.

## Where it shows

- **Library**: status chip + your rating in masonry, grid, list, and table.
  Saved-view filters use the internal fields `$interaction.status` and
  `$interaction.rating`, labelled **My status** and **My rating**. They resolve
  per-owner at query time and are *not* properties, because properties are
  shared. The universal status filter matches a semantic slot on any axis;
  future axis-specific sort/group controls must name the status set rather than
  collapse several axes into one misleading scalar.
- **Add-flow & discovery**: every result carries the overlay — *saved · Read · 8/10 · ★4.3 Amazon · ★7.9 Waffle* — so "have I already read/been/bought this?" is answered at a glance, before saving.

## Schema (migration v2, PK widened by v4)

```sql
status_sets(id, name, labels)                        -- labels: JSON slot→label
status_set_bindings(set_id, match_kind, match_value) -- 'schema_type'|'tag' → set
interactions(owner_id, entity_kind, entity_key,      -- entity_kind='url' for now
             set_id, slot, rating, note,             -- PK = (owner, kind, key, set_id)
             status_at, rated_at, updated_at)        --   since v4 (Decision 1b)
topping_entities(topping_id, entity_kind, entity_key) -- disposable entity↔file projection (v5)
```

`topping_entities` is scanner-derived index state. For a `.url`, `entity_key`
is the hash of the trimmed URL; it is never `toppings.content_hash`, which
identifies the carrier file's bytes for move reconciliation. This separation
lets two toppings for the same URL share marks and lets SQL filter overlays
without hashing every URL during every render. Migration v5 therefore handles
exact trimmed-URL equality only; the alias/entity hardening above is the next
correctness slice.

Local-first like everything else; syncs only to *your own* devices (paid sync tier), never into shared folders. Server-side aggregation consumes contributions, not the table.
