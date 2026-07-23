/**
 * Markdown frontmatter → typed properties. For notes, YAML frontmatter is
 * CANONICAL (ADR-004): the DB rows produced from it are a mirror, rebuildable
 * at any time. Type inference follows Obsidian's conventions so a dropped-in
 * Obsidian vault "just works".
 */
import { Document, isMap, parse as parseYaml, parseDocument } from 'yaml';
import type { PropertyValue } from '../types';
import type { PropertyTypes } from './propertyTypes';

export interface ParsedNote {
  /** Frontmatter-derived typed properties (excluding `tags`). */
  properties: Record<string, PropertyValue>;
  /** Union of frontmatter `tags` and inline `#tags`. */
  tags: string[];
  /** Markdown body without the frontmatter block. */
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const INLINE_TAG = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

export function parseNote(markdown: string, types?: PropertyTypes): ParsedNote {
  const match = FRONTMATTER.exec(markdown);
  const body = match ? markdown.slice(match[0].length) : markdown;
  const tags = new Set<string>();

  for (const m of body.matchAll(INLINE_TAG)) tags.add(m[2]!.toLowerCase());

  const properties: Record<string, PropertyValue> = {};
  if (match) {
    let data: unknown;
    try {
      data = parseYaml(match[1]!);
    } catch {
      data = null; // malformed frontmatter → treat as body-only, never crash the scan
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (key === 'tags') {
          for (const t of toStringArray(value)) tags.add(t.toLowerCase());
          continue;
        }
        const decl = types?.[key];
        const prop = (decl && declaredProperty(value, decl)) || inferProperty(value);
        if (prop) properties[key] = prop;
      }
    }
  }

  return { properties, tags: [...tags], body };
}

/**
 * Coerce a YAML scalar through its declared kind (propertyTypes.ts). Returns
 * null on a value/kind mismatch so the caller falls back to plain inference —
 * a stray string in a money column must stay visible, not vanish.
 */
function declaredProperty(value: unknown, decl: PropertyTypes[string]): PropertyValue | null {
  switch (decl.kind) {
    case 'money': return typeof value === 'number' ? { kind: 'money', amount: value, currency: decl.currency ?? 'EUR' } : null;
    case 'duration': return typeof value === 'number' ? { kind: 'duration', seconds: value } : null;
    case 'select': return typeof value === 'string' || typeof value === 'number' ? { kind: 'select', option: String(value) } : null;
    case 'coords':
      return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number')
        ? { kind: 'coords', lat: value[0] as number, lng: value[1] as number }
        : null;
    case 'number': return typeof value === 'number' ? { kind: 'number', value } : null;
    case 'checkbox': return typeof value === 'boolean' ? { kind: 'checkbox', value } : null;
    case 'date':
      if (value instanceof Date) return { kind: 'date', iso: value.toISOString() };
      return typeof value === 'string' && ISO_DATE.test(value) ? { kind: 'date', iso: value } : null;
    case 'url': return typeof value === 'string' ? { kind: 'url', value } : null;
    case 'text': return typeof value === 'string' ? { kind: 'text', value } : null;
  }
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function inferProperty(value: unknown): PropertyValue | null {
  if (value == null) return null;
  if (typeof value === 'boolean') return { kind: 'checkbox', value };
  if (typeof value === 'number') return { kind: 'number', value };
  if (value instanceof Date) return { kind: 'date', iso: value.toISOString() };
  if (typeof value === 'string') {
    if (ISO_DATE.test(value)) return { kind: 'date', iso: value };
    if (/^https?:\/\//.test(value)) return { kind: 'url', value };
    return { kind: 'text', value };
  }
  // Arrays/objects (beyond tags) have no property type yet — store as text JSON.
  return { kind: 'text', value: JSON.stringify(value) };
}

/**
 * PropertyValue → the YAML scalar that round-trips back through parseNote.
 * Kinds a bare scalar can't carry (money amount, select option, duration
 * seconds) rely on the key's declaration in `.waffle/properties.json`.
 */
export function propertyToYaml(p: PropertyValue): unknown {
  switch (p.kind) {
    case 'text': case 'url': return p.value;
    case 'select': return p.option;
    case 'number': return p.value;
    case 'checkbox': return p.value;
    case 'money': return p.amount;
    case 'duration': return p.seconds;
    case 'date': return p.iso;
    case 'coords': return [p.lat, p.lng];
  }
}

/**
 * Set/delete frontmatter keys in a markdown string (undefined value = delete).
 * Edits the parsed YAML *document* so untouched keys keep their comments and
 * formatting. The body is returned byte-identical. Constraint: a frontmatter
 * block parseNote already treats as malformed (unparseable YAML) is REPLACED
 * by a clean block — its properties were invisible to Waffle anyway.
 */
export function updateFrontmatter(markdown: string, patch: Record<string, unknown>): string {
  const match = FRONTMATTER.exec(markdown);
  const body = match ? markdown.slice(match[0].length) : markdown;

  let doc = match ? parseDocument(match[1]!) : new Document({});
  if (doc.errors.length > 0 || (doc.contents !== null && !isMap(doc.contents))) doc = new Document({});

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) doc.delete(key);
    else doc.set(key, value);
  }

  const empty = doc.contents === null || (isMap(doc.contents) && doc.contents.items.length === 0);
  if (empty) return body;
  return `---\n${doc.toString()}---\n${body}`;
}

/** Rebuild a PropertyValue from the properties EAV columns (inverse of toEavColumns). */
export function fromEavColumns(kind: string, text: string | null, num: number | null, aux: string | null): PropertyValue | null {
  switch (kind) {
    case 'text': return text !== null ? { kind, value: text } : null;
    case 'number': return num !== null ? { kind, value: num } : null;
    case 'money': return num !== null ? { kind, amount: num, currency: aux ?? 'EUR' } : null;
    case 'duration': return num !== null ? { kind, seconds: num } : null;
    case 'date': return text !== null ? { kind, iso: text } : null;
    case 'coords': return num !== null && aux !== null ? { kind, lat: num, lng: Number(aux) } : null;
    case 'select': return text !== null ? { kind, option: text } : null;
    case 'url': return text !== null ? { kind, value: text } : null;
    case 'checkbox': return num !== null ? { kind, value: num === 1 } : null;
    default: return null;
  }
}

/** Flatten a PropertyValue into the properties EAV columns (kind, text, num, aux). */
export function toEavColumns(p: PropertyValue): { kind: string; text: string | null; num: number | null; aux: string | null } {
  switch (p.kind) {
    case 'text': return { kind: p.kind, text: p.value, num: null, aux: null };
    case 'number': return { kind: p.kind, text: null, num: p.value, aux: null };
    case 'money': return { kind: p.kind, text: null, num: p.amount, aux: p.currency };
    case 'duration': return { kind: p.kind, text: null, num: p.seconds, aux: null };
    case 'date': return { kind: p.kind, text: p.iso, num: Date.parse(p.iso) || null, aux: null };
    case 'coords': return { kind: p.kind, text: null, num: p.lat, aux: String(p.lng) };
    case 'select': return { kind: p.kind, text: p.option, num: null, aux: null };
    case 'url': return { kind: p.kind, text: p.value, num: null, aux: null };
    case 'checkbox': return { kind: p.kind, text: null, num: p.value ? 1 : 0, aux: null };
  }
}
