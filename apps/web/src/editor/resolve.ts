/**
 * Wikilink and embed target resolution — Obsidian semantics, simplified:
 * bare names resolve note-folder-first, then vault-wide by filename.
 */
import { platform } from '../platform/instance';

/** `[[Name]]` → the note's vault path (case-insensitive title match). */
export async function findNoteByTitle(name: string): Promise<string | null> {
  const rows = await platform.db.exec<{ content_ref: string }>(
    `SELECT content_ref FROM toppings
     WHERE type = 'note' AND source = 'vault' AND deleted_at IS NULL AND LOWER(title) = LOWER(?)
     LIMIT 1`,
    [name],
  );
  return rows[0]?.content_ref ?? null;
}

/** `![[file.ext]]` → vault path: same folder as the note, else anywhere by filename. */
export async function resolveEmbed(notePath: string, target: string): Promise<string | null> {
  const noteDir = notePath.split('/').slice(0, -1).join('/');
  const candidates = noteDir ? [`${noteDir}/${target}`, target] : [target];
  const placeholders = candidates.map(() => '?').join(',');
  const exact = await platform.db.exec<{ content_ref: string }>(
    `SELECT content_ref FROM toppings
     WHERE source = 'vault' AND deleted_at IS NULL AND content_ref IN (${placeholders}) LIMIT 1`,
    candidates,
  );
  if (exact[0]) return exact[0].content_ref;
  const byName = await platform.db.exec<{ content_ref: string }>(
    `SELECT content_ref FROM toppings
     WHERE source = 'vault' AND deleted_at IS NULL AND content_ref LIKE ?
     ORDER BY LENGTH(content_ref) LIMIT 1`,
    ['%/' + target],
  );
  return byName[0]?.content_ref ?? null;
}
