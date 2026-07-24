# Architecture Decision Records

Load-bearing decisions, frozen 2026-07-22. Reversing any of these after P0 code exists is expensive; each records its *why*.

## ADR-001 — One TypeScript codebase, PWA-first, wrapped
React + TS + Vite PWA; Capacitor for iOS/Android; Tauri 2 for desktop. The product is DOM-heavy (CodeMirror, masonry, pdf.js, sandboxed HTML previews) — native frameworks would embed webviews anyway. One codebase is the maintainability requirement made structural.

## ADR-002 — SQLite everywhere, behind one adapter
`@sqlite.org/sqlite-wasm` (the official SQLite WASM build) over OPFS on web; native drivers on Capacitor/Tauri. One schema, one query language, every platform. The DB is an index for private vaults (rebuildable), a cache for shared folders, and the home of datasets.

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

*Amended 2026-07-23:* kinds a YAML scalar can't express (select, money, duration, coords) are carried by vault-level key→kind declarations at `.waffle/properties.json` — Obsidian's `types.json` pattern, files-canonical, read by the scanner at scan time and written by the table's add-column flow. Undeclared keys fall back to value inference. YAML scalar sequences infer as the `list` kind (Obsidian `multitext`) and remain sequences on write; nested structures Waffle cannot author use a read-only safety carrier, never editable scalar text.

## ADR-017 — Lists reference; folders contain
Folders are single-parent containment (where things live, files). Lists are many-to-many curated sequences referencing local toppings OR catalog entities, ordered or not, publishable as catalog objects, with derived progress from member interactions. A List is itself a topping backed by a `.list` file. (docs/11)

## ADR-018 — Source-synced folders: field ownership on shared files
Topping-materializing connectors (contacts → CRM) merge at FIELD level: connector-owned frontmatter keys vs user-owned keys + body; identity by source ID in frontmatter; deletions flag, never delete; one-way first. Local-vault only — never catalog/community. (docs/05, docs/12)

## ADR-019 — Open-core boundary
The client is open source (AGPL-3.0, this repo); the connector SDK and `waffle-schemas` open under MIT as they are extracted; the catalog contribution protocol (including its k-anonymity rules) is published; server-side catalog services (data, aggregation, ranking) are proprietary and live in a separate private repo. Public app-shell deploys carry no data and no secrets — local-first means the bundle is empty until a user brings a vault.

## ADR-020 — Obsidian config sync: bidirectional, field-level ownership
`.obsidian/types.json` and `*.base` files are vault files, so their derived state syncs at every scan — no import step. Types merge add-only (existing Waffle declarations win). Views derived from a base carry `cfg.origin = {base, view, spec}` where `spec` is the canonical last-imported state: while a view still matches `spec` it is sync-owned (auto-creates/updates/removes, self-heals duplicates); Waffle edits to a derived view write BACK into the `.base` view node via comment-preserving YAML document surgery — only owned keys (name/type/filters/order/sort/groupBy and the ordered properties' `columnSize` entries), with base-level filter children structurally subtracted first. Unknown `columnSize` entries remain untouched.

*Amended 2026-07-23 (agreed compatibility slice):* table, cards, and list layouts; directional `groupBy`; recursive AND/OR/NOT; leading expression negation; and the representable `file.*` subset round-trip symmetrically. A Base is vault-global unless a positive `file.inFolder` predicate scopes it to that folder and descendants. Unsupported filters and view states are all-or-nothing: a new misleading projection is not created, an existing projection freezes, and write-back changes no bytes. After every successful write-back the view re-derives from the file and stores that canonical state (anti-flap); the reconcile runs in one exclusive transaction so concurrent syncs serialize. Exact support matrix and extension procedure: `docs/recipes/extend-obsidian-sync.md`.

## ADR-021 — Soft delete: files move to `.trash/`
Deleting a topping moves its file into `.trash/` inside the vault — Obsidian's own convention, so both apps share one trash — and the targeted rescan tombstones the row. Nothing in the app hard-deletes user bytes; recovery is moving the file back (a restore UI can come later). Write sites that delete must cancel any pending debounced save first, or the save resurrects the file.

## ADR-022 — Durable identity lives in vault metadata, never paths or hashes
Before Lists, duplication, publishing, managed sync, or sharing depend on it,
every vault, folder, and topping receives a durable random ID persisted under
`.waffle/`. Paths and content hashes remain reconciliation evidence only.
Folder/topping identity must survive renames and full SQLite reconstruction; a
duplicate receives a new ID. This closes the deliberate v1 scanner limitation
where folder identity is path-derived and topping UUIDs exist only in the
disposable mirror. Exact metadata layout and migration require the gate in
docs/14 before scanner code changes.

## ADR-023 — Accountless forever; managed personal and shared sync are E2EE
Local Waffle requires no account. Authentication never implies upload: Sync,
Share, and Publish are separate explicit ceremonies. Personal Sync transports
end-to-end encrypted replicas while local files remain canonical. Shared
folders remain server-homed under ADR-004, but the authoritative server state
is ciphertext; granted member devices hold decryption keys and query local
decrypted caches. Supabase RLS is defense in depth, not the plaintext boundary.
Publishing deliberately creates a separate public projection. Key management,
membership epochs, recovery, remote-only hydration, conflict/version protocol,
and large-vault restore must pass docs/14's pre-implementation ADR/security
gate.

## ADR-024 — Experiences materialize existing primitives
Beginner-facing experiences (Trip Planner, Wardrobe, Net Worth) are recipes
that create ordinary property declarations, saved views, field mappings,
Lists, and dashboards. They are not another storage or renderer engine.
Suggestions are inert until accepted; accepted output belongs to the user and
never silently tracks later inference. The advanced escape hatch is **+ Custom
view**. Folder/view/List choice, Add, search scopes, and privacy rules are in
docs/13.

## ADR-025 — Connector suggestions are host-matched declarations
Connectors may declare canonical outputs, coarse intent hints, and bundled
experience recipes in their manifests; they never inspect folder names,
library rows, notes, or other datasets to decide what to suggest. The trusted
host matches manifest metadata to an on-device folder profile and materializes
accepted recipes. Entity sources (Contacts) use field-owned file
materialization; time-series sources (Oura) use canonical datasets. Source
deletion flags rather than deletes, while a user's soft-delete creates a
suppression tombstone so later pulls cannot resurrect it. Full reference flows:
docs/15.

## ADR-026 — URL identity is a versioned, evidence-bounded projection
The exact URL in a user's `.url` file remains canonical and unchanged. During
scan, a pure versioned normalizer derives a raw alias and candidate entity.
Generic normalization removes only an explicit tracking-parameter allowlist;
unknown parameters and fragments remain. Provider adapters may replace that
candidate only with documented stable evidence. The first adapter recognizes
an exact allowlist of Google Maps hosts and Search URLs carrying exactly one
`query_place_id`; it does not
interpret directions, shortened links, redirects, CID/data blobs, names, or
coordinates. Scan performs no network I/O.

`url_entity_aliases` and `topping_entities` are disposable projections. A
normalizer-version change reprojects them from the vault. Existing personal
marks move from a raw alias to its candidate only when the destination is empty
or semantically identical. Differing marks for the same owner/status set block
that alias from converging; both inputs remain addressable until a future
conflict-resolution surface exists. If a later rule changes an already-shared
candidate that carries marks, scan retains the prior effective entity rather
than guessing whether those marks belong to other aliases. Network/manual
aliases, obsolete provider-ID succession, durable interaction storage, and
encrypted multi-device identity require the still-open design gate in GitHub
issue #1 before code. ADR-027 additionally requires those durable forms to use
the generic private entity/identifier/claim substrate.

## ADR-027 — The provider-neutral Catalog is a separate proprietary product
Waffle Core remains a complete local-first library with no runtime dependency
on the Catalog. The master entity/claim graph, resolution, ranking,
aggregation, moderation, and corpus are a separate proprietary product behind
ADR-019's private server boundary. The shared schema vocabulary and
contribution protocol remain open and auditable; public discovery access does
not make the underlying corpus open data.

Catalog entity IDs are opaque, stable, and Waffle-controlled. URLs and
external identifiers—including ISBNs, GTINs, DOIs, IMDb IDs, MusicBrainz IDs,
Place IDs, merchant SKUs, and creator IDs—are claims with provenance,
confidence, observed/valid time, rights, and succession state, never permanent
identity. Facts, typed relationships, and media use the same claim discipline.
Merges create redirects, splits and disputes preserve history, and an explicit
**Same thing** operation never rewrites raw user files.

Private local evidence and owner overlays remain separate from the public
Catalog projection. Contributions require a distinct ceremony and exclude
private entity IDs, exact location, folder/co-save context, IP history, and a
stable public user identifier. Catalog acquisition is limited to
user-initiated actions, permitted metadata and APIs, feeds, licensed/open
datasets, standards, and partnerships; unauthorized bulk crawling,
authentication/quota circumvention, private-API imitation, and indiscriminate
republication are not foundations.

ADR-026's hashed `entity_key` remains a disposable local candidate bridge, not
a durable Waffle or Catalog entity ID. URL sub-slice B waits for a generic
portable private entity/identifier/claim substrate and its implementation ADR.
Full contract: `docs/16-catalog-product-and-entity-graph.md`.
