# Acceptance specification: URL aliases and entity identity

Target contract for the correctness slice after status/rating surfacing. This
is deliberately executable before implementation so a future agent does not
mistake generic query stripping for entity resolution.

## Scope boundary

Implement same-provider, high-confidence identity for the private library:

```text
raw saved URL → versioned normalized alias → provider key → local entity
```

Full semantic clustering across different providers remains P3. For example,
automatically proving that a restaurant's Google Maps listing and its official
website are the same entity is out of this slice; an eventual manual **Same
thing** action may record that relationship earlier.

## Invariants

1. The exact URL saved by the user remains unchanged in its `.url` file.
2. SQLite tables are disposable projections. Non-deterministic redirect,
   canonical-link, and manual alias evidence must have a durable encrypted
   representation under the identity ADR gate before implementation.
3. Scan is deterministic and offline. It never follows redirects, fetches a
   page, or leaks vault URLs.
4. Normalization rules are versioned. Reprocessing is explicit and idempotent.
5. Generic normalization removes only proven syntax/noise. Unknown query
   parameters remain because they may identify a product variant, document,
   map route, or other distinct resource.
6. Provider adapters merge only on stable, high-confidence identifiers. Place
   names or nearby coordinates alone never auto-merge.
7. A provider identifier may be superseded. Verified successor IDs join the
   existing entity while the old identifier remains an alias.
8. Personal marks attach to the resolved entity. Every alias for that entity
   displays the same status and rating without per-card queries or hashing.
9. Joining aliases is conflict preserving. Two different marks for the same
   owner/status set are never silently reduced to last-write-wins.

## Acceptance matrix

| Case | Expected identity |
| --- | --- |
| Exact URL saved in two folders | Same |
| URL differing only by an allowlisted tracking parameter | Same |
| Two Google Maps long URLs carrying the same Place ID/CID | Same |
| Resolved `maps.app.goo.gl` short link and its long URL | Same after explicit online Add/refresh resolution |
| Unresolved short link during an offline scan | Provisional; scan succeeds without network |
| Verified successor for an obsolete provider Place ID | Same; former ID remains an alias |
| Same place name or nearby coordinates without a stable provider key | Separate |
| Product URLs whose query parameter selects a size/variant | Separate unless that provider explicitly proves equivalence |
| Google Maps URLs carrying different stable Place IDs | Separate |

## Fixture exercise

Use only the fixture vault.

1. Add two `.url` files in different folders for one Google Maps fixture Place:
   use syntactically different long URLs with the same stable provider ID and
   tracking noise on one.
2. Scan. Confirm both toppings project to one entity while both files retain
   their original URL bytes.
3. Set a status and rating through one topping. Confirm both toppings update in
   masonry, grid, list, table, and saved interaction filters.
4. Rename/move either carrier file and rescan. Confirm topping reconciliation
   and entity identity remain independent.
5. Rebuild the disposable index from the fixture vault. Confirm deterministic
   aliases and marks reconstruct.
6. Exercise an unresolved short link with network disabled. Confirm scan makes
   no request, reports no error, and retains a provisional identity.
7. Create two aliases with conflicting existing marks. Run the proposed join
   operation and confirm both inputs remain recoverable and the conflict is
   surfaced.
8. Seed 20,000 toppings and load Everything. Confirm identity resolution occurs
   at ingestion/projection boundaries, not once per rendered item.

## Design gate before code

Record the following before changing the scanner or interaction primary key:

- durable local entity and alias representation;
- normalization-rule version and reprocessing protocol;
- mark migration and conflict representation;
- provider-adapter boundary, beginning with Google Maps;
- explicit online resolution boundary and privacy behavior;
- interaction with ADR-022 durable vault/folder/topping IDs and encrypted sync.
