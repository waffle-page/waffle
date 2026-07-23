# Status & Ratings

The personal-marks layer: per-user status ("reading", "want to go") and ratings on anything saveable — replicating Goodreads, IMDb watchlists, and Google Maps want-to-go/been, generalized across all domains. Three strictly separated layers, because conflating them is how products corrupt their own data.

## The three layers

| Layer | What | Ownership | Visibility |
| --- | --- | --- | --- |
| **Source rating** | Extracted at save/refresh from the page (Amazon stars, IMDb score, Google rating), client-side | Fact about the entity | Shared — part of catalog payload + local properties |
| **Personal interaction** | Your status + your rating + optional note/dates | Per-user × per-entity | **Private, always** — never syncs into shared folders; each member sees only their own overlay |
| **Waffle community rating** | Aggregate of users' personal ratings on a catalog entity | The network's | Public, k-thresholded aggregate (P3) |

## Decision 1 — Interaction state attaches to the *entity*, not the topping

`(owner, entity)` → `{status, rating}`, keyed by URL identity (`url_hash`, later `entity_id`), **not** by topping id. Consequences, all deliberate:

- The same book saved in two folders shows one status — no split-brain shelves.
- You can rate or queue something you've *never saved* (rate straight from the discovery feed, like rating a film on IMDb without listing it).
- In shared folders, each member's overlay is their own: Marta's "been", your "want to go", on the same place topping — exactly Google Maps shared-list semantics.
- Toppings of type `link` reuse `toppings.content_hash` to store the canonical-URL hash, so the join is already indexed.

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

- **Library**: status chip + your rating on cards; filter/sort/group by `interaction.status`, `interaction.rating` in any view (the view engine resolves interaction keys per-owner at query time — they are *not* properties, because properties are shared).
- **Add-flow & discovery**: every result carries the overlay — *saved · Read · 8/10 · ★4.3 Amazon · ★7.9 Waffle* — so "have I already read/been/bought this?" is answered at a glance, before saving.

## Schema (migration v2)

```sql
status_sets(id, name, labels)                        -- labels: JSON slot→label
status_set_bindings(set_id, match_kind, match_value) -- 'schema_type'|'tag' → set
interactions(owner_id, entity_kind, entity_key,      -- PK; entity_kind='url' for now
             set_id, slot, rating, note,
             status_at, rated_at, updated_at)
```

Local-first like everything else; syncs only to *your own* devices (paid sync tier), never into shared folders. Server-side aggregation consumes contributions, not the table.
