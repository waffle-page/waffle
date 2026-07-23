/**
 * Property writes go FILE-FIRST (ADR-016 notes-as-rows): patch the note's
 * frontmatter, write the vault file, then a targeted rescan re-derives the
 * index row. The DB is never written directly — the same bytes Obsidian or
 * Finder would see are the single source of truth. Writes to one vault path
 * serialize: every queued patch reads the bytes produced by its predecessor,
 * so rapid edits to different properties cannot erase one another.
 */
import { propertyToYaml, rescanFile, updateFrontmatter, type PropertyValue, type VaultFs } from '@waffle/core';
import { platform } from '../platform/instance';

const queuesByVault = new WeakMap<VaultFs, Map<string, Promise<void>>>();

export async function writeNoteProperty(fs: VaultFs, path: string, key: string, value: PropertyValue | null): Promise<void> {
  await writeNoteProperties(fs, path, { [key]: value });
}

/** Compose a row patch into one file write, then perform one targeted rescan. */
export async function writeNoteProperties(
  fs: VaultFs,
  path: string,
  values: Readonly<Record<string, PropertyValue | null>>,
): Promise<void> {
  const queues = queuesByVault.get(fs) ?? new Map<string, Promise<void>>();
  queuesByVault.set(fs, queues);
  const previous = queues.get(path) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const text = new TextDecoder().decode(await fs.read(path));
    const patch = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value === null ? undefined : propertyToYaml(value)]),
    );
    const updated = updateFrontmatter(text, patch);
    await fs.write(path, new TextEncoder().encode(updated));
    await rescanFile(platform.db, fs, path);
  });
  queues.set(path, current);
  try {
    await current;
  } finally {
    if (queues.get(path) === current) queues.delete(path);
  }
}
