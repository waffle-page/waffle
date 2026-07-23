/**
 * VaultFs over any FileSystemDirectoryHandle — the shared implementation behind
 * both web backends: OPFS (browser-private, dev default) and File System Access
 * (a real on-disk folder the user picked). The engine can't tell them apart.
 *
 * watch(): no change events exist on these handles — we poll (stat-walk + diff)
 * every 1.2s. Native watchers arrive with the Tauri/Capacitor backends (P1).
 */
import type { FsEvent, VaultFs } from '@waffle/core';

// lib.dom has historically lagged on FileSystemDirectoryHandle iteration.
const entriesOf = (dir: FileSystemDirectoryHandle) =>
  (dir as unknown as { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries();

export function createHandleVaultFs(root: FileSystemDirectoryHandle, rootLabel: string): VaultFs {
  const dirOf = async (path: string, create = false): Promise<FileSystemDirectoryHandle> => {
    let dir = root;
    for (const part of path.split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  };
  const split = (path: string): [string, string] => {
    const parts = path.split('/');
    return [parts.slice(0, -1).join('/'), parts.at(-1)!];
  };

  const fs: VaultFs = {
    async pickRoot() {
      return rootLabel;
    },

    async read(path) {
      const [dir, name] = split(path);
      const handle = await (await dirOf(dir)).getFileHandle(name);
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    },

    async write(path, data) {
      const [dir, name] = split(path);
      const handle = await (await dirOf(dir, true)).getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(data as unknown as ArrayBuffer);
      await writable.close();
    },

    async move(from, to) {
      await fs.write(to, await fs.read(from));
      await fs.remove(from);
    },

    async remove(path) {
      const [dir, name] = split(path);
      await (await dirOf(dir)).removeEntry(name, { recursive: true });
    },

    async list(dir) {
      const handle = await dirOf(dir);
      const out: Array<{ path: string; isDir: boolean; mtime: number; size: number }> = [];
      for await (const [name, entry] of entriesOf(handle)) {
        const path = dir ? `${dir}/${name}` : name;
        if (entry.kind === 'directory') {
          out.push({ path, isDir: true, mtime: 0, size: 0 });
        } else {
          const file = await (entry as FileSystemFileHandle).getFile();
          out.push({ path, isDir: false, mtime: file.lastModified, size: file.size });
        }
      }
      return out;
    },

    watch(cb) {
      let prev: Map<string, string> | null = null;
      let stopped = false;

      const snapshot = async (): Promise<Map<string, string>> => {
        const map = new Map<string, string>();
        const walk = async (dir: string): Promise<void> => {
          for (const entry of await fs.list(dir)) {
            const name = entry.path.split('/').pop()!;
            if (name.startsWith('.')) continue;
            if (entry.isDir) await walk(entry.path);
            else map.set(entry.path, `${entry.size}:${entry.mtime}`);
          }
        };
        await walk('');
        return map;
      };

      const tick = async (): Promise<void> => {
        if (stopped) return;
        try {
          const next = await snapshot();
          if (prev) {
            const events: FsEvent[] = [];
            for (const [path, sig] of next) {
              if (!prev.has(path)) events.push({ kind: 'create', path });
              else if (prev.get(path) !== sig) events.push({ kind: 'modify', path });
            }
            for (const path of prev.keys()) {
              if (!next.has(path)) events.push({ kind: 'delete', path });
            }
            if (events.length > 0) cb(events);
          }
          prev = next;
        } finally {
          if (!stopped) setTimeout(tick, 1200);
        }
      };
      void tick();
      return () => {
        stopped = true;
      };
    },
  };

  return fs;
}
