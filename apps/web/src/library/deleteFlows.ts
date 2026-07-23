/**
 * Soft delete (files-canonical): the file MOVES to `.trash/` inside the vault
 * — Obsidian's own convention, so both apps share one trash and nothing is
 * destroyed. The scanner skips dot-directories, so the targeted rescan sees
 * the path as gone and tombstones the row (deleted_at), never hard-deleting.
 * Implemented as read → write → remove instead of fs.move so every backend
 * behaves identically (write creates parent directories; move may not).
 */
import { rescanFile, type VaultFs } from '@waffle/core';
import { platform } from '../platform/instance';
import { uniquePath } from './addFlows';

export async function trashFile(fs: VaultFs, path: string): Promise<void> {
  const name = path.split('/').pop()!;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const target = await uniquePath(fs, '.trash', base, ext);
  const bytes = await fs.read(path);
  await fs.write(target, bytes);
  await fs.remove(path);
  await rescanFile(platform.db, fs, path); // path gone → tombstone
}
