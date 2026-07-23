# Recipe: extend the Obsidian sync

The sync pair (`apps/web/src/importer/obsidianImport.ts` +
`baseWriteback.ts`) is quarantine code: it rewrites USER FILES. Its two
invariants outrank any feature:

1. **Freeze, never corrupt.** If a state can't be expressed in Bases syntax,
   write nothing and let the view become Waffle-owned. A wrong write into a
   user's `.base` is strictly worse than no sync.
2. **Round-trip stability (anti-flap).** Whatever `baseWriteback` emits must
   re-import through `reimportView` to byte-identical `specOf(...)` output.
   If import and export disagree, sync oscillates on every scan.

## Adding support for a Bases filter construct (e.g. `not:`, a new function)

Touch BOTH directions in the same PR, symmetric or not at all:

| Direction | Where |
| --- | --- |
| Import | `parseFilterBlock` / `parseExpr` in `obsidianImport.ts` — produce a `FilterNode`; remove the corresponding skip line |
| Export | `toExpression` in `baseWriteback.ts` — serialize that node back; remove its freeze path |
| Query | If it needs new SQL, `filterSql` in `apps/web/src/library/queries.ts` (e.g. NOT wraps the fragment) |
| UI | `FilterPopover` ops list, if users should author it |

Then verify the loop live: put the construct in the fixture `Recetas.base`,
scan, edit that view in Waffle, reload — the construct must survive both
crossings unchanged.

## Adding a synced view field (today: name/type/filters/order/sort)

Extend `specOf` (it defines the sync contract), `planViewImport` (import),
and the `doc.setIn` block in `writeBackView` (export). Anything in `specOf`
marks divergence when edited — so a field belongs there ONLY if write-back
can express it.

## Adding a Waffle-side field (like groupBy)

The opposite: keep it OUT of `specOf`, out of write-back, and preserve it
explicitly in the two places that rebuild cfg wholesale — the auto-update
branch in `syncObsidian` and the canonicalization tail of `writeBackView`
(both currently carry `groupBy` across; follow that pattern).

## Adding an Obsidian property type mapping

`OBSIDIAN_KIND` in `obsidianImport.ts`. Only map types with a real Waffle
kind (see docs/recipes/add-a-property-type.md for creating one — `multitext`
waits on a list kind).

## Concurrency

The reconcile runs inside one `db.transaction` — keep every view mutation in
that scope. StrictMode double-mounts WILL run two syncs; the transaction is
what makes the second a no-op instead of a duplicator.
