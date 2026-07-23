/**
 * Link detail view v1 (docs/10): the Pinterest model — detail first, the site
 * exactly one tap further. Shared chrome: title/domain, key properties, YOUR
 * status + rating (docs/09, per resolved status set), Open ↗. Typed templates
 * (Product gallery, VideoObject player) layer on at P2 when extraction fills
 * media; this v1 is the `Thing` fallback everything degrades to.
 */
import { useEffect, useState } from 'react';
import type { LibraryItem } from '@waffle/ui';
import { loadMarks, loadToppingProps, saveMarks, type EntityMarks } from '../library/interactions';

const SLOTS = ['queued', 'active', 'done', 'dropped'] as const;

export function LinkDetail({ item, url, onClose }: { item: LibraryItem; url: string; onClose: () => void }) {
  const [marks, setMarks] = useState<EntityMarks | null>(null);
  const [props, setProps] = useState<Array<{ key: string; value: string }>>([]);

  useEffect(() => {
    void (async () => {
      setMarks(await loadMarks(url, null)); // schema_type joins at P2 extraction
      setProps(await loadToppingProps(item.id));
    })();
  }, [item.id, url]);

  const update = async (patch: Partial<Pick<EntityMarks, 'slot' | 'rating'>>): Promise<void> => {
    if (!marks) return;
    const next = { ...marks, ...patch };
    setMarks(next);
    await saveMarks(next.entityKey, next.set.id, next.slot, next.rating);
  };

  const domain = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  })();

  const chip: React.CSSProperties = {
    padding: '0.3rem 0.7rem',
    border: '1px solid var(--border)',
    borderRadius: 999,
    background: 'var(--surface)',
    color: 'var(--text)',
    cursor: 'pointer',
    fontSize: '0.8rem',
  };

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.6rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <button onClick={onClose} style={{ ...chip, borderRadius: 'var(--radius-sm)' }}>← Back</button>
        <h2 style={{ margin: 0, fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</h2>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: 'auto', padding: '0.35rem 0.9rem', borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: 'var(--accent-ink)', textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600 }}
        >
          Open ↗
        </a>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '1.25rem 1rem' }}>
          <div
            style={{
              aspectRatio: '2 / 1',
              borderRadius: 'var(--radius)',
              background: item.thumbColor ?? 'var(--ramp-aqua)',
              color: 'var(--ink-aqua)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-head)',
              fontWeight: 700,
              fontSize: '1.4rem',
              marginBottom: '0.75rem',
            }}
          >
            {domain}
          </div>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', wordBreak: 'break-all', margin: '0 0 1.25rem' }}>{url}</p>

          {marks && (
            <section style={{ marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>{marks.set.name}</h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                {SLOTS.filter((s) => marks.set.labels[s]).map((s) => (
                  <button
                    key={s}
                    onClick={() => void update({ slot: marks.slot === s ? null : s })}
                    style={{ ...chip, background: marks.slot === s ? 'var(--accent)' : 'var(--surface)', color: marks.slot === s ? 'var(--accent-ink)' : 'var(--text)' }}
                  >
                    {marks.set.labels[s]}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => void update({ rating: marks.rating === n ? null : n })}
                    title={`${n}/10`}
                    style={{ ...chip, padding: '0.25rem 0.45rem', background: (marks.rating ?? 0) >= n ? 'var(--ramp-peach)' : 'var(--surface)', color: (marks.rating ?? 0) >= n ? 'var(--ink-peach)' : 'var(--text-dim)' }}
                  >
                    ★
                  </button>
                ))}
                <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginLeft: 6 }}>{marks.rating ? `${marks.rating}/10` : 'unrated'}</span>
              </div>
            </section>
          )}

          {props.length > 0 && (
            <section>
              <h3 style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>Properties</h3>
              <table style={{ borderSpacing: '0 4px', fontSize: '0.85rem' }}>
                <tbody>
                  {props.map((p) => (
                    <tr key={p.key}>
                      <td style={{ color: 'var(--text-dim)', paddingRight: 16 }}>{p.key}</td>
                      <td style={{ wordBreak: 'break-all' }}>{p.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
