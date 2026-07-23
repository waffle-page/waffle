/**
 * Page-level platform singletons: one SQLite worker, one vault fs, one
 * migration pass — shared by every screen. Import from here, never construct.
 */
import { migrate, type VaultFs } from '@waffle/core';
import { createWebAdapters } from './web';
import { createOpfsVaultFs } from './web/opfsFs';

export const platform = createWebAdapters();

/**
 * The active vault, mutable: OPFS by default; picking a real folder (File
 * System Access) REPLACES it as the scan target for this profile — the
 * scanner's reconciliation then treats the new folder as the vault. A proper
 * multi-vault manager is future work; this is the documented v1 behavior.
 */
let activeVaultFs: Promise<VaultFs> = createOpfsVaultFs();
export const getVaultFs = (): Promise<VaultFs> => activeVaultFs;
export const setVaultFs = (fs: VaultFs): void => {
  activeVaultFs = Promise.resolve(fs);
};

export interface PlatformStatus {
  storage: string;
  sqliteVersion: string;
  schemaVersion: number;
  warning?: string;
}

export const platformReady: Promise<PlatformStatus> = (async () => {
  const dbStatus = await platform.dbReady;
  const schemaVersion = await migrate(platform.db);
  return {
    storage: dbStatus.storage,
    sqliteVersion: dbStatus.sqliteVersion,
    schemaVersion,
    warning: dbStatus.warning,
  };
})();
