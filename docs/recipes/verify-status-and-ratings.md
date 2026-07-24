# Manual acceptance: status and ratings in the library

Executable specification for the personal-marks projection in
`apps/web/src/library/queries.ts`, the scanner-derived
`topping_entities` mapping, and `packages/ui/src/InteractionBadges.tsx`.

## Invariants

1. A mark belongs to `(owner, entity, status set)`, never to a topping or
   shared frontmatter property.
2. A URL entity key hashes the trimmed URL. It is not the `.url` carrier's
   `toppings.content_hash`.
3. `topping_entities` is disposable scanner output. Full scan and
   `rescanFile` reconstruct it without changing user files.
4. Renderers receive presentation-ready marks and perform no DB/entity work.
5. **My status** and **My rating** are saved-view filters. A topping without a
   corresponding mark does not match, including `is not`.
6. Frontmatter properties named `rating` or `status` remain independent.

## Fixture exercise

Start `pnpm dev`, open `?dev`, then **Create fixture vault** → **Scan vault**.
Return to the library and use only that fixture.

1. Open **Trips** and the `masseria-torre` link. Set Tasks to **Done** and the
   personal rating to 8/10; return to the library.
2. Confirm compact **Done** and **★ 8** badges appear without changing the
   card's measured height. Check masonry, grid, list, and table.
3. Open Filter, add **My status is Done**, apply, and confirm the link remains
   while unmarked toppings do not.
4. Add **My rating ≥ 8** to the same view. Confirm the result remains. Change
   the detail rating below 8, close it, and confirm the active projection
   refreshes to zero without a page reload.
5. Remove the rating condition, reopen the link, restore 8, and confirm the
   badges and result return.
6. Add the same URL as a second link topping. After scan/requery, confirm both
   toppings display the same marks: entity identity, not topping identity.
7. Reload and scan. Confirm the badges and filters survive and the entity
   reference mapping is reconstructed for a pre-existing unchanged `.url`.
8. Open **Recipes → Mejores recetas**. Its frontmatter `rating` filter and
   property values remain unchanged; **My rating** is a distinct field.
9. Exercise one ordinary title/property filter and every layout again. Confirm
   no duplicate rows, broken grouping, or table selection regression.

## Scale check

In `?dev`, seed 20,000 toppings and run the benchmark. Open Everything in each
layout and the filter editor. The absent interaction mapping for synthetic
rows must remain cheap: no per-card query and no URL hashing during render.
