/**
 * Web SqlDriver: promise-RPC over the SQLite worker.
 *
 * Locking model (kept deliberately simple): a single promise-chain mutex
 * serializes top-level calls. `transaction()` holds the mutex for its whole
 * span; `exec()` calls made *inside* the transaction callback bypass the mutex
 * (reentrant path) so they run within BEGIN…COMMIT. The app-level rule that
 * upholds correctness: writes flow through one store layer — don't fire
 * unrelated driver calls concurrently with an open transaction.
 */
import type { SqlDriver } from '@waffle/core';

export interface DbStatus {
  storage: string;         // 'opfs-sahpool' | 'memory'
  sqliteVersion: string;
  warning?: string;
}

interface Pending {
  resolve: (rows: Record<string, unknown>[]) => void;
  reject: (err: Error) => void;
}

export class WebDb implements SqlDriver {
  readonly ready: Promise<DbStatus>;
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private lock: Promise<unknown> = Promise.resolve();
  private inTransaction = false;

  constructor() {
    this.worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise<DbStatus>((resolve, reject) => {
      const onReady = (event: MessageEvent) => {
        const msg = event.data;
        if (msg.kind !== 'ready') return;
        this.worker.removeEventListener('message', onReady);
        if (msg.ok) resolve({ storage: msg.storage, sqliteVersion: msg.sqliteVersion, warning: msg.error });
        else reject(new Error(msg.error ?? 'SQLite worker failed to start'));
      };
      this.worker.addEventListener('message', onReady);
    });
    this.worker.addEventListener('message', (event: MessageEvent) => {
      const msg = event.data;
      if (msg.kind !== 'result') return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.rows ?? []);
      else p.reject(new Error(msg.error));
    });
  }

  exec<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    if (this.inTransaction) return this.send(sql, params) as Promise<T[]>;
    return this.withLock(() => this.send(sql, params)) as Promise<T[]>;
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.withLock(async () => {
      this.inTransaction = true;
      await this.send('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        await this.send('COMMIT');
        return result;
      } catch (err) {
        await this.send('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        this.inTransaction = false;
      }
    });
  }

  private send(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ kind: 'exec', id, sql, params });
    });
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn);
    this.lock = run.catch(() => {});
    return run;
  }
}
