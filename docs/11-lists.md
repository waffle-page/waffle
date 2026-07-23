# Lists

Curated sequences of things — a course of videos, "Netflix most watched," a
packing list, a Spotify-style discoverable collection. Renamed from
"playlists/stacks" 2026-07-22: **Lists**. (Copy note: "List" the object vs
"list view" the layout — the object always takes the capital-L noun.)

## Lists are not folders (ADR-017)

| | Folder | List |
| --- | --- | --- |
| Role | Where things LIVE | Curated sequence that REFERENCES things |
| Membership | Single-parent (a topping lives in one folder) | Many-to-many (same item in 3 Lists + your folder) |
| Members | Its own toppings | Local toppings OR catalog entities (you can List videos you never saved) |
| Ordering | Per-view sort | Intrinsic: ordered (`itemListOrder`) or unordered |
| Publishable | Shared subtree (Drive model) | Yes — as a catalog entity (Spotify model) |

Exactly Spotify's library-vs-playlist split. schema.org type: `ItemList`
(ordered/unordered is literally in the vocabulary); a course is `Course`.

## A List is itself a topping

It lives in a folder, gets a thumbnail (grid of member thumbs), is shareable,
taggable, ratable, and statusable like anything else. Vault representation:
a diffable `.list` file (JSON: title, ordered flag, member refs) — the Finder
covenant holds. Member refs: topping ids for local items, entity keys for
catalog items.

## Derived progress (the Coursera semantics)

Interactions are entity-keyed (09), so each member carries its own status
("watched"). The List's status is **derived, not stored**: none started →
queued · any started → active with `3/12` progress · all done → done.
One roll-up query; manual override allowed. Any type of member works — videos,
books, places (a travel List derives "been to 4 of 9").

## Publishing is a different privacy class

Published Lists are deliberately public — outside the k-anonymity contract
that protects saves. The UI must make the save/publish boundary unmistakable.

## Uploads: reference-first

A List of external links costs nothing. A course WITH its videos uploaded
makes Waffle a **host** — storage, moderation, DMCA. Discipline: reference
first; hosting is a later paid-tier business decision, never a default.

## Sequencing

Local Lists + `.list` files + derived progress: cheap, P2-adjacent.
Published/discoverable Lists: P3 (rides catalog + accounts + verified tiers).
