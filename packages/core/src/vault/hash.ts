/** Stable hashes shared by vault identity projections. */

/** SHA-256 hex of file bytes. WebCrypto — available in browsers, workers, Node 18+. */
export async function contentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Deterministic folder id from its vault-relative path (v1: folder renames = new identity). */
export async function folderIdFor(path: string): Promise<string> {
  if (path === '') return 'f_root';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
  return 'f_' + [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
