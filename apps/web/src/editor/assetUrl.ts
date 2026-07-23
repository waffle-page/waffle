/**
 * Vault bytes → object URLs, one session-scoped cache shared by the reading
 * view and the live-preview widgets (two consumers, one cache — double-loading
 * the same bytes into two URL pools would waste memory for nothing).
 */
import { getVaultFs } from '../platform/instance';

const cache = new Map<string, string>();

export function mimeFor(target: string): string {
  const ext = target.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'webm') return 'audio/webm';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'm4a') return 'audio/mp4';
  if (ext === 'ogg') return 'audio/ogg';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  return 'application/octet-stream';
}

export async function vaultUrl(path: string, mime: string): Promise<string> {
  const cached = cache.get(path);
  if (cached) return cached;
  const fs = await getVaultFs();
  const bytes = await fs.read(path);
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
  cache.set(path, url);
  return url;
}
