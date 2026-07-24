# Recipe: add a renderer (layout)

Every layout is ONE file exporting a component with the shared `LayoutProps`
signature, plus one `registerLayout()` call at module load (ADR-006). The
picker, per-folder persistence, and view switching come free from the
registry — a new layout touches zero existing call sites.

## 1. Decide where it lives

- **Pure presentation** (masonry, grid, list): `packages/ui/src/layouts.tsx`
  or its own file in `packages/ui`, registered from `layouts.tsx`.
- **Needs platform access** (queries, vault writes): a file in
  `apps/web/src/library/`, self-registering, side-effect-imported once from
  `Library.tsx`. Precedent: `TableLayout.tsx` — the table edits frontmatter,
  so it cannot live in @waffle/ui (which never touches the DB or fs).

## 2. The component

```tsx
function BoardLayout({ items, loadThumb, onOpen }: LayoutProps) { ... }
```

`LayoutProps` (packages/ui/src/layouts.tsx) is the one shape every entry gets.
`items`, `loadThumb`, `onOpen` are universal; `folderId` / `onMutated` /
`tableConfig` / `onTableConfig` exist for editing-capable layouts — ignore
them in pure renderers. After any write your layout initiates, call
`onMutated` so the host swaps in fresh rows.

`LibraryItem.interactionMarks` already contains the current owner's
presentation-ready status labels and ratings. Render it with
`InteractionBadges` where the layout has room; never query interactions or
derive entity identity inside a renderer.

Virtualize anything unbounded: `@tanstack/react-virtual` via `VirtualList` /
`VirtualGrid` / `VirtualMasonry`, or directly (see `PropertyTable`). Tokens
only — no raw colors.

## 3. Register

```tsx
registerLayout({ key: 'board', label: 'Board', icon: BoardIcon, component: BoardLayout });
```

Key is permanent (it's stored in `views.layout` rows); pick it like a public
API name. Icon: add a glyph to `packages/ui/src/icons.tsx` in the Iconsax
style already there.

## 4. Update this doc's sibling

If the layout introduced a new extension seam of its own, write its recipe in
the same PR (docs/08-code-conventions.md → anti-entropy rules).
