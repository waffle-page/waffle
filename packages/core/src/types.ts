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
  /** note/file/dash: vault-relative path · link: URL */
  contentRef: string | null;
  thumbRef: string | null;
  blurhash: string | null;
  properties: Record<string, PropertyValue>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type PropertyValue =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'money'; amount: number; currency: string }      // ISO 4217
  | { kind: 'duration'; seconds: number }
  | { kind: 'date'; iso: string }                            // ISO 8601
  | { kind: 'coords'; lat: number; lng: number }             // WGS84
  | { kind: 'select'; option: string }
  | { kind: 'url'; value: string }
  | { kind: 'checkbox'; value: boolean };

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  home: 'local' | 'server';                                  // ADR-004
  ownerId: string | null;
}

// ── Views (ADR-006) ──────────────────────────────────────────────────────────

export interface View {
  id: string;
  folderId: string | null;                                   // null ⇒ smart folder
  name: string;
  layout: string;                                            // renderer registry key
  config: ViewConfig;
  kind: 'shared' | 'personal';
  isDefault: boolean;
}

export interface ViewConfig {
  filters: FilterNode | null;
  sorts: Array<{ key: string; dir: 'asc' | 'desc' }>;
  groupBy: string | null;
  visibleProps: string[];
  subtree: boolean;
}

export type FilterNode =
  | { op: 'and' | 'or'; children: FilterNode[] }
  | { op: 'cmp'; key: string; cmp: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'tagged'; value: unknown };

/** Every layout/widget: (query results → props) → component. One file per new visualization. */
export interface Renderer<Row = unknown, Props = unknown> {
  key: string;                                               // 'masonry' | 'table' | 'map' | 'body-map' | ...
  toProps(rows: Row[], view: View): Props;
  /** Component reference resolved by the UI package; core stays framework-free. */
  componentKey: string;
}

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
