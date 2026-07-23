/**
 * Thumbnail pipeline, v1 (ADR-012 as amended): render one 480w webp into
 * `.waffle/thumbs/`, store aspect ratio (masonry) and dominant color (instant
 * paint). Two sources: image FILE toppings, and NOTES whose body embeds a
 * vault image (`![[photo.png]]` / `![](photo.png)` — first one wins, remote
 * URLs never fetched). Own code, zero dependencies.
 *
 * Idempotent: processes rows with thumb_ref IS NULL; the scanner nulls thumb
 * fields when a file's content changes, which re-queues it here. Failures are
 * skipped and retried on the next run.
 */
import { parseNote, type SqlDriver, type VaultFs } from '@waffle/core';
import { resolveEmbed } from '../editor/resolve';

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
const EMBED = /!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(([^)\s]+)\)/g;
const THUMB_W = 480;

export async function runThumbnailer(db: SqlDriver, fs: VaultFs): Promise<number> {
  let generated = 0;

  const files = await db.exec<{ id: string; content_ref: string }>(
    `SELECT id, content_ref FROM toppings
     WHERE source = 'vault' AND type = 'file' AND thumb_ref IS NULL AND deleted_at IS NULL`,
  );
  for (const row of files) {
    if (!IMAGE_EXT.test(row.content_ref)) continue;
    if (await thumbFromImage(db, fs, row.id, row.content_ref)) generated++;
  }

  const notes = await db.exec<{ id: string; content_ref: string }>(
    `SELECT id, content_ref FROM toppings
     WHERE source = 'vault' AND type = 'note' AND thumb_ref IS NULL AND deleted_at IS NULL`,
  );
  for (const row of notes) {
    const image = await firstEmbeddedImage(fs, row.content_ref);
    if (image && (await thumbFromImage(db, fs, row.id, image))) generated++;
  }

  return generated;
}

/** First embedded VAULT image in the note body, in document order. */
async function firstEmbeddedImage(fs: VaultFs, notePath: string): Promise<string | null> {
  try {
    const body = parseNote(new TextDecoder().decode(await fs.read(notePath))).body;
    for (const m of body.matchAll(EMBED)) {
      const target = (m[1] ?? m[2])!;
      if (/^https?:\/\//i.test(target)) continue; // remote embeds are view-time only, never fetched here
      if (!IMAGE_EXT.test(target)) continue;
      // Wiki targets resolve as written; markdown paths resolve by basename (same folder-first rules).
      const resolved = await resolveEmbed(notePath, m[1] ? target : target.split('/').pop()!);
      if (resolved) return resolved;
    }
  } catch {
    // Unreadable note: skip; next run retries.
  }
  return null;
}

async function thumbFromImage(db: SqlDriver, fs: VaultFs, toppingId: string, imagePath: string): Promise<boolean> {
  try {
    const bytes = await fs.read(imagePath);
    const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart]));
    const aspect = bitmap.width / bitmap.height;
    const w = Math.min(THUMB_W, bitmap.width);
    const h = Math.max(1, Math.round(w / aspect));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
    const ref = `.waffle/thumbs/${toppingId}.webp`;
    await fs.write(ref, new Uint8Array(await blob.arrayBuffer()));

    await db.exec(
      `UPDATE toppings SET thumb_ref = ?, thumb_aspect = ?, thumb_color = ? WHERE id = ?`,
      [ref, aspect, dominantColor(ctx, w, h), toppingId],
    );
    return true;
  } catch {
    return false; // unreadable/corrupt image: leave thumb fields NULL; next run retries
  }
}

/** Average color over ≤1024 sampled pixels — the 10-line blurhash stand-in. */
function dominantColor(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): string {
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = 4 * Math.max(1, Math.floor((w * h) / 1024));
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += step) {
    r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++;
  }
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
