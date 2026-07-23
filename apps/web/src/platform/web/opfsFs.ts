/** OPFS vault backend: browser-private storage, no picker needed. Dev default. */
import type { VaultFs } from '@waffle/core';
import { createHandleVaultFs } from './handleFs';

export async function createOpfsVaultFs(rootName = 'vault'): Promise<VaultFs> {
  const opfs = await navigator.storage.getDirectory();
  const root = await opfs.getDirectoryHandle(rootName, { create: true });
  return createHandleVaultFs(root, '/' + rootName);
}
