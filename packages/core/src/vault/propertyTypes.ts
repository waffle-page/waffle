/**
 * Vault-level property-type declarations — Obsidian's `types.json` pattern.
 * YAML scalars can't express every kind (a select is just a string, money just
 * a number), so the vault carries a key → kind map at `.waffle/properties.json`.
 * Files-canonical like everything else: the scanner reads it at scan time, the
 * table UI writes it when a column is created. Undeclared keys fall back to
 * value inference (frontmatter.ts), so a plain Obsidian vault needs no file.
 */
import type { PropertyValue, VaultFs } from '../types';

/** Declaration-backed kinds. `unsupported` exists only as an inference carrier. */
export type PropertyTypeKind = Exclude<PropertyValue['kind'], 'unsupported'>;

export interface PropertyTypeDecl {
  kind: PropertyTypeKind;
  /** money only: ISO 4217; frontmatter stores the bare amount. */
  currency?: string;
}

export type PropertyTypes = Record<string, PropertyTypeDecl>;

const FILE = '.waffle/properties.json';

const KINDS = new Set<PropertyTypeKind>(['text', 'number', 'money', 'duration', 'date', 'coords', 'select', 'url', 'checkbox', 'list']);

export async function loadPropertyTypes(fs: VaultFs): Promise<PropertyTypes> {
  try {
    const raw = JSON.parse(new TextDecoder().decode(await fs.read(FILE))) as { keys?: Record<string, PropertyTypeDecl> };
    const types: PropertyTypes = {};
    for (const [key, decl] of Object.entries(raw.keys ?? {})) {
      if (decl && KINDS.has(decl.kind)) types[key] = decl;
    }
    return types;
  } catch {
    return {}; // no file, or unreadable JSON → inference-only vault
  }
}

export async function savePropertyTypes(fs: VaultFs, types: PropertyTypes): Promise<void> {
  const json = JSON.stringify({ version: 1, keys: types }, null, 2) + '\n';
  await fs.write(FILE, new TextEncoder().encode(json));
}
