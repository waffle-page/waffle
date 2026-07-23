/**
 * View tabs strip (ADR-006/-014): a folder's named views, Airtable-style.
 * Presentation only — CRUD happens in the host's callbacks. One inline input
 * serves both create and rename; the ⋯ menu exists only on the active tab.
 */
import { useRef, useState, type CSSProperties } from 'react';
import { PlusIcon } from './icons';

export interface ViewTabInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface ViewTabsProps {
  views: ViewTabInfo[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
}

const tabStyle = (active: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '0.3rem 0.7rem',
  fontSize: '0.8rem',
  fontWeight: active ? 600 : 400,
  border: 'none',
  borderBottom: active ? '2px solid var(--accent-ink)' : '2px solid transparent',
  background: 'none',
  color: active ? 'var(--text)' : 'var(--text-dim)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

export function ViewTabs({ views, activeId, onSelect, onCreate, onRename, onDelete, onSetDefault }: ViewTabsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Menu x-anchor under the active tab, in wrapper coordinates (scroll-corrected).
  const [menuLeft, setMenuLeft] = useState(8);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [naming, setNaming] = useState<'create' | 'rename' | null>(null);
  const [draft, setDraft] = useState('');
  const active = views.find((v) => v.id === activeId);

  const commitName = (): void => {
    const name = draft.trim();
    setNaming(null);
    setDraft('');
    if (!name) return;
    if (naming === 'create') onCreate(name);
    else if (active) onRename(active.id, name);
  };

  return (
    // The menu must be a SIBLING of the scroller, not a child: overflow-x:auto
    // forces overflow-y to clip too, which would swallow the dropdown.
    <div style={{ position: 'relative', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div ref={scrollerRef} style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 0.6rem', overflowX: 'auto' }}>
      {views.map((v) => (
        <button
          key={v.id}
          onClick={(e) => {
            if (v.id !== activeId) {
              onSelect(v.id);
              return;
            }
            setMenuLeft(Math.max(8, e.currentTarget.offsetLeft - (scrollerRef.current?.scrollLeft ?? 0)));
            setMenuOpen((o) => !o);
          }}
          style={tabStyle(v.id === activeId)}
          title={v.isDefault ? `${v.name} (default)` : v.name}
        >
          {v.name}
          {v.isDefault && <span aria-label="default view" style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>●</span>}
          {v.id === activeId && <span style={{ color: 'var(--text-dim)' }}>⋯</span>}
        </button>
      ))}
      {naming ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName();
            if (e.key === 'Escape') {
              setNaming(null);
              setDraft('');
            }
          }}
          placeholder={naming === 'create' ? 'view name' : 'rename view'}
          style={{ font: 'inherit', fontSize: '0.8rem', width: 130, margin: '0.2rem 0.3rem', padding: '0.15rem 0.4rem', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', outline: 'none' }}
        />
      ) : (
        <button onClick={() => setNaming('create')} title="New view" style={{ ...tabStyle(false), padding: '0.3rem 0.4rem' }}>
          <PlusIcon />
        </button>
      )}
      </div>
      {menuOpen && active && (
        <div style={{ position: 'absolute', top: '100%', left: menuLeft, zIndex: 6, display: 'flex', flexDirection: 'column', minWidth: 150, padding: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-menu)' }}>
          {[
            { label: 'Rename', run: () => { setNaming('rename'); setDraft(active.name); } },
            { label: active.isDefault ? 'Default view ✓' : 'Set as default', run: () => onSetDefault(active.id), disabled: active.isDefault },
            { label: 'Delete view', run: () => onDelete(active.id), disabled: views.length === 1 },
          ].map((item) => (
            <button
              key={item.label}
              disabled={item.disabled}
              onClick={() => {
                setMenuOpen(false);
                item.run();
              }}
              style={{ textAlign: 'left', padding: '0.35rem 0.6rem', fontSize: '0.8rem', border: 'none', background: 'none', color: item.disabled ? 'var(--text-dim)' : 'var(--text)', cursor: item.disabled ? 'default' : 'pointer', borderRadius: 'var(--radius-sm)' }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
