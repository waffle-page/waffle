# Connector SDK & Store

Connectors bring external data into datasets or materialized topping files.
They are signed, sandboxed, open-source packages; the store is public
infrastructure. Design goal: Oura could build and publish the Oura connector
without talking to us. Contacts→CRM and Oura→Sleep Dashboard are the reference
flows in `15-connector-driven-experiences.md`.

## Package anatomy

```jsonc
// manifest.json — the entire trust surface
{
  "id": "com.oura.connector",
  "name": "Oura Ring",
  "version": "1.2.0",
  "apiVersion": ">=1.0 <2.0",
  "auth": "oauth2-pkce",                    // oauth2-pkce | oauth2-broker | apikey | none
  "network": ["api.ouraring.com"],          // fetch allowlist — nothing else resolves
  "writes": {
    "canonical":  ["health.sleep", "health.heart_rate"],
    "extensions": { "oura.readiness": { "date": "date", "score": "int" } }
  },
  "schedule": "daily",                      // manual | daily | realtime
  "templates": ["sleep-dashboard.dash"]     // bundled suggested dashboards
}
```

The eventual manifest also declares coarse, non-executable experience hints
and versioned recipe metadata. The trusted host matches them to an on-device
folder profile; connector code never receives folder/library context
(ADR-025). Freeze the exact manifest keys with the SDK implementation rather
than treating this illustrative manifest as its final schema.

Plus one bundled TypeScript ESM module implementing:

```ts
interface Connector {
  auth(ctx: AuthContext): Promise<void>;      // no-op for manual/csv
  pull(ctx: PullContext, since: Date): Promise<void>;  // calls ctx.write(...)
}
```

No native code, no Node APIs — one package runs identically on web, iOS, Android, desktop.

## Sandbox: capability model

Connector code runs in a Worker with no DOM and no DB handle. All I/O is RPC to the host, which enforces the manifest:

| Connector asks | Host enforces |
| --- | --- |
| `fetch(url)` | URL must match manifest `network` allowlist |
| `write(table, rows, {units})` | Only declared tables (canonical or namespaced extensions); types validated; units converted at ingest (see `06-schemas-and-units.md`); rows stamped with `source` |
| `secret(key)` | Tokens live in OS keychain / encrypted storage — never in the vault, never synced, never read back as plaintext |
| The library, notes, other datasets | **No API exists** |

The install prompt is generated from the manifest: *"Talks to api.ouraring.com · writes sleep & readiness · syncs daily · cannot see your library."*

## Auth models

- **oauth2-pkce**: fully client-side where the provider supports it; tokens in device keychain.
- **oauth2-broker**: providers requiring client secrets go through a minimal hosted token-exchange (Supabase edge function) that mints tokens and never sees data.
- **apikey / none**: keychain-stored key, or nothing (CSV, local pulls like Home Assistant).

## Store mechanics (Obsidian/Homebrew model)

- Public registry repo (`waffle-connectors`): publishing = PR adding a manifest that points at a tagged, hashed release.
- CI: permission lint, schema lint, bundle scan (no `eval`, size caps), api-version check. First submission gets human review; updates auto-merge with diff scan. Client verifies release hash on install.
- **Trust tiers**: verified publisher (domain-proven, app-store style) · community · sideload/dev-mode (any URL, loudly marked).
- SDK is MIT; registry and reviews are public. A hosted registry replaces the Git repo only when volume demands it.

## Templates: the onboarding contract

Because the manifest declares schema *and* bundles `.dash` templates, install → authorize → "Add Sleep Dashboard to Health/?" → a working dashboard topping appears. Zero-to-graph in three taps. For publishers, the template is their marketing surface.

## First-party dogfooding

Home Assistant, HealthKit, Oura, Contacts, CSV/file-import, and GoCardless
connectors are built as store packages that ship pre-installed or as
first-party reference packages. Built-ins eat the same API as third parties
(VS Code discipline) — by the time the store opens, the SDK has months of
production use.

## Topping-materializing connectors (ADR-018)

A third output mode beyond datasets: connectors that materialize **files** —
an address book becomes a folder of contact notes (notes-as-rows, docs/12).
Same manifest/sandbox/schedule machinery; the new contract is **field
ownership on a shared file**:

- The connector declares which frontmatter keys it owns (name, phone, email);
  sync is a field-level merge that never touches user-owned keys or the body
  (where meeting notes and wikilinks live).
- Identity: the source's stable ID stored in frontmatter — re-syncs match
  files even after renames.
- Deletions flag (`source_status: removed`), never delete — user annotations
  are sacred.
- A user soft-deleting a linked note records a source-entity suppression
  tombstone; subsequent pulls cannot resurrect it. Restore clears suppression;
  **Keep as Waffle contact** detaches source ownership.
- Direction starts one-way (source → Waffle); write-back is a later,
  per-field decision.

Contacts are the most sensitive personal dataset: this mode is local-vault
only, on-device, categorically excluded from catalog and community features.
First implementations: vCard import (one-shot, near-free), then macOS
Contacts (native shells) and Google People (OAuth broker). Calendar and
browser bookmarks want the same mode later.

Connector-owned fields are visibly linked/read-only in v1; editing them opens
the source application. The markdown body, Waffle tags/status/custom fields,
and backlink history remain user-owned. Stable source identity, idempotent
pulls, ambiguous multi-source matches, and the CRM recipe are specified in
docs/15.

## Later extensions of the same machinery

Renderer packs (custom layouts/widgets), link-extraction site adapters (how the community teaches Waffle to parse a specific store or API), and detail templates (docs/10) reuse the manifest + sandbox + store pipeline.
