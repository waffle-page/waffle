# Waffle 🧇

A **local-first everything-library**. Folders hold **toppings** — notes, links, files, dashboards — each with a thumbnail, typed properties, and tags. Every folder renders through saved Airtable-style views: masonry, list, table, and more to come. Live personal data flows into datasets via sandboxed connectors. Discovery is built in.

*Airtable for non-technical people, with Obsidian's soul and Pinterest's eyes.*

- **Files are canonical.** Your vault is a normal folder: `.md` notes with YAML frontmatter, `.url` links, real files. Drop in an Obsidian vault and it just works; everything Waffle writes stays readable by Obsidian, Finder, and `grep`.
- **Private by architecture.** The app is a PWA whose bundle carries no data and no secrets. Your library lives on your device; nothing leaves it without an explicit, visible choice.
- **Typed properties without database jargon.** An "Airtable table" here is a view over notes — frontmatter keys become columns (`docs/12-notes-as-rows.md`).

## Status

Early development, moving fast. The P0 spine is complete and verified: SQLite (OPFS) index over a real vault, virtualized masonry/grid/list at 20k items, thumbnail pipeline, CodeMirror editor with live preview, add flows, and the first P1 slices — typed properties, the table view (create-row-in-table, bulk edit), per-entity status + ratings, and the saved-view manager (multiple named views per folder with defaults, SQL-compiled filters, property sort, group-by). See `docs/04-phases.md` for the phase ladder.

## Try it

```bash
pnpm install
pnpm dev        # opens the app; ?dev = dev-spine harness (seed 20k toppings, benchmarks)
```

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/01-vision.md](docs/01-vision.md) | What Waffle is, inspirations, product pillars |
| [docs/02-architecture.md](docs/02-architecture.md) | Stack, storage classes, Finder covenant, performance |
| [docs/03-adr.md](docs/03-adr.md) | Architecture decision records |
| [docs/04-phases.md](docs/04-phases.md) | Phase ladder + build order |
| [docs/05-connector-sdk.md](docs/05-connector-sdk.md) | Connector packages, sandbox, store |
| [docs/06-schemas-and-units.md](docs/06-schemas-and-units.md) | Canonical schemas, units (UCUM/ISO) |
| [docs/07-catalog.md](docs/07-catalog.md) | Global catalog: contribution protocol, privacy (k-anonymity), search |
| [docs/08-code-conventions.md](docs/08-code-conventions.md) | The legibility SLO, quarantine list, anti-entropy rules |
| [docs/09-status-and-ratings.md](docs/09-status-and-ratings.md) | Per-user status/ratings, source ratings |
| [docs/10-link-details.md](docs/10-link-details.md) | Typed link detail views |
| [docs/11-lists.md](docs/11-lists.md) | Lists: curated many-to-many sequences, derived progress |
| [docs/12-notes-as-rows.md](docs/12-notes-as-rows.md) | The user-tables doctrine |
| [docs/recipes/](docs/recipes/) | How to add a property type, a renderer, … |

## Monorepo layout

```
packages/core     # types, schema migrations, vault engine (platform-agnostic, runtime-free)
packages/ui       # React component library (tokens, masonry, table, cards)
apps/web          # Vite PWA; platform adapters (SQLite worker over OPFS)
apps/mobile       # arrives P1 — Capacitor shell (iOS + Android, share extension)
apps/desktop      # arrives P1 — Tauri wrapper (native FS watching)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Start with `docs/08-code-conventions.md` — the standing order is that a competent TS developer arriving cold becomes productive in a day, and every change is held to that.

## License & trademark

Code and docs in this repository are licensed under [AGPL-3.0](LICENSE). Server-side catalog services are a separate, proprietary codebase (see ADR-019 in `docs/03-adr.md`). The "Waffle" name and marks are not granted by the license.
