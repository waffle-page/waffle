/**
 * One table cell: kind-aware display + inline editor. Presentation only — the
 * parent owns which cell is editing and what a commit does. Editors are plain
 * HTML inputs on purpose (dependency budget): the native date picker and
 * number keypad beat anything we would hand-roll.
 */
import { useId, useRef, useState, type CSSProperties } from 'react';
import type { PropertyValue } from '@waffle/core';

/**
 * Kinds the UI can author. duration/coords display fine but have no editor yet;
 * `unsupported` is a read-only safety carrier by invariant.
 */
export type EditablePropertyKind = Exclude<PropertyValue['kind'], 'duration' | 'coords' | 'unsupported'>;
export const EDITABLE_KINDS: ReadonlyArray<PropertyValue['kind']> =
  ['text', 'number', 'date', 'checkbox', 'select', 'url', 'money', 'list'] satisfies ReadonlyArray<EditablePropertyKind>;

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
    case 'list': return p.values.length === 0 ? '[]' : p.values.map((value) => value === null ? 'null' : String(value)).join(' · ');
    case 'unsupported': return JSON.stringify(p.value) ?? '';
  }
}

export type CellInputParseResult =
  | { ok: true; value: PropertyValue | null }
  | { ok: false; message: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

function validIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) return false;
  const canonicalDay = new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10);
  return canonicalDay === value.slice(0, 10);
}

/**
 * Editor raw string → an explicit valid/invalid result. `null` means an
 * intentional empty value only; invalid non-empty input must never alias clear.
 */
export function parseCellInput(kind: PropertyValue['kind'], raw: string, currency: string): CellInputParseResult {
  const s = raw.trim();
  if (s === '') return { ok: true, value: null };
  switch (kind) {
    case 'text': return { ok: true, value: { kind, value: s } };
    case 'url': return { ok: true, value: { kind, value: s } };
    case 'select': return { ok: true, value: { kind, option: s } };
    case 'number': {
      const value = Number(s);
      return Number.isFinite(value)
        ? { ok: true, value: { kind, value } }
        : { ok: false, message: 'Enter a valid number.' };
    }
    case 'money': {
      const amount = Number(s);
      return Number.isFinite(amount)
        ? { ok: true, value: { kind, amount, currency } }
        : { ok: false, message: 'Enter a valid monetary amount.' };
    }
    case 'date':
      return validIsoDate(s)
        ? { ok: true, value: { kind, iso: s } }
        : { ok: false, message: 'Enter a valid ISO date.' };
    case 'list': {
      let value: unknown;
      try {
        value = JSON.parse(s);
      } catch {
        return { ok: false, message: 'Enter a JSON array, for example ["veggie","vegan"].' };
      }
      return isPropertyList(value)
        ? { ok: true, value: { kind, values: value } }
        : { ok: false, message: 'List items must be text, numbers, booleans, or null.' };
    }
    default:
      return { ok: false, message: `${kind} values cannot be edited here.` };
  }
}

function isPropertyList(value: unknown): value is Array<string | number | boolean | null> {
  return Array.isArray(value) && value.every((item) =>
    item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)),
  );
}

function editorInitial(p: PropertyValue | undefined): string {
  if (!p) return '';
  switch (p.kind) {
    case 'number': return String(p.value);
    case 'money': return String(p.amount);
    case 'date': return p.iso.slice(0, 10); // <input type=date> speaks date-only
    case 'list': return JSON.stringify(p.values);
    default: return formatProperty(p);
  }
}

const INPUT_TYPE: Partial<Record<PropertyValue['kind'], string>> = { number: 'number', money: 'number', date: 'date' };

export interface PropertyCellProps {
  /** Accessible column name for the native editor. */
  label: string;
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

export function PropertyCell({ label, value, kind, currency, options, editable, editing, replacement, onCommit, onCancel }: PropertyCellProps) {
  if (editing) {
    return (
      <CellEditor
        label={label}
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

function CellEditor({ label, kind, currency, options, initial, onCommit, onCancel }: {
  label: string;
  kind: PropertyValue['kind'];
  currency: string;
  options?: string[];
  initial: string;
  onCommit: (value: PropertyValue | null, move?: 'down' | 'left' | 'right') => void;
  onCancel: () => void;
}) {
  const [raw, setRaw] = useState(initial);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape must cancel, but blur fires after — route both through one gate.
  const done = useRef(false);
  const finish = (commit: boolean, move?: 'down' | 'left' | 'right'): void => {
    if (done.current) return;
    if (!commit) {
      done.current = true;
      onCancel();
      return;
    }
    const parsed = parseCellInput(kind, raw, currency);
    if (!parsed.ok) {
      setValidationError(parsed.message);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    done.current = true;
    onCommit(parsed.value, move);
  };
  const id = useId();
  const listId = kind === 'select' && options?.length ? `${id}-options` : undefined;
  const errorId = validationError ? `${id}-error` : undefined;
  const nativeType =
    INPUT_TYPE[kind] && parseCellInput(kind, initial, currency).ok
      ? INPUT_TYPE[kind]
      : 'text';
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        ref={inputRef}
        autoFocus
        type={nativeType}
        inputMode={kind === 'number' || kind === 'money' ? 'decimal' : undefined}
        step={kind === 'money' ? '0.01' : kind === 'number' ? 'any' : undefined}
        list={listId}
        value={raw}
        placeholder={kind === 'list' ? '["value","value"]' : undefined}
        aria-label={`Edit ${label}`}
        aria-invalid={validationError ? true : undefined}
        aria-describedby={errorId}
        onChange={(e) => {
          setRaw(e.target.value);
          setValidationError(null);
        }}
        onPaste={(event) => {
          const parsed = parseCellInput(kind, event.clipboardData.getData('text/plain'), currency);
          if (parsed.ok) return;
          event.preventDefault();
          setValidationError(parsed.message);
        }}
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
          border: `1px solid ${validationError ? 'var(--ink-blush)' : 'var(--accent)'}`,
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
      {validationError && (
        <span
          id={errorId}
          role="alert"
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.15rem)',
            left: 0,
            zIndex: 4,
            padding: '0.2rem 0.4rem',
            color: 'var(--ink-blush)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            whiteSpace: 'nowrap',
            fontSize: '0.72rem',
          }}
        >
          {validationError}
        </span>
      )}
    </div>
  );
}
