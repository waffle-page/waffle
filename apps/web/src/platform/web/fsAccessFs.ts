/**
 * File System Access vault backend: a REAL on-disk folder, user-picked — the
 * Finder covenant on the web. The picked handle persists in IndexedDB so the
 * next session re-attaches with a permission re-request instead of a re-pick.
 * Chromium-only (Safari lacks the API); the Tauri desktop shell (P1) is the
 * full-fidelity path.
 */
import type { VaultFs } from '@waffle/core';
import { createHandleVaultFs } from './handleFs';

const DB_NAME = 'waffle-platform';
const STORE = 'handles';
const KEY = 'vault-root';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function fsAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

/** Must be called from a user gesture (the OS picker requires one). */
export async function pickRealFolder(): Promise<VaultFs> {
  const picker = (window as unknown as { showDirectoryPicker(opts: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  const handle = await picker({ mode: 'readwrite' });
  await idbSet(KEY, handle);
  return createHandleVaultFs(handle, handle.name);
}

/** Re-attach the previously picked folder, re-requesting permission if needed. */
export async function restoreRealFolder(): Promise<VaultFs | null> {
  const handle = await idbGet<FileSystemDirectoryHandle>(KEY);
  if (!handle) return null;
  const h = handle as unknown as {
    queryPermission(d: object): Promise<string>;
    requestPermission(d: object): Promise<string>;
    name: string;
  };
  const desc = { mode: 'readwrite' };
  let state = await h.queryPermission(desc);
  if (state === 'prompt') state = await h.requestPermission(desc);
  if (state !== 'granted') return null;
  return createHandleVaultFs(handle, handle.name);
}
