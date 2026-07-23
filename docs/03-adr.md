# Architecture Decision Records

Load-bearing decisions, frozen 2026-07-22. Reversing any of these after P0 code exists is expensive; each records its *why*.

## ADR-001 — One TypeScript codebase, PWA-first, wrapped
React + TS + Vite PWA; Capacitor for iOS/Android; Tauri 2 for desktop. The product is DOM-heavy (CodeMirror, masonry, pdf.js, sandboxed HTML previews) — native frameworks would embed webviews anyway. One codebase is the maintainability requirement made structural.

## ADR-002 — SQLite everywhere, behind one adapter
wa-sqlite/OPFS on web; native drivers on Capacitor/Tauri. One schema, one query language, every platform. The DB is an index for private vaults (rebuildable), a cache for shared folders, and the home of datasets.

## ADR-003 — Toppings: one table for all item types
`type ∈ {note, link, file, dash}` on a single `toppings` table. Interleaved sorting, one view engine, one thumbnail pipeline, one property system. Dashboards being toppings gives them thumbnails, folders, and shareability for free.

## ADR-004 — Two storage classes: files-canonical private, server-homed shared
Private folders: files on disk are truth (`.md` + frontmatter canonical for notes), Obsidian-compatible, Finder-native. Shared folders: server is truth (Drive semantics), local cache, LWW + tombstones. Sharing promotes a subtree. The UI hides the seam.

## ADR-005 — Grants from day 0, nearest-ancestor resolution
`owner_id` on every row; `grants(folder_id, grantee, role)`; effective access = nearest ancestor grant, no deny rules (exact Drive model). Dormant until identity ships. Retrofitting ACLs onto a single-user schema is migration hell; carrying dormant columns is nearly free.

## ADR-006 — Renderer registry, not a layout enum
Every layout and widget = `(query results → props) → component`, registered by key. Custom visualizations (map, body-map, canvas) cost one file, not a refactor. This is the extensibility seam for future renderer packages.

## ADR-007 — Datasets are not toppings
Connector-fed tables live beside the library, surfaced only through widgets. Keeps Waffle a library with a pantry rather than dissolving into Grafana; keeps the tree curated.

## ADR-008 — Connectors are sandboxed store packages; first-party dogfoods the SDK
Signed package = manifest (network allowlist, declared tables, auth type, schedule, bundled templates) + one TS module in a Worker sandbox with an RPC bridge. No DB handle, no library access, no undeclared hosts — *data in, nothing out*. All first-party connectors (Home Assistant, HealthKit, CSV, GoCardless) are store packages that ship pre-installed (VS Code discipline). Contrast deliberately with Obsidian's full-disk-access plugin model.

## ADR-009 — Canonical schema catalog with international standards; adopt, don't invent
Open `waffle-schemas` catalog. Health: IEEE 1752 / Open mHealth shapes, FHIR-mappable naming (EHDS-ready, not FHIR-compliant). Units: UCUM codes attached to schema fields — storage is canonical (SI-ish), conversion happens once at ingest via SDK util, display converts per user preference. Finance: ISO 4217. Time: ISO 8601 UTC + IANA tz. Vendor extras go to namespaced extension tables (FHIR core+extensions pattern).

## ADR-010 — Currency converts at query time, never at ingest
Currency is a time-varying unit. Store native currency + `fx_rates`; converting at ingest destroys information. (Physical units convert at ingest — lossless.)

## ADR-011 — Multi-provider collisions resolve by source priority
Every canonical dataset row carries `source`; each canonical table has a user-orderable provider priority (Apple Health model). Widgets read the winner; provenance is never destroyed. Ships with the canonical layer, or multi-provider users get double-counted data.

## ADR-012 — Thumbnail pipeline is precomputed; placeholders are instant
Extract (og:image / file render / md first-image / video frame) else generate deterministic placeholder (type ramp fill + glyph). The grid never decodes originals. This plus virtualized masonry is the entire "Pinterest smoothness" contract.

*Amended 2026-07-22 (dependency budget, docs/08):* v1 ships **one** generated size (480w webp) + **dominant color** placeholder (~10 lines of own code) + stored aspect ratio. Local-first thumbs load from OPFS in single-digit ms, so blurhash — whose value is masking *network* latency — is deferred until remote images exist (P2 server-homed folders); its column stays dormant. The second size arrives with the first preview surface that consumes it.

## ADR-013 — `.waffle/` mirrors vault metadata for portability
Views, link/file properties, and tag data mirror into `.waffle/` inside the vault (the `.obsidian/` pattern) so a vault copied to another machine carries its structure. `index.sqlite` is rebuildable from the folder at any time.

## ADR-014 — Manual ordering via fractional index keys
Per-view `order_key` (fractional indexing, Figma/Linear pattern): a drag-drop writes one row. Required for "keep my custom sorting" at scale.

## ADR-015 — Link details: domain for extraction, type for display
Site adapters match by host rules (password-manager style, subdomain wildcards) and produce **schema.org-typed records**; detail templates register against **types** and dispatch most-specific-first up the hierarchy with a `Thing` fallback. Never domain→display: one `Product` template covers every store, and catalog records from other users render without their adapters. Templates are **pure render** (typed record in → view out — the ADR-006 contract); only extraction runs code, inside the existing sandbox. Contributor verticals ship as one store package: adapter + namespaced extension type + template. Full design: docs/10-link-details.md.

## ADR-016 — Notes are rows: no user-created database tables
An "Airtable table" is a table VIEW over notes (frontmatter = columns). One mental model, files-canonical, Obsidian-portable. Real user-tables are deferred until a case passes the breakage tests (10k+ rows, seconds-frequency writes, pure relational webs, fast concurrent cell edits — docs/12); CSV→dataset via the pantry covers big-tabular analysis meanwhile.

*Amended 2026-07-23:* kinds a YAML scalar can't express (select, money, duration, coords) are carried by vault-level key→kind declarations at `.waffle/properties.json` — Obsidian's `types.json` pattern, files-canonical, read by the scanner at scan time and written by the table's add-column flow. Undeclared keys fall back to value inference.

## ADR-017 — Lists reference; folders contain
Folders are single-parent containment (where things live, files). Lists are many-to-many curated sequences referencing local toppings OR catalog entities, ordered or not, publishable as catalog objects, with derived progress from member interactions. A List is itself a topping backed by a `.list` file. (docs/11)

## ADR-018 — Source-synced folders: field ownership on shared files
Topping-materializing connectors (contacts → CRM) merge at FIELD level: connector-owned frontmatter keys vs user-owned keys + body; identity by source ID in frontmatter; deletions flag, never delete; one-way first. Local-vault only — never catalog/community. (docs/05, docs/12)

## ADR-019 — Open-core boundary
The client is open source (AGPL-3.0, this repo); the connector SDK and `waffle-schemas` open under MIT as they are extracted; the catalog contribution protocol (including its k-anonymity rules) is published; server-side catalog services (data, aggregation, ranking) are proprietary and live in a separate private repo. Public app-shell deploys carry no data and no secrets — local-first means the bundle is empty until a user brings a vault.

## ADR-020 — Obsidian config sync: bidirectional, field-level ownership
`.obsidian/types.json` and `*.base` files are vault files, so their derived state syncs at every scan — no import step. Types merge add-only (existing Waffle declarations win). Views derived from a base carry `cfg.origin = {base, view, spec}` where `spec` is the canonical last-imported state: while a view still matches `spec` it is sync-owned (auto-creates/updates/removes, self-heals duplicates); Waffle edits to a derived view write BACK into the `.base` view node via comment-preserving YAML document surgery — only owned keys (name/type/filters/order/sort), with base-level filter children structurally subtracted first. Any state Bases can't express (masonry/list layouts, edited shared conditions, unsupported operators) FREEZES the view — write nothing, report, never corrupt a user file. Fields with no Bases spelling at all (groupBy) sit outside the sync contract entirely: excluded from `spec`, preserved across updates in both directions. After every write-back the view re-derives from the new file and stores that canonical state (anti-flap); the reconcile runs in one exclusive transaction so concurrent syncs serialize. Extension recipe: `docs/recipes/extend-obsidian-sync.md`.

## ADR-021 — Soft delete: files move to `.trash/`
Deleting a topping moves its file into `.trash/` inside the vault — Obsidian's own convention, so both apps share one trash — and the targeted rescan tombstones the row. Nothing in the app hard-deletes user bytes; recovery is moving the file back (a restore UI can come later). Write sites that delete must cancel any pending debounced save first, or the save resurrects the file.
