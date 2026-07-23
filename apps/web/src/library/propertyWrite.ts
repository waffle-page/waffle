/**
 * Property writes go FILE-FIRST (ADR-016 notes-as-rows): patch the note's
 * frontmatter, write the vault file, then a targeted rescan re-derives the
 * index row. The DB is never written directly — the same bytes Obsidian or
 * Finder would see are the single source of truth.
 */
import { propertyToYaml, rescanFile, updateFrontmatter, type PropertyValue, type VaultFs } from '@waffle/core';
import { platform } from '../platform/instance';

export async function writeNoteProperty(fs: VaultFs, path: string, key: string, value: PropertyValue | null): Promise<void> {
  const text = new TextDecoder().decode(await fs.read(path));
  const updated = updateFrontmatter(text, { [key]: value === null ? undefined : propertyToYaml(value) });
  await fs.write(path, new TextEncoder().encode(updated));
  await rescanFile(platform.db, fs, path);
}
