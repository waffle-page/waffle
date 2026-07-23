/**
 * One table cell: kind-aware display + inline editor. Presentation only — the
 * parent owns which cell is editing and what a commit does. Editors are plain
 * HTML inputs on purpose (dependency budget): the native date picker and
 * number keypad beat anything we would hand-roll.
 */
import { useRef, useState, type CSSProperties } from 'react';
import type { PropertyValue } from '@waffle/core';

/** Kinds the UI can author. duration/coords display fine but have no editor yet (recipe: docs/recipes/add-a-property-type.md). */
export const EDITABLE_KINDS: ReadonlyArray<PropertyValue['kind']> = ['text', 'number', 'date', 'checkbox', 'select', 'url', 'money'];

export function formatProperty(p: PropertyValue): string {
  switch (p.kind) {
    case 'text': case 'url': return p.value;
    case 'select': return p.option;
    case 'number': return p.value.toLocaleString();
    case 'checkbox': return p.value ? '✓' : '';
    case 'money':
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency }).format(p.amount);
      } catch {
        return `${p.amount} ${p.currency}`;
      }
    case 'duration': {
      const h = Math.floor(p.seconds / 3600);
      const m = Math.floor((p.seconds % 3600) / 60);
      const s = Math.round(p.seconds % 60);
      return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    }
    case 'date': {
      const d = new Date(p.iso);
      if (Number.isNaN(d.getTime())) return p.iso;
      return p.iso.includes('T') ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
    }
    case 'coords': return `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
  }
}

/** Editor raw string → PropertyValue (null clears the key). Shared with bulk-edit surfaces. */
export function parseCellInput(kind: PropertyValue['kind'], raw: string, currency: string): PropertyValue | null {
  const s = raw.trim();
  if (s === '') return null;
  switch (kind) {
    case 'text': return { kind, value: s };
    case 'url': return { kind, value: s };
    case 'select': return { kind, option: s };
    case 'number': return Number.isNaN(Number(s)) ? null : { kind, value: Number(s) };
    case 'money': return Number.isNaN(Number(s)) ? null : { kind, amount: Number(s), currency };
    case 'date': return { kind, iso: s };
    default: return null; // checkbox toggles directly; duration/coords have no editor
  }
}

function editorInitial(p: PropertyValue | undefined): string {
  if (!p) return '';
  switch (p.kind) {
    case 'number': return String(p.value);
    case 'money': return String(p.amount);
    case 'date': return p.iso.slice(0, 10); // <input type=date> speaks date-only
    default: return formatProperty(p);
  }
}

const INPUT_TYPE: Partial<Record<PropertyValue['kind'], string>> = { number: 'number', money: 'number', date: 'date' };

export interface PropertyCellProps {
  value: PropertyValue | undefined;
  kind: PropertyValue['kind'];
  currency: string;
  /** Distinct existing values, select kind only — suggestions, not a closed list. */
  options?: string[];
  editable: boolean;
  editing: boolean;
  /** Printable-key editing replaces the current value with this first character. */
  replacement?: string;
  onCommit: (value: PropertyValue | null, move?: 'down' | 'left' | 'right') => void;
  onCancel: () => void;
}

const cellText: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

export function PropertyCell({ value, kind, currency, options, editable, editing, replacement, onCommit, onCancel }: PropertyCellProps) {
  if (editing) {
    return (
      <CellEditor
        kind={kind}
        currency={currency}
        options={options}
        initial={replacement ?? editorInitial(value)}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  }

  if (kind === 'checkbox') {
    const checked = value?.kind === 'checkbox' && value.value;
    return (
      <input
        type="checkbox"
        checked={checked}
        disabled={!editable}
        readOnly
        tabIndex={-1}
        aria-hidden
        style={{ accentColor: 'var(--accent)', pointerEvents: 'none' }}
      />
    );
  }

  const canEdit = editable && EDITABLE_KINDS.includes(kind);
  const empty = value === undefined;
  return (
    // alignSelf stretch: an empty cell must still be a full-height click target.
    <div
      title={canEdit ? undefined : empty ? undefined : formatProperty(value)}
      style={{ display: 'flex', alignItems: 'center', alignSelf: 'stretch', width: '100%', minWidth: 0, color: empty ? 'var(--text-dim)' : 'var(--text)' }}
    >
      {empty ? (canEdit ? '' : '—') : kind === 'select' ? (
        <span style={{ ...cellText, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 999, padding: '0.1rem 0.55rem', fontSize: '0.78rem' }}>
          {formatProperty(value)}
        </span>
      ) : kind === 'url' ? (
        <span style={{ ...cellText, minWidth: 0, color: 'var(--accent-ink)' }}>
          {formatProperty(value)}
        </span>
      ) : (
        <span style={cellText}>{formatProperty(value)}</span>
      )}
    </div>
  );
}

function CellEditor({ kind, currency, options, initial, onCommit, onCancel }: {
  kind: PropertyValue['kind'];
  currency: string;
  options?: string[];
  initial: string;
  onCommit: (value: PropertyValue | null, move?: 'down' | 'left' | 'right') => void;
  onCancel: () => void;
}) {
  const [raw, setRaw] = useState(initial);
  // Escape must cancel, but blur fires after — route both through one gate.
  const done = useRef(false);
  const finish = (commit: boolean, move?: 'down' | 'left' | 'right'): void => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(parseCellInput(kind, raw, currency), move);
    else onCancel();
  };
  const id = useRef(`dl-${Math.random().toString(36).slice(2, 8)}`); // stable per edit session
  const listId = kind === 'select' && options?.length ? id.current : undefined;
  return (
    <>
      <input
        autoFocus
        type={INPUT_TYPE[kind] ?? 'text'}
        step={kind === 'money' ? '0.01' : kind === 'number' ? 'any' : undefined}
        list={listId}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            finish(true, 'down');
          } else if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            finish(true, e.shiftKey ? 'left' : 'right');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          }
        }}
        style={{
          width: '100%',
          minWidth: 0,
          font: 'inherit',
          color: 'var(--text)',
          background: 'var(--surface)',
          border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.15rem 0.4rem',
          outline: 'none',
        }}
      />
      {listId && (
        <datalist id={listId}>
          {options!.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  );
}
