/**
 * Thumbnail pipeline, v1 (ADR-012 as amended): for image file toppings, render
 * one 480w webp into `.waffle/thumbs/`, store aspect ratio (masonry) and
 * dominant color (instant paint). Own code, zero dependencies — local thumbs
 * load in single-digit ms, so nothing fancier is warranted yet.
 *
 * Idempotent: processes rows with thumb_ref IS NULL; the scanner nulls thumb
 * fields when a file's content changes, which re-queues it here. Failures are
 * skipped and retried on the next run.
 */
import type { SqlDriver, VaultFs } from '@waffle/core';

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
const THUMB_W = 480;

export async function runThumbnailer(db: SqlDriver, fs: VaultFs): Promise<number> {
  const pending = await db.exec<{ id: string; content_ref: string }>(
    `SELECT id, content_ref FROM toppings
     WHERE source = 'vault' AND type = 'file' AND thumb_ref IS NULL AND deleted_at IS NULL`,
  );
  let generated = 0;
  for (const row of pending) {
    if (!IMAGE_EXT.test(row.content_ref)) continue;
    try {
      const bytes = await fs.read(row.content_ref);
      const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart]));
      const aspect = bitmap.width / bitmap.height;
      const w = Math.min(THUMB_W, bitmap.width);
      const h = Math.max(1, Math.round(w / aspect));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();

      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
      const ref = `.waffle/thumbs/${row.id}.webp`;
      await fs.write(ref, new Uint8Array(await blob.arrayBuffer()));

      await db.exec(
        `UPDATE toppings SET thumb_ref = ?, thumb_aspect = ?, thumb_color = ? WHERE id = ?`,
        [ref, aspect, dominantColor(ctx, w, h), row.id],
      );
      generated++;
    } catch {
      // Unreadable/corrupt image: leave thumb fields NULL; next run retries.
    }
  }
  return generated;
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
