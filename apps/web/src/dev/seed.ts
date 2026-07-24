/**
 * Dev-only: seed a deterministic synthetic library — 200 folders, 20,000
 * toppings, ~46k properties, tags, and FTS rows — to prove the P0 step-2 exit
 * test ("20k rows, ms-class queries"). Deterministic PRNG so benchmark numbers
 * are comparable across machines and runs.
 */
import type { SqlDriver } from '@waffle/core';

const FOLDER_COUNT = 200;
const TOPPING_COUNT = 20_000;

const ADJECTIVES = ['linen', 'suede', 'greek', 'italian', 'summer', 'wedding', 'vintage', 'minimal', 'olive', 'terracotta', 'coastal', 'brutalist', 'quiet', 'golden', 'andalusian', 'nordic'];
const NOUNS = ['shirt', 'loafers', 'masseria', 'trattoria', 'itinerary', 'invoice', 'recipe', 'sofa', 'lamp', 'ring', 'escritura', 'playa', 'pergola', 'notebook', 'sketch', 'contract'];
const FOLDER_NAMES = ['Trips', 'Wardrobe', 'Finances', 'Health', 'House', 'Recipes', 'Reading', 'Gifts', 'Projects', 'Inspiration'];
const TAGS = ['wedding', 'summer', 'travel', 'fashion', 'home', 'finance', 'health', 'recipes', 'kids', 'design', 'garden', 'italy'];
const COLORS = ['white', 'navy', 'olive', 'tan', 'black', 'terracotta'];
const TYPES = ['note', 'link', 'file'] as const;
// Fake thumb tints so 20k seeded cards exercise masonry visuals (data, not UI tokens).
const TINTS = ['#d9cfc0', '#c9d6cf', '#cfd2e0', '#e0d3cd', '#d5ddc9', '#e0cdd6'];

/** Small deterministic PRNG (mulberry32). */
function prng(seedValue: number): () => number {
  let a = seedValue;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rand: () => number, arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

async function insertChunked(
  db: SqlDriver,
  table: string,
  columns: string[],
  rows: unknown[][],
  chunkSize: number,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
    await db.exec(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`,
      chunk.flat(),
    );
  }
}

export async function seed(db: SqlDriver, onProgress: (label: string) => void): Promise<number> {
  const rand = prng(1234);
  const started = performance.now();
  const now = Date.now();

  await db.transaction(async () => {
    onProgress('clearing previous data');
    for (const table of ['view_order', 'views', 'url_entity_aliases', 'topping_entities', 'topping_tags', 'tags', 'properties', 'toppings', 'folders']) {
      await db.exec(`DELETE FROM ${table}`);
    }
    await db.exec(`DELETE FROM toppings_fts`);

    onProgress('folders');
    // All seed folders nest under one parent so the folder tree stays sane.
    const nowIso = new Date(now).toISOString();
    const folderIds: string[] = [];
    const folderRows: unknown[][] = [['fseed', null, 'Seed Library', '/seed', 'local', nowIso, nowIso]];
    for (let i = 0; i < FOLDER_COUNT; i++) {
      const id = `f${i}`;
      folderIds.push(id);
      const iso = new Date(now - i * 86_400_000).toISOString();
      folderRows.push([id, 'fseed', `${pick(rand, FOLDER_NAMES)} ${i}`, `/seed/${id}`, 'local', iso, iso]);
    }
    await insertChunked(db, 'folders', ['id', 'parent_id', 'name', 'path', 'home', 'created_at', 'updated_at'], folderRows, 200);

    onProgress('tags');
    const tagRows = TAGS.map((name, i) => [`tag${i}`, name, 'user']);
    await insertChunked(db, 'tags', ['id', 'name', 'scope'], tagRows, 200);

    onProgress('toppings');
    const toppingRows: unknown[][] = [];
    const propertyRows: unknown[][] = [];
    const toppingTagRows: unknown[][] = [];
    const ftsRows: unknown[][] = [];
    for (let i = 0; i < TOPPING_COUNT; i++) {
      const id = `t${i}`;
      const type = pick(rand, TYPES);
      const folderId = pick(rand, folderIds);
      const title = `${pick(rand, ADJECTIVES)} ${pick(rand, ADJECTIVES)} ${pick(rand, NOUNS)}`;
      const iso = new Date(now - Math.floor(rand() * 365) * 86_400_000 - i).toISOString();
      const aspect = Math.round((0.6 + rand()) * 100) / 100; // 0.6–1.6, masonry variety
      toppingRows.push([id, type, folderId, title, type === 'link' ? `https://example.com/${id}` : `${folderId}/${id}.md`, iso, iso, 'seed', aspect, pick(rand, TINTS)]);

      propertyRows.push([id, 'rating', 'number', null, Math.floor(rand() * 50) / 10, null]);
      if (type === 'link') {
        propertyRows.push([id, 'price', 'money', null, Math.round((5 + rand() * 495) * 100) / 100, 'EUR']);
        propertyRows.push([id, 'color', 'select', pick(rand, COLORS), null, null]);
      }

      toppingTagRows.push([id, `tag${Math.floor(rand() * TAGS.length)}`]);
      if (rand() < 0.5) toppingTagRows.push([id, `tag${Math.floor(rand() * TAGS.length)}`]);

      const body = `${pick(rand, ADJECTIVES)} ${pick(rand, NOUNS)} for the ${pick(rand, ADJECTIVES)} ${pick(rand, NOUNS)}`;
      ftsRows.push([id, title, body, pick(rand, TAGS)]);
    }

    await insertChunked(db, 'toppings', ['id', 'type', 'folder_id', 'title', 'content_ref', 'created_at', 'updated_at', 'source', 'thumb_aspect', 'thumb_color'], toppingRows, 250);
    onProgress('properties');
    await insertChunked(db, 'properties', ['topping_id', 'key', 'kind', 'value_text', 'value_num', 'value_aux'], propertyRows, 500);
    onProgress('tags per topping');
    // Duplicate (topping, tag) pairs are possible by construction; INSERT OR IGNORE keeps the PK honest.
    for (let i = 0; i < toppingTagRows.length; i += 1000) {
      const chunk = toppingTagRows.slice(i, i + 1000);
      const placeholders = chunk.map(() => '(?,?)').join(',');
      await db.exec(`INSERT OR IGNORE INTO topping_tags (topping_id, tag_id) VALUES ${placeholders}`, chunk.flat());
    }
    onProgress('full-text index');
    await insertChunked(db, 'toppings_fts', ['topping_id', 'title', 'body', 'tags'], ftsRows, 500);
  });

  return Math.round(performance.now() - started);
}
