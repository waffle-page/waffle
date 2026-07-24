# Experiences, Suggestions & Capture

The beginner-facing product contract. Waffle should feel as though it has
understood the purpose of a folder and removed setup work, while the underlying
model remains the small set already established by ADR-003, ADR-006, ADR-016,
and ADR-017.

## Progressive disclosure: purpose first, machinery second

Layouts are rendering primitives. They are not the first decision most people
should have to make.

| User sees | Existing machinery underneath |
| --- | --- |
| **Trip planner** | A coordinated bundle of map, itinerary, calendar, budget, reservation, and packing views |
| **Wardrobe** | Gallery, outfits, wishlist, retailer, and seasonal views over one folder |
| **Finances** | Asset views plus dashboards, progressively enriched by datasets/connectors |
| A named view such as **Map** or **Budget** | One saved view: layout + query + presentation config |
| **+ Custom view** | The advanced escape hatch: choose a layout, fields, filters, sort, and grouping |
| Masonry, table, map, calendar, timeline | Renderer-registry entries, normally hidden until customization |

An **experience recipe** is the internal term for the first three rows. It
materializes existing concepts — property declarations, saved views, optional
dashboard/List toppings, field-role mappings, and contextual capture actions.
It is not a third view engine or a permanently running automation.

Once accepted, the materialized result belongs to the user. A newer recipe or
changed inference never silently rewrites it.

## Suggest the correct organizational object

Creating the wrong thing is negative assistance. The suggestion engine must
distinguish containment, presentation, and reference:

| Intent | Suggest |
| --- | --- |
| A distinct project or area where items should live | **Folder** |
| Another way to see the same folder | **View** |
| A curated collection spanning folders | **List** |
| A complete purpose-shaped setup | **Folder experience**: folder + recipe + cover |

Examples: “Trip to Japan” is a folder experience; “Hotels” inside it is usually
a map/filter rather than another folder; “Summer clothes” is a Wardrobe view;
“Favourite outfits” is a List.

## Suggestion invariants

- Suggestions replace work; they do not decorate the interface. Each must be
  understandable, reversible, and likely to remove several manual actions.
- The engine returns every candidate above its confidence threshold: sometimes
  none, sometimes five or more. The UI may show a small leading set plus
  **More**, but display capacity is not a model limit.
- Folder name, local types, tags, properties, dates, coordinates, and saved
  domains may be evaluated on-device. Raw folder membership, names, and
  co-saved context are never sent merely to obtain automatic suggestions.
- An explicit catalog/web search may send the query the user entered. Remote
  candidate pools may use coarse type plus a consented market bucket; final
  private-context ranking happens on-device. Exact coordinates, folder context,
  and co-saved items stay local. Locale/timezone may suggest a market setting
  but are not silently treated as the user's location (see `07-catalog.md`).
- Connector manifests may declare coarse intent hints and bundled recipes. The
  trusted host matches them locally (for example, Wellness + Oura → Sleep
  Dashboard); connector code never receives folder/library context. See
  `15-connector-driven-experiences.md`.
- A suggestion is inert until accepted. Moving existing items requires a clear
  summary and confirmation; the resulting operation offers Undo.
- Dismissal is respected. Waffle does not repeatedly ask the same question.

### Suggested default

Before the user has chosen a default, Waffle may open the highest-confidence
useful view. Once the user explicitly chooses or pins a view, that choice wins
until they change it. “Suggested default” never means a view that keeps
changing as inference changes.

## Suggested folders and covers

A useful folder suggestion is a one-tap setup, not merely a proposed name:

```text
┌────────────────────────────────────┐
│ [cover collage]                    │
│ Set up “Trip to Japan”             │
│ Map · Itinerary · Reservations     │
│ Uses 14 places you already saved   │
│                    Not now · Set up │
└────────────────────────────────────┘
```

Cover sources, in order:

1. A collage from the proposed contents' existing thumbnails.
2. One strong existing image from those contents.
3. A deterministic/generated cover using Waffle's semantic visual system.
4. A catalog image preview with source/provenance.
5. A user-selected camera or photo-library image.

Remote imagery remains a preview until the user accepts the setup or saves the
underlying item. Suggestions appear at moments of intent — onboarding/empty
states, the Add sheet, an Inbox/Everything cluster, folder creation, or one
restrained Home card — not as permanent banners throughout the application.

## Add: one familiar surface, two purposes

The primary Add affordance is a bottom-right circular `+`, inset for platform
safe areas and content scrollbars. It opens a bottom sheet on mobile and a
larger anchored sheet on desktop.

- **Capture:** camera, photo library, link, note, voice, file, scan.
- **Discover:** search, relevant stores/providers, query suggestions, and
  matching ideas/pins.

These are sections of one flow, not separate products. Action order may adapt
modestly to platform and use, but must not jump unpredictably. Table's ghost
row remains a fast contextual affordance; the `+` is the universal one.

## Search has three explicit scopes

One search entry point exposes:

1. **This folder** — local FTS constrained to the current folder/subtree.
2. **All saved** — local FTS across the vault.
3. **Discover** — catalog/web results, visibly crossing the local boundary.

Starting inside a folder defaults to **This folder**. The scope is always
visible. Mobile opens a full-screen search sheet; desktop also exposes
Cmd/Ctrl+K. Catalog results show saved/status/rating overlays so users do not
re-add what they already have.

## Shell, feedback, and recovery contract

The shell must explain state without occupying the workspace permanently:

| Situation | Beginner-facing behavior |
| --- | --- |
| Successful/reversible action | Brief toast with **Undo** where supported |
| Background import, connector pull, sync, thumbnail, or bulk operation | Compact progress in **Activity & Issues**; its panel is always dismissible |
| Actionable warning/failure | Persistent issue badge and grouped detail with retry/open-source-file actions |
| Irreversible, security-sensitive, or unusually large action | Responsive app dialog/sheet; never a browser-native `confirm()` |

Obsidian sync reports belong in Activity & Issues, not in an immortal side tab
or a generic warning banner. The same center owns connector freshness,
permissions, offline/unsynced state, and operation failures while preserving
source-specific detail.

**Trash** is a visible navigation destination. The user-facing verb is **Move
to Trash**, never “move to `.trash`”; `.trash/` is an implementation path.
Ordinary soft deletion should complete with Undo instead of requiring a modal.
Confirmation is reserved for a large/ambiguous selection or a state that cannot
be recovered normally. Restore and empty-trash are explicit actions.

Small but binding table polish belongs in the same P1 hardening slice:

- The sticky Title column and header cells paint an opaque semantic background,
  stacking boundary, and edge divider/shadow; scrolled columns never bleed
  underneath.
- Ordinary number cells do not expose browser spinner arrows. Locale-aware
  parsing/formatting comes from Settings; explicit stepping appears only for a
  property that declares a meaningful step.
- Operation/detail panels, including the current table-operations surface, are
  closable and do not steal permanent width from the library.

## Renderer implications

Map, calendar, and timeline consume declared semantic field roles rather than
guessing keys forever: location/coordinates, start/end/date, timezone, amount,
currency, status, and relation. A recipe proposes mappings; a custom view can
override them.

Interactive edits (move a pin, drag an event, resize a timeline interval)
remain ordinary file-first property mutations: optimistic preview while the
gesture is active, one canonical write on commit, targeted rescan, requery,
and session-history receipt where supported.

## Sequencing

- **P1 usability:** local search UI; responsive `+` capture sheet; visible
  Trash and Activity & Issues; numeric/locale polish; mobile-safe shell.
- **P1/P2 boundary:** local recipe matching, suggested folders/covers from
  existing content, and `+ Custom view`.
- **P2:** contextual sources, catalog candidate API, Map, Calendar, then
  editable Timeline and the complete Trip Planner experience.
- **P3:** global catalog/feed signals and marketplace-scale discovery.
