/**
 * Personal marks (docs/09): status + rating, keyed to the resolved ENTITY —
 * one status per set per entity, private always. Scanner projection is the
 * authority for a saved topping because it may retain a raw alias on conflict.
 */
import { fromEavColumns, urlEntityKey } from '@waffle/core';
import { formatProperty } from '@waffle/ui';
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

export async function loadMarks(toppingId: string, url: string, schemaType: string | null): Promise<EntityMarks> {
  const projected = await platform.db.exec<{ entity_key: string }>(
    `SELECT entity_key FROM topping_entities
      WHERE topping_id = ? AND entity_kind = 'url'`,
    [toppingId],
  );
  const entityKey = projected[0]?.entity_key ?? await urlEntityKey(url);
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
  return rows.flatMap((r) => {
    const value = fromEavColumns(r.kind, r.value_text, r.value_num, r.value_aux);
    return value ? [{ key: r.key, value: formatProperty(value) }] : [];
  });
}
