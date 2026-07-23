# Recipe: extend the Obsidian sync

The sync quarantine is three files; the Library controller is its caller seam:

| Responsibility | File |
| --- | --- |
| Reconcile `.obsidian/types.json` + `*.base` into saved views | `apps/web/src/importer/obsidianImport.ts` |
| Pure Bases grammar and built-in-field mapping | `apps/web/src/importer/basesCompatibility.ts` |
| Patch owned view fields back into the canonical `.base` | `apps/web/src/importer/baseWriteback.ts` |
| Trigger write-back when a derived view is edited/removed | `apps/web/src/library/useLibraryViews.ts` |

They rewrite USER FILES. Three invariants outrank every feature:

1. **Freeze, never corrupt.** If Waffle cannot represent the complete view,
   do not create a misleading projection; if a derived projection already
   exists, leave it untouched. Write-back returns `frozen` before changing
   bytes.
2. **No partial filters.** A recursive filter is all-or-nothing. Dropping one
   child broadens the result set while claiming success.
3. **Round-trip stability (anti-flap).** Whatever `baseWriteback` emits must
   re-import through `reimportView` to byte-identical `specOf(...)` output.

Official grammar references:
[Bases syntax](https://obsidian.md/help/bases/syntax),
[Views](https://obsidian.md/help/bases/views), and
[Functions](https://obsidian.md/help/bases/functions).

## Current compatibility contract

| Bases construct | Waffle representation | Write-back |
| --- | --- | --- |
| `table`, `cards`, `list` | `table`, `grid`, `list` renderers | Symmetric |
| `and:`, `or:`, `not:` | Recursive `FilterNode` | Symmetric |
| Leading `!expression` | Unary `not` node | Emits a `not:` block |
| `== != < <= > >=` | Typed comparison | Symmetric |
| `.contains("…")` | Case-sensitive substring for scalars; exact member for lists | Symmetric |
| `file.hasTag(...)` | Exact/nested-tag predicate | Symmetric |
| `file.inFolder("…")` | Folder + descendants; projection is housed under that folder | Symmetric |
| `groupBy: {property, direction}` | `{key, dir}`; direction orders buckets | Symmetric |
| One sort rule | `ViewSort` | Symmetric |
| `order` + `columnSize` for note properties | `{key, width}[]` | Symmetric |
| `file.name` in `order` | Fixed Waffle Title column | Preserved |

Unsupported view types, view-specific settings, formula columns/filters,
multiple sorts, limits, and unrepresentable file columns freeze. They are
named in the sync report; they are never converted to a fallback layout or
partially dropped.

### Built-in file fields

“Supported” is contextual: Waffle can query more file metadata than its table
can display as columns.

| Bases field | Filter | Sort | Group | Table column |
| --- | --- | --- | --- | --- |
| `file.name` | `==`, `!=` | Freeze | Yes | Fixed Title |
| `file.basename` | Comparisons, `contains` | Yes | Yes | Freeze |
| `file.path` | Comparisons, `contains` | Yes | Yes | Freeze |
| `file.folder` | Comparisons, `contains`, `inFolder` | Yes | Yes | Freeze |
| `file.ext` | `==`, `!=` | Freeze | Yes | Freeze |
| `file.mtime` | Date comparisons | Yes | Yes | Freeze |
| `file.ctime`, `file.size`, links/embeds/backlinks | Freeze | Freeze | Freeze | Freeze |

`file.ctime` is deliberately unsupported: the web File System Access API does
not provide a trustworthy creation timestamp. `file.size` waits until size is
stored explicitly in the disposable index. Do not synthesize either.

## Adding a Bases filter construct

Touch every direction in the same change:

| Direction | Where |
| --- | --- |
| Import/export grammar | `parseFilterBlock` / `filterToBases` in `basesCompatibility.ts` |
| Query | `filterSql` in `apps/web/src/library/queries.ts` |
| UI | `FilterPopover`, only if Waffle should author it |

If the UI cannot represent the tree, keep it active and read-only. The current
popover does this for nested imported filters so Apply cannot flatten them.

## Adding a synced view field

Extend all four boundaries:

1. `BaseView` + `planViewImport`.
2. The persisted `ViewCfg`.
3. `specOf` — only after both directions exist.
4. The `doc.setIn` block in `writeBackView`.

`specOf` defines ownership. An import-only field in that snapshot is a defect:
Waffle would detect divergence but could not serialize the state it claims to
own.

Column order and widths form one Waffle field:
`columns: Array<{key, width}>`. Bases splits it into `order` plus
`columnSize`; `file.name` is the fixed Title column and is not put in the
Waffle array. Width import accepts `note.<key>`, while write-back updates only
ordered note-property entries and preserves unknown `columnSize` keys.

Persisted migrations are silent and paired. Legacy `groupBy: string` becomes
`{key, dir: "asc"}`. Pre-parity derived views omitted `groupBy` from
`origin.spec`, so `queries.parseCfg` seeds it from the live config; otherwise
migration alone would falsely classify an untouched view as diverged.

## Adding an Obsidian property type mapping

Edit `OBSIDIAN_KIND` in `obsidianImport.ts`. Only map types with a real Waffle
kind (see `docs/recipes/add-a-property-type.md`). Obsidian `multitext` maps to
Waffle `list`: YAML remains a sequence, while the table editor and clipboard
use a JSON array. Nested YAML structures infer as read-only `unsupported`; no
Obsidian declaration maps to that safety carrier.

## Manual acceptance specification

### Fixture pass

1. Run `pnpm dev`, open `?dev`, choose **Create fixture vault**, then
   **Scan vault**. Never use **Open folder…**.
2. Open **Recipes**. Confirm three derived views:
   `Mejores recetas` (table), `Todas` (cards), and `Vegetarianas` (list).
3. Confirm `Mejores recetas` contains Pasta but not Tiramisù: the base-level
   `file.inFolder` + `file.ext` filters and structured `not:` all apply.
4. Confirm `Todas` contains both recipe notes, including the descendant folder.
5. Confirm `Vegetarianas` contains both notes and its rating group headers are
   descending (`5` before `4.5`). Its `dietary.contains("vegetarian")`
   predicate uses list membership, and its leading-`!` filter remains active.
6. Open the Filter popover on a nested-filter view. It must state that filters
   are read-only; changing only group direction must not remove any filter.
7. Reload and rescan. No derived view duplicates, disappears, or changes
   ownership.

### File round-trip

1. Change `Vegetarianas` group direction in Waffle.
2. Read `Recipes/Recetas.base` through the fixture’s OPFS handle. Confirm
   `type: list`, both filter forms, `file.path` sort, note-property order, and
   `groupBy` survive; only owned YAML nodes changed.
3. Reload, rescan, and confirm the same view state re-imports without another
   write (anti-flap).

### Freeze pass

1. Add a temporary view using `file.size`, a second sort rule, or `limit`.
2. Scan. Confirm the sync report names the unsupported construct and no
   projection is created.
3. Make an existing derived view temporarily unsupported in the `.base`, then
   scan. Confirm its Waffle projection is neither updated nor removed.
4. Restore the valid fixture file and scan. Confirm reconciliation resumes.

## Concurrency

The reconcile runs inside one `db.transaction`. React StrictMode double-mounts;
the transaction makes the second sync observe the first pass instead of
creating duplicate views.
