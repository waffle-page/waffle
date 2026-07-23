/**
 * Note editor, step-6: CodeMirror 6 source mode + reading view (Preview), with
 * debounced save straight to the vault file — the file stays canonical
 * (ADR-004) and every save runs a targeted rescan so the index (properties,
 * FTS) never trails what's on disk. Voice memos record via MediaRecorder into
 * the note's folder and embed as ![[file.webm]].
 *
 * The Back button AWAITS the pending save + rescan before onClose — the host
 * requeries its rows on close, and that read must see this editor's writes.
 * No self-write suppression yet: the library screen doesn't run a watcher —
 * when it does, saves from here must mark their paths so the watcher's rescan
 * doesn't fight the open editor.
 */
import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { rescanFile } from '@waffle/core';
import { getVaultFs, platform } from '../platform/instance';
import { vaultUrl, mimeFor } from './assetUrl';
import { livePreview } from './livePreview';
import { liveStyle } from './liveStyle';
import { resolveEmbed } from './resolve';
import { Preview } from './Preview';

const SAVE_DEBOUNCE_MS = 800;

/** Clipboard images arrive named `image.png` or extensionless — mime decides. */
const EXT_FROM_MIME: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif',
  'audio/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav',
};

type Mode = 'edit' | 'preview';

export function NoteEditor({
  path,
  title,
  onClose,
  onNavigate,
}: {
  path: string;
  title: string;
  onClose: () => void;
  onNavigate: (wikilinkName: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const textRef = useRef('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<Mode>('edit');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async (content: string): Promise<void> => {
    const fs = await getVaultFs();
    await fs.write(path, new TextEncoder().encode(content));
    await rescanFile(platform.db, fs, path); // index mirrors the file NOW, not at the next full scan
    setDirty(false);
    setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  };

  /** Pasted/dropped files → vault files beside the note + `![[…]]` embeds at `at`. */
  const embedFiles = async (files: File[], view: EditorView, at: number): Promise<void> => {
    // Never insert above the frontmatter block: `---` must stay line 1 or the
    // properties stop parsing (for Obsidian too, not just our scanner).
    const fmEnd = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(view.state.doc.toString())?.[0].length ?? 0;
    at = Math.max(at, fmEnd);
    const fs = await getVaultFs();
    const noteDir = path.split('/').slice(0, -1).join('/');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    let insert = '';
    for (const [i, file] of files.entries()) {
      const dot = file.name.lastIndexOf('.');
      const ext = dot > 0 ? file.name.slice(dot) : EXT_FROM_MIME[file.type] ?? '';
      const name = `${title}-paste-${stamp}${files.length > 1 ? `-${i + 1}` : ''}${ext}`;
      await fs.write(noteDir ? `${noteDir}/${name}` : name, new Uint8Array(await file.arrayBuffer()));
      await rescanFile(platform.db, fs, noteDir ? `${noteDir}/${name}` : name);
      insert += `![[${name}]]\n`;
    }
    view.dispatch({ changes: { from: at, insert } });
    setNotice(`embedded ${files.length} file${files.length > 1 ? 's' : ''}`);
  };

  /** Flush any pending debounced save, then leave — the host refreshes on close. */
  const onBack = async (): Promise<void> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const view = viewRef.current;
    const text = view ? view.state.doc.toString() : textRef.current;
    if (dirty) await save(text);
    onClose();
  };

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const fs = await getVaultFs();
      try {
        textRef.current = new TextDecoder().decode(await fs.read(path));
        if (!disposed) setLoaded(true);
      } catch {
        if (!disposed) setNotice(`Couldn't open ${path}`);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [path]);

  useEffect(() => {
    if (!loaded || mode !== 'edit' || !hostRef.current) return;
    const view = new EditorView({
      doc: textRef.current,
      parent: hostRef.current,
      extensions: [
        basicSetup,
        markdown(),
        liveStyle,
        livePreview({
          onNavigate,
          resolveAsset: async (target) => {
            const assetPath = await resolveEmbed(path, target);
            return assetPath ? vaultUrl(assetPath, mimeFor(target)) : null;
          },
        }),
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          // Files on the clipboard (screenshots) embed; anything carrying text
          // (Excel cells put BOTH a text and an image flavor on the pasteboard)
          // stays a text paste — the snapshot image would be the wrong half.
          paste: (event, v) => {
            const files = [...(event.clipboardData?.files ?? [])];
            if (files.length === 0 || event.clipboardData?.getData('text/plain')) return false;
            event.preventDefault();
            void embedFiles(files, v, v.state.selection.main.head);
            return true;
          },
          // Dropping onto the open note EMBEDS — without stopPropagation the
          // library surface underneath would file it into the folder instead.
          drop: (event, v) => {
            const files = [...(event.dataTransfer?.files ?? [])];
            if (files.length === 0) return false;
            event.preventDefault();
            event.stopPropagation();
            const at = v.posAtCoords({ x: event.clientX, y: event.clientY }) ?? v.state.selection.main.head;
            void embedFiles(files, v, at);
            return true;
          },
          dragover: (event) => {
            if (!event.dataTransfer?.types.includes('Files')) return false;
            event.preventDefault();
            event.stopPropagation();
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          textRef.current = update.state.doc.toString();
          setDirty(true);
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => void save(textRef.current), SAVE_DEBOUNCE_MS);
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '0.9rem' },
          '.cm-content': { fontFamily: 'var(--font-body)', caretColor: 'var(--text)' },
          '.cm-gutters': { display: 'none' },
        }),
      ],
    });
    viewRef.current = view;
    return () => {
      // Non-Back unmounts (wikilink navigation, mode switch): flush fire-and-forget.
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void save(view.state.doc.toString());
      }
      viewRef.current = null;
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, mode, path]);

  const insertAtCursor = (snippet: string): void => {
    const view = viewRef.current;
    if (view) {
      const at = view.state.selection.main.head;
      view.dispatch({ changes: { from: at, insert: snippet } });
    } else {
      textRef.current += snippet;
      void save(textRef.current);
    }
  };

  const onRecordToggle = async (): Promise<void> => {
    if (recorder) {
      recorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        void (async () => {
          stream.getTracks().forEach((t) => t.stop());
          setRecorder(null);
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
          const noteDir = path.split('/').slice(0, -1).join('/');
          const name = `${title}-rec-${stamp}.webm`;
          const fs = await getVaultFs();
          await fs.write(noteDir ? `${noteDir}/${name}` : name, new Uint8Array(await new Blob(chunks).arrayBuffer()));
          insertAtCursor(`\n![[${name}]]\n`);
          setNotice(`recorded ${name}`);
        })();
      };
      rec.start();
      setRecorder(rec);
      setNotice('recording… click ⏹ to stop');
    } catch {
      setNotice('microphone unavailable');
    }
  };

  const headerBtn: React.CSSProperties = {
    padding: '0.3rem 0.7rem',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-2)',
    color: 'var(--text)',
    cursor: 'pointer',
    fontSize: '0.8rem',
  };

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.6rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <button onClick={() => void onBack()} style={headerBtn}>← Back</button>
        <h2 style={{ margin: 0, fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h2>
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
          {notice ?? (dirty ? 'editing…' : savedAt ? `saved ${savedAt}` : path)}
        </span>
        <button onClick={() => void onRecordToggle()} title={recorder ? 'Stop recording' : 'Record voice memo'} style={{ ...headerBtn, background: recorder ? 'var(--ramp-blush)' : 'var(--surface-2)', color: recorder ? 'var(--ink-blush)' : 'var(--text)' }}>
          {recorder ? '⏹' : '🎙'}
        </button>
        <button
          onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}
          style={{ ...headerBtn, background: mode === 'preview' ? 'var(--accent)' : 'var(--surface-2)', color: mode === 'preview' ? 'var(--accent-ink)' : 'var(--text)' }}
        >
          {mode === 'edit' ? 'Preview' : 'Edit'}
        </button>
      </header>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {!loaded && !notice && <p style={{ color: 'var(--text-dim)', padding: '1rem' }}>opening…</p>}
        {mode === 'edit' ? (
          <div ref={hostRef} style={{ height: '100%', maxWidth: 760, margin: '0 auto', padding: '0.5rem 1rem' }} />
        ) : (
          <Preview notePath={path} text={textRef.current} onNavigate={onNavigate} />
        )}
      </div>
    </div>
  );
}
