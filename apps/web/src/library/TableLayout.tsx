/**
 * The 'table' layout (docs/12: notes as rows) — registered from the app, not
 * @waffle/ui, because its cells WRITE. tableOperations.ts plans each gesture;
 * vaultMutations.ts executes file → rescan; this component owns optimistic
 * projection, pending accounting, canonical requery, and controls. Non-note
 * rows display read-only until link/file properties get their
 * `.waffle/meta.json` mirror (ADR-013). Column kinds resolve declaration-first
 * (.waffle/properties.json), then from the data itself.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadPropertyTypes, savePropertyTypes, type PropertyTypes, type PropertyValue } from '@waffle/core';
import {
  EDITABLE_KINDS, PropertyTable, TABLE_COLUMN_DEFAULT_WIDTH, TableIcon, parseCellInput, registerLayout,
  type EditablePropertyKind, type LayoutProps, type TableColumn, type TableColumnConfig, type TableGridCell, type TableRowData,
} from '@waffle/ui';
import { getVaultFs } from '../platform/instance';
import { loadPropertyMap, vaultDirFor } from './queries';
import {
  canAuthorProperty,
  optimisticPatchMap,
  pasteNotice,
  planBulkEdit,
  planCellEdit,
  planClearCells,
  planFillDown,
  planPasteAppend,
  planPasteAtAnchor,
  type PropertyPatch,
  type TableOperationPlan,
} from './tableOperations';
import { useSessionHistory } from './sessionHistory';
import {
  commitTableOperation,
  createEmptyNote,
  mutationWarningsMessage,
  trashVaultFiles,
  type MutationWarning,
} from './vaultMutations';

type PropMap = Map<string, Record<string, PropertyValue>>;

function TableLayout({ items, groups, folderId = null, crossFolder = false, onOpen, onMutated, tableConfig, onTableConfig }: LayoutProps) {
  const history = useSessionHistory();
  const [propMap, setPropMap] = useState<PropMap | null>(null);
  const [types, setTypes] = useState<PropertyTypes>({});
  const [dir, setDir] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkKey, setBulkKey] = useState<string | null>(null);
  const [bulkRaw, setBulkRaw] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pendingMutations = useRef(0);
  const propertyScopeRef = useRef<string | null>(crossFolder ? null : folderId);
  propertyScopeRef.current = crossFolder ? null : folderId;

  useEffect(() => {
    let dead = false;
    void (async () => {
      const fs = await getVaultFs();
      const [map, t, d] = await Promise.all([loadPropertyMap(crossFolder ? null : folderId), loadPropertyTypes(fs), vaultDirFor(folderId)]);
      if (dead) return;
      // A refresh caused by an earlier write must not replace newer optimistic
      // patches. The last outstanding mutation performs the canonical reload.
      if (pendingMutations.current === 0) setPropMap(map);
      setTypes(t);
      setDir(d);
    })();
    return () => {
      dead = true;
    };
  }, [folderId, crossFolder, items]);

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
    const configured = tableConfig?.columns ?? [];
    const configuredByKey = new Map(configured.map((column) => [column.key, column]));
    const ordered = [...configured.map((column) => column.key), ...dataKeys.filter((key) => !configuredByKey.has(key))];
    return ordered.map((key) => {
      const declared = types[key]?.kind;
      const counted = present.get(key);
      const modal = counted ? [...counted.entries()].sort((a, b) => b[1] - a[1])[0]![0] : undefined;
      const kind = (declared ?? modal ?? 'text') as PropertyValue['kind'];
      const column: TableColumn = { key, kind, width: configuredByKey.get(key)?.width ?? TABLE_COLUMN_DEFAULT_WIDTH };
      const currency = types[key]?.currency ?? currencies.get(key);
      if (currency) column.currency = currency;
      const options = optionSets.get(key);
      if (kind === 'select' && options) column.options = [...options].sort();
      return column;
    });
  }, [propMap, types, items, tableConfig?.columns]);

  // The view's SQL query already ordered items (queries.ts) — no client sort.
  const rows = useMemo<TableRowData[]>(
    () =>
      items.map((item) => ({
        item,
        props: propMap?.get(item.id) ?? {},
        editable: item.type === 'note' && !!item.contentRef?.endsWith('.md'),
        deletable: !!item.contentRef,
      })),
    [items, propMap],
  );

  const rowById = useMemo(() => new Map(rows.map((r) => [r.item.id, r])), [rows]);

  const patchOptimistically = (patches: ReadonlyMap<string, Readonly<PropertyPatch>>): void => {
    setPropMap((prev) => {
      const next = new Map(prev);
      for (const [id, patch] of patches) {
        const props = { ...(next.get(id) ?? {}) };
        for (const [key, value] of Object.entries(patch)) {
          if (value === null) delete props[key];
          else props[key] = value;
        }
        next.set(id, props);
      }
      return next;
    });
  };

  /** Header click cycles: asc → desc → back to the recency default. */
  const onSort = (key: string): void => {
    const current = tableConfig?.sort;
    const next =
      current?.key !== key ? { key, dir: 'asc' as const }
      : current.dir === 'asc' ? { key, dir: 'desc' as const }
      : { key: '$updated', dir: 'desc' as const };
    onTableConfig?.({ sort: next });
  };


  const run = async (work: () => Promise<void>, notice: string | null = null): Promise<void> => {
    pendingMutations.current += 1;
    setBusy(true);
    setError(notice);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      try {
        await onMutated?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      pendingMutations.current -= 1;
      if (pendingMutations.current === 0) {
        try {
          const refreshScope = propertyScopeRef.current;
          const canonical = await loadPropertyMap(refreshScope);
          if (pendingMutations.current === 0 && propertyScopeRef.current === refreshScope) {
            setPropMap(canonical);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          if (pendingMutations.current === 0) setBusy(false);
        }
      }
    }
  };

  const surfaceMutationWarnings = (warnings: MutationWarning[]): void => {
    const warning = mutationWarningsMessage(warnings);
    if (warning) setError(warning);
  };

  const perform = (
    plan: TableOperationPlan,
    historyLabel: string,
    notice: string | null = null,
  ): void => {
    if (plan.patches.length > 0) patchOptimistically(optimisticPatchMap(plan.patches));
    if (plan.patches.length === 0 && plan.creates.length === 0) {
      setError(notice);
      return;
    }
    void run(async () => {
      // Creation has no inverse yet. It starts a new history epoch before a
      // mixed paste records the independently reversible property patches.
      if (plan.creates.length > 0) history.invalidate();
      const receipt = await history.runRecordedMutation(
        historyLabel,
        async () => commitTableOperation(await getVaultFs(), dir, plan),
      );
      surfaceMutationWarnings(receipt.warnings);
    }, notice);
  };

  const onEditCell = (id: string, key: string, value: PropertyValue | null): void => {
    perform(planCellEdit(rowById.get(id), key, value), 'Edit cell');
  };

  const onCreateRow = (title: string): void => {
    if (dir === null) return;
    void run(async () => {
      history.invalidate();
      const receipt = await createEmptyNote(await getVaultFs(), dir, title);
      surfaceMutationWarnings(receipt.warnings);
    });
  };

  const applyBulk = (value: PropertyValue | null): void => {
    if (!bulkKey) return;
    const key = bulkKey;
    const plan = planBulkEdit(rows, selected, key, value);
    perform(
      plan,
      'Edit selected cells',
      plan.skipped > 0 ? `${key}: skipped ${plan.skipped} read-only structured value${plan.skipped === 1 ? '' : 's'}.` : null,
    );
  };

  const applyBulkRaw = (): void => {
    if (!bulkColumn) return;
    if (bulkColumn.kind === 'checkbox') {
      applyBulk({ kind: 'checkbox', value: bulkRaw !== 'false' });
      return;
    }
    if (bulkRaw.trim() === '') {
      setError(`${bulkColumn.key}: enter a value or use Clear property.`);
      return;
    }
    const parsed = parseCellInput(bulkColumn.kind, bulkRaw, bulkColumn.currency ?? 'EUR');
    if (!parsed.ok) {
      setError(`${bulkColumn.key}: ${parsed.message}`);
      return;
    }
    applyBulk(parsed.value);
  };

  const onClearCells = (cells: TableGridCell[]): void => {
    perform(planClearCells(rowById, cells), 'Clear cells');
  };

  const onFillDown = (cellRows: TableGridCell[][]): void => {
    perform(planFillDown(rowById, columns, cellRows), 'Fill down');
  };

  const onColumnsChange = (next: TableColumnConfig[]): void => {
    onTableConfig?.({ columns: next });
  };

  /** Selected-cell paste overwrites existing note rows, then creates overflow notes. */
  const onPasteCells = (anchor: TableGridCell, grid: string[][]): void => {
    const plan = planPasteAtAnchor({ anchor, grid, rows, columns, allowOverflow: dir !== null });
    perform(plan, 'Paste cells', pasteNotice(plan.invalid));
  };

  /** Spreadsheet paste → notes-as-rows (docs/12 applied to ingestion). */
  const onPasteRows = (grid: string[][]): void => {
    if (dir === null || grid.length === 0) return;
    const plan = planPasteAppend(grid, columns, types);
    void run(async () => {
      // Spreadsheet append creates notes and may change property declarations;
      // neither mutation class has an inverse in the current session history.
      history.invalidate();
      const fs = await getVaultFs();
      if (Object.keys(plan.addedTypes).length > 0) {
        const nextTypes = { ...types, ...plan.addedTypes };
        await savePropertyTypes(fs, nextTypes);
        setTypes(nextTypes);
        if (plan.columns) onTableConfig?.({ columns: plan.columns });
      }
      const receipt = await commitTableOperation(fs, dir, plan);
      surfaceMutationWarnings(receipt.warnings);
    }, pasteNotice(plan.invalid));
  };

  const addColumn = (name: string, kind: EditablePropertyKind, currency: string): void => {
    const key = name.trim();
    if (!key || key.startsWith('$') || columns.some((c) => c.key === key)) return;
    void run(async () => {
      history.invalidate();
      const decl = kind === 'money' ? { kind, currency: currency.trim().toUpperCase() || 'EUR' } : { kind };
      const fs = await getVaultFs();
      const next = { ...types, [key]: decl };
      await savePropertyTypes(fs, next);
      setTypes(next);
      onTableConfig?.({
        columns: [...columns.map(({ key: columnKey, width }) => ({ key: columnKey, width })), { key, width: TABLE_COLUMN_DEFAULT_WIDTH }],
      });
      setAddOpen(false);
    });
  };

  const bulkColumn = columns.find((c) => c.key === bulkKey) ?? null;
  const selectedEditable = rows.filter((r) => selected.has(r.item.id) && r.editable).length;
  const selectedDeletable = rows.filter((r) => selected.has(r.item.id) && r.deletable);

  const deleteSelected = (): void => {
    const targets = selectedDeletable;
    setConfirmDelete(false);
    setSelected(new Set<string>());
    void run(async () => {
      const receipt = await history.runRecordedMutation(
        `Delete ${targets.length} item${targets.length === 1 ? '' : 's'}`,
        async () => trashVaultFiles(await getVaultFs(), targets.map((target) => target.item.contentRef!)),
      );
      surfaceMutationWarnings(receipt.warnings);
    });
  };

  if (propMap === null) return null; // one query in flight; don't flash placeholder dashes

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {(selected.size > 0 || error) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '0.45rem 0.75rem', borderBottom: '1px solid var(--border)', background: 'var(--surface)', fontSize: '0.8rem' }}>
          {selected.size > 0 && (
            <>
              <strong>{selected.size} selected</strong>
              {/* Properties live in note frontmatter; file/link properties await .waffle/meta.json (ADR-013). Say so, don't skip silently. */}
              <span style={{ color: 'var(--text-dim)' }}>
                {selectedEditable === 0 ? 'no notes in selection — properties apply to notes only; set' : selectedEditable < selected.size ? `set (on ${selectedEditable} note${selectedEditable > 1 ? 's' : ''})` : 'set'}
              </span>
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
                  placeholder={bulkColumn.kind === 'list' ? '["value","value"]' : 'value'}
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
                onClick={applyBulkRaw}
                style={{ ...chipStyle, background: 'var(--accent)', color: 'var(--accent-ink)', opacity: !bulkColumn || busy ? 0.5 : 1 }}
              >
                {busy ? 'Applying…' : 'Apply'}
              </button>
              <button disabled={!bulkColumn || busy} onClick={() => applyBulk(null)} style={{ ...chipStyle, opacity: !bulkColumn || busy ? 0.5 : 1 }}>
                Clear property
              </button>
              {confirmDelete ? (
                <>
                  <button
                    disabled={busy}
                    onClick={deleteSelected}
                    style={{ ...chipStyle, background: 'var(--ramp-blush)', color: 'var(--ink-blush)', fontWeight: 600 }}
                  >
                    Move {selectedDeletable.length} to .trash — confirm
                  </button>
                  <button onClick={() => setConfirmDelete(false)} style={chipStyle}>Cancel</button>
                </>
              ) : (
                <button
                  disabled={busy || selectedDeletable.length === 0}
                  onClick={() => setConfirmDelete(true)}
                  style={{ ...chipStyle, opacity: busy || selectedDeletable.length === 0 ? 0.5 : 1 }}
                >
                  Delete…
                </button>
              )}
              <button onClick={() => { setSelected(new Set<string>()); setConfirmDelete(false); }} style={chipStyle}>Deselect</button>
            </>
          )}
          {error && <span role="alert" style={{ color: 'var(--ink-blush)', marginLeft: 'auto' }}>{error}</span>}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <PropertyTable
          rows={rows}
          columns={columns}
          groups={groups}
          sort={tableConfig?.sort ?? null}
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
            const selectable = rows.filter((r) => r.editable || r.deletable).map((r) => r.item.id);
            setSelected((prev) => (selectable.every((id) => prev.has(id)) && selectable.length > 0 ? new Set<string>() : new Set(selectable)));
          }}
          onEditCell={onEditCell}
          onClearCells={onClearCells}
          onPasteCells={dir !== null ? onPasteCells : undefined}
          onFillDown={onFillDown}
          onColumnsChange={onColumnsChange}
          canCreate={dir !== null}
          onCreateRow={onCreateRow}
          onPasteRows={dir !== null ? onPasteRows : undefined}
          onAddColumn={() => setAddOpen((v) => !v)}
          onOpen={onOpen}
        />
      </div>

      {addOpen && <AddColumnForm existing={columns.map((c) => c.key)} onSubmit={addColumn} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function AddColumnForm({ existing, onSubmit, onClose }: { existing: string[]; onSubmit: (name: string, kind: EditablePropertyKind, currency: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<EditablePropertyKind>('text');
  const [currency, setCurrency] = useState('EUR');
  const clean = name.trim();
  const taken = existing.includes(clean);
  const invalid = clean === '' || clean.startsWith('$') || taken;
  return (
    <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 5, display: 'flex', flexDirection: 'column', gap: 8, padding: '0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-menu)', width: 230 }}>
      <strong style={{ fontSize: '0.82rem' }}>New property column</strong>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="name (frontmatter key)" style={selectStyle} />
      <select value={kind} onChange={(e) => setKind(e.target.value as EditablePropertyKind)} style={selectStyle}>
        {EDITABLE_KINDS.map((k) => (
          <option key={k} value={k}>{k === 'list' ? 'list (Obsidian multitext)' : k}</option>
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

registerLayout({ key: 'table', label: 'Table', icon: TableIcon, component: TableLayout, groupable: true });
