/**
 * Executable mutation boundary for library files.
 *
 * Planners decide WHAT changes; this module performs the only legal private-
 * vault loop: write/move file → rescanFile. React owns the final requery after
 * these commands settle. Receipts retain the exact forward/inverse material
 * Slice C needs for session undo without teaching components about file I/O.
 *
 * Writes to one note path serialize so every patch reads its predecessor.
 * A planned multi-property row patch is always one file write and one rescan.
 */
import {
  propertyToYaml,
  rescanFile,
  updateFrontmatter,
  type PropertyValue,
  type VaultFs,
} from '@waffle/core';
import { platform } from '../platform/instance';
import { createNote, exists, uniquePath } from './addFlows';
import type { PlannedNoteCreate, PlannedNotePatch, PropertyPatch, TableOperationPlan } from './tableOperations';

export interface TableMutationReceipt {
  kind: 'table';
  patches: PlannedNotePatch[];
  createdPaths: string[];
}

export interface TrashMutationReceipt {
  kind: 'trash';
  moves: Array<{ from: string; to: string }>;
}

export type VaultMutationReceipt = TableMutationReceipt | TrashMutationReceipt;
export type ReplayableMutationReceipt =
  | { kind: 'table'; patches: PlannedNotePatch[] }
  | TrashMutationReceipt;
export type ReplayDirection = 'undo' | 'redo';

const queuesByVault = new WeakMap<VaultFs, Map<string, Promise<void>>>();

async function writeNoteProperties(
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
    await fs.write(path, new TextEncoder().encode(updateFrontmatter(text, patch)));
    await rescanFile(platform.db, fs, path);
  });
  queues.set(path, current);
  try {
    await current;
  } finally {
    if (queues.get(path) === current) queues.delete(path);
  }
}

function noteContents(values: PropertyPatch): string {
  const patch = Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => value === null ? [] : [[key, propertyToYaml(value)]]),
  );
  return Object.keys(patch).length > 0 ? updateFrontmatter('', patch) : '';
}

async function createPlannedNote(fs: VaultFs, dir: string, create: PlannedNoteCreate): Promise<string> {
  const path = await createNote(fs, dir, create.title, noteContents(create.values));
  await rescanFile(platform.db, fs, path);
  return path;
}

/** Execute one logical table gesture. The caller requeries after it settles. */
export async function commitTableOperation(
  fs: VaultFs,
  dir: string | null,
  plan: TableOperationPlan,
): Promise<TableMutationReceipt> {
  for (const patch of plan.patches) await writeNoteProperties(fs, patch.path, patch.after);
  const createdPaths: string[] = [];
  for (const create of plan.creates) {
    if (dir === null) throw new Error('This view has no vault directory for note creation.');
    createdPaths.push(await createPlannedNote(fs, dir, create));
  }
  return { kind: 'table', patches: plan.patches, createdPaths };
}

export async function createEmptyNote(fs: VaultFs, dir: string, title: string): Promise<string> {
  return createPlannedNote(fs, dir, { title, values: {} });
}

async function trashFile(fs: VaultFs, path: string): Promise<{ from: string; to: string }> {
  const name = path.split('/').pop()!;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const target = await uniquePath(fs, '.trash', base, ext);
  // Use read → write → remove instead of fs.move so every backend behaves
  // identically. The scanner skips dot-directories; rescanning the vanished
  // original path therefore tombstones its mirror row without indexing trash.
  const bytes = await fs.read(path);
  await fs.write(target, bytes);
  await fs.remove(path);
  await rescanFile(platform.db, fs, path);
  return { from: path, to: target };
}

/** Soft-delete only; the returned paths are the future un-trash inverse. */
export async function trashVaultFiles(fs: VaultFs, paths: string[]): Promise<TrashMutationReceipt> {
  const moves: TrashMutationReceipt['moves'] = [];
  for (const path of paths) moves.push(await trashFile(fs, path));
  return { kind: 'trash', moves };
}

/**
 * Move a file to one exact inverse path without ever replacing an occupant.
 *
 * Session history stores both paths, so inventing a new target during replay
 * would break redo identity. A collision instead freezes that replay entry:
 * preserving an externally-created user file is more important than making
 * the shortcut appear successful.
 */
async function replayMove(
  fs: VaultFs,
  from: string,
  to: string,
  canonicalPath: string,
): Promise<void> {
  if (await exists(fs, to)) {
    throw new Error(`Cannot replay history because "${to}" already exists.`);
  }
  const bytes = await fs.read(from);
  await fs.write(to, bytes);
  await fs.remove(from);
  // Trash is deliberately invisible to the scanner. Reindexing the original
  // path therefore restores its row on undo and tombstones it again on redo.
  await rescanFile(platform.db, fs, canonicalPath);
}

/**
 * Replay only the mutation classes promised by Slice C.
 *
 * Table-created overflow notes are intentionally absent from the replayable
 * receipt: the current contract covers property patches and soft deletes, not
 * note creation. Undo runs row patches and trash moves in reverse order so a
 * gesture's inverse is applied in the opposite order from its forward writes.
 */
export async function replayVaultMutation(
  fs: VaultFs,
  receipt: ReplayableMutationReceipt,
  direction: ReplayDirection,
): Promise<void> {
  if (receipt.kind === 'table') {
    const patches = direction === 'undo' ? [...receipt.patches].reverse() : receipt.patches;
    for (const patch of patches) {
      await writeNoteProperties(fs, patch.path, direction === 'undo' ? patch.before : patch.after);
    }
    return;
  }

  const moves = direction === 'undo' ? [...receipt.moves].reverse() : receipt.moves;
  for (const move of moves) {
    if (direction === 'undo') {
      await replayMove(fs, move.to, move.from, move.from);
    } else {
      await replayMove(fs, move.from, move.to, move.from);
    }
  }
}
