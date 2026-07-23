# Recipe: add a property type

A property *kind* is one variant of the `PropertyValue` union. The whole system
is a closed loop around it: YAML frontmatter → typed value → EAV row → table
cell → YAML again. Adding a kind = extending each hop. No schema migration —
the `properties` table stores kind as TEXT.

Worked example to crib from: `money` (declaration-carried) or `date`
(value-inferred).

## 1. The type — `packages/core/src/types.ts`

Add the variant to `PropertyValue`. Name fields in domain language
(`amount`/`currency`, not `a`/`b`).

## 2. The round-trip — `packages/core/src/vault/frontmatter.ts`

| Function | What to add |
| --- | --- |
| `inferProperty` | Only if the kind is recognizable from a bare YAML scalar (like `date` from `2026-01-01`). Most new kinds skip this. |
| `declaredProperty` | Coerce the scalar when the key is declared with your kind in `.waffle/properties.json`. Return `null` on mismatch (falls back to inference — wrong-typed values must stay visible). |
| `propertyToYaml` | The scalar the editors write back. Must survive `parseNote` + the declaration and come back as the same kind. |
| `toEavColumns` / `fromEavColumns` | Map to/from `(value_text, value_num, value_aux)`. Put the *sortable* representation in `value_num` — that column is what indexes and column sorts use. |

## 3. The declaration — `packages/core/src/vault/propertyTypes.ts`

Add the kind to `KINDS`. If it needs per-key config (as `money` needs
`currency`), extend `PropertyTypeDecl` — the declaration file is
vault-canonical, so keep the shape JSON-simple.

## 4. The cell — `packages/ui/src/PropertyCell.tsx`

- `formatProperty` — display string (locale-aware where it applies).
- To make it *authorable*, not just displayable: add to `EDITABLE_KINDS`,
  `parseCellInput` (raw input string → value), `editorInitial`, and
  `INPUT_TYPE` if a native input type fits. Kinds not in `EDITABLE_KINDS`
  render read-only and are omitted from the add-column picker automatically.

## 5. Sorting — `apps/web/src/library/TableLayout.tsx`

Add a case to `sortValue` (mirror what you put in `value_num`).

## That's all

The table derives columns, options, and editors from the declaration + data;
the scanner types values on the next scan. `duration` and `coords` currently
stop at step 4's display half — finishing them is this recipe.
