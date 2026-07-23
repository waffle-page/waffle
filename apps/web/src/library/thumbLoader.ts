/**
 * Resolves thumb_ref → object URL by reading the webp from the vault fs.
 * Session-scoped cache: object URLs live until the page unloads (bounded by
 * how many thumbs a session actually views).
 */
import type { ThumbLoader } from '@waffle/ui';
import { getVaultFs } from '../platform/instance';

const cache = new Map<string, string>();

export const loadThumb: ThumbLoader = async (item) => {
  if (!item.thumbRef) return null;
  const cached = cache.get(item.thumbRef);
  if (cached) return cached;
  try {
    const fs = await getVaultFs();
    const bytes = await fs.read(item.thumbRef);
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'image/webp' }));
    cache.set(item.thumbRef, url);
    return url;
  } catch {
    return null; // thumb file missing (e.g. vault switched) — card falls back
  }
};
