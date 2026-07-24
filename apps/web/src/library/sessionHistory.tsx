/**
 * In-memory session history for canonical vault mutations.
 *
 * Invariants:
 * - Every completed canonical sub-mutation is represented. A fully-settled
 *   command records normally; a later-file failure records its completed
 *   prefix as partial. React never constructs inverse writes.
 * - A replay changes stacks only after canonical files change. Total failures
 *   remain retryable at the stack head; partial failures split the applied
 *   prefix from the retryable suffix so neither half can run twice.
 * - Any forward command in flight blocks replay. Entries are ordered by the
 *   gesture's start sequence, not I/O completion, so concurrent row writes
 *   cannot reorder the user's history.
 * - Keyboard shortcuts never consume native undo inside text controls or
 *   CodeMirror. Grid-level Cmd/Ctrl+Z is Waffle history; editor-level Cmd/Ctrl+Z
 *   remains the editor's own document history.
 * - State is intentionally volatile: reload and vault replacement clear it.
 * - Unrecorded canonical writes invalidate history before they start. Retaining
 *   an inverse across a full-note/editor write would make that inverse unsafe.
 * - History is bounded by entry count and serialized receipt size; the newest
 *   gesture is discarded with a visible warning if it cannot fit by itself.
 *
 * The replayable surface is deliberately narrow: table property
 * patches and soft-delete path pairs. Creation reported by a table command is
 * a forward-history barrier but is not synthesized into a partial inverse.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getVaultFs } from '../platform/instance';
import {
  PartialReplayMutationError,
  PartialVaultMutationError,
  mutationWarningsMessage,
  replayVaultMutation,
  type ReplayableMutationReceipt,
  type VaultMutationReceipt,
} from './vaultMutations';

interface HistoryEntry {
  sequence: number;
  label: string;
  receipt: ReplayableMutationReceipt;
  bytes: number;
}

interface HistoryStacks {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

export interface SessionHistoryController {
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  error: string | null;
  runRecordedMutation: <T extends VaultMutationReceipt>(label: string, work: () => Promise<T>) => Promise<T>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clear: () => void;
  invalidate: () => void;
  /** Clears only the visible warning/error; history receipts remain intact. */
  dismissError: () => void;
}

const SessionHistoryContext = createContext<SessionHistoryController | null>(null);
const MAX_HISTORY_ENTRIES = 100;
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;

function replayablePart(receipt: VaultMutationReceipt): ReplayableMutationReceipt | null {
  if (receipt.kind === 'trash') {
    return receipt.moves.length > 0 ? { kind: 'trash', moves: receipt.moves } : null;
  }
  // A spreadsheet paste can both patch existing rows and create overflow
  // notes. History records only its property portion; creation remains outside
  // the advertised inverse surface rather than pretending to be reversible.
  return receipt.patches.length > 0 ? { kind: 'table', patches: receipt.patches } : null;
}

function receiptBytes(receipt: ReplayableMutationReceipt): number {
  // JSON size is a deterministic, cheap proxy for retained heap. The cap is a
  // guardrail, not accounting: it prevents large bulk edits from accumulating
  // without teaching history about every PropertyValue representation.
  return new TextEncoder().encode(JSON.stringify(receipt)).byteLength;
}

function historyEntry(
  sequence: number,
  label: string,
  receipt: ReplayableMutationReceipt,
): HistoryEntry {
  return { sequence, label, receipt, bytes: receiptBytes(receipt) };
}

function boundUndo(entries: HistoryEntry[]): HistoryEntry[] {
  let bytes = 0;
  const bounded: HistoryEntry[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (bounded.length >= MAX_HISTORY_ENTRIES || bytes + entry.bytes > MAX_HISTORY_BYTES) break;
    bounded.unshift(entry);
    bytes += entry.bytes;
  }
  return bounded;
}

function isNativeUndoSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('input, textarea, select, [contenteditable="true"], .cm-editor') !== null;
}

export function useSessionHistoryController(
  onReplayed: () => Promise<void>,
): SessionHistoryController {
  const [stacks, setStacks] = useState<HistoryStacks>({ undo: [], redo: [] });
  const [forwardPending, setForwardPending] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stacksRef = useRef(stacks);
  const forwardPendingRef = useRef(0);
  const replayingRef = useRef(false);
  const nextSequence = useRef(0);
  const historyGeneration = useRef(0);
  const onReplayedRef = useRef(onReplayed);
  onReplayedRef.current = onReplayed;

  /**
   * The ref is authoritative between React renders. Promise completions from
   * separate row gestures may occur in one event-loop turn; publishing through
   * it prevents one completion from dropping another entry.
   */
  const publishStacks = useCallback((next: HistoryStacks): void => {
    stacksRef.current = next;
    setStacks(next);
  }, []);

  const clear = useCallback((): void => {
    // Invalidates commands that began before a vault replacement or untracked
    // canonical write. Their receipts must not enter the new history epoch.
    historyGeneration.current += 1;
    publishStacks({ undo: [], redo: [] });
    setError(null);
  }, [publishStacks]);

  const recordReceipt = useCallback((
    sequence: number,
    label: string,
    receipt: VaultMutationReceipt,
  ): string | null => {
    const replayable = replayablePart(receipt);
    const current = stacksRef.current;
    if (!replayable) {
      publishStacks({ undo: current.undo, redo: [] });
      return null;
    }

    const entry = historyEntry(sequence, label, replayable);
    if (entry.bytes > MAX_HISTORY_BYTES) {
      // The completed change is valid, but retaining it must not evict every
      // older usable inverse. Only the oversized new entry is omitted.
      publishStacks({ undo: current.undo, redo: [] });
      return 'Change completed, but its undo data exceeded the 8 MB session history limit.';
    }
    const ordered = [...current.undo, entry].sort((a, b) => a.sequence - b.sequence);
    publishStacks({ undo: boundUndo(ordered), redo: [] });
    return null;
  }, [publishStacks]);

  const runRecordedMutation = useCallback(async <T extends VaultMutationReceipt,>(
    label: string,
    work: () => Promise<T>,
  ): Promise<T> => {
    if (replayingRef.current) {
      throw new Error('Wait for undo or redo to finish before changing the vault.');
    }
    const generation = historyGeneration.current;
    const sequence = ++nextSequence.current;
    forwardPendingRef.current += 1;
    setForwardPending(forwardPendingRef.current);
    setError(null);
    try {
      const receipt = await work();
      if (historyGeneration.current !== generation) return receipt;
      const historyWarning = recordReceipt(sequence, label, receipt);
      const warning = mutationWarningsMessage(receipt.warnings);
      if (historyWarning || warning) {
        setError([historyWarning, warning].filter(Boolean).join(' '));
      }
      return receipt;
    } catch (mutationError) {
      if (
        mutationError instanceof PartialVaultMutationError &&
        historyGeneration.current === generation
      ) {
        const historyWarning = recordReceipt(sequence, `${label} (partial)`, mutationError.receipt);
        if (historyWarning) setError(historyWarning);
      }
      throw mutationError;
    } finally {
      forwardPendingRef.current -= 1;
      setForwardPending(forwardPendingRef.current);
    }
  }, [recordReceipt]);

  const invalidate = useCallback((): void => {
    // Clear before an unrecorded write begins. Even a failed full-note write
    // may have changed canonical bytes before reporting its later rescan error.
    if (replayingRef.current || forwardPendingRef.current > 0) {
      throw new Error('Wait for the current vault change before starting this action.');
    }
    clear();
  }, [clear]);

  const replay = useCallback(async (direction: 'undo' | 'redo'): Promise<void> => {
    if (replayingRef.current || forwardPendingRef.current > 0) return;
    const current = stacksRef.current;
    const source = direction === 'undo' ? current.undo : current.redo;
    const entry = source.at(-1);
    if (!entry) return;
    const generation = historyGeneration.current;

    replayingRef.current = true;
    setReplaying(true);
    setError(null);
    try {
      const result = await replayVaultMutation(await getVaultFs(), entry.receipt, direction);
      if (historyGeneration.current !== generation) return;

      // Move the entry before refreshing the projection. The file mutation has
      // already succeeded; a query failure must not make a second shortcut
      // apply the same inverse twice.
      const latest = stacksRef.current;
      if (direction === 'undo') {
        publishStacks({
          undo: latest.undo.slice(0, -1),
          redo: [...latest.redo, entry],
        });
      } else {
        publishStacks({
          undo: [...latest.undo, entry],
          redo: latest.redo.slice(0, -1),
        });
      }

      let refreshMessage: string | null = null;
      try {
        await onReplayedRef.current();
      } catch (refreshError) {
        refreshMessage = `History changed the vault, but refresh failed: ${
          refreshError instanceof Error ? refreshError.message : String(refreshError)
        }`;
      }
      const warning = mutationWarningsMessage(result.warnings);
      if (refreshMessage || warning) {
        setError([refreshMessage, warning].filter(Boolean).join(' '));
      }
    } catch (replayError) {
      if (
        replayError instanceof PartialReplayMutationError &&
        historyGeneration.current === generation
      ) {
        // Preserve both truthful halves: the unapplied suffix remains at the
        // source stack head, while the completed prefix becomes reversible in
        // the opposite stack. A retry never reapplies an already-changed file.
        const latest = stacksRef.current;
        const remaining = historyEntry(
          entry.sequence,
          `${entry.label} (remaining)`,
          replayError.remaining,
        );
        const applied = historyEntry(
          entry.sequence,
          `${entry.label} (partial)`,
          replayError.applied,
        );
        if (direction === 'undo') {
          publishStacks({
            undo: [...latest.undo.slice(0, -1), remaining],
            redo: [...latest.redo, applied],
          });
        } else {
          publishStacks({
            undo: [...latest.undo, applied],
            redo: [...latest.redo.slice(0, -1), remaining],
          });
        }
        let refreshMessage: string | null = null;
        try {
          await onReplayedRef.current();
        } catch (refreshError) {
          refreshMessage = `History partially changed the vault, and refresh failed: ${
            refreshError instanceof Error ? refreshError.message : String(refreshError)
          }`;
        }
        const warning = mutationWarningsMessage(replayError.warnings);
        setError([replayError.message, refreshMessage, warning].filter(Boolean).join(' '));
      } else {
        setError(replayError instanceof Error ? replayError.message : String(replayError));
      }
    } finally {
      replayingRef.current = false;
      setReplaying(false);
    }
  }, [publishStacks]);

  const undo = useCallback(() => replay('undo'), [replay]);
  const redo = useCallback(() => replay('redo'), [replay]);
  const dismissError = useCallback((): void => setError(null), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'z' ||
        isNativeUndoSurface(event.target)
      ) {
        return;
      }
      event.preventDefault();
      void (event.shiftKey ? redo() : undo());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  const busy = forwardPending > 0 || replaying;
  return useMemo(() => ({
    canUndo: stacks.undo.length > 0 && !busy,
    canRedo: stacks.redo.length > 0 && !busy,
    busy,
    undoLabel: stacks.undo.at(-1)?.label ?? null,
    redoLabel: stacks.redo.at(-1)?.label ?? null,
    error,
    runRecordedMutation,
    undo,
    redo,
    clear,
    invalidate,
    dismissError,
  }), [busy, clear, dismissError, error, invalidate, redo, runRecordedMutation, stacks.redo, stacks.undo, undo]);
}

export function SessionHistoryProvider({
  controller,
  children,
}: {
  controller: SessionHistoryController;
  children: ReactNode;
}) {
  return (
    <SessionHistoryContext.Provider value={controller}>
      {children}
    </SessionHistoryContext.Provider>
  );
}

export function useSessionHistory(): SessionHistoryController {
  const history = useContext(SessionHistoryContext);
  if (!history) throw new Error('Session history must be used inside SessionHistoryProvider.');
  return history;
}
