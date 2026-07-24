export * from './types';
export { MIGRATIONS } from './db/migrations';
export { migrate } from './db/migrate';
export { scanVault, rescanFile, type ScanResult } from './vault/scanner';
export { parseNote, toEavColumns, fromEavColumns, propertyToYaml, updateFrontmatter, type ParsedNote } from './vault/frontmatter';
export { loadPropertyTypes, savePropertyTypes, type PropertyTypes, type PropertyTypeDecl, type PropertyTypeKind } from './vault/propertyTypes';
export { contentHash, folderIdFor } from './vault/hash';
export {
  URL_IDENTITY_VERSION,
  rawUrlAliasKey,
  resolveUrlIdentity,
  urlEntityKey,
  type UrlIdentity,
  type UrlIdentityEvidence,
} from './vault/urlIdentity';
