/**
 * Dev-only executable probe for ADR-026's destructive edge: two legacy raw
 * aliases already carry different personal marks before first v6 projection.
 *
 * The probe constructs that state directly in SQLite because no product UI
 * should create it, scans through the real reconciliation path, verifies both
 * marks survive, and restores the exact prior marks plus a deterministic
 * projection in `finally`.
 */
import type { SqlDriver } from '@waffle/core';

interface FixtureAlias {
  topping_id: string;
  alias_key: string;
  candidate_key: string;
}

interface StoredMark {
  owner_id: string;
  entity_kind: string;
  entity_key: string;
  set_id: string;
  slot: string | null;
  rating: number | null;
  note: string | null;
  status_at: string | null;
  rated_at: string | null;
  updated_at: string;
}

export async function runUrlIdentityConflictProbe(
  db: SqlDriver,
  scan: () => Promise<void>,
): Promise<string> {
  const aliases = await db.exec<FixtureAlias>(
    `SELECT t.id AS topping_id, a.alias_key, a.candidate_key
       FROM toppings t
       JOIN topping_entities te ON te.topping_id = t.id AND te.entity_kind = 'url'
       JOIN url_entity_aliases a ON a.alias_key = te.alias_key
      WHERE t.title IN ('lumen-field', 'lumen-field-reference')
      ORDER BY t.title`,
  );
  if (aliases.length !== 2 || aliases[0]?.candidate_key !== aliases[1]?.candidate_key) {
    throw new Error('Create and scan the fixture vault before running the URL identity conflict probe.');
  }

  const [left, right] = aliases;
  const candidateKey = left!.candidate_key;
  const keys = [...new Set([left!.alias_key, right!.alias_key, candidateKey])];
  const priorMarks = await db.exec<StoredMark>(
    `SELECT owner_id, entity_kind, entity_key, set_id, slot, rating, note,
            status_at, rated_at, updated_at
       FROM interactions
      WHERE owner_id = 'local' AND entity_kind = 'url'
        AND entity_key IN (?,?,?) AND set_id = 'do'`,
    keys,
  );
  const clearProbeState = async (): Promise<void> => {
    for (const key of keys) {
      await db.exec(
        `DELETE FROM interactions
          WHERE owner_id = 'local' AND entity_kind = 'url' AND entity_key = ? AND set_id = 'do'`,
        [key],
      );
    }
    for (const alias of aliases) {
      await db.exec(
        `DELETE FROM topping_entities WHERE topping_id = ? AND entity_kind = 'url'`,
        [alias.topping_id],
      );
      await db.exec(`DELETE FROM url_entity_aliases WHERE alias_key = ?`, [alias.alias_key]);
    }
  };

  // Construct the pre-v6 state intentionally. This is migration evidence, not
  // a product write path; all inserted rows are removed before returning.
  await db.transaction(async () => {
    await clearProbeState();
    const now = new Date().toISOString();
    await db.exec(
      `INSERT INTO interactions
         (owner_id, entity_kind, entity_key, set_id, slot, rating, status_at, rated_at, updated_at)
       VALUES ('local','url',?,'do','done',8,?,?,?)`,
      [left!.alias_key, now, now, now],
    );
    await db.exec(
      `INSERT INTO interactions
         (owner_id, entity_kind, entity_key, set_id, slot, rating, status_at, rated_at, updated_at)
       VALUES ('local','url',?,'do','queued',6,?,?,?)`,
      [right!.alias_key, now, now, now],
    );
  });

  try {
    await scan();
    const states = await db.exec<{ state: string }>(
      `SELECT state FROM url_entity_aliases
        WHERE alias_key IN (?,?) ORDER BY state`,
      [left!.alias_key, right!.alias_key],
    );
    const marks = await db.exec<{ slot: string; rating: number }>(
      `SELECT slot, rating FROM interactions
        WHERE owner_id = 'local' AND entity_kind = 'url'
          AND entity_key IN (?,?,?) AND set_id = 'do'
        ORDER BY rating`,
      keys,
    );
    const stateSignature = states.map((row) => row.state).join(',');
    const markSignature = marks.map((row) => `${row.slot}:${row.rating}`).join(',');
    if (stateSignature !== 'conflict,resolved' || markSignature !== 'queued:6,done:8') {
      throw new Error(`Conflict probe failed: states=${stateSignature}; marks=${markSignature}`);
    }
    return 'passed — divergent 6/8 marks survived; one alias blocked, one resolved; fixture state restored';
  } finally {
    await db.transaction(async () => {
      await clearProbeState();
      for (const mark of priorMarks) {
        await db.exec(
          `INSERT INTO interactions
             (owner_id, entity_kind, entity_key, set_id, slot, rating, note,
              status_at, rated_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            mark.owner_id,
            mark.entity_kind,
            mark.entity_key,
            mark.set_id,
            mark.slot,
            mark.rating,
            mark.note,
            mark.status_at,
            mark.rated_at,
            mark.updated_at,
          ],
        );
      }
    });
    await scan();
  }
}
