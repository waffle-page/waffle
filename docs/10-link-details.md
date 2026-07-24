# Link Detail Views

What clicking a link opens: a typed detail view — media gallery, key properties,
your status/rating — with the source site always exactly one tap further
(Pinterest's model: the detail is where Waffle earns its keep). A Pokémon card,
a YouTube video, and a product page each render through a different template,
and contributors can add templates for verticals we never imagined.

## The core split: domain for extraction, type for display (ADR-015)

```
URL ──► EXTRACTION (matched by DOMAIN) ──► typed private record/claims ──► DISPLAY (matched by TYPE) ──► detail view
        site adapters: password-manager       schema.org        detail templates:
        host rules + generic JSON-LD/og       type + props      most-specific-type wins
        fallback                                                + Thing fallback
```

- **Extraction matches by domain.** Site adapters declare host rules in their
  manifests — `["youtube.com", "*.youtube.com", "youtu.be"]` — exact host >
  wildcard subdomain > generic extractor. Most sites need NO adapter: the
  generic extractor reads JSON-LD/og and pages self-describe their type
  (YouTube says `VideoObject`, Amazon says `Product`). Adapters exist for
  sites with poor markup or richer APIs.
- **Display matches by type, never by domain.** Templates register against
  schema.org types; selection walks the type hierarchy, most specific wins —
  the same dispatch rule as status-set bindings (09). Why: one `Product`
  template covers the same product on fifty domains and the fifty-first; and an
  authorized typed projection arriving from the separate Catalog product
  renders on your device without their domain adapter installed. The typed
  record travels; the renderer is local.

## Built-in templates (v1 set)

| Type | Renders |
| --- | --- |
| `VideoObject` | player/thumbnail, duration, channel, watch status |
| `Product` | image/video gallery, price (money-typed), availability, source rating |
| `Place` | map (existing map machinery), address, hours, visit status |
| `Article` | reading-view lede, source, reading time |
| `Thing` (fallback) | favicon card + whatever properties exist — a bad extraction degrades, never breaks |

Every template's chrome is shared: title/domain header, tags, YOUR status +
rating controls (09), and the one prominent **Open ↗** (new tab on web;
in-app browser sheet on mobile at P2 — the store-circles surface).

## Contributor templates: the store pattern, third use

A vertical ships as ONE store package bundling up to three pieces (same
bundling trick as Oura's connector shipping its dashboard):

1. **Site adapter** — domain-matched extractor (sandboxed, manifest-declared
   hosts + output types) filling a typed record.
2. **Extension type** — namespaced (`pokemon:Card`, never bare `Card`),
   registered in the versioned `waffle-schemas` catalog (06 governance).
3. **Detail template** — the renderer for that type.

### Templates are pure render — the complexity firewall

A template = typed record in → view out. No fetching, no storage access, no
arbitrary logic — the same contract as layout renderers (ADR-006). The moment
templates can run code, this becomes a second plugin system with its own
security surface. Extraction (which does run code) stays in the sandbox where
it already lives.

## Dispatch details

- Template: exact type → walk parents (`TVSeries → CreativeWork → Thing`).
- Extractor: exact host → `*.domain` wildcard → generic. User-installed beats
  built-in; user can pin an adapter per site.
- Per-item override: any topping can force a different template (view a
  YouTube link as a plain article card) — the same UX grammar as the
  per-folder layout picker. Stored as a topping property.

## Schema touch

Link toppings gain `schema_type` (the catalog spec already carries it
server-side) + extracted media lists (`images[]`, `videos[]`) and typed
properties via the existing EAV. Private extraction does not make a source
claim or media asset distributable; Catalog ingestion separately records
provenance, observed time, rights, attribution, and takedown state. Templates
render what their input stored and never fetch at view time. Migration lands
with the P1 detail-view build.

## Create note from a source

A link or file does not change topping type in place. **Create note from…** is
an explicit derivation:

```text
source .url or file ──remains unchanged──┐
                                         └──► new user-owned .md note
                                              source · captured time
                                              extracted/summary content
                                              user annotations
```

For a URL the action may offer:

- **Reference note:** title, permitted metadata/excerpt, source link, and an
  empty annotation body.
- **Reading copy:** permitted article content converted to Markdown through an
  explicit user-initiated fetch.
- **Summary:** a derived summary with source link and clearly separated quoted
  material.

For a file the equivalent action may extract text, OCR, transcribe, or
summarize while retaining the original file. The note is a new topping
`derived_from` or `describes` the source; it is not automatically the same
content entity and never inherits identity merely because its text came from
the source.

The `.md` records source URL or relative file evidence, capture time,
extractor/model version where relevant, and source hash/attribution where
available. Durable source-topping/entity references arrive only after
ADR-022/027; current path/hash evidence is not identity.

Refresh never overwrites user-authored bytes. It creates a new snapshot/diff,
or updates only an explicitly source-owned managed region under a later
write-back contract. **Replace with note** is a separate compound command:
create and rescan the note first, then soft-trash the source with Undo. Partial
failure leaves the verified source and any completed note visible.

## Sequencing

- **P1**: detail view v1 — shared chrome + `Thing`/`Product`/`VideoObject`
  templates over whatever properties exist (manual + basic extraction);
  status/ratings controls live here.
- **P2**: rich extraction (native fetch in shells; JSON-LD/oEmbed; media
  galleries; source ratings), `Place`/`Article` templates, per-site adapters.
- **Catalog product / later Core**: contributor template/adapter packages
  through the store, with adapters remaining evidence collectors rather than
  identity authorities.
