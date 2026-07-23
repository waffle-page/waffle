/**
 * Personal marks (docs/09): status + rating, keyed to the ENTITY (canonical-URL
 * hash for links) — one status per set per entity, private always.
 */
import { contentHash } from '@waffle/core';
import { platform } from '../platform/instance';

export interface StatusSet {
  id: string;
  name: string;
  labels: Partial<Record<'queued' | 'active' | 'done' | 'dropped', string>>;
}

export interface EntityMarks {
  entityKey: string;
  set: StatusSet;
  slot: string | null;
  rating: number | null;
}

/** Canonical entity key for a URL (v1: hash of the trimmed URL string). */
export async function urlEntityKey(url: string): Promise<string> {
  return contentHash(new TextEncoder().encode(url.trim()));
}

/** Resolve which status set applies: schema_type binding, else the generic 'do'. */
async function resolveSet(schemaType: string | null): Promise<StatusSet> {
  const rows = await platform.db.exec<{ id: string; name: string; labels: string }>(
    schemaType
      ? `SELECT s.id, s.name, s.labels FROM status_set_bindings b JOIN status_sets s ON s.id = b.set_id
         WHERE b.match_kind = 'schema_type' AND b.match_value = ? LIMIT 1`
      : `SELECT id, name, labels FROM status_sets WHERE id = 'do'`,
    schemaType ? [schemaType] : [],
  );
  const row = rows[0] ?? { id: 'do', name: 'Tasks', labels: '{}' };
  return { id: row.id, name: row.name, labels: JSON.parse(row.labels) };
}

export async function loadMarks(url: string, schemaType: string | null): Promise<EntityMarks> {
  const entityKey = await urlEntityKey(url);
  const set = await resolveSet(schemaType);
  const rows = await platform.db.exec<{ slot: string | null; rating: number | null }>(
    `SELECT slot, rating FROM interactions WHERE owner_id = 'local' AND entity_kind = 'url' AND entity_key = ? AND set_id = ?`,
    [entityKey, set.id],
  );
  return { entityKey, set, slot: rows[0]?.slot ?? null, rating: rows[0]?.rating ?? null };
}

export async function saveMarks(entityKey: string, setId: string, slot: string | null, rating: number | null): Promise<void> {
  const now = new Date().toISOString();
  await platform.db.exec(
    `INSERT INTO interactions (owner_id, entity_kind, entity_key, set_id, slot, rating, status_at, rated_at, updated_at)
     VALUES ('local', 'url', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, entity_kind, entity_key, set_id)
     DO UPDATE SET slot = excluded.slot, rating = excluded.rating,
       status_at = CASE WHEN excluded.slot IS NOT interactions.slot THEN excluded.status_at ELSE interactions.status_at END,
       rated_at = CASE WHEN excluded.rating IS NOT interactions.rating THEN excluded.rated_at ELSE interactions.rated_at END,
       updated_at = excluded.updated_at`,
    [entityKey, setId, slot, rating, now, now, now],
  );
}

/** Typed properties of a topping, for the detail view's key-properties list. */
export async function loadToppingProps(toppingId: string): Promise<Array<{ key: string; value: string }>> {
  const rows = await platform.db.exec<{ key: string; kind: string; value_text: string | null; value_num: number | null; value_aux: string | null }>(
    `SELECT key, kind, value_text, value_num, value_aux FROM properties WHERE topping_id = ? ORDER BY key`,
    [toppingId],
  );
  return rows.map((r) => ({
    key: r.key,
    value:
      r.kind === 'money' ? `${r.value_num} ${r.value_aux}` :
      r.kind === 'checkbox' ? (r.value_num ? 'yes' : 'no') :
      r.value_text ?? String(r.value_num ?? ''),
  }));
}
