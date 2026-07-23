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
2. **Many ways to look.** A view is a saved arrangement (masonry, list, table, board, gallery, map, custom). Folders remember their views. Non-technical users get Airtable power without ever hearing the word "database."
3. **The pantry.** Datasets fill themselves via connectors (Oura, banks, Home Assistant, HealthKit). They never appear in the folder tree — only dashboards surface them. Curation is the trunk; live data is a tributary.
4. **Discovery built in.** Adding a topping opens a **two-rail contextual add sheet**, both rails computed from the same signal (tags, properties, and domains of what the folder already holds): a **sources rail** (type-dependent — links: store circles ranked by folder domain frequency + tag affinity, later crowd co-occurrence; files: camera / library / scan / other app; notes: blank / voice / template) and a **search rail** of AI query chips ("greek italian summer shirts") as pre-made queries. Plus matching-idea results while typing, and a home feed. Every first-save of a URL enriches a crowd-built global index (see `07-catalog.md` for the contribution protocol and its privacy rules).
5. **Private by architecture.** Private vault = files on the user's device; on-device AI (Whisper transcription, embedding-based tagging) by default; cloud enrichment opt-in; shared folders visibly server-side.
6. **Open ecosystem.** Connectors, schemas, and (later) renderers are open-source packages in a public store. Third parties (e.g., Oura) publish connectors that bundle their own dashboard templates.
7. **Your marks on everything.** Per-user status ("reading", "want to go") and ratings on any link — Goodreads/IMDb/Maps functionality generalized across domains (see `09-status-and-ratings.md`). Private always (even in shared folders, each member sees only their own overlay); shown in the library and across discovery; source ratings (Amazon/IMDb/Google) extracted client-side; a k-thresholded **Waffle community rating** emerges from the network at P3 — rank anything, see how others ranked it.

## The user promise, in one scenario

Share "Puglia 2027" with friends (editor role via invite link). Anyone saves a Google Maps place from the share sheet; it lands as a link topping with coordinates and a photo. The folder has a map view. Nothing was configured.

## Boundaries held deliberately

- Client-side extraction covers **user-initiated saves**: metadata + one thumbnail + link out (the Pinterest pattern). Bulk scraping, anti-bot circumvention, and full-image-set caching are out of scope by design.
- Waffle is not Grafana: datasets exist only to feed widgets.
- Full third-party *plugin* surface (beyond connectors) waits until the sandbox story is proven.
