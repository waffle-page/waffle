/**
 * Web implementations of the platform adapters. This is the only place in the
 * web app where platform-specific storage/IO code lives (ADR-001/002).
 */
import type { PlatformAdapters, VaultFs } from '@waffle/core';
import { WebDb, type DbStatus } from './webDb';

/**
 * The web app does NOT use platform.fs: the active vault is a MUTABLE seam —
 * `getVaultFs()` in platform/instance.ts (OPFS by default, File System Access
 * folder when picked). platform.fs becomes real when the native shells land
 * with one fixed vault root. This stub exists only to satisfy the adapter
 * shape and to fail loudly if something bypasses the seam.
 */
const notYet = (): never => {
  throw new Error('Use getVaultFs() (platform/instance.ts) — platform.fs is not the web vault seam');
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
