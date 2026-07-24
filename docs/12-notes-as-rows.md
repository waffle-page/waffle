# Notes as Rows

The user-tables doctrine (ADR-016): Waffle does NOT give users database
tables. An "Airtable table" in Waffle is a **view over markdown files** — each
row is a note whose frontmatter holds the columns. One mental model
(everything is a topping), files-canonical, Obsidian-portable.

## The wedding test

Plan a whole wedding without a single new storage concept:

- **Guests** — folder, one note per guest (`rsvp: select`, `table: 7`,
  `dietary: [veggie]`, `plus_one: true`) → table view grouped by table,
  filtered `rsvp = yes`.
- **Timeline** — folder of event notes with time properties → sorted list
  (timeline layout later, as a registry entry).
- **Vendors** — notes with `money` properties → a dashboard widget SUMS them
  (dashboards query the library, not only the pantry).
- **Relations** (guest → table, vendor → event) — a `relation` property kind:
  a typed wikilink (P2, reuses machinery).

## What makes it sing (small features, not engines)

1. **Create-row-in-table**: typing into the grid's empty row creates the note.
2. **Bulk property edit** across selected rows.
3. **Folder templates**: "Wedding planner" scaffolds Guests/Tables/Timeline/
   Vendors with pre-made views + properties in one tap — the templates/AI
   surface from the original vision (AI can suggest and generate these).

## Shipped table interaction contract

The table's selection, editing, clipboard, paste, mutation, virtualization,
accessibility, and regression contract is executable rather than implicit:
[`docs/recipes/verify-table-interactions.md`](recipes/verify-table-interactions.md).
Any change to the table quarantine, property parsing, grouping, or rescanning
must run the relevant sections and record the result in its commit or PR.

## When notes-as-rows genuinely breaks (the deferral tests)

Only these justify revisiting real user-tables:

- **Scale**: ~10k+ rows (a 10k-file folder is slow to scan, absurd in Finder).
- **Write frequency**: rows changing every few seconds (that's the pantry).
- **Pure relational data**: junction tables, cross-table formula/rollup webs —
  rows with no life as documents.
- **Fast concurrent multi-user cell edits** where per-file LWW is too coarse.

Escape hatch that already exists: CSV → dataset (pantry) + dashboards covers
the analysis half of big tabular data without user-facing table editing.

## Source-synced folders (contacts → CRM)

Notes-as-rows extends to LIVE-SYNCED sources via **topping-materializing
connectors** (ADR-018, machinery in 05-connector-sdk): an address book
becomes a folder of contact notes. The CRM assembles from existing rails —
`Person`-bound status set (reach out → in conversation → met), relation
properties (contact → company), and backlinks-as-interaction-timeline (every
meeting note mentioning [[Name]] is that contact's history, free).

Source fields and the user's dossier do not fight: name/phone/email/address are
connector-owned and visibly linked; body/tags/status/custom properties remain
user-owned. A source deletion flags the note, while a user deletion suppresses
future rematerialization. The complete Apple/Google Contacts reconciliation,
identity, duplicate-source, and CRM experience contract is
`15-connector-driven-experiences.md`.
