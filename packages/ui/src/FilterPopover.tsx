/**
 * Filter + group editor for a view (docs/12 wedding test: "filtered rsvp = yes,
 * grouped by table"). Presentation only: edits a draft, hands back typed
 * conditions on Apply — the host compiles them to SQL. v1 is a flat AND list;
 * or-groups wait until a real view needs them.
 */
import { useState, type CSSProperties } from 'react';
import type { PropertyValue } from '@waffle/core';

/** '$title' | '$type' | '$tag' | property key. */
export interface FilterField {
  key: string;
  kind: PropertyValue['kind'] | 'title' | 'type' | 'tag';
}

export interface FilterCondition {
  key: string;
  cmp: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'tagged';
  value: string | number | boolean;
}

export interface FilterPopoverProps {
  fields: FilterField[];
  conditions: FilterCondition[];
  groupBy: string | null;
  /** Property keys offered for grouping (select/text/checkbox/number make sense; host decides). */
  groupChoices: string[];
  onApply: (conditions: FilterCondition[], groupBy: string | null) => void;
  onClose: () => void;
}

const OPS: Record<string, Array<{ cmp: FilterCondition['cmp']; label: string }>> = {
  title: [{ cmp: 'contains', label: 'contains' }],
  type: [{ cmp: 'eq', label: 'is' }],
  tag: [{ cmp: 'tagged', label: 'has tag' }],
  text: [{ cmp: 'eq', label: 'is' }, { cmp: 'ne', label: 'is not' }, { cmp: 'contains', label: 'contains' }],
  select: [{ cmp: 'eq', label: 'is' }, { cmp: 'ne', label: 'is not' }],
  url: [{ cmp: 'contains', label: 'contains' }, { cmp: 'eq', label: 'is' }],
  number: [{ cmp: 'eq', label: '=' }, { cmp: 'ne', label: '≠' }, { cmp: 'lt', label: '<' }, { cmp: 'lte', label: '≤' }, { cmp: 'gt', label: '>' }, { cmp: 'gte', label: '≥' }],
  money: [{ cmp: 'lt', label: '<' }, { cmp: 'lte', label: '≤' }, { cmp: 'gt', label: '>' }, { cmp: 'gte', label: '≥' }, { cmp: 'eq', label: '=' }],
  duration: [{ cmp: 'lt', label: '<' }, { cmp: 'gte', label: '≥' }],
  date: [{ cmp: 'gte', label: 'on or after' }, { cmp: 'lt', label: 'before' }],
  checkbox: [{ cmp: 'eq', label: 'is' }],
};

/** Raw input string → typed condition value for the field's kind. */
function typedValue(kind: FilterField['kind'], raw: string): string | number | boolean | null {
  if (kind === 'number' || kind === 'money' || kind === 'duration') {
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

export function FilterPopover({ fields, conditions, groupBy, groupChoices, onApply, onClose }: FilterPopoverProps) {
  const [rows, setRows] = useState<DraftRow[]>(() =>
    conditions.map((c) => ({ key: c.key, cmp: c.cmp, raw: rawValue(fields.find((f) => f.key === c.key)?.kind ?? 'text', c.value) })),
  );
  const [group, setGroup] = useState<string | null>(groupBy);

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
    <div style={{ position: 'absolute', top: '100%', right: 8, zIndex: 6, display: 'flex', flexDirection: 'column', gap: 8, width: 430, maxWidth: '90vw', padding: '0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}>
      <strong style={{ fontSize: '0.82rem' }}>Filter</strong>
      {rows.length === 0 && <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>No conditions — showing everything.</span>}
      {rows.map((r, i) => {
        const kind = fieldFor(r.key).kind;
        const ops = OPS[kind] ?? OPS.text!;
        return (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={r.key} onChange={(e) => { const key = e.target.value; setRow(i, { key, cmp: (OPS[fieldFor(key).kind] ?? OPS.text!)[0]!.cmp, raw: '' }); }} style={{ ...ctl, width: 120 }}>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>{f.key === '$title' ? 'Title' : f.key === '$type' ? 'Type' : f.key === '$tag' ? 'Tag' : f.key}</option>
              ))}
            </select>
            <select value={r.cmp} onChange={(e) => setRow(i, { cmp: e.target.value as FilterCondition['cmp'] })} style={{ ...ctl, width: 110 }}>
              {ops.map((o) => (
                <option key={o.cmp} value={o.cmp}>{o.label}</option>
              ))}
            </select>
            {kind === 'checkbox' ? (
              <select value={r.raw || 'true'} onChange={(e) => setRow(i, { raw: e.target.value })} style={{ ...ctl, flex: 1 }}>
                <option value="true">checked</option>
                <option value="false">unchecked</option>
              </select>
            ) : kind === 'type' ? (
              <select value={r.raw || 'note'} onChange={(e) => setRow(i, { raw: e.target.value })} style={{ ...ctl, flex: 1 }}>
                {['note', 'link', 'file', 'dash'].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            ) : (
              <input
                value={r.raw}
                onChange={(e) => setRow(i, { raw: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
                type={kind === 'number' || kind === 'money' || kind === 'duration' ? 'number' : kind === 'date' ? 'date' : 'text'}
                placeholder="value"
                style={{ ...ctl, flex: 1, minWidth: 0 }}
              />
            )}
            <button onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} title="Remove condition" style={{ ...ctl, cursor: 'pointer' }}>×</button>
          </div>
        );
      })}
      <div>
        <button onClick={() => setRows((prev) => [...prev, { key: fields[0]!.key, cmp: (OPS[fields[0]!.kind] ?? OPS.text!)[0]!.cmp, raw: '' }])} style={{ ...ctl, cursor: 'pointer' }}>
          + condition
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Group by</span>
        <select value={group ?? ''} onChange={(e) => setGroup(e.target.value || null)} style={{ ...ctl, flex: 1 }}>
          <option value="">none</option>
          {groupChoices.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{ ...ctl, cursor: 'pointer' }}>Cancel</button>
        <button onClick={apply} style={{ ...ctl, cursor: 'pointer', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 }}>Apply</button>
      </div>
    </div>
  );
}
