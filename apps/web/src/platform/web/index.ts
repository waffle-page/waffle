/**
 * Web implementations of the platform adapters. This is the only place in the
 * web app where platform-specific storage/IO code lives (ADR-001/002).
 */
import type { PlatformAdapters, VaultFs } from '@waffle/core';
import { WebDb, type DbStatus } from './webDb';

/** Vault filesystem lands in P0 step 3 (File System Access API). */
const notYet = (): never => {
  throw new Error('VaultFs: not implemented until P0 step 3 (vault engine)');
};
const stubFs: VaultFs = {
  pickRoot: notYet,
  read: notYet,
  write: notYet,
  move: notYet,
  remove: notYet,
  list: notYet,
  watch: notYet,
};

export interface WebPlatform extends PlatformAdapters {
  db: WebDb;
  dbReady: Promise<DbStatus>;
}

export function createWebAdapters(): WebPlatform {
  const db = new WebDb();
  return {
    db,
    dbReady: db.ready,
    fs: stubFs,
    net: { fetch: (url, init) => fetch(url, init as RequestInit | undefined) },
  };
}
