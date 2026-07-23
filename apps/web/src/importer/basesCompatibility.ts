/**
 * Pure compatibility boundary for the Obsidian Bases grammar.
 *
 * This belongs beside the quarantined sync pair because a partial parse is
 * more dangerous than no parse: dropping one condition broadens a user's
 * view while making it look successfully imported. The invariants are:
 *
 *  - recursive filters are all-or-nothing;
 *  - every imported node has a symmetric Bases spelling;
 *  - built-in file fields map only where Waffle can evaluate them exactly.
 */
import type { FilterNode, PropertyTypeDecl, PropertyTypes } from '@waffle/core';
import type { GroupByConfig } from '@waffle/ui';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CMP: Record<string, Extract<FilterNode, { op: 'cmp' }>['cmp']> = {
  '==': 'eq',
  '!=': 'ne',
  '<': 'lt',
  '<=': 'lte',
  '>': 'gt',
  '>=': 'gte',
};
const OP: Partial<Record<Extract<FilterNode, { op: 'cmp' }>['cmp'], string>> = {
  eq: '==',
  ne: '!=',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
};

const FILE_TO_KEY: Record<string, string | undefined> = {
  'file.name': '$name',
  'file.basename': '$basename',
  'file.path': '$path',
  'file.folder': '$folder',
  'file.ext': '$ext',
  'file.mtime': '$updated',
};
const KEY_TO_FILE = Object.fromEntries(Object.entries(FILE_TO_KEY).map(([file, key]) => [key, file])) as Record<string, string | undefined>;

export interface FilterParseResult {
  node: FilterNode | null;
  supported: boolean;
}

export interface GroupParseResult {
  groupBy: GroupByConfig | null;
  supported: boolean;
}

/** `note.foo` and the documented shorthand `foo` both address frontmatter. */
export const stripNote = (key: string): string => (key.startsWith('note.') ? key.slice(5) : key);

export function basesKeyToWaffle(rawKey: string): string | null {
  if (rawKey.startsWith('formula.') || rawKey.startsWith('this.')) return null;
  if (rawKey.startsWith('file.')) return FILE_TO_KEY[rawKey] ?? null;
  return stripNote(rawKey);
}

export function waffleKeyToBases(key: string): string | null {
  // Waffle's displayed title is the extensionless filename.
  if (key === '$title') return 'file.basename';
  if (key.startsWith('$')) return KEY_TO_FILE[key] ?? null;
  return key;
}

export function filterKind(key: string, kinds: PropertyTypes): PropertyTypeDecl['kind'] | undefined {
  if (key === '$updated') return 'date';
  return key.startsWith('$') ? undefined : kinds[key]?.kind;
}

/** Parse an Obsidian `and:`/`or:`/`not:` block without dropping any child. */
export function parseFilterBlock(block: unknown, kinds: PropertyTypes, notes: string[]): FilterParseResult {
  if (block === undefined || block === null) return { node: null, supported: true };
  if (typeof block === 'string') return parseExpression(block, kinds, notes);
  if (typeof block !== 'object' || Array.isArray(block)) return unsupported(notes, 'filter block is not an object or expression');

  const rec = block as Record<string, unknown>;
  const operators = (['and', 'or', 'not'] as const).filter((op) => op in rec);
  if (operators.length !== 1 || Object.keys(rec).length !== 1) {
    return unsupported(notes, 'filter block must contain only one of `and`, `or`, or `not`');
  }

  const op = operators[0]!;
  if (!Array.isArray(rec[op]) || rec[op].length === 0) {
    return unsupported(notes, `\`${op}\` must contain a non-empty list`);
  }
  const rawChildren = rec[op] as unknown[];
  if (rawChildren.some((child) => child === undefined || child === null)) {
    return unsupported(notes, `\`${op}\` contains an empty filter`);
  }
  const parsed = rawChildren.map((child) => parseFilterBlock(child, kinds, notes));
  if (parsed.some((child) => !child.supported)) return { node: null, supported: false };
  const children = parsed.flatMap((child) => child.node ? [child.node] : []);
  return children.length === rawChildren.length
    ? { node: { op, children }, supported: true }
    : unsupported(notes, `\`${op}\` contains an empty filter`);
}

/** FilterNode → YAML-ready Bases filter block; null means freeze. */
export function filterToBases(node: FilterNode, kinds: PropertyTypes): unknown | null {
  if (node.op === 'cmp') return comparisonToBases(node, kinds);
  if (node.children.length === 0) return null;
  const children: unknown[] = [];
  for (const child of node.children) {
    const converted = filterToBases(child, kinds);
    if (converted === null) return null;
    children.push(converted);
  }
  return { [node.op]: children };
}

export function parseGroupBy(raw: unknown, notes: string[]): GroupParseResult {
  if (raw === undefined || raw === null) return { groupBy: null, supported: true };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return unsupportedGroup(notes, 'groupBy must be an object');
  const group = raw as Record<string, unknown>;
  const extraKeys = Object.keys(group).filter((key) => key !== 'property' && key !== 'direction');
  if (extraKeys.length) return unsupportedGroup(notes, `groupBy settings ${extraKeys.join(', ')} are unsupported`);
  if (typeof group.property !== 'string') return unsupportedGroup(notes, 'groupBy.property is missing');
  const key = basesKeyToWaffle(group.property);
  if (!key) return unsupportedGroup(notes, `groupBy on ${group.property} is unsupported`);
  const direction = typeof group.direction === 'string' ? group.direction.toUpperCase() : 'ASC';
  if (direction !== 'ASC' && direction !== 'DESC') return unsupportedGroup(notes, `groupBy direction "${String(group.direction)}" is unsupported`);
  return { groupBy: { key, dir: direction === 'DESC' ? 'desc' : 'asc' }, supported: true };
}

export function groupByToBases(groupBy: GroupByConfig): { property: string; direction: 'ASC' | 'DESC' } | null {
  const property = waffleKeyToBases(groupBy.key);
  return property ? { property, direction: groupBy.dir === 'desc' ? 'DESC' : 'ASC' } : null;
}

function parseExpression(src: string, kinds: PropertyTypes, notes: string[]): FilterParseResult {
  const expression = src.trim();
  if (expression.startsWith('!')) {
    let inner = expression.slice(1).trim();
    if (inner.startsWith('(') && inner.endsWith(')')) inner = inner.slice(1, -1).trim();
    const parsed = parseExpression(inner, kinds, notes);
    return parsed.supported && parsed.node
      ? { node: { op: 'not', children: [parsed.node] }, supported: true }
      : { node: null, supported: false };
  }

  let match = /^file\.inFolder\((.*)\)$/.exec(expression);
  if (match) {
    const folder = oneStringArgument(match[1]!);
    return folder === null
      ? unsupported(notes, `unsupported filter: ${expression}`)
      : { node: { op: 'cmp', key: '$folder', cmp: 'inFolder', value: folder }, supported: true };
  }

  match = /^file\.hasTag\((.*)\)$/.exec(expression);
  if (match) {
    const tags = stringArguments(match[1]!);
    if (!tags?.length) return unsupported(notes, `unsupported filter: ${expression}`);
    const children = tags.map((tag): FilterNode => ({ op: 'cmp', key: '$tag', cmp: 'tagged', value: tag.replace(/^#/, '') }));
    return { node: children.length === 1 ? children[0]! : { op: 'or', children }, supported: true };
  }

  match = /^([\w.$]+)\.contains\((.*)\)$/.exec(expression);
  if (match) {
    const key = basesKeyToWaffle(match[1]!);
    const value = oneStringArgument(match[2]!);
    if (!key || value === null || key === '$name' || key === '$ext' || key === '$updated') {
      return unsupported(notes, `unsupported filter: ${expression}`);
    }
    return { node: { op: 'cmp', key, cmp: 'contains', value }, supported: true };
  }

  match = /^([\w.$]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(expression);
  if (match) {
    const rawKey = match[1]!;
    const key = basesKeyToWaffle(rawKey);
    const cmp = CMP[match[2]!]!;
    if (!key) return unsupported(notes, `filter on ${rawKey} is unsupported`);
    if ((key === '$name' || key === '$ext') && cmp !== 'eq' && cmp !== 'ne') {
      return unsupported(notes, `${rawKey} supports only == and != in Waffle`);
    }
    const value = literal(match[3]!, filterKind(key, kinds));
    return value === undefined
      ? unsupported(notes, `unsupported value in filter: ${expression}`)
      : { node: { op: 'cmp', key, cmp, value }, supported: true };
  }

  return unsupported(notes, `unsupported filter: ${expression}`);
}

function comparisonToBases(node: Extract<FilterNode, { op: 'cmp' }>, kinds: PropertyTypes): string | null {
  if (node.key === '$tag' && node.cmp === 'tagged') return `file.hasTag(${quote(String(node.value))})`;
  if (node.key === '$folder' && node.cmp === 'inFolder') return `file.inFolder(${quote(String(node.value))})`;
  const key = waffleKeyToBases(node.key);
  if (!key) return null;
  if (node.cmp === 'contains') return `${key}.contains(${quote(String(node.value))})`;
  const op = OP[node.cmp];
  return op ? `${key} ${op} ${literalToBases(node.value, filterKind(node.key, kinds))}` : null;
}

function literal(raw: string, kind: PropertyTypeDecl['kind'] | undefined): string | number | boolean | undefined {
  const value = raw.trim();
  const dateCall = /^date\((.*)\)$/.exec(value);
  if (kind === 'date' && dateCall) {
    const dateText = oneStringArgument(dateCall[1]!);
    return dateText && !Number.isNaN(Date.parse(dateText)) ? Date.parse(dateText) : undefined;
  }
  const string = decodeQuoted(value);
  if (string !== null) {
    if (kind === 'date') return ISO_DATE.test(string) ? Date.parse(string) : undefined;
    return string;
  }
  if (kind === 'date') return ISO_DATE.test(value) ? Date.parse(value) : undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (!Number.isNaN(Number(value))) return Number(value);
  // Bases requires text literals to be quoted. Treat formulas/functions as
  // unsupported rather than misreading their source text as a literal.
  return undefined;
}

function literalToBases(value: unknown, kind: PropertyTypeDecl['kind'] | undefined): string {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (kind === 'date') return quote(new Date(value).toISOString().slice(0, 10));
    return String(value);
  }
  return quote(String(value));
}

function stringArguments(raw: string): string[] | null {
  const values: string[] = [];
  let rest = raw.trim();
  while (rest) {
    const match = /^("(?:\\.|[^"\\])*"|'(?:''|[^'])*')\s*(?:,\s*|$)/.exec(rest);
    if (!match) return null;
    const value = decodeQuoted(match[1]!);
    if (value === null) return null;
    values.push(value);
    rest = rest.slice(match[0].length);
  }
  return values;
}

const oneStringArgument = (raw: string): string | null => {
  const values = stringArguments(raw);
  return values?.length === 1 ? values[0]! : null;
};

function decodeQuoted(raw: string): string | null {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return null;
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return null;
}

function unsupported(notes: string[], message: string): FilterParseResult {
  notes.push(message);
  return { node: null, supported: false };
}

function unsupportedGroup(notes: string[], message: string): GroupParseResult {
  notes.push(message);
  return { groupBy: null, supported: false };
}

const quote = (value: string): string => JSON.stringify(value);
