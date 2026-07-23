/**
 * Canonical table clipboard boundary.
 *
 * Display formatting is locale-facing; clipboard values must remain parseable
 * by Waffle and spreadsheet applications. TSV quoting is deliberately absent
 * in v1, so tabs/newlines inside a value remain an explicit recipe limitation.
 */
import type { PropertyValue } from '@waffle/core';
import { formatProperty } from './PropertyCell';

export function parseClipboardTsv(text: string): string[][] {
  const lines = text.replace(/\r/g, '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.length === 0 || lines.every((line) => line === '') ? [] : lines.map((line) => line.split('\t'));
}

export function propertyToTsv(value: PropertyValue): string {
  switch (value.kind) {
    case 'text': case 'url': return value.value;
    case 'select': return value.option;
    case 'number': return String(value.value);
    case 'checkbox': return value.value ? 'true' : 'false';
    case 'money': return String(value.amount);
    case 'date': return value.iso;
    case 'list': return JSON.stringify(value.values);
    case 'unsupported': return JSON.stringify(value.value) ?? '';
    default: return formatProperty(value);
  }
}
