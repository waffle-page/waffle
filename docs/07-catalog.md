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
                       + optional coarse market bucket + time bucket
                       (no folder, exact location, or stable user identity;
                        sparse aggregates roll up or stay dark)
                                  │
                                  ▼
                ┌── GLOBAL CATALOG (Supabase, P3) ───────────────┐
                │ urls:      url_hash · canonical_url · type     │
                │            payload JSONB                       │
                │            first_seen · last_confirmed         │
                │            embedding (pgvector) · geo (PostGIS)│
                │ entities:  clustered URLs (same thing,         │
                │            many addresses)                     │
                │ signals:   entity · market · period            │
                │            unique_savers · rating aggregates   │
                │            save velocity · confidence          │
                │ tag_stats: aggregated tag co-occurrence        │
                └────────────────┬───────────────────────────────┘
               search API: FTS + vector + facets + geo + regional trends
                                  │
             query chips · add-sheet "matching ideas" · home feed
```

## Design decisions

### 1. The unit is the entity, not the URL
The private library establishes the first identity seam in P1: preserve every
raw saved URL, derive versioned aliases locally, and use high-confidence
provider identifiers so URL variants such as two links to one Google Maps
Place converge. Scanner work remains offline; explicit Add/refresh may resolve
redirects or canonical links. Exact rules and false-merge protections:
`docs/09-status-and-ratings.md` and
`docs/recipes/verify-url-entity-identity.md`.

The global catalog extends that seam rather than inventing another one:
normalization produces a versioned **URL alias/entity key**, then semantic **entity
resolution** clusters different sites pointing at the same thing (a restaurant
on Google Maps + TripAdvisor + its own site) via type-specific matching keys —
name+geo for places, GTIN / brand+model for products, oEmbed ID for videos.
Cross-provider clustering remains P3; the private alias foundation does not
require uploading a URL or folder context.

### 2. Reuse the standards regime (see 06-schemas-and-units.md)
Records are **schema.org**-typed (`Product`, `Place`, `VideoObject`, `Article`, `Recipe`, generic) — which is what JSON-LD extraction natively yields — with UCUM/ISO value discipline (price = amount + ISO 4217, duration = seconds, geo = WGS84). Extraction **site adapters** for stubborn domains reuse the connector-store package machinery (manifest, sandbox, registry). One standards regime across pantry and catalog.

### 3. First-saver creates; everyone after votes
Later savers' independent extractions confirm (consensus strengthens
confidence) or supersede (staleness detected, payload updated, history kept).
Save signals retain coarse time buckets so the catalog can distinguish
lifetime popularity from current velocity; a single overwritten `save_count`
is insufficient. Popularity counts distinct consented savers, not clicks or
page views. The private backend's deduplication/anti-abuse mechanism requires a
privacy review—it must not smuggle in a permanent global device identifier.
Confidence decays with age; feeds and chips prefer fresh-confirmed records;
stale records queue for opportunistic refresh on next touch.

### 4. Privacy protocol
The catalog learns about an entity and, only with separate consent, a coarse
market—not the user's library context. Contributions carry no folder,
co-saved context, exact coordinates, address, or stable public user identity.
Folder-context ranking happens client-side: the device computes the derived
query; the folder never leaves it. Catalog contribution is a visible setting
(default on, one-tap off); regional-signal sharing is independently
controllable.

Aggregate signals (distinct saves, rating distributions, tag co-occurrence,
and save velocity) surface only above k distinct contributors. Sparse cells
roll up geographically (metro/region → country) and temporally (day → week →
month) before they can surface; if the rolled-up cell still misses the
threshold, it remains hidden. Public APIs return aggregates, never raw
contribution events.

### 5. Regional relevance without location history

Regional availability and taste matter: a Wardrobe folder in Spain should not
rank an irrelevant US retailer first, and a place becoming popular in Madrid
is a different signal from global lifetime popularity. The client therefore
uses an optional **market bucket**, not precise location.

- Preferred source: an explicit country/region or market in Settings.
- Optional source: a granted device location quantized locally to an approved
  coarse market; exact coordinates are immediately discarded.
- Locale and timezone may suggest a setting but never silently assert location.
- IP-derived geography, if ever used at ingress, is transient, consented,
  coarse, and excluded from application logs/analytics and stored events. The
  backend must document unavoidable infrastructure logging before launch.
- Contribution payloads contain a versioned market code and coarse time bucket,
  never latitude/longitude. Small or low-population markets use a coarser
  parent bucket.
- The user can use exact location locally for search/ranking without sharing
  it. Disabling regional contribution does not disable the catalog.

The contribution protocol and backend aggregate schema must pass a privacy
review before P3 implementation. K-anonymity is a release floor, not proof
against every linkage attack; retention, bucket size, rate limits, and any
unique-contributor mechanism are part of that review.

## Community ratings (see 09-status-and-ratings.md)

Users' private ratings contribute (anonymously, opt-out-able) to a per-entity
aggregate, displayed only above the same k-anonymity threshold as every other
catalog signal. A regional rating aggregate may surface only when its market
bucket independently clears the threshold; otherwise the UI uses the safe
parent/global aggregate. Extracted **source ratings** (Amazon, IMDb, Google —
normalized 0–10 with raw value/scale/count preserved) live in the entity
payload and refresh via the same loop. Discovery surfaces show all three layers
side by side: the source's rating, the Waffle community rating, and your own.

## Boundaries (restated from 01-vision.md)

Metadata + one thumbnail + link out; user-initiated fetches only; robots respected beyond them; DMCA-style takedown; k-thresholded aggregates. Full-image-set caching and anti-bot circumvention remain explicitly out unless taken as a conscious business decision.

## Growth path

| Stage | What exists |
| --- | --- |
| P2 | Personal catalog: same extraction path, on-device, private — search over *your* saves |
| P3.0 | Global catalog live: canonical URLs, contribution protocol, FTS + vector search, chips/feed powered |
| P3.x | Entity resolution (clustering), geo/facet browse (Maps-class verticals), site-adapter registry open |
