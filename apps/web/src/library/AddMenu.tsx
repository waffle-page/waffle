import { useEffect, useRef, useState } from 'react';

export type AddAction = { kind: 'note'; name: string } | { kind: 'link'; url: string } | { kind: 'files'; files: File[] };

/** The + Add popover: new note, add link, add files. Two-rail contextual add
 *  sheet (sources + query chips) replaces this at P2 — this is its skeleton. */
export function AddMenu({ onAdd }: { onAdd: (action: AddAction) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<'note' | 'link' | null>(null);
  const [value, setValue] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setForm(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const submit = (): void => {
    if (!form || !value.trim()) return;
    onAdd(form === 'note' ? { kind: 'note', name: value } : { kind: 'link', url: value });
    setOpen(false);
    setForm(null);
    setValue('');
  };

  const item: React.CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '0.45rem 0.75rem',
    background: 'transparent',
    border: 'none',
    color: 'var(--text)',
    cursor: 'pointer',
    fontSize: '0.85rem',
    borderRadius: 'var(--radius-sm)',
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        onClick={() => {
          setOpen((o) => !o);
          setForm(null);
          setValue('');
        }}
        style={{ padding: '0.35rem 0.8rem', border: 'none', borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: 'var(--accent-ink)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
      >
        + Add
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) {
            onAdd({ kind: 'files', files });
            setOpen(false);
          }
        }}
      />
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 20, width: 240, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.4rem', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
          {form === null ? (
            <>
              <button style={item} onClick={() => setForm('note')}>📝 New note</button>
              <button style={item} onClick={() => setForm('link')}>🔗 Add link</button>
              <button style={item} onClick={() => fileRef.current?.click()}>📄 Add files…</button>
            </>
          ) : (
            <div style={{ padding: '0.3rem' }}>
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                  if (e.key === 'Escape') setForm(null);
                }}
                placeholder={form === 'note' ? 'Note name' : 'Paste a URL'}
                style={{ width: '100%', boxSizing: 'border-box', padding: '0.4rem 0.5rem', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: '0.4rem' }}
              />
              <button onClick={submit} style={{ ...item, background: 'var(--accent)', color: 'var(--accent-ink)', textAlign: 'center', fontWeight: 600 }}>
                {form === 'note' ? 'Create note' : 'Add link'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
