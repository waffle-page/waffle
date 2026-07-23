/**
 * Obsidian sync report: the sync itself runs automatically at every scan
 * (importer/obsidianImport). Opening this runs one more idempotent pass and
 * shows what happened — created/updated/diverged/removed views, merged types,
 * and every skipped construct with its reason.
 */
import { useEffect, useRef, useState } from 'react';
import { platform, getVaultFs } from '../platform/instance';
import { syncObsidian, type SyncResult } from '../importer/obsidianImport';

const dim: React.CSSProperties = { color: 'var(--text-dim)' };
const chip: React.CSSProperties = { padding: '0.3rem 0.7rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer', fontSize: '0.8rem' };

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ran = useRef(false); // StrictMode double-effect: one sync per open
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      try {
        const r = await syncObsidian(await getVaultFs(), platform.db);
        setResult(r);
        if (r.typesAdded.length || r.viewsCreated.length || r.viewsUpdated.length || r.viewsRemoved.length) onImported();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nothingFound = result && !result.found.typesFile && result.found.baseFiles === 0;
  const quiet = result && !nothingFound && !result.typesAdded.length && !result.viewsCreated.length && !result.viewsUpdated.length && !result.viewsDiverged.length && !result.viewsRemoved.length;

  const list = (label: string, items: Array<{ folder: string; name: string }>) =>
    items.length > 0 && (
      <p style={{ margin: '0.2rem 0' }}>
        {label}: {items.map((v) => `${v.name} (${v.folder})`).join(' · ')}
      </p>
    );

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'color-mix(in srgb, var(--bg) 60%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 560, maxWidth: '92vw', maxHeight: '80vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)', padding: '1rem 1.25rem', fontSize: '0.85rem' }}>
        <h2 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>Obsidian sync</h2>
        <p style={{ ...dim, margin: '0 0 0.75rem', fontSize: '0.78rem' }}>
          Runs automatically at every vault scan: `.obsidian/types.json` merges into property declarations (yours win), `.base` views stay in sync until you edit them in Waffle — then they're yours.
        </p>

        {error && <p style={{ color: 'var(--ink-blush)' }}>{error}</p>}
        {!result && !error && <p style={dim}>syncing…</p>}

        {result && (
          <>
            {nothingFound && <p style={dim}>No `.obsidian/types.json` and no `.base` files in this vault.</p>}
            {quiet && <p style={dim}>Everything already in sync — {result.found.baseFiles} base file{result.found.baseFiles === 1 ? '' : 's'}, nothing to change.</p>}
            {result.typesAdded.length > 0 && <p style={{ margin: '0.2rem 0' }}>Property types added: {result.typesAdded.join(', ')}</p>}
            {result.typesSkipped.map((s) => (
              <p key={s.key} style={{ ...dim, margin: '0.2rem 0' }}>Skipped type {s.key}: {s.reason}</p>
            ))}
            {list('Views created', result.viewsCreated)}
            {list('Views updated', result.viewsUpdated)}
            {list('Edited in Waffle — left alone', result.viewsDiverged)}
            {list('Removed (base view gone)', result.viewsRemoved)}
            {result.notes.length > 0 && (
              <details style={{ marginTop: '0.5rem' }}>
                <summary style={{ ...dim, cursor: 'pointer' }}>{result.notes.length} note{result.notes.length === 1 ? '' : 's'} (skipped constructs)</summary>
                {result.notes.map((n, i) => (
                  <p key={i} style={{ ...dim, margin: '0.2rem 0', fontSize: '0.78rem' }}>— {n}</p>
                ))}
              </details>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
          <button onClick={onClose} style={chip}>Close</button>
        </div>
      </div>
    </div>
  );
}
