/**
 * Dev-only: the P0 step-2 exit test. Times the query shapes the real UI will
 * run (folder views, property filters, FTS, global recents) end-to-end —
 * including worker RPC overhead, because that's what the user experiences.
 */
import type { SqlDriver } from '@waffle/core';

export interface BenchResult {
  name: string;
  medianMs: number;
  rows: number;
}

const RUNS = 5;

async function timeQuery(db: SqlDriver, name: string, sql: string, params?: unknown[]): Promise<BenchResult> {
  await db.exec(sql, params); // warm-up (page cache, statement compile)
  const samples: number[] = [];
  let rows = 0;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const result = await db.exec(sql, params);
    samples.push(performance.now() - t0);
    rows = result.length;
  }
  samples.sort((a, b) => a - b);
  return { name, medianMs: Math.round(samples[Math.floor(RUNS / 2)]! * 100) / 100, rows };
}

export async function runBench(db: SqlDriver): Promise<BenchResult[]> {
  const busiest = await db.exec<{ folder_id: string }>(
    `SELECT folder_id FROM toppings GROUP BY folder_id ORDER BY COUNT(*) DESC LIMIT 1`,
  );
  const folderId = busiest[0]?.folder_id;
  if (!folderId) throw new Error('No data — run the seed first');

  return [
    await timeQuery(
      db,
      'folder view (sorted, limit 100)',
      `SELECT id, type, title, updated_at FROM toppings
       WHERE folder_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 100`,
      [folderId],
    ),
    await timeQuery(
      db,
      'folder view, links only',
      `SELECT id, title FROM toppings
       WHERE folder_id = ? AND type = 'link' AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 100`,
      [folderId],
    ),
    await timeQuery(
      db,
      'property filter: price < €60',
      `SELECT t.id, t.title, p.value_num AS price FROM toppings t
       JOIN properties p ON p.topping_id = t.id AND p.key = 'price'
       WHERE p.value_num < 60 AND t.deleted_at IS NULL
       ORDER BY p.value_num LIMIT 100`,
    ),
    await timeQuery(
      db,
      "full-text search: 'linen'",
      `SELECT f.topping_id, t.title FROM toppings_fts f
       JOIN toppings t ON t.id = f.topping_id
       WHERE toppings_fts MATCH 'linen' LIMIT 100`,
    ),
    await timeQuery(
      db,
      'global recents (all folders)',
      `SELECT id, title FROM toppings WHERE deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 100`,
    ),
    await timeQuery(db, 'count all toppings', `SELECT COUNT(*) AS c FROM toppings`),
  ];
}
