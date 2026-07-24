/**
 * Schema migrations, applied in order by `migrate()`. Append-only: never edit a
 * shipped migration — add a new one. Full schema rationale: docs/03-adr.md.
 *
 * Portability constraints (why some obvious things are absent):
 * - No `PRAGMA journal_mode` here — WAL is unavailable on the web OPFS VFS;
 *   each platform driver sets its own pragmas at open.
 * - FTS is a plain fts5 table (not external-content): the indexer deletes and
 *   reinserts a topping's row on change. Simplest correct thing at our scale.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
-- ── Library ────────────────────────────────────────────────────────────────

CREATE TABLE folders (
  id          TEXT PRIMARY KEY,            -- uuid, never a path
  parent_id   TEXT REFERENCES folders(id),
  name        TEXT NOT NULL,
  path        TEXT,                        -- materialized path of ids: /a/b/c — nearest-ancestor grant lookups
  owner_id    TEXT,                        -- dormant until identity ships (ADR-005)
  home        TEXT NOT NULL DEFAULT 'local',  -- local | server   (ADR-004)
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_folders_parent ON folders(parent_id);

CREATE TABLE toppings (
  id           TEXT PRIMARY KEY,           -- uuid
  type         TEXT NOT NULL CHECK (type IN ('note','link','file','dash')),  -- ADR-003
  folder_id    TEXT NOT NULL REFERENCES folders(id),
  title        TEXT NOT NULL,
  content_ref  TEXT,                       -- vault rows: file path (links: the .url carrier; URL lives in properties)
  content_hash TEXT,                       -- re-association after offline moves
  thumb_ref    TEXT,                       -- key into .waffle/thumbs/
  blurhash     TEXT,
  owner_id     TEXT,
  source       TEXT,                       -- share-extension | paste | finder | import | seed | ...
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT                        -- tombstone (shared-folder sync)
);
CREATE INDEX idx_toppings_folder ON toppings(folder_id, type);
CREATE INDEX idx_toppings_folder_updated ON toppings(folder_id, updated_at);
CREATE INDEX idx_toppings_updated ON toppings(updated_at);  -- global recents
CREATE INDEX idx_toppings_hash ON toppings(content_hash);

-- Typed properties, EAV. For notes, YAML frontmatter is canonical and this
-- mirrors it; for link/file/dash this is canonical (mirrored to .waffle/meta.json, ADR-013).
CREATE TABLE properties (
  topping_id  TEXT NOT NULL REFERENCES toppings(id),
  key         TEXT NOT NULL,
  kind        TEXT NOT NULL,               -- text|number|money|duration|date|coords|select|url|checkbox
  value_text  TEXT,
  value_num   REAL,                        -- canonical unit per kind (money: amount · duration: seconds)
  value_aux   TEXT,                        -- money: ISO 4217 · coords: lng · select: option id
  PRIMARY KEY (topping_id, key)
);
CREATE INDEX idx_properties_key_num  ON properties(key, value_num);
CREATE INDEX idx_properties_key_text ON properties(key, value_text);

CREATE TABLE tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,              -- user tags now; global crowd tags P3
  scope TEXT NOT NULL DEFAULT 'user'       -- user | global
);
CREATE TABLE topping_tags (
  topping_id TEXT NOT NULL REFERENCES toppings(id),
  tag_id     TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (topping_id, tag_id)
);
CREATE INDEX idx_topping_tags_tag ON topping_tags(tag_id);

-- ── Views (ADR-006, ADR-014) ───────────────────────────────────────────────

CREATE TABLE views (
  id         TEXT PRIMARY KEY,
  folder_id  TEXT REFERENCES folders(id),  -- NULL ⇒ smart folder (query-scoped)
  name       TEXT NOT NULL,
  layout     TEXT NOT NULL,                -- renderer registry key: masonry|list|table|board|gallery|map|...
  config     TEXT NOT NULL,                -- JSON: filters AST, sorts, group_by, visible props, subtree
  kind       TEXT NOT NULL DEFAULT 'shared', -- shared | personal
  owner_id   TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  position   REAL NOT NULL                 -- tab order
);
CREATE INDEX idx_views_folder ON views(folder_id);

-- Per-view manual ordering: fractional index keys — one write per drag-drop.
CREATE TABLE view_order (
  view_id    TEXT NOT NULL REFERENCES views(id),
  topping_id TEXT NOT NULL REFERENCES toppings(id),
  order_key  TEXT NOT NULL,
  PRIMARY KEY (view_id, topping_id)
);

-- ── Sharing (ADR-005, dormant until P1) ────────────────────────────────────

CREATE TABLE grants (
  id         TEXT PRIMARY KEY,
  folder_id  TEXT NOT NULL REFERENCES folders(id),
  grantee    TEXT NOT NULL,                -- user id | invite-link token
  role       TEXT NOT NULL CHECK (role IN ('viewer','editor')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_grants_folder ON grants(folder_id);

-- ── Search ─────────────────────────────────────────────────────────────────

CREATE VIRTUAL TABLE toppings_fts USING fts5(
  topping_id UNINDEXED,
  title, body, tags
);

-- ── Datasets (ADR-007..011) ────────────────────────────────────────────────
-- Actual dataset tables (health_sleep, oura_readiness, ...) are created per
-- connector manifest by the host. This registry tracks them.

CREATE TABLE datasets (
  table_name   TEXT PRIMARY KEY,           -- e.g. 'health_sleep'
  kind         TEXT NOT NULL,              -- canonical | extension
  schema_ver   TEXT NOT NULL,
  connector_id TEXT,                       -- NULL for canonical multi-source tables
  created_at   TEXT NOT NULL
);

CREATE TABLE source_priority (              -- ADR-011: user-orderable provider precedence
  table_name TEXT NOT NULL,
  source     TEXT NOT NULL,
  priority   INTEGER NOT NULL,
  PRIMARY KEY (table_name, source)
);

CREATE TABLE fx_rates (                     -- ADR-010: currency converts at query time
  day      TEXT NOT NULL,                  -- ISO date
  currency TEXT NOT NULL,                  -- ISO 4217
  eur_rate REAL NOT NULL,
  PRIMARY KEY (day, currency)
);

CREATE TABLE connector_state (
  connector_id TEXT PRIMARY KEY,
  installed_at TEXT NOT NULL,
  last_pull    TEXT,
  status       TEXT NOT NULL DEFAULT 'ok'  -- ok | auth_required | error | disabled
);
`,
  },
  {
    version: 2,
    name: 'status_and_ratings',
    // Personal marks layer (docs/09-status-and-ratings.md): per-owner status +
    // rating keyed to the ENTITY (v1: trimmed-URL hash), not the topping — one
    // status per book no matter how many folders it's saved in, and you can
    // rate things you never saved. Private always; never syncs into shared folders.
    sql: `
CREATE TABLE status_sets (
  id     TEXT PRIMARY KEY,                 -- 'read' | 'watch' | 'visit' | 'buy' | 'do' | custom uuid
  name   TEXT NOT NULL,
  labels TEXT NOT NULL                     -- JSON: slot → label, e.g. {"queued":"Want to read",...}
);

CREATE TABLE status_set_bindings (
  set_id      TEXT NOT NULL REFERENCES status_sets(id),
  match_kind  TEXT NOT NULL,               -- 'schema_type' | 'tag'
  match_value TEXT NOT NULL,               -- 'Book' | 'Place' | tag id
  PRIMARY KEY (match_kind, match_value)
);

CREATE TABLE interactions (
  owner_id    TEXT NOT NULL DEFAULT 'local',
  entity_kind TEXT NOT NULL DEFAULT 'url', -- 'url' now; extensible (ADR: rate anything)
  entity_key  TEXT NOT NULL,               -- trimmed-URL hash; never the carrier file's content_hash
  set_id      TEXT REFERENCES status_sets(id),
  slot        TEXT CHECK (slot IN ('queued','active','done','dropped')),
  rating      REAL,                        -- canonical 0-10; display maps to user preference
  note        TEXT,
  status_at   TEXT,
  rated_at    TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (owner_id, entity_kind, entity_key)
);
CREATE INDEX idx_interactions_slot ON interactions(owner_id, slot);

INSERT INTO status_sets (id, name, labels) VALUES
  ('read',  'Reading',  '{"queued":"Want to read","active":"Reading","done":"Read","dropped":"Abandoned"}'),
  ('watch', 'Watching', '{"queued":"Watchlist","active":"Watching","done":"Watched","dropped":"Dropped"}'),
  ('visit', 'Places',   '{"queued":"Want to go","done":"Been"}'),
  ('buy',   'Shopping', '{"queued":"Want it","done":"Bought","dropped":"Returned"}'),
  ('do',    'Tasks',    '{"queued":"To do","active":"Doing","done":"Done","dropped":"Dropped"}');

INSERT INTO status_set_bindings (set_id, match_kind, match_value) VALUES
  ('read',  'schema_type', 'Book'),
  ('read',  'schema_type', 'Article'),
  ('watch', 'schema_type', 'Movie'),
  ('watch', 'schema_type', 'TVSeries'),
  ('visit', 'schema_type', 'Place'),
  ('visit', 'schema_type', 'Restaurant'),
  ('buy',   'schema_type', 'Product');
`,
  },
  {
    version: 3,
    name: 'thumbnails',
    // Thumbnail pipeline (ADR-012, v1 shape): one generated size, aspect ratio
    // for masonry, dominant color for instant paint. The v1 `blurhash` column
    // stays dormant — local OPFS thumbs load in ms, so blurhash earns its place
    // only when remote images arrive (P2 shared folders).
    sql: `
ALTER TABLE toppings ADD COLUMN thumb_aspect REAL;   -- width / height
ALTER TABLE toppings ADD COLUMN thumb_color  TEXT;   -- dominant color, e.g. '#a2b3c4'
`,
  },
  {
    version: 4,
    name: 'multi_axis_status',
    // 09 Decision 1b: multiple exclusive status AXES per entity — one slot per
    // status SET (a book: reading status AND ownership status). The interactions
    // key widens to (owner, entity, set). SQLite can't alter a PK: rebuild.
    sql: `
CREATE TABLE interactions_v4 (
  owner_id    TEXT NOT NULL DEFAULT 'local',
  entity_kind TEXT NOT NULL DEFAULT 'url',
  entity_key  TEXT NOT NULL,
  set_id      TEXT NOT NULL REFERENCES status_sets(id),
  slot        TEXT CHECK (slot IN ('queued','active','done','dropped')),
  rating      REAL,
  note        TEXT,
  status_at   TEXT,
  rated_at    TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (owner_id, entity_kind, entity_key, set_id)
);
INSERT INTO interactions_v4
  SELECT owner_id, entity_kind, entity_key, COALESCE(set_id, 'do'), slot, rating, note, status_at, rated_at, updated_at
  FROM interactions;
DROP TABLE interactions;
ALTER TABLE interactions_v4 RENAME TO interactions;
CREATE INDEX idx_interactions_slot ON interactions(owner_id, slot);
`,
  },
  {
    version: 5,
    name: 'topping_entity_refs',
    // Interactions belong to entities, while library rows belong to vault
    // files. This disposable mapping lets SQL join the two without ever
    // confusing a `.url` carrier-file hash with its trimmed-URL entity hash.
    sql: `
CREATE TABLE topping_entities (
  topping_id  TEXT NOT NULL REFERENCES toppings(id) ON DELETE CASCADE,
  entity_kind TEXT NOT NULL,
  entity_key  TEXT NOT NULL,
  PRIMARY KEY (topping_id, entity_kind)
);
CREATE INDEX idx_topping_entities_identity
  ON topping_entities(entity_kind, entity_key);
`,
  },
];
