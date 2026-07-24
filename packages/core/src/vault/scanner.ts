/**
 * Vault scanner — QUARANTINE MODULE (docs/08-code-conventions.md).
 *
 * Why this is hairy: it reconciles two sources of truth that drift apart while
 * the app is closed — the folder on disk (canonical for private vaults,
 * ADR-004) and the SQLite index (disposable mirror). The invariants:
 *
 *  - Identity survives edits (same path, new hash → UPDATE same topping id).
 *  - Identity survives moves/renames (path gone, hash found elsewhere → the
 *    topping FOLLOWS the file; its id, and therefore view membership, is kept).
 *  - Disappeared files tombstone (deleted_at), never hard-delete.
 *  - Only rows with source='vault' are touched — seeded/app-created rows are
 *    someone else's (the store layer's) responsibility.
 *  - URL entity refs derive from URL bytes, never the `.url` carrier's file
 *    hash; personal interaction overlays must survive carrier-file renames.
 *
 * v1 limits, on purpose (see docs/04-phases.md deferred list):
 *  - Watcher events trigger a full rescan (debounced by the caller); targeted
 *    incremental scans come when a real vault exceeds ~5k files.
 *  - Folder identity is path-derived; renaming a folder re-creates its subtree
 *    identity. Topping ids still survive (hash match).
 *  - Files > 2 MB hash as size:mtime marker instead of content (streaming hash
 *    later); their move-tracking is size+mtime-based.
 */
import type { SqlDriver, ToppingType, VaultFs } from '../types';
import { parseNote, toEavColumns } from './frontmatter';
import { contentHash, folderIdFor, urlEntityKey } from './hash';
import { loadPropertyTypes } from './propertyTypes';

export interface ScanResult {
  files: number;
  folders: number;
  added: number;
  updated: number;
  moved: number;
  tombstoned: number;
  unchanged: number;
  ms: number;
}

const MAX_HASH_BYTES = 2 * 1024 * 1024;
const MAX_FTS_BODY = 20_000;
const TEXT_TYPES: Record<string, ToppingType> = { md: 'note', url: 'link', webloc: 'link', dash: 'dash' };

const dirname = (path: string): string => path.split('/').slice(0, -1).join('/');
const basename = (path: string): string => path.split('/').pop()!;

interface FsFile { path: string; size: number; mtime: number }
interface Existing { id: string; folder_id: string; content_ref: string; content_hash: string | null }
interface EntityRef { topping_id: string; entity_key: string }

export async function scanVault(db: SqlDriver, fs: VaultFs): Promise<ScanResult> {
  const t0 = performance.now();
  const types = await loadPropertyTypes(fs);

  // Pass 1 — walk the tree (skip dot-entries: .waffle, .obsidian, .DS_Store…).
  const files: FsFile[] = [];
  const dirs: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.list(dir)) {
      const name = entry.path.split('/').pop()!;
      if (name.startsWith('.')) continue;
      if (entry.isDir) {
        dirs.push(entry.path);
        await walk(entry.path);
      } else {
        files.push({ path: entry.path, size: entry.size, mtime: entry.mtime });
      }
    }
  };
  await walk('');

  // Pass 2 — hash + extract outside the transaction (slow part, no lock held).
  interface ExtractedFile extends FsFile {
    type: ToppingType;
    hash: string;
    note: ReturnType<typeof parseNote> | null;
    url: string | null;
    entityKey: string | null;
  }
  const extracted: ExtractedFile[] = [];
  for (const f of files) {
    const type = typeFor(f.path);
    const readable = type !== 'file' || f.size <= MAX_HASH_BYTES;
    const bytes = readable ? await fs.read(f.path) : null;
    const hash = bytes ? await contentHash(bytes) : `big:${f.size}:${f.mtime}`;
    const note = type === 'note' && bytes ? parseNote(new TextDecoder().decode(bytes), types) : null;
    const url = type === 'link' && bytes ? extractUrl(new TextDecoder().decode(bytes)) : null;
    const entityKey = url ? await urlEntityKey(url) : null;
    extracted.push({ ...f, type, hash, note, url, entityKey });
  }

  const result: ScanResult = { files: files.length, folders: dirs.length, added: 0, updated: 0, moved: 0, tombstoned: 0, unchanged: 0, ms: 0 };
  const now = new Date().toISOString();

  await db.transaction(async () => {
    // Folders: deterministic ids from paths; INSERT OR IGNORE keeps reruns cheap.
    for (const dir of ['', ...dirs]) {
      await db.exec(
        `INSERT OR IGNORE INTO folders (id, parent_id, name, path, home, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
        [await folderIdFor(dir), dir === '' ? null : await folderIdFor(dirname(dir)), dir === '' ? '/' : basename(dir), '/' + dir, 'local', now, now],
      );
    }

    const existing = await db.exec<Existing>(
      `SELECT id, folder_id, content_ref, content_hash FROM toppings WHERE source = 'vault' AND deleted_at IS NULL`,
    );
    const byPath = new Map(existing.map((r) => [r.content_ref, r]));
    // One read lets unchanged files avoid thousands of no-op UPSERTs while
    // still backfilling the derived table after migration v5.
    const entityRefs = await db.exec<EntityRef>(
      `SELECT topping_id, entity_key FROM topping_entities WHERE entity_kind = 'url'`,
    );
    const entityByTopping = new Map(entityRefs.map((ref) => [ref.topping_id, ref.entity_key]));
    const byHash = new Map<string, Existing[]>();
    for (const r of existing) {
      if (!r.content_hash) continue;
      const list = byHash.get(r.content_hash) ?? [];
      list.push(r);
      byHash.set(r.content_hash, list);
    }
    const fsPaths = new Set(extracted.map((f) => f.path));
    const seenIds = new Set<string>();

    for (const f of extracted) {
      const folderId = await folderIdFor(dirname(f.path));
      const title = basename(f.path).replace(/\.[^.]+$/, '');
      const mtimeIso = new Date(f.mtime).toISOString();
      const atPath = byPath.get(f.path);

      if (atPath && atPath.content_hash === f.hash) {
        if ((entityByTopping.get(atPath.id) ?? null) !== f.entityKey) {
          await replaceUrlEntityRef(db, atPath.id, f.entityKey);
        }
        // Self-heal: folder_id derives from the path — if it drifted (bug, or a
        // future folder-id scheme change), quietly correct it.
        if (atPath.folder_id !== folderId) {
          await db.exec(`UPDATE toppings SET folder_id = ? WHERE id = ?`, [folderId, atPath.id]);
          result.updated++;
        } else {
          result.unchanged++;
        }
        seenIds.add(atPath.id);
        continue;
      }

      if (atPath) {
        // Same path, new content → edit in place. Thumb fields reset: the old
        // thumbnail describes bytes that no longer exist (thumbnailer re-runs).
        await db.exec(
          `UPDATE toppings SET title = ?, content_hash = ?, updated_at = ?,
             thumb_ref = NULL, thumb_aspect = NULL, thumb_color = NULL WHERE id = ?`,
          [title, f.hash, mtimeIso, atPath.id],
        );
        await writeExtras(db, atPath.id, f);
        result.updated++;
        seenIds.add(atPath.id);
        continue;
      }

      // New path: a move if this content used to live at a path that vanished.
      const candidate = (byHash.get(f.hash) ?? []).find((r) => !fsPaths.has(r.content_ref) && !seenIds.has(r.id));
      if (candidate) {
        await db.exec(`UPDATE toppings SET content_ref = ?, folder_id = ?, title = ?, updated_at = ? WHERE id = ?`, [f.path, folderId, title, mtimeIso, candidate.id]);
        if ((entityByTopping.get(candidate.id) ?? null) !== f.entityKey) {
          await replaceUrlEntityRef(db, candidate.id, f.entityKey);
        }
        result.moved++;
        seenIds.add(candidate.id);
        continue;
      }

      const id = crypto.randomUUID();
      await db.exec(
        `INSERT INTO toppings (id, type, folder_id, title, content_ref, content_hash, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, f.type, folderId, title, f.path, f.hash, 'vault', mtimeIso, mtimeIso],
      );
      await writeExtras(db, id, f);
      result.added++;
      seenIds.add(id);
    }

    for (const r of existing) {
      if (seenIds.has(r.id) || fsPaths.has(r.content_ref)) continue;
      await db.exec(`UPDATE toppings SET deleted_at = ? WHERE id = ?`, [now, r.id]);
      await db.exec(`DELETE FROM toppings_fts WHERE topping_id = ?`, [r.id]);
      result.tombstoned++;
    }
  });

  result.ms = Math.round(performance.now() - t0);
  return result;
}

/**
 * Targeted single-file reindex — the fast path for app-initiated writes (cell
 * edits, create-row): the file was just written, so re-deriving one topping
 * beats a full-vault walk. Same invariants as scanVault with one deliberate
 * gap: NO move detection (the caller writes to a known path, it can't be a
 * move) and no big-file marker (this path is for text toppings; anything read
 * here gets a real content hash, which the next scanVault agrees with).
 */
export async function rescanFile(db: SqlDriver, fs: VaultFs, path: string): Promise<void> {
  const now = new Date().toISOString();
  let bytes: Uint8Array | null = null;
  try {
    bytes = await fs.read(path);
  } catch {
    bytes = null; // gone → tombstone below, mirroring scanVault's disappeared-file rule
  }

  await db.transaction(async () => {
    const rows = await db.exec<Existing>(
      `SELECT id, folder_id, content_ref, content_hash FROM toppings WHERE source = 'vault' AND deleted_at IS NULL AND content_ref = ?`,
      [path],
    );
    const existing = rows[0] ?? null;

    if (bytes === null) {
      if (existing) {
        await db.exec(`UPDATE toppings SET deleted_at = ? WHERE id = ?`, [now, existing.id]);
        await db.exec(`DELETE FROM toppings_fts WHERE topping_id = ?`, [existing.id]);
      }
      return;
    }

    const hash = await contentHash(bytes);
    const type = typeFor(path);
    const text = new TextDecoder().decode(bytes);
    const url = type === 'link' ? extractUrl(text) : null;
    const entityKey = url ? await urlEntityKey(url) : null;
    if (existing && existing.content_hash === hash) {
      await replaceUrlEntityRef(db, existing.id, entityKey);
      return;
    }

    const types = await loadPropertyTypes(fs);
    const f = {
      type,
      path,
      note: type === 'note' ? parseNote(text, types) : null,
      url,
      entityKey,
    };
    const title = basename(path).replace(/\.[^.]+$/, '');

    if (existing) {
      await db.exec(
        `UPDATE toppings SET title = ?, content_hash = ?, updated_at = ?,
           thumb_ref = NULL, thumb_aspect = NULL, thumb_color = NULL WHERE id = ?`,
        [title, hash, now, existing.id],
      );
      await writeExtras(db, existing.id, f);
      return;
    }

    const folderId = await folderIdFor(dirname(path));
    await db.exec(
      `INSERT OR IGNORE INTO folders (id, parent_id, name, path, home, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      [folderId, dirname(path) === '' ? null : await folderIdFor(dirname(dirname(path))), dirname(path) === '' ? '/' : basename(dirname(path)), '/' + dirname(path), 'local', now, now],
    );
    const id = crypto.randomUUID();
    await db.exec(
      `INSERT INTO toppings (id, type, folder_id, title, content_ref, content_hash, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, f.type, folderId, title, path, hash, 'vault', now, now],
    );
    await writeExtras(db, id, f);
  });
}

function typeFor(path: string): ToppingType {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return TEXT_TYPES[ext] ?? 'file';
}

/** `.url` files are INI (`URL=…`); `.webloc` is a plist — grab the first http(s) URL either way. */
function extractUrl(text: string): string | null {
  return /https?:\/\/[^\s<>"']+/.exec(text)?.[0] ?? null;
}

/** Properties + tags + FTS for a topping — full replace (frontmatter is canonical, ADR-004). */
async function writeExtras(
  db: SqlDriver,
  toppingId: string,
  f: { type: ToppingType; path: string; note: ReturnType<typeof parseNote> | null; url: string | null; entityKey: string | null },
): Promise<void> {
  await db.exec(`DELETE FROM properties WHERE topping_id = ?`, [toppingId]);
  await db.exec(`DELETE FROM topping_tags WHERE topping_id = ?`, [toppingId]);
  await db.exec(`DELETE FROM toppings_fts WHERE topping_id = ?`, [toppingId]);
  await replaceUrlEntityRef(db, toppingId, f.entityKey);

  const title = f.path.split('/').pop()!.replace(/\.[^.]+$/, '');

  if (f.type === 'link' && f.url) {
    // Vault-file-backed link: content_ref is the carrier file's PATH (so the
    // scanner can track it); the URL itself lives as a property.
    await db.exec(`INSERT INTO properties (topping_id, key, kind, value_text) VALUES (?,?,?,?)`, [toppingId, 'url', 'url', f.url]);
    await db.exec(`INSERT INTO toppings_fts (topping_id, title, body, tags) VALUES (?,?,?,?)`, [toppingId, title, f.url, '']);
    return;
  }

  if (!f.note) {
    await db.exec(`INSERT INTO toppings_fts (topping_id, title, body, tags) VALUES (?,?,?,?)`, [toppingId, title, '', '']);
    return;
  }

  for (const [key, value] of Object.entries(f.note.properties)) {
    const c = toEavColumns(value);
    await db.exec(
      `INSERT INTO properties (topping_id, key, kind, value_text, value_num, value_aux) VALUES (?,?,?,?,?,?)`,
      [toppingId, key, c.kind, c.text, c.num, c.aux],
    );
  }
  for (const tag of f.note.tags) {
    const tagId = 'tag_' + tag;
    await db.exec(`INSERT OR IGNORE INTO tags (id, name, scope) VALUES (?,?,?)`, [tagId, tag, 'user']);
    await db.exec(`INSERT OR IGNORE INTO topping_tags (topping_id, tag_id) VALUES (?,?)`, [toppingId, tagId]);
  }
  await db.exec(
    `INSERT INTO toppings_fts (topping_id, title, body, tags) VALUES (?,?,?,?)`,
    [toppingId, title, f.note.body.slice(0, MAX_FTS_BODY), f.note.tags.join(' ')],
  );
}

/** Replace only the scanner-owned URL projection; other entity kinds have separate ingesters. */
async function replaceUrlEntityRef(db: SqlDriver, toppingId: string, entityKey: string | null): Promise<void> {
  if (entityKey === null) {
    await db.exec(`DELETE FROM topping_entities WHERE topping_id = ? AND entity_kind = 'url'`, [toppingId]);
    return;
  }
  await db.exec(
    `INSERT INTO topping_entities (topping_id, entity_kind, entity_key) VALUES (?,'url',?)
     ON CONFLICT(topping_id, entity_kind) DO UPDATE SET entity_key = excluded.entity_key`,
    [toppingId, entityKey],
  );
}
