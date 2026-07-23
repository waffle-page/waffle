# Recipe: add a property type

A property *kind* is one variant of the `PropertyValue` union. The whole system
is a closed loop around it: YAML frontmatter → typed value → EAV row → table
cell → YAML again. Adding a kind = extending each hop. No schema migration —
the `properties` table stores kind as TEXT.

Worked example to crib from: `money` (declaration-carried) or `date`
(value-inferred). For a non-scalar example, `list` preserves an Obsidian
List/`multitext` YAML sequence and stores its canonical clipboard/editor form
as a JSON array.

`unsupported` is not a user-facing property kind. It is a read-only inference
carrier for JSON-compatible YAML maps and nested sequences. Never add it to
`KINDS` or `EDITABLE_KINDS`: its sole purpose is to keep a structure visible
without allowing an editor to coerce it into a scalar. Authorability must also
be checked per value: a nested value beneath a declared `list` column remains
`unsupported` and is skipped by single edit, bulk edit, paste, and fill-down.
Explicit clear may delete it, as with other read-only property kinds.

## 1. The type — `packages/core/src/types.ts`

Add the variant to `PropertyValue`. Name fields in domain language
(`amount`/`currency`, not `a`/`b`).

## 2. The round-trip — `packages/core/src/vault/frontmatter.ts`

| Function | What to add |
| --- | --- |
| `inferProperty` | Only if the kind is recognizable from a bare YAML value (like `date` from `2026-01-01`, or `list` from a scalar sequence). Most new kinds skip this. |
| `declaredProperty` | Coerce the YAML value when the key is declared with your kind in `.waffle/properties.json`. Return `null` on mismatch (falls back to inference — wrong-typed values must stay visible). |
| `propertyToYaml` | The value editors write back. It must survive `parseNote` + the declaration and return as the same kind **and YAML shape**; a sequence must never become a scalar. |
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
- If the display delimiter can also occur inside a value, do not use it as the
  editor or clipboard grammar. `list` displays with separators but edits and
  copies as JSON; this is what makes commas, tabs, and newlines reversible.

## 5. Query behavior — `apps/web/src/library/queries.ts`

SQL sorts `value_num` first and `value_text` second. Filters use the same EAV
columns; grouping reconstructs the value through `fromEavColumns` and calls
`formatProperty`. Decide and document the new kind's canonical ordering and
filter semantics. `list` currently stores compact JSON in `value_text`, so
sorting is lexical and `contains` searches the serialized scalar items.

## That's all

The table derives columns, options, and editors from the declaration + data;
the scanner types values on the next scan. `duration` and `coords` currently
stop at step 4's display half — finishing them is this recipe.
