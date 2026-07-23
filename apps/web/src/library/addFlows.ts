/**
 * Add flows (P0 step 7): create notes, links, and files as VAULT FILES — the
 * scanner then indexes them like anything else (one write path, ADR-004).
 * Links become `.url` files (Finder-covenant native format).
 *
 * Deliberately NO external fetches here: auto-unfurling titles/favicons via
 * third-party services would leak save activity off-device (privacy pillar).
 * Rich unfurl lands with native fetch in the Tauri/Capacitor shells, where the
 * request goes directly to the site — like a browser visit.
 */
import type { VaultFs } from '@waffle/core';

const ILLEGAL = /[/\\:*?"<>|#^[\]]/g;

function joinDir(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

async function exists(fs: VaultFs, path: string): Promise<boolean> {
  try {
    await fs.read(path);
    return true;
  } catch {
    return false;
  }
}

/** `name.ext` → `name 2.ext`, `name 3.ext`… until free. */
async function uniquePath(fs: VaultFs, dir: string, base: string, ext: string): Promise<string> {
  for (let n = 1; ; n++) {
    const candidate = joinDir(dir, `${base}${n === 1 ? '' : ` ${n}`}${ext}`);
    if (!(await exists(fs, candidate))) return candidate;
  }
}

export async function createNote(fs: VaultFs, dir: string, rawName: string): Promise<string> {
  const base = (rawName.trim().replace(ILLEGAL, '') || 'Untitled').replace(/\.md$/i, '');
  const path = await uniquePath(fs, dir, base, '.md');
  await fs.write(path, new TextEncoder().encode(''));
  return path;
}

export async function createLink(fs: VaultFs, dir: string, rawUrl: string): Promise<string> {
  const url = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  const host = new URL(url).hostname.replace(/^www\./, '');
  const path = await uniquePath(fs, dir, host.replace(ILLEGAL, ''), '.url');
  await fs.write(path, new TextEncoder().encode(`[InternetShortcut]\nURL=${url}\n`));
  return path;
}

export async function addFiles(fs: VaultFs, dir: string, files: File[]): Promise<number> {
  let added = 0;
  for (const file of files) {
    const dot = file.name.lastIndexOf('.');
    const base = (dot > 0 ? file.name.slice(0, dot) : file.name).replace(ILLEGAL, '') || 'file';
    const ext = dot > 0 ? file.name.slice(dot) : '';
    const path = await uniquePath(fs, dir, base, ext);
    await fs.write(path, new Uint8Array(await file.arrayBuffer()));
    added++;
  }
  return added;
}
