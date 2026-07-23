/**
 * SQLite worker — QUARANTINE MODULE (docs/08-code-conventions.md).
 *
 * Why this is hairy: SQLite-wasm must run off the main thread, and the OPFS
 * SyncAccessHandle pool VFS ("opfs-sahpool") only works inside a worker. This
 * file owns the single database connection; the main thread talks to it via
 * the tiny message protocol below. Invariants:
 *  - Exactly one connection, one worker. All SQL is serialized here.
 *  - opfs-sahpool persists across reloads but is single-tab. Multi-tab
 *    coordination (Web Locks) is future work — do not open a second tab and
 *    expect writes to merge.
 *  - If OPFS is unavailable (e.g. some headless/private contexts) we fall back
 *    to an in-memory DB and say so loudly via `storage: 'memory'`.
 */
import sqlite3InitModule, { type Database, type SqlValue } from '@sqlite.org/sqlite-wasm';

interface ExecRequest { kind: 'exec'; id: number; sql: string; params?: SqlValue[] }
interface ReadyMsg { kind: 'ready'; ok: boolean; storage: string; sqliteVersion: string; error?: string }
interface ResultMsg { kind: 'result'; id: number; ok: boolean; rows?: Record<string, unknown>[]; error?: string }

const post = (m: ReadyMsg | ResultMsg) => (self as unknown as MessagePort).postMessage(m);

type Exec = (sql: string, params?: SqlValue[]) => Record<string, SqlValue>[];

const dbPromise: Promise<{ exec: Exec }> = (async () => {
  const sqlite3 = await sqlite3InitModule();
  const version = sqlite3.version.libVersion;

  const wrap = (db: Database): Exec => (sql, params) => {
    const rows: Record<string, SqlValue>[] = [];
    db.exec({
      sql,
      // bind is only legal for single-statement SQL; migrations are multi-statement and unbound.
      bind: params && params.length > 0 ? params : undefined,
      rowMode: 'object',
      resultRows: rows,
    });
    return rows;
  };

  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'waffle' });
    const db = new pool.OpfsSAHPoolDb('/waffle.db');
    post({ kind: 'ready', ok: true, storage: 'opfs-sahpool', sqliteVersion: version });
    return { exec: wrap(db) };
  } catch (e) {
    const db = new sqlite3.oo1.DB(':memory:');
    post({
      kind: 'ready',
      ok: true,
      storage: 'memory',
      sqliteVersion: version,
      error: `OPFS unavailable, data will NOT persist: ${String(e)}`,
    });
    return { exec: wrap(db) };
  }
})().catch((e) => {
  post({ kind: 'ready', ok: false, storage: 'none', sqliteVersion: '', error: String(e) });
  throw e;
});

self.onmessage = async (event: MessageEvent<ExecRequest>) => {
  const { id, sql, params } = event.data;
  try {
    const db = await dbPromise;
    post({ kind: 'result', id, ok: true, rows: db.exec(sql, params) });
  } catch (e) {
    post({ kind: 'result', id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
