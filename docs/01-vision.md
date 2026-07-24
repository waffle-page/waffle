# Vision

Waffle is a local-first everything-library: one place where notes, links, files, and dashboards live together in folders, get thumbnails and typed properties, and render through saved views — with live personal data (health, finance, home) flowing in through an open connector ecosystem, and Pinterest-class discovery for finding the next thing to save.

## Inspirations and what each contributes

| Source | Contribution |
| --- | --- |
| **Obsidian** (primary) | Files-canonical vault, plain `.md` + YAML frontmatter, mermaid, wikilinks, the plugin-ecosystem lesson |
| **Airtable** | Typed properties, saved views (filter / sort / group / layout), templates — with zero database jargon |
| **Pinterest** | Masonry grids, visual add-flow, AI query chips, store circles, home feed, save-from-anywhere |
| **Google Drive** | Folder sharing with subtree inheritance and roles |
| **Aggregators / Kubera** | Connectors, datasets, net-worth-class dashboards |

## Product pillars

1. **One kind of item.** Notes, links, files, dashboards are all *toppings* — rows in one collection. They mix, sort, and filter together; there are no separate silos.
2. **Many ways to look, purpose first.** A view is a saved arrangement (masonry, list, table, board, gallery, map, calendar, timeline, custom). Non-technical users are first offered purpose-shaped experiences — Trip planner, Wardrobe, Net worth — assembled from coordinated views and properties. **+ Custom view** reveals the advanced machinery when wanted; nobody must understand layouts or databases before the folder becomes useful.
3. **The pantry.** Datasets fill themselves via connectors (Oura, banks, Home Assistant, HealthKit). They never appear in the folder tree — only dashboards surface them. Curation is the trunk; live data is a tributary.
4. **Discovery built in.** The familiar bottom-right `+` opens one contextual Add sheet: capture (camera, library, link, note, voice, file) plus discovery (stores/providers, query suggestions, matching ideas). The same local signal can suggest a useful folder, view, List, or complete experience with a cover — only when it saves real setup work, never by auto-mutating the vault. Every first-save of a URL enriches a crowd-built global index (see `07-catalog.md` for the contribution protocol and its privacy rules; `13-experiences-and-suggestions.md` for the client contract).
5. **Private by architecture.** No account is required and signing in uploads nothing. Private vault files stay on the user's device; on-device AI is the default; managed personal sync and shared folders are end-to-end encrypted; cloud enrichment and publishing are explicit, separate choices. See `14-identity-sync-and-encryption.md`.
6. **Open ecosystem.** Connectors, schemas, and (later) renderers are open-source packages in a public store. Third parties (e.g., Oura) publish connectors that bundle their own dashboard templates.
7. **Your marks on everything.** Per-user status ("reading", "want to go") and ratings on any link — Goodreads/IMDb/Maps functionality generalized across domains (see `09-status-and-ratings.md`). Private always (even in shared folders, each member sees only their own overlay); shown in the library and across discovery; source ratings (Amazon/IMDb/Google) extracted client-side; a k-thresholded **Waffle community rating** emerges from the network at P3 — rank anything, see how others ranked it.

## The user promise, in one scenario

Share "Puglia 2027" with friends (editor role via invite link). Anyone saves a Google Maps place from the share sheet; it lands as a link topping with coordinates and a photo. The folder has a map view. Nothing was configured.

## Boundaries held deliberately

- Client-side extraction covers **user-initiated saves**: metadata + one thumbnail + link out (the Pinterest pattern). Bulk scraping, anti-bot circumvention, and full-image-set caching are out of scope by design.
- Waffle is not Grafana: datasets exist only to feed widgets.
- Full third-party *plugin* surface (beyond connectors) waits until the sandbox story is proven.
