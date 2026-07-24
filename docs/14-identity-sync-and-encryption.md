# Identity, Sync, Encryption & Restore

The pre-implementation contract for Supabase identity, managed personal sync,
encrypted collaboration, quotas, and new-device recovery. It extends ADR-004
without creating another canonical content model.

## Four explicit privacy states

| State | Account | Canonical representation | Cloud state |
| --- | --- | --- | --- |
| **On this device** | No | Vault files | None |
| **Personal Sync** | Yes | Vault files remain canonical | End-to-end encrypted replica/change transport |
| **Shared folder** | Yes (invite-link bootstrap allowed) | Server-homed encrypted file/object state | Authoritative ciphertext + local decrypted cache |
| **Published** | Yes | Private/shared source remains canonical | Deliberate public read-only projection |

Accountless use is permanent and first-class. First launch has no registration
wall. Signing in does not upload a byte; **Sync**, **Share**, and **Publish**
are separate explicit ceremonies.

Supabase Auth proves account/session identity. RLS restricts which ciphertext
rows or objects a session may request. Neither grants Supabase plaintext access:
authorization is defense in depth; client-held encryption keys are the privacy
boundary.

When sharing exists, navigation projects these states in plain language:

- **Shared with me**: folders owned by another account where this member has a
  grant.
- **Shared with others**: folders this account/workspace owns and has shared.
- Published links are managed separately from collaboration because publishing
  creates a public projection, not another member grant.

These destinations appear when relevant rather than permanently cluttering an
accountless/local-only shell. They are query projections over identity/grants,
not special folder storage models.

## Durable identity is a gate, not a later migration

The v1 scanner currently derives folder IDs from paths and creates topping
UUIDs in the disposable index. That is adequate for the single-device spine
but cannot support reconstruction, Lists, duplication, publishing, or sharing.
Before any network feature depends on identity:

- A vault has a durable random `vault_id`.
- Folder IDs survive renames and moves.
- Topping IDs survive edits, moves, renames, and complete index reconstruction.
- IDs live in portable vault metadata under `.waffle/`; paths and content
  hashes are matching/recovery evidence, never identity.
- Duplicating a topping creates a new ID; optional `copied_from` provenance is
  not identity.
- Sharing/publishing maps the same durable identity into the server envelope.
- Commands carry stable operation IDs, actor/device IDs, revisions, and
  tombstones so retries are idempotent.

The exact `.waffle/` file layout and offline-rename ambiguity procedure must be
settled in the implementation ADR before changing the scanner.

### Topping identity and content-entity identity are different

A topping is one user-owned saved object; duplicating it creates another
topping ID. A content entity is the real-world thing described by one or many
source claims and external identifiers. Personal status and ratings attach to
the latter.

- Raw URLs remain byte-for-byte user content and are never rewritten by
  normalization.
- Deterministic URL aliases rebuild locally and currently produce only a
  disposable effective candidate bridge. Provider identifiers are sourced
  claims, not permanent identity.
- The future private entity ID is opaque and durable in encrypted, portable
  vault metadata. The exact `.waffle/` entity/identifier/claim and redirect
  representation requires its implementation ADR; SQLite remains a disposable
  projection.
- A private entity may map to a canonical entity in the separate proprietary
  Catalog product, but that mapping does not upload private evidence or
  rewrite the private ID out of history. Catalog contributions never use the
  private ID as a stable public contributor identifier.
- Devices must run versioned normalization/projection rules. A rule upgrade is
  an explicit, idempotent migration rather than an invisible change during
  rendering.
- Private entity claims and personal marks join the encrypted personal
  replica. A shared folder never exposes one member's private status/rating or
  private evidence to another.
- Conflicting marks discovered while joining aliases remain recoverable and
  require an explicit merge policy; last-write-wins must not silently destroy
  either record.

Deterministic same-provider sub-slice A is complete with the bounded Google
Maps acceptance case. Durable URL sub-slice B waits for the generic portable
private entity/identifier/claim substrate; cross-source resolution belongs to
the separate Catalog product. See ADR-027 and
`docs/16-catalog-product-and-entity-graph.md`.

### Duplication and large local libraries

Waffle imposes no arbitrary topping-count limit on a local vault. Performance
budgets and available disk are the constraints; managed-service billing remains
byte-based. Internal object/operation safeguards may protect the service
without becoming a user-facing per-topping meter.

Duplicating one topping or a selected set creates new durable IDs and ordinary
canonical files; copies never alias the originals. A request to duplicate tens
of thousands of items is a visible long-running operation, not a synchronous
UI gesture or one giant in-memory transaction:

- Preview item count, estimated bytes, destination, and name collisions before
  starting; require confirmation beyond a measured large-operation threshold.
- Write each destination file, `rescanFile` it, and requery at bounded batch
  boundaries. Never bulk-insert the SQLite mirror.
- Report progress and truthful partial completion; cancellation stops future
  copies and does not erase completed files.
- Persist an operation manifest/receipt so cleanup can soft-delete exactly the
  created IDs. Do not place an unbounded 50,000-file inverse inside session
  undo history.

## End-to-end encrypted personal and shared state

Shared encryption is feasible and required. The server stores/routs ciphertext;
member devices decrypt and query through their local SQLite cache.

Required properties:

- Every device has an identity key pair. Native shells keep it non-exportable
  in the OS keystore where possible; the PWA uses WebCrypto-wrapped storage
  with its weaker browser-profile/reinstallation threat model stated plainly.
- Content uses authenticated encryption with unique nonces; identifiers and
  revisions needed for routing are authenticated as associated data.
- A folder/key epoch is distributed only to granted member devices using an
  audited public-key/group-key protocol. Membership changes create a new epoch.
- Attachments and private thumbnails are encrypted too. Public preview images
  exist only after the separate Publish ceremony.
- Search, filters, renderer inference, and folder-context ranking execute on
  decrypted local state. The server receives no plaintext search index.
- RLS, TLS, rate limits, and audit trails remain mandatory even though they are
  not substitutes for end-to-end encryption.
- Cryptography is a dependency-budget exception: use a maintained, audited
  implementation of established primitives/protocols; never implement a novel
  construction in application code.

Removing a member stops access to future epochs after rekeying. It cannot erase
plaintext or keys already downloaded to that member's devices; the UI must say
this honestly. Envelope encryption may allow small per-object data keys to be
rewrapped rather than re-encrypting hundreds of gigabytes, but the exact group
protocol and rekey design are pre-implementation decisions.

### Invitations and recovery

Registered-member invitations wrap access to the recipient's device/account
keys. A pre-account invite link may bootstrap a one-time secret, but the secret
must not be sent in HTTP request data or exposed to unfurl crawlers. The exact
link-fragment/claim protocol needs threat modelling before code.

Account recovery and encryption recovery are separate:

- Resetting a Supabase password must not silently grant access to encryption
  keys.
- A new device is approved by an existing device or a user-held recovery
  secret/key backup.
- The product must explain the consequence of losing every authorized device
  and recovery secret.
- Device removal triggers key rotation for future writes.

## Personal Sync preserves the file-first loop

Managed personal sync is transport/replication, not a third source of truth:

```text
local edit
  → write canonical vault file
  → targeted rescan
  → enqueue encrypted revision
  → upload/reconcile
  → other device decrypts to its canonical vault file
  → targeted rescan
```

Multiple devices introduce writers to a class previously described as
single-writer. Initial conflict policy is file-level versions plus explicit
conflict copies, never silent overwrite. Topping-level LWW remains the first
shared-folder collaboration policy; real-time co-editing is a separate later
decision.

## Storage boundary: library sync, not a Drive clone

Managed Sync is not a promise to host arbitrary disk archives. Local vaults may
contain files of any size the user's filesystem accepts; the cloud service may
apply a clearly disclosed per-file ceiling and plan quota without restricting
the local vault.

- Notes, links, Lists, dashboards, declarations, views, metadata, and ordinary
  attachments are the primary synchronized corpus.
- An oversized file remains **Local only**, with stable identity, metadata, and
  thumbnail available to the library. The UI never implies it is protected by
  Waffle Sync.
- Existing Drive/iCloud/Dropbox objects should normally be referenced through
  links or future provider connectors rather than copied into Waffle storage.
- Object/operation safeguards may exist internally, but cloud bytes remain the
  understandable customer-facing measure.
- Exact limits are private commercial policy chosen from observed usage/costs,
  not frozen into this engineering contract.

Waffle-internal on-demand attachment hydration is compatible with this
architecture. A true Google Drive clone is not: transparent Finder/Explorer
placeholder files would require platform-specific filesystem-provider
extensions, arbitrary large-object/version infrastructure, and semantics for
every other application opening those placeholders. That is a separate product
decision, not an incidental Sync feature.

## New-device restore: useful in minutes, complete later

Even within bounded service tiers, a large vault must not require every byte
before Waffle opens. Restore optimizes **time to a trustworthy library**, not
time to a full byte-for-byte copy. A 200 GB corpus is a robustness/stress case
for self-hosted, bring-your-own-sync, or exceptional vaults — not the managed
service's target allowance.

```mermaid
flowchart LR
    A[Sign in] --> K[Approve device or recover keys]
    K --> M[Download encrypted manifest + revision head]
    M --> I[Decrypt metadata/index accelerator locally]
    I --> U[Library becomes browsable]
    U --> T[Hydrate notes + thumbnails + recent/pinned items]
    T --> O[Fetch large files on demand or in background]
    O --> V[Verify hashes and reconcile scanner]
```

Restore order:

1. Vault list, size, last complete sync, device/revision head.
2. Device approval/recovery and encrypted vault manifest.
3. Property declarations, views/recipes, grants, tombstones, and a disposable
   encrypted index snapshot or equivalent metadata accelerator.
4. Small canonical text objects (`.md`, `.url`, `.list`, `.dash`) and encrypted
   thumbnails.
5. Recent, pinned, and user-selected offline attachments.
6. Remaining eligible attachments on demand or as a resumable background
   download. Oversized/local-only content is identified, not requested.

The manifest/index accelerator is derived and disposable; canonical file bytes
and their authenticated revisions remain sufficient to rebuild it.

### Platform experience

- **Mobile defaults to optimized storage.** The complete synchronized library
  is visible; eligible attachments hydrate on open. Users can mark folders or
  items **Keep offline** and set a storage budget.
- **Desktop initially restores every eligible synchronized file** into a
  complete Finder/Obsidian-compatible vault, after a disk-space check. A later
  optimized mode may keep attachments in Waffle's managed cache, but must not
  create misleading ordinary placeholders that another app mistakes for
  complete content.
- Every transfer is resumable, content-hash verified, and safe across process
  termination, network changes, and device sleep. Wi-Fi/power preferences and
  an explicit byte/time estimate are required for large restores.
- The UI distinguishes **available locally**, **remote-only**, **downloading**,
  **failed**, and **deleted**. Cache eviction is never a deletion event and
  must never cause the vault scanner to tombstone a remote-only topping.
- A consistent manifest snapshot is followed by ordered deltas so edits made
  during a long restore are not missed.
- “Last fully synced” and “local changes waiting” are visible facts. A new
  device can recover only revisions that actually reached the service.

Encrypted thumbnails are restore accelerators, not canonical assets. They may
be stored without consuming the user's advertised quota, but their bandwidth
and operational cost still inform private pricing.

## Quota and lapse behavior

Local libraries are not metered by Waffle. Managed service pricing uses cloud
bytes as the simple customer-facing measure; topping count, row count,
operations, and bandwidth remain internal capacity/abuse signals.

When a quota is exceeded:

- Local editing continues.
- New uploads pause; existing cloud data remains downloadable.
- The UI identifies unsynced devices/revisions and says local files are safe.
- Upgrade/cleanup is offered; nothing local is deleted.
- Lapse/retention and cloud-trash expiry require advance notice and an export
  path. Exact commercial thresholds and grace periods live outside the public
  engineering repository.

Shared-folder storage is charged to its owner/workspace, never duplicated
against every collaborator.

## Pre-implementation ADR gate

Before enabling Sync or Share, settle and threat-model:

1. Durable `.waffle/` vault/folder/topping identity representation and
   migration; the separate private content-entity/claim representation must be
   settled before Sync transports it.
2. Audited crypto implementation and cross-platform key storage.
3. Device enrollment, key backup/recovery, invite claims, and metadata leakage.
4. Folder/key hierarchy, membership epochs, revocation, and lazy rewrapping.
5. Version/conflict protocol, idempotent operations, and restore snapshots.
6. Remote-only VFS semantics and scanner integration.
7. Trash/version retention and quota accounting.
8. Security review, interoperability vectors, corruption drills, lost-device
   drills, and an interrupted large-manifest/selective-restore acceptance
   procedure.

Reference designs, not implementation permission:

- [RFC 9420 — Messaging Layer Security](https://www.rfc-editor.org/rfc/rfc9420.html)
  for group membership epochs, forward secrecy, and post-compromise security.
- [RFC 9180 — Hybrid Public Key Encryption](https://www.rfc-editor.org/rfc/rfc9180.html)
  for recipient public-key key encapsulation.
- [RFC 5116 — Authenticated Encryption](https://www.rfc-editor.org/rfc/rfc5116.html)
  for AEAD and nonce requirements.
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
  for the RLS layer beneath client-side encryption.
