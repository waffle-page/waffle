# The Global Catalog

The crowd-built index of everything Waffle users save: canonical URLs → typed entities with extracted properties, searchable by text, vector, property facets, and geo. Ships P3, but its machinery (on-device extraction → typed records) powers the private library from P2 — built and tested for an audience of one before the network exists.

## Refresh loop

Every catalog dies of staleness. Waffle's answer: the same user actions that build the index keep it alive.

- **Save** a URL → device extracts (JSON-LD / og / oEmbed / microdata + vision over thumbnail + AI tags) → contributes a typed record.
- **View or re-save** an already-cataloged URL → device opportunistically re-extracts (rate-limited, user session) → **confirms** (bump `last_confirmed`) or **supersedes** (price moved, place closed).

## Pipeline

```
user saves a URL
 └─ ON-DEVICE extraction
      ├─ private copy: full record → user's library (folder, context, identity STAY on device)
      └─ contribution: canonical URL + schema.org-typed payload + tags + embedding
                       (no folder, no identity; aggregate signals surface only after
                        k distinct savers — niche saves stay dark)
                                  │
                                  ▼
                ┌── GLOBAL CATALOG (Supabase, P3) ───────────────┐
                │ urls:      url_hash · canonical_url · type     │
                │            payload JSONB · save_count          │
                │            first_seen · last_confirmed         │
                │            embedding (pgvector) · geo (PostGIS)│
                │ entities:  clustered URLs (same thing,         │
                │            many addresses)                     │
                │ tag_stats: aggregated tag co-occurrence        │
                └────────────────┬───────────────────────────────┘
               search API: FTS + vector + property facets + geo
                                  │
             query chips · add-sheet "matching ideas" · home feed
```

## Design decisions

### 1. The unit is the entity, not the URL
Normalization first: strip tracking params, resolve shortlinks, honor `rel=canonical` → **URL identity** (`url_hash`). Then **entity resolution** clusters URLs pointing at the same thing (a restaurant on Google Maps + TripAdvisor + its own site) via type-specific matching keys — name+geo for places, GTIN / brand+model for products, oEmbed ID for videos. V1 ships canonical URLs only; clustering is v2 — the catalog is useful before the hard part.

### 2. Reuse the standards regime (see 06-schemas-and-units.md)
Records are **schema.org**-typed (`Product`, `Place`, `VideoObject`, `Article`, `Recipe`, generic) — which is what JSON-LD extraction natively yields — with UCUM/ISO value discipline (price = amount + ISO 4217, duration = seconds, geo = WGS84). Extraction **site adapters** for stubborn domains reuse the connector-store package machinery (manifest, sandbox, registry). One standards regime across pantry and catalog.

### 3. First-saver creates; everyone after votes
Later savers' independent extractions confirm (consensus strengthens confidence) or supersede (staleness detected, payload updated, history kept). Confidence decays with age; feeds and chips prefer fresh-confirmed records; stale records queue for opportunistic refresh on next touch.

### 4. Privacy protocol
The catalog learns about **the URL, never the user**: contributions carry no folder, no co-saved context, no identity. Aggregate signals (save counts, tag co-occurrence) surface only above k distinct savers (k-anonymity — a niche save reveals nothing). Folder-context ranking happens client-side: the device computes the derived query; the folder never leaves it. Contribution is a visible setting (default on, one-tap off).

## Community ratings (see 09-status-and-ratings.md)

Users' private ratings contribute (anonymously, opt-out-able) to a per-entity aggregate, displayed only above the same k-anonymity threshold as every other catalog signal. Extracted **source ratings** (Amazon, IMDb, Google — normalized 0–10 with raw value/scale/count preserved) live in the entity payload and refresh via the same loop. Discovery surfaces show all three layers side by side: the source's rating, the Waffle community rating, and your own.

## Boundaries (restated from 01-vision.md)

Metadata + one thumbnail + link out; user-initiated fetches only; robots respected beyond them; DMCA-style takedown; k-thresholded aggregates. Full-image-set caching and anti-bot circumvention remain explicitly out unless taken as a conscious business decision.

## Growth path

| Stage | What exists |
| --- | --- |
| P2 | Personal catalog: same extraction path, on-device, private — search over *your* saves |
| P3.0 | Global catalog live: canonical URLs, contribution protocol, FTS + vector search, chips/feed powered |
| P3.x | Entity resolution (clustering), geo/facet browse (Maps-class verticals), site-adapter registry open |
