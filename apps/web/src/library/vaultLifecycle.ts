/**
 * Full active-vault reconciliation command.
 *
 * This is lifecycle work, not saved-view coordination: scan canonical files,
 * derive Obsidian config, generate missing thumbnails, then let the caller
 * reload its projections. Obsidian failure is reported separately and never
 * invalidates an otherwise successful vault scan.
 */
import { scanVault } from '@waffle/core';
import { syncObsidian } from '../importer/obsidianImport';
import { getVaultFs, platform } from '../platform/instance';
import { runThumbnailer } from '../thumbs/thumbnailer';

export async function reconcileActiveVault(): Promise<number> {
  const fs = await getVaultFs();
  await scanVault(platform.db, fs);
  try {
    await syncObsidian(fs, platform.db);
  } catch (error) {
    console.warn('obsidian sync failed', error);
  }
  return runThumbnailer(platform.db, fs);
}
