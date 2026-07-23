/**
 * The 'table' layout (docs/12: notes as rows) — registered from the app, not
 * @waffle/ui, because its cells WRITE: an edit patches the note's frontmatter
 * on disk and rescans (propertyWrite.ts). Non-note rows display read-only
 * until link/file properties get their `.waffle/meta.json` mirror (ADR-013).
 * Column kinds resolve declaration-first (.waffle/properties.json), then from
 * the data itself.
 */
import { useEffect, useMemo, useState } from 'react';
import { loadPropertyTypes, rescanFile, savePropertyTypes, type PropertyTypes, type PropertyValue } from '@waffle/core';
import {
  EDITABLE_KINDS, PropertyTable, TableIcon, TITLE_SORT_KEY, parseCellInput, registerLayout,
  type LayoutProps, type TableColumn, type TableRowData,
} from '@waffle/ui';
import { getVaultFs, platform } from '../platform/instance';
import { createNote } from './addFlows';
import { writeNoteProperty } from './propertyWrite';
import { loadPropertyMap, vaultDirFor } from './queries';

type PropMap = Map<string, Record<string, PropertyValue>>;

function sortValue(v: PropertyValue | undefined): number | string | null {
  if (!v) return null;
  switch (v.kind) {
    case 'number': return v.value;
    case 'money': return v.amount;
    case 'duration': return v.seconds;
    case 'checkbox': return v.value ? 1 : 0;
    case 'date': return Date.parse(v.iso) || 0;
    case 'coords': return v.lat;
    case 'text': case 'url': return v.value;
    case 'select': return v.option;
  }
}

function TableLayout({ items, folderId = null, onOpen, onMutated, tableConfig, onTableConfig }: LayoutProps) {
  const [propMap, setPropMap] = useState<PropMap | null>(null);
  const [types, setTypes] = useState<PropertyTypes>({});
  const [dir, setDir] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkKey, setBulkKey] = useState<string | null>(null);
  const [bulkRaw, setBulkRaw] = useState('');

  useEffect(() => {
    let dead = false;
    void (async () => {
      const fs = await getVaultFs();
      const [map, t, d] = await Promise.all([loadPropertyMap(folderId), loadPropertyTypes(fs), vaultDirFor(folderId)]);
      if (dead) return;
      setPropMap(map);
      setTypes(t);
      setDir(d);
    })();
    return () => {
      dead = true;
    };
  }, [folderId, items]);

  const columns = useMemo<TableColumn[]>(() => {
    if (!propMap) return [];
    const present = new Map<string, Map<string, number>>(); // key → kind → count
    const optionSets = new Map<string, Set<string>>();
    const currencies = new Map<string, string>();
    for (const item of items) {
      const props = propMap.get(item.id);
      if (!props) continue;
      for (const [key, value] of Object.entries(props)) {
        const kinds = present.get(key) ?? new Map<string, number>();
        kinds.set(value.kind, (kinds.get(value.kind) ?? 0) + 1);
        present.set(key, kinds);
        if (value.kind === 'select') {
          const set = optionSets.get(key) ?? new Set<string>();
          set.add(value.option);
          optionSets.set(key, set);
        }
        if (value.kind === 'money' && !currencies.has(key)) currencies.set(key, value.currency);
      }
    }
    const dataKeys = [...present.keys()].sort();
    const pinned = tableConfig?.columns ?? [];
    const ordered = [...pinned, ...dataKeys.filter((k) => !pinned.includes(k))];
    return ordered.map((key) => {
      const declared = types[key]?.kind;
      const counted = present.get(key);
      const modal = counted ? [...counted.entries()].sort((a, b) => b[1] - a[1])[0]![0] : undefined;
      const kind = (declared ?? modal ?? 'text') as PropertyValue['kind'];
      const column: TableColumn = { key, kind };
      const currency = types[key]?.currency ?? currencies.get(key);
      if (currency) column.currency = currency;
      const options = optionSets.get(key);
      if (kind === 'select' && options) column.options = [...options].sort();
      return column;
    });
  }, [propMap, types, items, tableConfig?.columns]);

  const rows = useMemo<TableRowData[]>(() => {
    const base: TableRowData[] = items.map((item) => ({
      item,
      props: propMap?.get(item.id) ?? {},
      editable: item.type === 'note' && !!item.contentRef?.endsWith('.md'),
    }));
    const colSort = tableConfig?.colSort;
    if (!colSort) return base;
    const mul = colSort.dir === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      if (colSort.key === TITLE_SORT_KEY) return mul * a.item.title.localeCompare(b.item.title);
      const va = sortValue(a.props[colSort.key]);
      const vb = sortValue(b.props[colSort.key]);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // missing values sink regardless of direction
      if (vb === null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return mul * (va - vb);
      return mul * String(va).localeCompare(String(vb));
    });
  }, [items, propMap, tableConfig?.colSort]);

  const rowById = useMemo(() => new Map(rows.map((r) => [r.item.id, r])), [rows]);

  const onSort = (key: string): void => {
    const current = tableConfig?.colSort;
    const next = current?.key !== key ? { key, dir: 'asc' as const } : current.dir === 'asc' ? { key, dir: 'desc' as const } : null;
    onTableConfig?.({ colSort: next });
  };

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await onMutated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPropMap(await loadPropertyMap(folderId)); // drop optimistic state, back to canon
    } finally {
      setBusy(false);
    }
  };

  const onEditCell = (id: string, key: string, value: PropertyValue | null): void => {
    const row = rowById.get(id);
    if (!row?.editable || !row.item.contentRef) return;
    setPropMap((prev) => {
      // Optimistic: the file write + rescan lag a beat; the cell must not snap back.
      const next = new Map(prev);
      const props = { ...(next.get(id) ?? {}) };
      if (value === null) delete props[key];
      else props[key] = value;
      next.set(id, props);
      return next;
    });
    const path = row.item.contentRef;
    void run(async () => {
      const fs = await getVaultFs();
      await writeNoteProperty(fs, path, key, value);
    });
  };

  const onCreateRow = (title: string): void => {
    if (dir === null) return;
    void run(async () => {
      const fs = await getVaultFs();
      const path = await createNote(fs, dir, title);
      await rescanFile(platform.db, fs, path);
    });
  };

  const applyBulk = (value: PropertyValue | null): void => {
    if (!bulkKey) return;
    const key = bulkKey;
    const targets = rows.filter((r) => selected.has(r.item.id) && r.editable && r.item.contentRef);
    void run(async () => {
      const fs = await getVaultFs();
      for (const t of targets) await writeNoteProperty(fs, t.item.contentRef!, key, value);
    });
  };

  const addColumn = (name: string, kind: PropertyValue['kind'], currency: string): void => {
    const key = name.trim();
    if (!key || key.startsWith('$') || columns.some((c) => c.key === key)) return;
    void run(async () => {
      const decl = kind === 'money' ? { kind, currency: currency.trim().toUpperCase() || 'EUR' } : { kind };
      const fs = await getVaultFs();
      const next = { ...types, [key]: decl };
      await savePropertyTypes(fs, next);
      setTypes(next);
      onTableConfig?.({ columns: [...columns.map((c) => c.key), key] });
      setAddOpen(false);
    });
  };

  const bulkColumn = columns.find((c) => c.key === bulkKey) ?? null;
  const selectedEditable = rows.filter((r) => selected.has(r.item.id) && r.editable).length;

  if (propMap === null) return null; // one query in flight; don't flash placeholder dashes

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {(selected.size > 0 || error) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '0.45rem 0.75rem', borderBottom: '1px solid var(--border)', background: 'var(--surface)', fontSize: '0.8rem' }}>
          {selected.size > 0 && (
            <>
              <strong>{selectedEditable} selected</strong>
              <span style={{ color: 'var(--text-dim)' }}>set</span>
              <select value={bulkKey ?? ''} onChange={(e) => setBulkKey(e.target.value || null)} style={selectStyle}>
                <option value="">property…</option>
                {columns.filter((c) => EDITABLE_KINDS.includes(c.kind)).map((c) => (
                  <option key={c.key} value={c.key}>{c.key}</option>
                ))}
              </select>
              {bulkColumn && bulkColumn.kind === 'checkbox' ? (
                <select value={bulkRaw || 'true'} onChange={(e) => setBulkRaw(e.target.value)} style={selectStyle}>
                  <option value="true">checked</option>
                  <option value="false">unchecked</option>
                </select>
              ) : bulkColumn ? (
                <input
                  value={bulkRaw}
                  onChange={(e) => setBulkRaw(e.target.value)}
                  type={bulkColumn.kind === 'number' || bulkColumn.kind === 'money' ? 'number' : bulkColumn.kind === 'date' ? 'date' : 'text'}
                  list={bulkColumn.kind === 'select' ? 'bulk-options' : undefined}
                  placeholder="value"
                  style={{ ...selectStyle, width: 150 }}
                />
              ) : null}
              {bulkColumn?.kind === 'select' && bulkColumn.options && (
                <datalist id="bulk-options">
                  {bulkColumn.options.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              )}
              <button
                disabled={!bulkColumn || busy || selectedEditable === 0}
                onClick={() => applyBulk(bulkColumn!.kind === 'checkbox' ? { kind: 'checkbox', value: bulkRaw !== 'false' } : parseCellInput(bulkColumn!.kind, bulkRaw, bulkColumn!.currency ?? 'EUR'))}
                style={{ ...chipStyle, background: 'var(--accent)', color: 'var(--accent-ink)', opacity: !bulkColumn || busy ? 0.5 : 1 }}
              >
                {busy ? 'Applying…' : 'Apply'}
              </button>
              <button disabled={!bulkColumn || busy} onClick={() => applyBulk(null)} style={{ ...chipStyle, opacity: !bulkColumn || busy ? 0.5 : 1 }}>
                Clear property
              </button>
              <button onClick={() => setSelected(new Set<string>())} style={chipStyle}>Deselect</button>
            </>
          )}
          {error && <span style={{ color: 'var(--ink-blush)', marginLeft: 'auto' }}>{error}</span>}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <PropertyTable
          rows={rows}
          columns={columns}
          sort={tableConfig?.colSort ?? null}
          onSort={onSort}
          selected={selected}
          onToggleSelect={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onToggleAll={() => {
            const editable = rows.filter((r) => r.editable).map((r) => r.item.id);
            setSelected((prev) => (editable.every((id) => prev.has(id)) && editable.length > 0 ? new Set<string>() : new Set(editable)));
          }}
          onEditCell={onEditCell}
          canCreate={dir !== null}
          onCreateRow={onCreateRow}
          onAddColumn={() => setAddOpen((v) => !v)}
          onOpen={onOpen}
        />
      </div>

      {addOpen && <AddColumnForm existing={columns.map((c) => c.key)} onSubmit={addColumn} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function AddColumnForm({ existing, onSubmit, onClose }: { existing: string[]; onSubmit: (name: string, kind: PropertyValue['kind'], currency: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PropertyValue['kind']>('text');
  const [currency, setCurrency] = useState('EUR');
  const clean = name.trim();
  const taken = existing.includes(clean);
  const invalid = clean === '' || clean.startsWith('$') || taken;
  return (
    <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 5, display: 'flex', flexDirection: 'column', gap: 8, padding: '0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', width: 230 }}>
      <strong style={{ fontSize: '0.82rem' }}>New property column</strong>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="name (frontmatter key)" style={selectStyle} />
      <select value={kind} onChange={(e) => setKind(e.target.value as PropertyValue['kind'])} style={selectStyle}>
        {EDITABLE_KINDS.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      {kind === 'money' && <input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="currency (ISO 4217)" maxLength={3} style={selectStyle} />}
      {taken && <span style={{ color: 'var(--ink-blush)', fontSize: '0.75rem' }}>column already exists</span>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={chipStyle}>Cancel</button>
        <button
          disabled={invalid}
          onClick={() => onSubmit(clean, kind, currency)}
          style={{ ...chipStyle, background: 'var(--accent)', color: 'var(--accent-ink)', opacity: invalid ? 0.5 : 1 }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.25rem 0.45rem', fontSize: '0.8rem' };
const chipStyle: React.CSSProperties = { ...selectStyle, cursor: 'pointer' };

registerLayout({ key: 'table', label: 'Table', icon: TableIcon, component: TableLayout });
