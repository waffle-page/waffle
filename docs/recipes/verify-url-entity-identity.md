# Acceptance specification: URL aliases and entity identity

Executable contract for ADR-026's deterministic URL-identity slice. It is
deliberately narrower than generic URL canonicalization: absence of strong
evidence means separate entities.

## Scope boundary

The implemented local pipeline is:

```text
raw saved URL → versioned normalized alias → provider key → local entity
```

Full semantic clustering across different providers remains P3. For example,
automatically proving that a restaurant's Google Maps listing and its official
website are the same entity is out of this slice; an eventual manual **Same
thing** action may record that relationship earlier.

The Google adapter recognizes only the documented Maps Search URL shape:
`/maps/search/?api=1&query=…&query_place_id=…`, with exactly one Place ID.
Directions, CID and `data=!…` blobs, shortened links, redirects, names, and
coordinates are deliberately not interpreted.

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
| Two documented Google Maps Search URLs carrying the same `query_place_id` | Same |
| Two Maps URLs relying only on CID, `data=!…`, name, or coordinates | Separate |
| Resolved `maps.app.goo.gl` short link and its long URL | Same after explicit online Add/refresh resolution |
| Unresolved short link during an offline scan | Provisional; scan succeeds without network |
| Verified successor for an obsolete provider Place ID | Same; former ID remains an alias |
| Same place name or nearby coordinates without a stable provider key | Separate |
| Product URLs whose query parameter selects a size/variant | Separate unless that provider explicitly proves equivalence |
| Google Maps URLs carrying different stable Place IDs | Separate |

## Fixture exercise

Use only the fixture vault.

1. Choose **Create fixture vault**, then **Scan vault**. The fixture contains
   `Trips/lumen-field.url` and root `lumen-field-reference.url`: different
   locale/query/tracking syntax, one documented Place ID.
2. In the harness's **URL identity (ADR-026)** table, confirm their alias
   prefixes differ, effective prefixes match, provider evidence matches, and
   both rows say `resolved`. Read both files and confirm their original URL
   bytes are unchanged.
3. Confirm `tracked-article` and `tracked-article-reference` also have different
   aliases and one effective key. Their `edition=summer` identity parameter
   remains in both files; only allowlisted tracking noise was ignored.
4. Set a status and rating through one topping. Confirm both toppings update in
   masonry, grid, list, table, and saved interaction filters.
5. Rename/move either carrier file and rescan. Confirm topping reconciliation
   and entity identity remain independent.
6. Rebuild the disposable index from the fixture vault. Confirm deterministic
   aliases and marks reconstruct.
7. Add an unresolved short link with network disabled. Confirm scan makes no
   request, reports no error, and assigns only its normalized-URL candidate.
8. Choose **Probe URL identity conflict**. It constructs and scans a legacy
   state with different 6/8 marks at the two raw aliases, asserts one
   `conflict` plus one `resolved` projection and both surviving marks, then
   restores the clean fixture projection. Confirm the green `passed` report.
9. Seed 20,000 toppings and load Everything. Confirm identity resolution occurs
   at ingestion/projection boundaries, not once per rendered item.

## Design-gate result

ADR-026 settles deterministic sub-slice A:

- raw files stay canonical; alias/entity tables are rebuildable projections;
- normalizer version 1 removes only `utm_*`, `gclid`, `dclid`, `fbclid`,
  `msclkid`, `mc_cid`, `mc_eid`, `_ga`, `_gl`, and `igshid`;
- unopposed/identical marks migrate; differing owner/set values block the whole
  alias and retain both identities;
- a later rule that changes an already-marked shared candidate retains the old
  effective key for explicit resolution rather than moving shared marks;
- Google Maps accepts only the documented single-`query_place_id` Search URL;
- provider matching uses exact Google registrable hosts, never a
  `google.<anything>` pattern;
- scan never performs network I/O or emits catalog/location telemetry.

GitHub issue #1 remains open for sub-slice B: durable manual/network evidence,
short-link resolution, provider-ID succession, conflict UI, and the interaction
with ADR-022 identity plus encrypted sync.
