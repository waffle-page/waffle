# Waffle Catalog

The separate proprietary discovery product: a provider-neutral master graph of
entities, identifiers, sourced claims, relationships, rights-aware media, and
privacy-preserving aggregate signals. Waffle Core remains complete without it.
The open client may integrate through an auditable protocol, but the corpus,
entity resolution, ranking, aggregation, and abuse systems live behind
ADR-019's private server boundary.

Full entity, product, privacy, rights, and acquisition contract:
`docs/16-catalog-product-and-entity-graph.md`.

## Refresh loop

Every catalog dies of staleness. Permitted user actions can provide fresh
evidence without turning Waffle into a crawler.

- **Save** a URL → device may extract permitted metadata for the private
  library. A separate contribution ceremony may submit a rights-compatible
  evidence projection.
- **Explicit refresh** → device may re-observe the user-selected source within
  its access terms, confirming or superseding individual claims.
- **Feed/dataset refresh** → the Catalog ingests only sources with a recorded
  licence, permission, retention, and distribution basis.

## Pipeline

```
source URLs · external identifiers · extracted observations
permitted feeds · licensed/open datasets · partnerships
                              │ evidence
                              ▼
               ┌── WAFFLE CATALOG PRODUCT ───────────────┐
               │ opaque Waffle entity IDs                │
               │ identifier + fact + relationship claims │
               │ provenance · confidence · valid time    │
               │ media rights · attribution · takedown   │
               │ merges · redirects · splits · succession│
               │ consented aggregate signals             │
               └────────────────┬─────────────────────────┘
                                │ bounded discovery API
                                ▼
                 search · facets · geo · trends · feed
                                │
                                ▼
                     optional Waffle Core surfaces
```

## Design decisions

### 1. The unit is the Waffle entity, never a URL or provider key

The private library currently preserves raw URLs and derives deterministic
candidate aliases under ADR-026. That projection is useful for converging
obvious saved variants, but its hashes and provider keys are not durable entity
identity.

The Catalog assigns opaque Waffle entity IDs. URLs, ISBNs, GTINs, DOIs, IMDb
IDs, MusicBrainz IDs, Place IDs, SKUs, creator IDs, and future schemes are
identifier claims. Multiple claims may identify one entity; one disputed or
reused identifier may require separation. Provider succession never re-keys
the entity.

Core may later carry durable private entity IDs and an optional mapping to a
Catalog entity. Private IDs, evidence, and folder context are not contribution
identifiers.

### 2. Claims and relationships retain provenance

Entities are typed through sourced claims. Facts and relationships carry
source, observation time, valid time, confidence, state, and rights metadata.
Conflicting observations coexist; an effective projection does not erase its
evidence. Merges create redirects, splits preserve every affected ID/claim,
and identifier succession is explicit history.

The graph reuses schema.org types and the UCUM/ISO discipline from
`06-schemas-and-units.md`, while allowing namespaced extensions. Site/provider
adapters produce evidence; they are not identity authorities or
provider-specific catalog partitions.

### 3. Independent observations confirm or supersede claims

An initial permitted observation may create a provisional Catalog entity.
Later independent evidence can confirm a claim, supersede a time-varying fact,
or expose a duplicate without overwriting history.

Save signals retain coarse time buckets so the catalog can distinguish
lifetime popularity from current velocity; a single overwritten `save_count`
is insufficient. Popularity counts distinct consented savers, not clicks or
page views. The Catalog backend's deduplication/anti-abuse mechanism requires a
privacy review—it must not smuggle in a permanent global device identifier.
Confidence decays with age; feeds and chips prefer fresh-confirmed records;
stale records may refresh through an eligible feed or explicit user action.

### 4. Privacy protocol

The Catalog learns about an entity only through a distinct contribution
ceremony and, with separate consent, a coarse market—not the user's library
context. Contributions carry no private entity ID, folder,
co-saved context, exact coordinates, address, or stable public user identity.
Folder-context ranking happens client-side: the device computes the derived
query; the folder never leaves it. Catalog contribution and regional-signal
sharing are independently controllable. Their eventual defaults require
product/privacy review rather than assumption in this engineering contract.

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
review before Catalog launch. K-anonymity is a release floor, not proof
against every linkage attack; retention, bucket size, rate limits, and any
unique-contributor mechanism are part of that review.

## Community ratings (see 09-status-and-ratings.md)

Users may separately consent to contribute a rating projection to a
per-entity aggregate. The protocol must not expose their private entity ID or a
stable public user identifier. Aggregates display only above the same reviewed
privacy threshold as every other Catalog signal. A regional rating aggregate
may surface only when its market bucket independently clears the threshold;
otherwise the UI uses the safe parent/global aggregate. Permitted
**source-rating claims** normalize to 0–10
while retaining raw value/scale/count, provenance, observation time,
display/retention rights, and attribution. A provider page exposing a rating
is not by itself permission to bulk ingest or redistribute it. Discovery may
show source, Waffle community, and personal layers side by side only where each
layer is authorized.

## Acquisition and distribution boundary

Catalog growth comes from user-initiated saves/refreshes, permitted page
metadata, authorized APIs, creator/merchant feeds, licensed or compatible open
datasets, public standards, and explicit partnerships. Every ingestion path
records its rights basis, permitted uses, attribution, retention/expiry, and
takedown route.

Unauthorized bulk crawling, authentication/quota circumvention, private-API
imitation, and indiscriminate third-party republication are out. Rights-
incompatible datasets stay isolated. Media requires creator/rightsholder,
licence/permission, attribution, provenance, and takedown state. Sensitive
entity classes require an explicit Catalog policy before ingestion.

## Growth path

| Stage | What exists |
| --- | --- |
| Core P2 | Private on-device extraction/search over the user's own saves; no Catalog dependency |
| Catalog validation | One rights-cleared, economically viable vertical/source; generic entity/claim model proven |
| Catalog v1 | Proprietary master graph, audited contribution protocol, text/vector/facet/geo discovery |
| Catalog expansion | Additional licensed/permitted verticals, entity resolution, trends, partnerships |
