import type { SqlDriver } from '../types';
import { MIGRATIONS } from './migrations';

/**
 * Bring the database to the latest schema version. Idempotent; safe to call on
 * every app start. Returns the schema version after migration.
 */
export async function migrate(db: SqlDriver): Promise<number> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`);

  const rows = await db.exec<{ v: number | null }>(
    `SELECT MAX(version) AS v FROM schema_migrations`,
  );
  const current = rows[0]?.v ?? 0;

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.transaction(async () => {
      // Re-check inside the write transaction: concurrent migrate() calls (e.g.
      // React StrictMode double-mount) serialize on the driver lock, and the
      // loser must see the winner's work instead of re-applying it.
      const done = await db.exec<{ ok: number }>(
        `SELECT 1 AS ok FROM schema_migrations WHERE version = ?`,
        [m.version],
      );
      if (done.length > 0) return;
      // The wasm/native drivers accept multi-statement SQL in a single exec.
      await db.exec(m.sql);
      await db.exec(
        `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
        [m.version, m.name, new Date().toISOString()],
      );
    });
  }

  const after = await db.exec<{ v: number }>(`SELECT MAX(version) AS v FROM schema_migrations`);
  return after[0]?.v ?? 0;
}
