/**
 * Waffle core domain types. Runtime-free on purpose: everything here can be
 * imported by any package (web, mobile, desktop, workers, tests) with no side effects.
 */

// ── Library ──────────────────────────────────────────────────────────────────

export type ToppingType = 'note' | 'link' | 'file' | 'dash';

export interface Topping {
  id: string;
  type: ToppingType;
  folderId: string;
  title: string;
  /**
   * note/file/dash: vault-relative path. link: the carrier `.url` file's
   * vault path for vault-scanned links (the URL itself lives in the `url`
   * property — see scanner.writeExtras); non-vault rows may hold a URL here.
   */
  contentRef: string | null;
  thumbRef: string | null;
  blurhash: string | null;
  properties: Record<string, PropertyValue>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** JSON-compatible YAML value retained for display without scalar coercion. */
export type PropertyJsonValue =
  | string
  | number
  | boolean
  | null
  | PropertyJsonValue[]
  | { [key: string]: PropertyJsonValue };

export type PropertyValue =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'money'; amount: number; currency: string }      // ISO 4217
  | { kind: 'duration'; seconds: number }
  | { kind: 'date'; iso: string }                            // ISO 8601
  | { kind: 'coords'; lat: number; lng: number }             // WGS84
  | { kind: 'select'; option: string }
  | { kind: 'url'; value: string }
  | { kind: 'checkbox'; value: boolean }
  /** Obsidian List / `multitext`: YAML sequence, edited as an unambiguous JSON array. */
  | { kind: 'list'; values: Array<string | number | boolean | null> }
  /**
   * Read-only safety carrier for JSON-compatible YAML maps/nested sequences.
   * Never declaration-backed or authorable: it prevents a structure Waffle
   * cannot model from masquerading as editable scalar text.
   */
  | { kind: 'unsupported'; value: PropertyJsonValue };

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  home: 'local' | 'server';                                  // ADR-004
  ownerId: string | null;
}

// ── Views (ADR-006) ──────────────────────────────────────────────────────────
// The LIVE view shapes are app/UI-level, one per concept (docs/08):
//   apps/web/src/library/queries.ts → FolderView / ViewCfg  (persisted state)
//   packages/ui/src/layouts.tsx     → LayoutEntry / LayoutProps (renderer registry)
// Core carries only the filter AST, shared by view configs, the SQL compiler,
// and the Obsidian sync.

export type FilterNode =
  | { op: 'and' | 'or'; children: FilterNode[] }
  | { op: 'cmp'; key: string; cmp: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'tagged'; value: unknown };

// ── Dashboards ───────────────────────────────────────────────────────────────

export interface DashDoc {
  widgets: WidgetSpec[];
}
export interface WidgetSpec {
  renderer: string;                                          // registry key
  query: string;                                             // SQL over datasets + library
  title?: string;
}

// ── Sharing (ADR-005) ────────────────────────────────────────────────────────

export interface Grant {
  folderId: string;
  grantee: { kind: 'user'; userId: string } | { kind: 'link'; token: string };
  role: 'viewer' | 'editor';
}

// ── Connectors (ADR-008..011) ────────────────────────────────────────────────

export interface ConnectorManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  auth: 'oauth2-pkce' | 'oauth2-broker' | 'apikey' | 'none';
  network: string[];                                         // fetch allowlist
  writes: {
    canonical: string[];                                     // catalog table names
    extensions?: Record<string, Record<string, string>>;     // name → column: type
  };
  schedule: 'manual' | 'daily' | 'realtime';
  templates?: string[];                                      // bundled .dash files
}

export interface Connector {
  auth(ctx: AuthContext): Promise<void>;
  pull(ctx: PullContext, since: Date | null): Promise<void>;
}

/** The entire capability surface available inside the sandbox. Nothing else exists. */
export interface PullContext {
  fetch(url: string, init?: unknown): Promise<unknown>;      // host-enforced allowlist
  write(table: string, rows: Record<string, unknown>[], opts?: { units?: Record<string, string> }): Promise<void>; // UCUM ingest conversion
  secret(key: string): Promise<string | null>;               // keychain-backed
  log(msg: string): void;
}
export interface AuthContext {
  requestOAuth(params: Record<string, string>): Promise<void>;
  storeSecret(key: string, value: string): Promise<void>;
}

// ── Platform adapters ────────────────────────────────────────────────────────
// The ONLY seam where platform-specific code lives. Everything above them is
// pure TS. Web implements these with OPFS/FS-Access/wasm; Capacitor and Tauri
// swap in native implementations without the app noticing.

export interface PlatformAdapters {
  /**
   * Target contract for the native shells (one fixed vault root). The web app
   * routes vault IO through a mutable active-vault seam instead
   * (apps/web/src/platform/instance.ts → getVaultFs) until a vault manager
   * exists; its platform.fs is a loud stub.
   */
  fs: VaultFs;
  db: SqlDriver;
  net: { fetch(url: string, init?: unknown): Promise<unknown> }; // CORS-free on native shells
  share?: { onIncoming(cb: (item: IncomingShare) => void): void };
}

export interface VaultFs {
  pickRoot(): Promise<string>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(dir: string): Promise<Array<{ path: string; isDir: boolean; mtime: number; size: number }>>;
  watch(cb: (events: FsEvent[]) => void): () => void;
}
export interface FsEvent { kind: 'create' | 'modify' | 'delete' | 'rename'; path: string; oldPath?: string }

export interface SqlDriver {
  /** Run one SQL statement; resolves to result rows as plain objects. */
  exec<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Run `fn` inside BEGIN…COMMIT (ROLLBACK on throw). Drivers guarantee the
   * transaction holds an exclusive lock: no other exec interleaves.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export interface IncomingShare { url?: string; files?: Blob[]; text?: string }
