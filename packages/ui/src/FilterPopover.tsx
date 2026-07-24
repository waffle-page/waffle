/**
 * Filter + group editor for a view (docs/12 wedding test: "filtered rsvp = yes,
 * grouped by table"). Presentation only: edits a draft, hands back typed
 * conditions on Apply — the host compiles them to SQL. v1 is a flat AND list;
 * or-groups wait until a real view needs them.
 */
import { useState, type CSSProperties } from 'react';
import type { PropertyValue } from '@waffle/core';
import type { GroupByConfig } from './types';

/** Built-in `$…` field or frontmatter property key. */
export interface FilterField {
  key: string;
  kind: PropertyValue['kind'] | 'title' | 'type' | 'tag' | 'interaction-status' | 'interaction-rating';
  /** Beginner-facing name for built-ins; property keys fall back to themselves. */
  label?: string;
  /** Fixed vocabulary for semantic fields such as interaction status. */
  options?: Array<{ value: string; label: string }>;
}

export interface FilterCondition {
  key: string;
  cmp: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'tagged';
  value: string | number | boolean;
}

export interface FilterPopoverProps {
  fields: FilterField[];
  conditions: FilterCondition[];
  /** Complex imported filter trees stay active but are not flattened into this v1 editor. */
  filtersReadOnly?: boolean;
  groupBy: GroupByConfig | null;
  /** Property keys offered for grouping (select/text/checkbox/number make sense; host decides). */
  groupChoices: string[];
  /** false ⇒ the active layout can't render sections; the group control is hidden, not ignored. */
  showGroupBy?: boolean;
  onApply: (conditions: FilterCondition[], groupBy: GroupByConfig | null) => void;
  onClose: () => void;
}

const OPS: Record<string, Array<{ cmp: FilterCondition['cmp']; label: string }>> = {
  title: [{ cmp: 'contains', label: 'contains' }],
  type: [{ cmp: 'eq', label: 'is' }],
  tag: [{ cmp: 'tagged', label: 'has tag' }],
  text: [{ cmp: 'eq', label: 'is' }, { cmp: 'ne', label: 'is not' }, { cmp: 'contains', label: 'contains' }],
  select: [{ cmp: 'eq', label: 'is' }, { cmp: 'ne', label: 'is not' }],
  url: [{ cmp: 'contains', label: 'contains' }, { cmp: 'eq', label: 'is' }],
  list: [{ cmp: 'contains', label: 'contains' }],
  number: [{ cmp: 'eq', label: '=' }, { cmp: 'ne', label: '≠' }, { cmp: 'lt', label: '<' }, { cmp: 'lte', label: '≤' }, { cmp: 'gt', label: '>' }, { cmp: 'gte', label: '≥' }],
  money: [{ cmp: 'lt', label: '<' }, { cmp: 'lte', label: '≤' }, { cmp: 'gt', label: '>' }, { cmp: 'gte', label: '≥' }, { cmp: 'eq', label: '=' }],
  duration: [{ cmp: 'lt', label: '<' }, { cmp: 'gte', label: '≥' }],
  date: [{ cmp: 'gte', label: 'on or after' }, { cmp: 'lt', label: 'before' }],
  checkbox: [{ cmp: 'eq', label: 'is' }],
  'interaction-status': [{ cmp: 'eq', label: 'is' }, { cmp: 'ne', label: 'is not' }],
  'interaction-rating': [{ cmp: 'eq', label: '=' }, { cmp: 'ne', label: '≠' }, { cmp: 'lt', label: '<' }, { cmp: 'lte', label: '≤' }, { cmp: 'gt', label: '>' }, { cmp: 'gte', label: '≥' }],
};

/** Raw input string → typed condition value for the field's kind. */
function typedValue(kind: FilterField['kind'], raw: string): string | number | boolean | null {
  if (kind === 'number' || kind === 'money' || kind === 'duration' || kind === 'interaction-rating') {
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }
  if (kind === 'date') {
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? null : ms; // value_num carries Date.parse ms (toEavColumns)
  }
  if (kind === 'checkbox') return raw === 'true';
  return raw.trim() === '' ? null : raw.trim();
}

/** Condition value → editor input string. */
function rawValue(kind: FilterField['kind'], value: string | number | boolean): string {
  if (kind === 'date' && typeof value === 'number') return new Date(value).toISOString().slice(0, 10);
  return String(value);
}

interface DraftRow {
  key: string;
  cmp: FilterCondition['cmp'];
  raw: string;
}

const ctl: CSSProperties = { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.25rem 0.45rem', fontSize: '0.8rem' };

function defaultRaw(field: FilterField): string {
  if (field.options?.[0]) return field.options[0].value;
  if (field.kind === 'checkbox') return 'true';
  if (field.kind === 'type') return 'note';
  return '';
}

export function FilterPopover({ fields, conditions, filtersReadOnly = false, groupBy, groupChoices, showGroupBy = true, onApply, onClose }: FilterPopoverProps) {
  const [rows, setRows] = useState<DraftRow[]>(() =>
    conditions.map((c) => ({ key: c.key, cmp: c.cmp, raw: rawValue(fields.find((f) => f.key === c.key)?.kind ?? 'text', c.value) })),
  );
  const [group, setGroup] = useState<GroupByConfig | null>(groupBy);

  const fieldFor = (key: string): FilterField => fields.find((f) => f.key === key) ?? { key, kind: 'text' };

  const apply = (): void => {
    const out: FilterCondition[] = [];
    for (const r of rows) {
      const value = typedValue(fieldFor(r.key).kind, r.raw);
      if (value !== null) out.push({ key: r.key, cmp: r.cmp, value });
    }
    onApply(out, group);
  };

  const setRow = (i: number, patch: Partial<DraftRow>): void =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div role="dialog" aria-label="View filters" style={{ position: 'absolute', top: '100%', right: 8, zIndex: 6, display: 'flex', flexDirection: 'column', gap: 8, width: 430, maxWidth: '90vw', padding: '0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-menu)' }}>
      <strong style={{ fontSize: '0.82rem' }}>Filter</strong>
      {filtersReadOnly && (
        <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
          This imported view uses nested filters. They remain active and sync safely; edit them in Obsidian.
        </span>
      )}
      {!filtersReadOnly && rows.length === 0 && <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>No conditions — showing everything.</span>}
      {!filtersReadOnly && rows.map((r, i) => {
        const kind = fieldFor(r.key).kind;
        const ops = OPS[kind] ?? OPS.text!;
        return (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select aria-label="Filter field" value={r.key} onChange={(e) => { const key = e.target.value; const field = fieldFor(key); setRow(i, { key, cmp: (OPS[field.kind] ?? OPS.text!)[0]!.cmp, raw: defaultRaw(field) }); }} style={{ ...ctl, width: 120 }}>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>{f.label ?? (f.key === '$title' ? 'Title' : f.key === '$type' ? 'Type' : f.key === '$tag' ? 'Tag' : f.key)}</option>
              ))}
            </select>
            <select aria-label="Filter operator" value={r.cmp} onChange={(e) => setRow(i, { cmp: e.target.value as FilterCondition['cmp'] })} style={{ ...ctl, width: 110 }}>
              {ops.map((o) => (
                <option key={o.cmp} value={o.cmp}>{o.label}</option>
              ))}
            </select>
            {fieldFor(r.key).options ? (
              <select aria-label="Filter value" value={r.raw || fieldFor(r.key).options![0]?.value || ''} onChange={(e) => setRow(i, { raw: e.target.value })} style={{ ...ctl, flex: 1 }}>
                {fieldFor(r.key).options!.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : kind === 'checkbox' ? (
              <select aria-label="Filter value" value={r.raw || 'true'} onChange={(e) => setRow(i, { raw: e.target.value })} style={{ ...ctl, flex: 1 }}>
                <option value="true">checked</option>
                <option value="false">unchecked</option>
              </select>
            ) : kind === 'type' ? (
              <select aria-label="Filter value" value={r.raw || 'note'} onChange={(e) => setRow(i, { raw: e.target.value })} style={{ ...ctl, flex: 1 }}>
                {['note', 'link', 'file', 'dash'].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            ) : (
              <input
                aria-label="Filter value"
                value={r.raw}
                onChange={(e) => setRow(i, { raw: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
                type={kind === 'date' ? 'date' : 'text'}
                inputMode={kind === 'number' || kind === 'money' || kind === 'duration' || kind === 'interaction-rating' ? 'decimal' : undefined}
                placeholder="value"
                style={{ ...ctl, flex: 1, minWidth: 0 }}
              />
            )}
            <button onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} title="Remove condition" style={{ ...ctl, cursor: 'pointer' }}>×</button>
          </div>
        );
      })}
      {!filtersReadOnly && <div>
        <button onClick={() => setRows((prev) => [...prev, { key: fields[0]!.key, cmp: (OPS[fields[0]!.kind] ?? OPS.text!)[0]!.cmp, raw: '' }])} style={{ ...ctl, cursor: 'pointer' }}>
          + condition
        </button>
      </div>}
      {showGroupBy && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Group by</span>
          <select
            aria-label="Group by field"
            value={group?.key ?? ''}
            onChange={(e) => setGroup(e.target.value ? { key: e.target.value, dir: group?.dir ?? 'asc' } : null)}
            style={{ ...ctl, flex: 1 }}
          >
            <option value="">none</option>
            {groupChoices.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          {group && (
            <select aria-label="Group direction" value={group.dir} onChange={(e) => setGroup({ ...group, dir: e.target.value as GroupByConfig['dir'] })} style={ctl}>
              <option value="asc">ascending</option>
              <option value="desc">descending</option>
            </select>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{ ...ctl, cursor: 'pointer' }}>Cancel</button>
        <button onClick={apply} style={{ ...ctl, cursor: 'pointer', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 }}>Apply</button>
      </div>
    </div>
  );
}
