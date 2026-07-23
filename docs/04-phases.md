# Phases

Each phase ships something usable. Discovery and network features stand on a spine that already works.

| Phase | Ships | Contents |
| --- | --- | --- |
| **P0 — Spine** | Working vault PWA | Monorepo; schema v1 (grants dormant); folder tree (nested); add note/link/file; unified virtualized masonry + list; thumbnail pipeline + generated fallbacks; per-folder persisted sort/filter (views v1); CodeMirror md editor with preview, mermaid, wikilinks; record audio → playable inline in note |
| **P1 — Structure + Identity** | Airtable-for-dummies, signed in | Typed properties UI; table view + filter/sort/group; saved-view manager (multiple views, defaults); **personal status + ratings** (entity-keyed, slots + status sets, per `09-status-and-ratings.md`); **theme palette editor** (seed colors → OKLCH-derived ladder, WCAG guard); Obsidian importer (frontmatter types + `.base` → views); Supabase auth; Capacitor iOS/Android + share extension; Tauri desktop wrapper (native watcher); on-device Whisper transcription |
| **P2 — Sharing + Discovery** | Shared folders live; the Pinterest feel | Invite links, roles, subtree inheritance, server-homed shared class; **unlisted public publishing for one topping or folder, with revocable share URLs and crawler-visible preview cards**; map layout; AI tagging on save (on-device embeddings, optional cloud); **contextual add sheet** — two rails from folder context: source/store recommendations (type-dependent) + AI query chips; product/video extraction (JSON-LD/oEmbed/og: price, duration, images, **source ratings**); status/rating overlays on every discovery + add-flow surface; store circles + in-app browse-and-save; HEIC/PDF/HTML previews |
| **P3 — Network** | Global catalog + feed | Global catalog (see `07-catalog.md`: contribution protocol, opportunistic refresh, FTS + vector + facet/geo search, entity resolution in P3.x); home feed (continue-your-folders + suggestions); **community ratings** (k-thresholded aggregates); live-feed connectors (PSD2 banks via broker); dashboards + AI-suggested templates; connector store opens |

## P2 public-link publishing contract

Public-link publishing is not collaborative sharing and is not P3 catalog
publication. It is an explicit, unlisted, read-only projection for anyone who
has the URL:

| Published target | Public page | Dedicated share image |
| --- | --- | --- |
| One topping | Read-only topping detail | Its thumbnail, or a generated type fallback |
| One folder | Read-only folder using its chosen/default saved view | Folder cover or generated collage of member thumbnails |

- **Explicit boundary:** publish, copy link, and revoke are deliberate actions;
  links are unlisted and `noindex` by default. Nothing local becomes public
  merely because it is shared with collaborators.
- **Files remain canonical:** publication uploads only the derived public
  projection and referenced preview assets. It does not create a third
  canonical storage class or silently promote the private vault.
- **Real unfurls:** the public URL returns server-rendered metadata without
  authentication or client JavaScript: canonical URL, title, description,
  `og:type`, absolute `og:image`, image MIME and dimensions, plus equivalent
  Twitter Card fields. The image is served from public HTTP storage—not OPFS
  or a session-bound blob—so WhatsApp, Messages, Slack, and similar crawlers
  can fetch it.
- **One preview identity per publication:** each published topping/folder owns
  a stable share-image asset that can be regenerated when its source thumbnail
  or folder cover changes without changing the public URL.
- **Revocation is honest:** the origin page and assets stop resolving after
  revoke; the UI warns that third-party preview caches may retain an older
  card temporarily.
- **Pre-implementation gate:** write the publishing ADR before code to settle
  live projection versus explicit snapshot/republish, token entropy, asset
  retention, and cache invalidation. This requirement does not reopen the
  settled private/shared storage model.

## P0 build order

| # | Step | Why this position |
| --- | --- | --- |
| 1 | **Scaffold**: pnpm monorepo, Vite + React + TS PWA shell, platform adapter interfaces (fs / sqlite / fetch / share) with web implementations | Every later piece plugs into the adapters; validates the one-codebase bet immediately |
| 2 | **Data spine**: wa-sqlite over OPFS, schema v1 + migration runner, FTS5 | Riskiest web-platform bet — validate in days, not months; everything reads/writes through it |
| 3 | **Vault engine**: FS Access folder binding, watcher/scanner, frontmatter indexer, `.waffle/` metadata, hash re-association | Test corpus from day one: a copy of a real Obsidian vault |
| 4 | **Library UI**: folder tree, unified toppings query, virtualized masonry + list, per-folder persisted views — built on the **semantic token contract** (themeable from day one: light/dark/system, tokens only, no raw colors) | First visible product; exercises the whole stack below it |
| 5 | **Thumbnail pipeline**: extract → generated fallback → 2-size webp + blurhash | **Milestone: 20,000 synthetic toppings, smooth scroll** |
| 6 | **Editor**: CodeMirror 6, preview, mermaid, wikilink resolution, audio record → attach → inline player | |
| 7 | **Add flows**: paste-URL unfurl (native fetch via minimal Tauri dev shell — pure-web CORS is the known limit), file drop, note create | |

**Milestone — "the spine walks"**: drop an Obsidian vault in → browse smoothly → add all three topping types → custom sort survives restart → Finder round-trip (drag out, drag in, rename outside the app).

## Deferred by design

Real-time note co-editing (shared folders use LWW first) · third-party renderer/plugin surface (connectors prove the sandbox first) · locally materialized mirror of shared folders · canvas renderer · full-image-set product caching (business decision, see vision boundaries).
