/**
 * In-memory session history for canonical vault mutations.
 *
 * Invariants:
 * - Only a fully-settled forward command may enter history. React components
 *   never retain file bytes or construct inverse writes.
 * - A replay changes stacks only after its vault command succeeds. Failed
 *   collision-safe restores therefore remain retryable at the stack head.
 * - Any forward command in flight blocks replay. Entries are ordered by the
 *   gesture's start sequence, not I/O completion, so concurrent row writes
 *   cannot reorder the user's history.
 * - Keyboard shortcuts never consume native undo inside text controls or
 *   CodeMirror. Grid-level Cmd/Ctrl+Z is Waffle history; editor-level Cmd/Ctrl+Z
 *   remains the editor's own document history.
 * - State is intentionally volatile: reload and vault replacement clear it.
 *
 * The replayable surface is deliberately narrow for Slice C: table property
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
  replayVaultMutation,
  type ReplayableMutationReceipt,
  type VaultMutationReceipt,
} from './vaultMutations';

interface HistoryEntry {
  sequence: number;
  label: string;
  receipt: ReplayableMutationReceipt;
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
  capture: <T extends VaultMutationReceipt>(label: string, work: () => Promise<T>) => Promise<T>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clear: () => void;
}

const SessionHistoryContext = createContext<SessionHistoryController | null>(null);

function replayablePart(receipt: VaultMutationReceipt): ReplayableMutationReceipt | null {
  if (receipt.kind === 'trash') {
    return receipt.moves.length > 0 ? receipt : null;
  }
  // A spreadsheet paste can both patch existing rows and create overflow
  // notes. Slice C records only its property portion; creation remains outside
  // the advertised inverse surface rather than pretending to be reversible.
  return receipt.patches.length > 0 ? { kind: 'table', patches: receipt.patches } : null;
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
  const vaultGeneration = useRef(0);
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
    // Invalidates commands that began against the previous active vault. Their
    // file handles may still settle, but their receipts must never enter the
    // replacement vault's session history.
    vaultGeneration.current += 1;
    publishStacks({ undo: [], redo: [] });
    setError(null);
  }, [publishStacks]);

  const capture = useCallback(async <T extends VaultMutationReceipt,>(
    label: string,
    work: () => Promise<T>,
  ): Promise<T> => {
    if (replayingRef.current) {
      throw new Error('Wait for undo or redo to finish before changing the vault.');
    }
    const generation = vaultGeneration.current;
    const sequence = ++nextSequence.current;
    forwardPendingRef.current += 1;
    setForwardPending(forwardPendingRef.current);
    setError(null);
    try {
      const receipt = await work();
      if (vaultGeneration.current !== generation) return receipt;
      const replayable = replayablePart(receipt);
      const current = stacksRef.current;
      const undo = replayable
        ? [...current.undo, { sequence, label, receipt: replayable }]
            .sort((a, b) => a.sequence - b.sequence)
        : current.undo;
      // Even a creation-only table gesture is a new history branch. Redo must
      // not survive a successful forward mutation it would leap across.
      publishStacks({ undo, redo: [] });
      return receipt;
    } finally {
      forwardPendingRef.current -= 1;
      setForwardPending(forwardPendingRef.current);
    }
  }, [publishStacks]);

  const replay = useCallback(async (direction: 'undo' | 'redo'): Promise<void> => {
    if (replayingRef.current || forwardPendingRef.current > 0) return;
    const current = stacksRef.current;
    const source = direction === 'undo' ? current.undo : current.redo;
    const entry = source.at(-1);
    if (!entry) return;
    const generation = vaultGeneration.current;

    replayingRef.current = true;
    setReplaying(true);
    setError(null);
    try {
      await replayVaultMutation(await getVaultFs(), entry.receipt, direction);
      if (vaultGeneration.current !== generation) return;

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

      try {
        await onReplayedRef.current();
      } catch (refreshError) {
        setError(`History changed the vault, but refresh failed: ${
          refreshError instanceof Error ? refreshError.message : String(refreshError)
        }`);
      }
    } catch (replayError) {
      setError(replayError instanceof Error ? replayError.message : String(replayError));
    } finally {
      replayingRef.current = false;
      setReplaying(false);
    }
  }, [publishStacks]);

  const undo = useCallback(() => replay('undo'), [replay]);
  const redo = useCallback(() => replay('redo'), [replay]);

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
    capture,
    undo,
    redo,
    clear,
  }), [busy, capture, clear, error, redo, stacks.redo, stacks.undo, undo]);
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
