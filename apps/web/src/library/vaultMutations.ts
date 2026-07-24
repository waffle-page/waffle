/**
 * Executable mutation boundary for library files.
 *
 * Planners decide WHAT changes; this module performs the only legal private-
 * vault loop: write/move file → rescanFile. React owns the final requery after
 * these commands settle. Receipts retain the exact forward/inverse material
 * session history needs without teaching components about file I/O.
 *
 * Writes to one note path serialize so every patch reads its predecessor.
 * A planned multi-property row patch is always one file write and one rescan.
 */
import {
  loadPropertyTypes,
  parseNote,
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
  warnings: MutationWarning[];
}

export interface TrashMutationReceipt {
  kind: 'trash';
  moves: Array<{ from: string; to: string }>;
  warnings: MutationWarning[];
}

export interface MutationWarning {
  path: string;
  message: string;
}

/** Collapse post-write projection failures into one concise UI-safe notice. */
export function mutationWarningsMessage(warnings: MutationWarning[]): string | null {
  if (warnings.length === 0) return null;
  return `${warnings.length} index refresh warning${warnings.length === 1 ? '' : 's'}: ${warnings[0]!.message}`;
}

export type VaultMutationReceipt = TableMutationReceipt | TrashMutationReceipt;
export type ReplayableMutationReceipt =
  | { kind: 'table'; patches: PlannedNotePatch[] }
  | { kind: 'trash'; moves: TrashMutationReceipt['moves'] };
export type ReplayDirection = 'undo' | 'redo';

export interface ReplayMutationResult {
  warnings: MutationWarning[];
}

/** A logical gesture failed after these canonical sub-mutations completed. */
export class PartialVaultMutationError extends Error {
  readonly receipt: VaultMutationReceipt;
  readonly cause: unknown;

  constructor(message: string, receipt: VaultMutationReceipt, cause: unknown) {
    super(message);
    this.name = 'PartialVaultMutationError';
    this.receipt = receipt;
    this.cause = cause;
  }
}

/** Replay itself can split when a later file fails after earlier inverses. */
export class PartialReplayMutationError extends Error {
  readonly applied: ReplayableMutationReceipt;
  readonly remaining: ReplayableMutationReceipt;
  readonly warnings: MutationWarning[];
  readonly cause: unknown;

  constructor(
    message: string,
    applied: ReplayableMutationReceipt,
    remaining: ReplayableMutationReceipt,
    warnings: MutationWarning[],
    cause: unknown,
  ) {
    super(message);
    this.name = 'PartialReplayMutationError';
    this.applied = applied;
    this.remaining = remaining;
    this.warnings = warnings;
    this.cause = cause;
  }
}

interface NoteWritePrecondition {
  expected: Readonly<Record<string, PropertyValue | null>>;
  direction: ReplayDirection;
}

const queuesByVault = new WeakMap<VaultFs, Map<string, Promise<MutationWarning[]>>>();

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const samePropertyValue = (
  left: PropertyValue | null | undefined,
  right: PropertyValue | null | undefined,
): boolean => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

async function assertExpectedNoteProperties(
  fs: VaultFs,
  path: string,
  expected: NoteWritePrecondition,
  text?: string,
): Promise<void> {
  const markdown = text ?? new TextDecoder().decode(await fs.read(path));
  const current = parseNote(markdown, await loadPropertyTypes(fs)).properties;
  for (const [key, value] of Object.entries(expected.expected)) {
    if (samePropertyValue(current[key], value)) continue;
    throw new Error(
      `Cannot ${expected.direction} because "${path}" property "${key}" changed after this action.`,
    );
  }
}

async function rescanWarning(fs: VaultFs, path: string): Promise<MutationWarning[]> {
  try {
    await rescanFile(platform.db, fs, path);
    return [];
  } catch (error) {
    return [{
      path,
      message: `The file changed, but its index refresh failed: ${messageOf(error)}`,
    }];
  }
}

async function writeNoteProperties(
  fs: VaultFs,
  path: string,
  values: Readonly<Record<string, PropertyValue | null>>,
  precondition?: NoteWritePrecondition,
): Promise<MutationWarning[]> {
  const queues = queuesByVault.get(fs) ?? new Map<string, Promise<MutationWarning[]>>();
  queuesByVault.set(fs, queues);
  const previous = queues.get(path) ?? Promise.resolve([]);
  const current = previous.catch(() => []).then(async () => {
    const text = new TextDecoder().decode(await fs.read(path));
    // Validate inside the same per-path queue and against the same bytes the
    // write will patch. Undo must freeze—not clobber—when Obsidian, the note
    // editor, or a reused path has changed one of the targeted properties.
    if (precondition) await assertExpectedNoteProperties(fs, path, precondition, text);
    const patch = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value === null ? undefined : propertyToYaml(value)]),
    );
    await fs.write(path, new TextEncoder().encode(updateFrontmatter(text, patch)));
    return rescanWarning(fs, path);
  });
  queues.set(path, current);
  try {
    return await current;
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

async function createPlannedNote(
  fs: VaultFs,
  dir: string,
  create: PlannedNoteCreate,
): Promise<{ path: string; warnings: MutationWarning[] }> {
  const path = await createNote(fs, dir, create.title, noteContents(create.values));
  return { path, warnings: await rescanWarning(fs, path) };
}

function receiptSize(receipt: VaultMutationReceipt): number {
  return receipt.kind === 'table'
    ? receipt.patches.length + receipt.createdPaths.length
    : receipt.moves.length;
}

function throwPartial(
  action: string,
  receipt: VaultMutationReceipt,
  total: number,
  error: unknown,
): never {
  const completed = receiptSize(receipt);
  if (completed === 0) throw error;
  const warning = mutationWarningsMessage(receipt.warnings);
  throw new PartialVaultMutationError(
    `${action} stopped after ${completed} of ${total} file changes: ${messageOf(error)}${warning ? ` ${warning}` : ''}`,
    receipt,
    error,
  );
}

/** Execute one logical table gesture. The caller requeries after it settles. */
export async function commitTableOperation(
  fs: VaultFs,
  dir: string | null,
  plan: TableOperationPlan,
): Promise<TableMutationReceipt> {
  const receipt: TableMutationReceipt = {
    kind: 'table',
    patches: [],
    createdPaths: [],
    warnings: [],
  };
  const total = plan.patches.length + plan.creates.length;

  for (const patch of plan.patches) {
    try {
      receipt.warnings.push(...await writeNoteProperties(fs, patch.path, patch.after));
      receipt.patches.push(patch);
    } catch (error) {
      throwPartial('Table operation', receipt, total, error);
    }
  }
  for (const create of plan.creates) {
    try {
      if (dir === null) throw new Error('This view has no vault directory for note creation.');
      const created = await createPlannedNote(fs, dir, create);
      receipt.createdPaths.push(created.path);
      receipt.warnings.push(...created.warnings);
    } catch (error) {
      throwPartial('Table operation', receipt, total, error);
    }
  }
  return receipt;
}

export async function createEmptyNote(
  fs: VaultFs,
  dir: string,
  title: string,
): Promise<TableMutationReceipt> {
  const created = await createPlannedNote(fs, dir, { title, values: {} });
  return {
    kind: 'table',
    patches: [],
    createdPaths: [created.path],
    warnings: created.warnings,
  };
}

async function trashFile(
  fs: VaultFs,
  path: string,
): Promise<{ move: { from: string; to: string }; warnings: MutationWarning[] }> {
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
  try {
    await fs.remove(path);
  } catch (removeError) {
    // A copy is not a completed move and must not masquerade as a replayable
    // receipt. Best-effort rollback restores the pre-command path topology.
    try {
      await fs.remove(target);
    } catch (rollbackError) {
      throw new Error(
        `Could not finish moving "${path}" or remove the safety copy "${target}": ${messageOf(removeError)}; rollback: ${messageOf(rollbackError)}`,
      );
    }
    throw removeError;
  }
  return {
    move: { from: path, to: target },
    warnings: await rescanWarning(fs, path),
  };
}

/** Soft-delete only; the returned paths are the exact un-trash inverse. */
export async function trashVaultFiles(fs: VaultFs, paths: string[]): Promise<TrashMutationReceipt> {
  const receipt: TrashMutationReceipt = { kind: 'trash', moves: [], warnings: [] };
  for (const path of paths) {
    try {
      const trashed = await trashFile(fs, path);
      receipt.moves.push(trashed.move);
      receipt.warnings.push(...trashed.warnings);
    } catch (error) {
      throwPartial('Soft delete', receipt, paths.length, error);
    }
  }
  return receipt;
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
): Promise<MutationWarning[]> {
  if (await exists(fs, to)) {
    throw new Error(`Cannot replay history because "${to}" already exists.`);
  }
  if (!(await exists(fs, from))) {
    throw new Error(`Cannot replay history because "${from}" no longer exists.`);
  }
  const bytes = await fs.read(from);
  await fs.write(to, bytes);
  try {
    await fs.remove(from);
  } catch (removeError) {
    // Keep a failed replay topologically unchanged whenever the backend lets
    // us. If cleanup also fails, both copies remain: duplication is safer than
    // deleting either user file, and the error names both paths for recovery.
    try {
      await fs.remove(to);
    } catch (rollbackError) {
      throw new Error(
        `Could not finish moving "${from}" or remove the safety copy "${to}": ${messageOf(removeError)}; rollback: ${messageOf(rollbackError)}`,
      );
    }
    throw removeError;
  }
  // Trash is deliberately invisible to the scanner. Reindexing the original
  // path therefore restores its row on undo and tombstones it again on redo.
  return rescanWarning(fs, canonicalPath);
}

/**
 * Replay only the mutation classes promised by session history.
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
): Promise<ReplayMutationResult> {
  if (receipt.kind === 'table') {
    const ordered = direction === 'undo' ? [...receipt.patches].reverse() : receipt.patches;
    // Preflight every row before the first inverse write. Ordinary external
    // divergence therefore freezes the whole logical gesture, rather than
    // applying a misleading prefix and failing on a later row.
    for (const patch of ordered) {
      await assertExpectedNoteProperties(fs, patch.path, {
        expected: direction === 'undo' ? patch.after : patch.before,
        direction,
      });
    }

    const applied: PlannedNotePatch[] = [];
    const warnings: MutationWarning[] = [];
    for (let index = 0; index < ordered.length; index += 1) {
      const patch = ordered[index]!;
      try {
        warnings.push(...await writeNoteProperties(
          fs,
          patch.path,
          direction === 'undo' ? patch.before : patch.after,
          {
            expected: direction === 'undo' ? patch.after : patch.before,
            direction,
          },
        ));
        applied.push(patch);
      } catch (error) {
        if (applied.length === 0) throw error;
        const normalize = (patches: PlannedNotePatch[]): PlannedNotePatch[] =>
          direction === 'undo' ? [...patches].reverse() : patches;
        throw new PartialReplayMutationError(
          `${direction} stopped after ${applied.length} of ${ordered.length} file changes: ${messageOf(error)}`,
          { kind: 'table', patches: normalize(applied) },
          { kind: 'table', patches: normalize(ordered.slice(index)) },
          warnings,
          error,
        );
      }
    }
    return { warnings };
  }

  const ordered = direction === 'undo' ? [...receipt.moves].reverse() : receipt.moves;
  for (const move of ordered) {
    const from = direction === 'undo' ? move.to : move.from;
    const to = direction === 'undo' ? move.from : move.to;
    if (!(await exists(fs, from))) {
      throw new Error(`Cannot replay history because "${from}" no longer exists.`);
    }
    if (await exists(fs, to)) {
      throw new Error(`Cannot replay history because "${to}" already exists.`);
    }
  }

  const applied: TrashMutationReceipt['moves'] = [];
  const warnings: MutationWarning[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const move = ordered[index]!;
    try {
      if (direction === 'undo') {
        warnings.push(...await replayMove(fs, move.to, move.from, move.from));
      } else {
        warnings.push(...await replayMove(fs, move.from, move.to, move.from));
      }
      applied.push(move);
    } catch (error) {
      if (applied.length === 0) throw error;
      const normalize = (moves: TrashMutationReceipt['moves']): TrashMutationReceipt['moves'] =>
        direction === 'undo' ? [...moves].reverse() : moves;
      throw new PartialReplayMutationError(
        `${direction} stopped after ${applied.length} of ${ordered.length} file changes: ${messageOf(error)}`,
        { kind: 'trash', moves: normalize(applied) },
        { kind: 'trash', moves: normalize(ordered.slice(index)) },
        warnings,
        error,
      );
    }
  }
  return { warnings };
}
