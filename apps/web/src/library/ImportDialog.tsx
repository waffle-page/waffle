/**
 * Obsidian import dialog: shows the DRY-RUN plan (what will import, what's
 * skipped and why) and only writes on explicit Apply (importer/obsidianImport).
 */
import { useEffect, useState } from 'react';
import { platform, getVaultFs } from '../platform/instance';
import { applyImport, scanImport, type ImportPlan } from '../importer/obsidianImport';

const dim: React.CSSProperties = { color: 'var(--text-dim)' };
const chip: React.CSSProperties = { padding: '0.3rem 0.7rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer', fontSize: '0.8rem' };

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ types: number; views: number } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setPlan(await scanImport(await getVaultFs(), platform.db));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const newTypeKeys = plan ? Object.keys(plan.typesNew) : [];
  const importableViews = plan ? plan.bases.flatMap((b) => b.views.filter((v) => !v.exists)) : [];
  const nothingFound = plan && !plan.typesFileFound && plan.bases.length === 0;

  const onApply = async (): Promise<void> => {
    if (!plan) return;
    setBusy(true);
    try {
      setDone(await applyImport(await getVaultFs(), plan));
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'color-mix(in srgb, var(--bg) 60%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 560, maxWidth: '92vw', maxHeight: '80vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)', padding: '1rem 1.25rem', fontSize: '0.85rem' }}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Import from Obsidian</h2>

        {error && <p style={{ color: 'var(--ink-blush)' }}>{error}</p>}
        {!plan && !error && <p style={dim}>scanning vault…</p>}

        {done ? (
          <p>Imported <strong>{done.types}</strong> property type{done.types === 1 ? '' : 's'} and <strong>{done.views}</strong> view{done.views === 1 ? '' : 's'}.</p>
        ) : plan && (
          <>
            {nothingFound && <p style={dim}>No `.obsidian/types.json` and no `.base` files in this vault — nothing to import.</p>}

            {plan.typesFileFound && (
              <section style={{ marginBottom: '0.9rem' }}>
                <h3 style={{ fontSize: '0.85rem', margin: '0 0 0.3rem' }}>Property types (.obsidian/types.json)</h3>
                {newTypeKeys.length > 0 && (
                  <p style={{ margin: '0.2rem 0' }}>
                    New: {newTypeKeys.map((k) => `${k} → ${plan.typesNew[k]!.kind}`).join(' · ')}
                  </p>
                )}
                {plan.typesKept.length > 0 && <p style={{ ...dim, margin: '0.2rem 0' }}>Already declared in Waffle (kept as-is): {plan.typesKept.join(', ')}</p>}
                {plan.typesSkipped.map((s) => (
                  <p key={s.key} style={{ ...dim, margin: '0.2rem 0' }}>Skipped {s.key}: {s.reason}</p>
                ))}
                {newTypeKeys.length === 0 && plan.typesSkipped.length === 0 && plan.typesKept.length === 0 && <p style={dim}>nothing new</p>}
              </section>
            )}

            {plan.bases.map((base) => (
              <section key={base.path} style={{ marginBottom: '0.9rem' }}>
                <h3 style={{ fontSize: '0.85rem', margin: '0 0 0.3rem' }}>{base.path} → folder “{base.folderName}”</h3>
                {base.views.map((v, i) => (
                  <div key={i} style={{ margin: '0.25rem 0 0.5rem' }}>
                    <strong>{v.name}</strong> · {v.layout} view{v.exists && <span style={dim}> — already exists, skipped</span>}
                    {!v.exists && (
                      <span style={dim}>
                        {' '}· {v.cfg.filters ? `${countCmps(v.cfg.filters)} filter${countCmps(v.cfg.filters) === 1 ? '' : 's'}` : 'no filters'} · sort {v.cfg.sort.key} {v.cfg.sort.dir}
                        {v.cfg.columns?.length ? ` · columns ${v.cfg.columns.join(', ')}` : ''}
                      </span>
                    )}
                    {v.notes.map((n, j) => (
                      <div key={j} style={{ ...dim, fontSize: '0.78rem' }}>— {n}</div>
                    ))}
                  </div>
                ))}
                {base.skipped.map((s, i) => (
                  <div key={i} style={{ ...dim, fontSize: '0.78rem' }}>— {s}</div>
                ))}
              </section>
            ))}
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <button onClick={onClose} style={chip}>{done ? 'Close' : 'Cancel'}</button>
          {!done && plan && !nothingFound && (
            <button
              disabled={busy || (newTypeKeys.length === 0 && importableViews.length === 0)}
              onClick={() => void onApply()}
              style={{ ...chip, background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600, opacity: busy || (newTypeKeys.length === 0 && importableViews.length === 0) ? 0.5 : 1 }}
            >
              {busy ? 'Importing…' : `Import ${newTypeKeys.length} types + ${importableViews.length} views`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function countCmps(node: import('@waffle/core').FilterNode): number {
  return node.op === 'cmp' ? 1 : node.children.reduce((n, c) => n + countCmps(c), 0);
}
