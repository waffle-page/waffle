/**
 * Dev spine harness (reach it at ?dev) — seeds, benchmarks, and vault-engine
 * exercises for P0 steps 1–3. The library UI is the app's real face.
 */
import { useEffect, useRef, useState } from 'react';
import { scanVault, updateFrontmatter, type ScanResult } from '@waffle/core';
import { getVaultFs, platform, platformReady } from './platform/instance';
import { runThumbnailer } from './thumbs/thumbnailer';
import { seed } from './dev/seed';
import { runBench, type BenchResult } from './dev/bench';
import { createFixtureVault } from './dev/fixture';

interface Status {
  storage: string;
  sqliteVersion: string;
  schemaVersion: number;
  toppingCount: number;
  warning?: string;
}

interface VaultRow {
  id: string;
  type: string;
  title: string;
  folder: string;
  props: number;
  tags: string | null;
}

const card: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '1rem 1.25rem',
  marginBottom: '1rem',
};
const btn: React.CSSProperties = { padding: '0.45rem 0.9rem' };
const dim: React.CSSProperties = { color: 'var(--text-dim)' };

export function DevHarness() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bench, setBench] = useState<BenchResult[] | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [vaultRows, setVaultRows] = useState<VaultRow[]>([]);
  const [watching, setWatching] = useState(false);
  const [lastEvents, setLastEvents] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchHits, setSearchHits] = useState<string[] | null>(null);
  const unwatchRef = useRef<(() => void) | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshCount = async (): Promise<number> => {
    const rows = await platform.db.exec<{ c: number }>('SELECT COUNT(*) AS c FROM toppings');
    return rows[0]?.c ?? 0;
  };

  const refreshVaultRows = async (): Promise<void> => {
    setVaultRows(
      await platform.db.exec<VaultRow>(`
        SELECT t.id, t.type, t.title, f.path AS folder,
          (SELECT COUNT(*) FROM properties p WHERE p.topping_id = t.id) AS props,
          (SELECT GROUP_CONCAT(tg.name, ' ') FROM topping_tags tt JOIN tags tg ON tg.id = tt.tag_id
            WHERE tt.topping_id = t.id) AS tags
        FROM toppings t JOIN folders f ON f.id = t.folder_id
        WHERE t.source = 'vault' AND t.deleted_at IS NULL
        ORDER BY f.path, t.title`),
    );
  };

  useEffect(() => {
    (async () => {
      try {
        const s = await platformReady;
        setStatus({ ...s, toppingCount: await refreshCount() });
        await refreshVaultRows();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const guard = async (label: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      setBusy(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const doScan = async (): Promise<void> => {
    const fs = await getVaultFs();
    const result = await scanVault(platform.db, fs);
    await runThumbnailer(platform.db, fs);
    setScan(result);
    const count = await refreshCount();
    setStatus((s) => s && { ...s, toppingCount: count });
    await refreshVaultRows();
  };

  const onSeed = () =>
    guard('seeding…', async () => {
      setBench(null);
      const ms = await seed(platform.db, (label) => setBusy(`seeding: ${label}`));
      const count = await refreshCount();
      setStatus((s) => s && { ...s, toppingCount: count });
      setBusy(`seeded in ${(ms / 1000).toFixed(1)}s`);
      await refreshVaultRows();
    });

  const onClearSeed = () =>
    guard('clearing seed data…', async () => {
      // The seeder's inverse: everything marked source='seed' + the Seed Library
      // folder subtree ('fseed') + views hung on those folders. Vault rows untouched.
      await platform.db.transaction(async () => {
        await platform.db.exec(`DELETE FROM toppings_fts WHERE topping_id IN (SELECT id FROM toppings WHERE source = 'seed')`);
        await platform.db.exec(`DELETE FROM properties WHERE topping_id IN (SELECT id FROM toppings WHERE source = 'seed')`);
        await platform.db.exec(`DELETE FROM topping_tags WHERE topping_id IN (SELECT id FROM toppings WHERE source = 'seed')`);
        await platform.db.exec(`DELETE FROM view_order WHERE view_id IN (SELECT id FROM views WHERE folder_id IN (SELECT id FROM folders WHERE id = 'fseed' OR parent_id = 'fseed'))`);
        await platform.db.exec(`DELETE FROM views WHERE folder_id IN (SELECT id FROM folders WHERE id = 'fseed' OR parent_id = 'fseed')`);
        await platform.db.exec(`DELETE FROM toppings WHERE source = 'seed'`);
        await platform.db.exec(`DELETE FROM folders WHERE parent_id = 'fseed'`);
        await platform.db.exec(`DELETE FROM folders WHERE id = 'fseed'`);
      });
      const count = await refreshCount();
      setStatus((s) => s && { ...s, toppingCount: count });
      setBusy('seed data cleared');
      await refreshVaultRows();
    });

  const onBench = () => guard('benchmarking…', async () => setBench(await runBench(platform.db)));

  const onFixture = () =>
    guard('writing fixture vault…', async () => {
      const n = await createFixtureVault(await getVaultFs());
      setBusy(`fixture vault: ${n} files written — now scan`);
    });

  const onScan = () => guard('scanning vault…', doScan);

  const onWatchToggle = async (): Promise<void> => {
    if (watching) {
      unwatchRef.current?.();
      unwatchRef.current = null;
      setWatching(false);
      return;
    }
    const fs = await getVaultFs();
    unwatchRef.current = fs.watch((events) => {
      setLastEvents(events.map((e) => `${e.kind}:${e.path}`).join('  '));
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void doScan(), 400);
    });
    setWatching(true);
  };

  const onExternalEdit = () =>
    guard('editing pasta-alla-norma.md…', async () => {
      const fs = await getVaultFs();
      const path = 'Recipes/pasta-alla-norma.md';
      const text = new TextDecoder().decode(await fs.read(path));
      await fs.write(path, new TextEncoder().encode(text + `\nEdited externally at ${new Date().toISOString()}.\n`));
      setBusy('external edit written — watcher (if on) will pick it up');
    });

  const onExternalPropertyEdit = () =>
    guard('changing pasta rating outside the index…', async () => {
      const fs = await getVaultFs();
      const path = 'Recipes/pasta-alla-norma.md';
      const text = new TextDecoder().decode(await fs.read(path));
      const rating = /^rating:\s*9\.25$/m.test(text) ? 9.5 : 9.25;
      // Deliberately do not rescan: this models Obsidian changing the canonical
      // file while another Waffle tab still holds an undo receipt.
      await fs.write(path, new TextEncoder().encode(updateFrontmatter(text, { rating })));
      setBusy(`external rating ${rating} written — do not scan before testing conflict freeze`);
    });

  const onMove = () =>
    guard('moving tiramisu…', async () => {
      const fs = await getVaultFs();
      const nested = 'Recipes/desserts/tiramisu.md';
      const top = 'Recipes/tiramisu.md';
      const from = await fs.read(nested).then(() => nested).catch(() => top);
      const to = from === nested ? top : nested;
      await fs.move(from, to);
      setBusy(`moved ${from} → ${to} — rescan and check the id stays`);
    });

  const onSearch = async (q: string): Promise<void> => {
    setSearch(q);
    if (!q.trim()) {
      setSearchHits(null);
      return;
    }
    const rows = await platform.db.exec<{ title: string }>(
      `SELECT t.title FROM toppings_fts f JOIN toppings t ON t.id = f.topping_id
       WHERE toppings_fts MATCH ? AND t.source = 'vault' LIMIT 20`,
      [q.trim() + '*'],
    );
    setSearchHits(rows.map((r) => r.title));
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ fontSize: '1.4rem' }}>🧇 Waffle — dev spine</h1>
      <p style={dim}>
        P0 steps 1–3 harness. <a href="/" style={{ color: 'var(--accent-ink)' }}>← back to the library</a>
      </p>

      <div style={card}>
        {status ? (
          <table style={{ borderSpacing: '0 2px' }}>
            <tbody>
              <tr><td style={{ ...dim, paddingRight: 16 }}>storage</td><td>{status.storage}{status.storage === 'memory' && ' ⚠️ no persistence'}</td></tr>
              <tr><td style={{ ...dim, paddingRight: 16 }}>sqlite</td><td>{status.sqliteVersion}</td></tr>
              <tr><td style={{ ...dim, paddingRight: 16 }}>schema</td><td>v{status.schemaVersion}</td></tr>
              <tr><td style={{ ...dim, paddingRight: 16 }}>toppings</td><td>{status.toppingCount.toLocaleString()}</td></tr>
            </tbody>
          </table>
        ) : (
          <span>opening database…</span>
        )}
        {status?.warning && <p style={{ color: 'var(--ink-peach)' }}>{status.warning}</p>}
      </div>

      <div style={card}>
        <strong>Benchmark (step 2)</strong>
        <div style={{ display: 'flex', gap: 8, margin: '0.6rem 0' }}>
          <button style={btn} onClick={onSeed} disabled={!status}>Seed 20,000 toppings</button>
          <button style={btn} onClick={onClearSeed} disabled={!status}>Clear seed data</button>
          <button style={btn} onClick={onBench} disabled={!status || !status.toppingCount}>Run benchmark</button>
        </div>
        {bench && (
          <table style={{ width: '100%', borderSpacing: '0 4px' }}>
            <thead><tr style={{ ...dim, textAlign: 'left' }}><th>query</th><th style={{ textAlign: 'right' }}>median</th><th style={{ textAlign: 'right' }}>rows</th></tr></thead>
            <tbody>
              {bench.map((b) => (
                <tr key={b.name}>
                  <td>{b.name}</td>
                  <td style={{ textAlign: 'right', color: b.medianMs <= 20 ? 'var(--ink-mint)' : 'var(--ink-peach)' }}>{b.medianMs} ms</td>
                  <td style={{ textAlign: 'right' }}>{b.rows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={card}>
        <strong>Vault engine (step 3)</strong> <span style={dim}>— OPFS-backed vault</span>
        <div style={{ display: 'flex', gap: 8, margin: '0.6rem 0', flexWrap: 'wrap' }}>
          <button style={btn} onClick={onFixture} disabled={!status}>Create fixture vault</button>
          <button style={btn} onClick={onScan} disabled={!status}>Scan vault</button>
          <button style={btn} onClick={() => void onWatchToggle()} disabled={!status}>{watching ? '● Watching (stop)' : 'Watch changes'}</button>
          <button style={btn} onClick={onExternalEdit} disabled={!status}>Simulate external edit</button>
          <button style={btn} onClick={onExternalPropertyEdit} disabled={!status}>Simulate property conflict</button>
          <button style={btn} onClick={onMove} disabled={!status}>Move tiramisu</button>
        </div>
        {scan && (
          <p style={{ margin: '0.4rem 0' }}>
            scan: {scan.files} files · {scan.folders} folders · <span style={{ color: 'var(--ink-mint)' }}>+{scan.added} added</span> · {scan.updated} updated · {scan.moved} moved · {scan.tombstoned} tombstoned · {scan.unchanged} unchanged · {scan.ms} ms
          </p>
        )}
        {lastEvents && <p style={{ ...dim, margin: '0.4rem 0' }}>watch: {lastEvents}</p>}

        <input
          value={search}
          onChange={(e) => void onSearch(e.target.value)}
          placeholder="full-text search the vault…"
          style={{ width: '100%', padding: '0.4rem 0.6rem', margin: '0.4rem 0', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxSizing: 'border-box' }}
        />
        {searchHits && <p style={dim}>{searchHits.length ? searchHits.join(' · ') : 'no hits'}</p>}

        {vaultRows.length > 0 && (
          <table style={{ width: '100%', borderSpacing: '0 3px', fontSize: '0.85rem' }}>
            <thead><tr style={{ ...dim, textAlign: 'left' }}><th>folder</th><th>title</th><th>type</th><th>props</th><th>tags</th><th>id</th></tr></thead>
            <tbody>
              {vaultRows.map((r) => (
                <tr key={r.id}>
                  <td style={dim}>{r.folder}</td>
                  <td>{r.title}</td>
                  <td>{r.type}</td>
                  <td>{r.props}</td>
                  <td style={dim}>{r.tags ?? ''}</td>
                  <td style={{ ...dim, fontFamily: 'monospace' }}>{r.id.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {busy && <p style={{ color: 'var(--ink-periwinkle)' }}>{busy}</p>}
      {error && <pre style={{ color: 'var(--ink-blush)', whiteSpace: 'pre-wrap' }}>{error}</pre>}
    </div>
  );
}
