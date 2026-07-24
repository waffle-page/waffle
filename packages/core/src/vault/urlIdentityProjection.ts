/**
 * URL alias projection — QUARANTINE MODULE (ADR-026).
 *
 * This is the only place where deterministic URL evidence may converge an
 * existing interaction key. Its invariants:
 *  - projection rows are disposable; saved URLs and marks are not rewritten;
 *  - an empty or semantically identical destination may converge;
 *  - any differing owner/status-set pair blocks the whole alias migration;
 *  - value-conflict state keeps the raw alias effective, so both mark sets
 *    remain addressable until an explicit resolution surface exists;
 *  - changed evidence never moves marks out of a previously shared entity and
 *    keeps that prior entity effective instead;
 *  - callers run this inside the scanner's exclusive transaction.
 */
import type { SqlDriver } from '../types';
import type { UrlIdentity, UrlIdentityEvidence } from './urlIdentity';

export interface ProjectedUrlRef {
  topping_id: string;
  entity_key: string;
  alias_key: string | null;
}

export interface UrlAliasProjection {
  alias_key: string;
  entity_key: string;
  candidate_key: string;
  normalizer_version: number;
  provider: string | null;
  provider_key: string | null;
  evidence: UrlIdentityEvidence;
  state: 'resolved' | 'conflict';
}

interface InteractionRow {
  owner_id: string;
  set_id: string;
  slot: string | null;
  rating: number | null;
  note: string | null;
  status_at: string | null;
  rated_at: string | null;
  updated_at: string;
}

const interactionId = (row: Pick<InteractionRow, 'owner_id' | 'set_id'>): string =>
  `${row.owner_id}\u0000${row.set_id}`;

const sameValue = (left: InteractionRow, right: InteractionRow): boolean =>
  left.slot === right.slot
  && left.rating === right.rating
  && left.note === right.note;

const laterIso = (left: string | null, right: string | null): string | null => {
  if (left === null) return right;
  if (right === null) return left;
  return left >= right ? left : right;
};

/** Cheap scanner fast-path: every field capable of changing convergence agrees. */
export function isUrlIdentityProjectionCurrent(
  ref: ProjectedUrlRef | undefined,
  alias: UrlAliasProjection | undefined,
  identity: UrlIdentity,
): boolean {
  return ref?.alias_key === identity.aliasKey
    && alias?.alias_key === identity.aliasKey
    && alias.candidate_key === identity.entityKey
    && alias.normalizer_version === identity.normalizerVersion
    && alias.provider === identity.provider
    && alias.provider_key === identity.providerKey
    && alias.evidence === identity.evidence
    && ref.entity_key === alias.entity_key;
}

async function migrateUnopposedMarks(
  db: SqlDriver,
  aliasKey: string,
  candidateKey: string,
): Promise<'resolved' | 'conflict'> {
  if (aliasKey === candidateKey) return 'resolved';

  const source = await db.exec<InteractionRow>(
    `SELECT owner_id, set_id, slot, rating, note, status_at, rated_at, updated_at
       FROM interactions
      WHERE entity_kind = 'url' AND entity_key = ?`,
    [aliasKey],
  );
  if (source.length === 0) return 'resolved';

  const target = await db.exec<InteractionRow>(
    `SELECT owner_id, set_id, slot, rating, note, status_at, rated_at, updated_at
       FROM interactions
      WHERE entity_kind = 'url' AND entity_key = ?`,
    [candidateKey],
  );
  const targetById = new Map(target.map((row) => [interactionId(row), row]));

  // Preflight the entire alias before writing. Partial convergence would make
  // one saved URL expose a mixture of raw and shared marks.
  if (source.some((row) => {
    const existing = targetById.get(interactionId(row));
    return existing !== undefined && !sameValue(row, existing);
  })) {
    return 'conflict';
  }

  for (const row of source) {
    const existing = targetById.get(interactionId(row));
    if (existing) {
      await db.exec(
        `UPDATE interactions
            SET status_at = ?, rated_at = ?, updated_at = ?
          WHERE owner_id = ? AND entity_kind = 'url' AND entity_key = ? AND set_id = ?`,
        [
          laterIso(existing.status_at, row.status_at),
          laterIso(existing.rated_at, row.rated_at),
          laterIso(existing.updated_at, row.updated_at),
          row.owner_id,
          candidateKey,
          row.set_id,
        ],
      );
      await db.exec(
        `DELETE FROM interactions
          WHERE owner_id = ? AND entity_kind = 'url' AND entity_key = ? AND set_id = ?`,
        [row.owner_id, aliasKey, row.set_id],
      );
      continue;
    }

    await db.exec(
      `UPDATE interactions SET entity_key = ?
        WHERE owner_id = ? AND entity_kind = 'url' AND entity_key = ? AND set_id = ?`,
      [candidateKey, row.owner_id, aliasKey, row.set_id],
    );
  }

  return 'resolved';
}

/**
 * Project one saved URL and return its effective key. A value conflict retains
 * the raw hash; changed evidence with shared marks retains the previous entity;
 * all unopposed aliases use the current candidate.
 */
export async function projectUrlIdentity(
  db: SqlDriver,
  toppingId: string,
  identity: UrlIdentity,
): Promise<string> {
  const prior = (await db.exec<{ entity_key: string }>(
    `SELECT entity_key FROM url_entity_aliases WHERE alias_key = ?`,
    [identity.aliasKey],
  ))[0];

  // A later normalizer/provider version may change a previously shared
  // candidate. Marks at that old entity may also serve other aliases, so they
  // cannot safely be moved by one alias's rescan. Preserve visibility and
  // require explicit future resolution instead.
  let state: 'resolved' | 'conflict';
  let effectiveKey: string;
  if (prior && prior.entity_key !== identity.aliasKey && prior.entity_key !== identity.entityKey) {
    const markCount = (await db.exec<{ count: number }>(
      `SELECT COUNT(*) AS count FROM interactions
        WHERE entity_kind = 'url' AND entity_key = ?`,
      [prior.entity_key],
    ))[0]?.count ?? 0;
    if (markCount > 0) {
      state = 'conflict';
      effectiveKey = prior.entity_key;
    } else {
      state = await migrateUnopposedMarks(db, identity.aliasKey, identity.entityKey);
      effectiveKey = state === 'conflict' ? identity.aliasKey : identity.entityKey;
    }
  } else {
    state = await migrateUnopposedMarks(db, identity.aliasKey, identity.entityKey);
    effectiveKey = state === 'conflict' ? identity.aliasKey : identity.entityKey;
  }
  const now = new Date().toISOString();

  await db.exec(
    `INSERT INTO url_entity_aliases
       (alias_key, entity_key, candidate_key, normalizer_version, provider, provider_key, evidence, state, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(alias_key) DO UPDATE SET
       entity_key = excluded.entity_key,
       candidate_key = excluded.candidate_key,
       normalizer_version = excluded.normalizer_version,
       provider = excluded.provider,
       provider_key = excluded.provider_key,
       evidence = excluded.evidence,
       state = excluded.state,
       updated_at = excluded.updated_at`,
    [
      identity.aliasKey,
      effectiveKey,
      identity.entityKey,
      identity.normalizerVersion,
      identity.provider,
      identity.providerKey,
      identity.evidence,
      state,
      now,
    ],
  );
  await db.exec(
    `INSERT INTO topping_entities (topping_id, entity_kind, entity_key, alias_key)
     VALUES (?,'url',?,?)
     ON CONFLICT(topping_id, entity_kind) DO UPDATE SET
       entity_key = excluded.entity_key,
       alias_key = excluded.alias_key`,
    [toppingId, effectiveKey, identity.aliasKey],
  );
  return effectiveKey;
}

/** Remove only scanner-owned membership; alias evidence may still own marks. */
export async function clearUrlIdentityProjection(db: SqlDriver, toppingId: string): Promise<void> {
  await db.exec(
    `DELETE FROM topping_entities WHERE topping_id = ? AND entity_kind = 'url'`,
    [toppingId],
  );
}
