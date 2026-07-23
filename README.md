# Waffle 🧇

A **local-first everything-library**. Folders hold **toppings** — notes, links, files, dashboards — each with a thumbnail, typed properties, and tags. Every folder renders through saved Airtable-style views: masonry, list, table, and more to come. Live personal data flows into datasets via sandboxed connectors. Discovery is built in.

*Airtable for non-technical people, with Obsidian's soul and Pinterest's eyes.*

- **Files are canonical.** Your vault is a normal folder: `.md` notes with YAML frontmatter, `.url` links, real files. Drop in an Obsidian vault and it just works; everything Waffle writes stays readable by Obsidian, Finder, and `grep`.
- **Private by architecture.** The app is a PWA whose bundle carries no data and no secrets. Your library lives on your device; nothing leaves it without an explicit, visible choice.
- **Typed properties without database jargon.** An "Airtable table" here is a view over notes — frontmatter keys become columns (`docs/12-notes-as-rows.md`).

## Status (2026-07-23)

**P0 — the spine — is complete and verified**: SQLite (OPFS) index over a real vault, virtualized masonry/grid/list smooth at 20k items, thumbnail pipeline, CodeMirror editor with Obsidian-style live preview, add flows.

**P1 — structure + identity — shipped so far:**

- Typed properties: 10 user-facing kinds including Obsidian List/`multitext`, vault-level declarations at `.waffle/properties.json` (Obsidian's `types.json` pattern), frontmatter-first writes with targeted rescans; nested YAML Waffle cannot author remains visible and read-only.
- The **table layout**: create-row-in-table, validated per-kind cell editors, bulk property edit, spreadsheet paste (Excel/Sheets/Airtable TSV → typed notes with auto-declared columns), cell/range selection, keyboard navigation, canonical TSV copy, paste-at-anchor with overflow notes, serialized same-note writes, persisted column resize/reorder, sticky Title, fill-down, and accessible active-cell/range semantics.
- **Saved-view manager**: named views per folder with defaults, filters compiled to SQL, property sorts, group-by in table/grid/list.
- Per-entity **status + ratings** (multi-axis slots) with the link detail view.
- **Paste/drop images** into notes (vault files + `![[…]]` embeds); a note's first embedded image becomes its card thumbnail.
- **Soft delete** to `.trash/` (ADR-021) from table selection and the editor.
- **Bidirectional Obsidian config sync** (ADR-020): `types.json` and `.base` files sync at every scan; table/cards/list views, directional grouping, recursive negation, and representable `file.*` predicates round-trip through comment-preserving YAML surgery; inexpressible states freeze safely.

**Next** (working agreements in [CLAUDE.md](CLAUDE.md)): simplify the three
large UI orchestrators around their actual mutation/view seams, then table
interaction slice C — in-memory session undo/redo for property writes and soft
deletes — and the P1 remainder.
Phase ladder: `docs/04-phases.md`.

## Try it

```bash
pnpm install
pnpm dev        # opens the app; ?dev = dev-spine harness (seed 20k toppings, benchmarks)
```

## Documentation

| Doc | Contents |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Working in this repo (humans and AI agents): read order, invariants, verification discipline, current position + next steps |
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
