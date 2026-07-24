/**
 * Deterministic URL identity — QUARANTINE MODULE (ADR-026).
 *
 * Invariants:
 *  - The saved URL is evidence, never rewritten by normalization.
 *  - Scan-time resolution is pure and offline.
 *  - Generic rules remove only known tracking parameters. Unknown parameters
 *    and fragments may carry identity and therefore survive.
 *  - Provider identity requires documented, high-confidence evidence.
 *  - The version changes whenever output for an existing input may change.
 *
 * Non-goals: redirects, short-link expansion, canonical-link discovery,
 * undocumented provider blobs, semantic cross-provider clustering.
 */
import { contentHash } from './hash';

export const URL_IDENTITY_VERSION = 1;

export type UrlIdentityEvidence = 'normalized-url' | 'google-maps-query-place-id';

export interface UrlIdentity {
  /** Hash of the exact trimmed URL, compatible with the original v1 mark key. */
  aliasKey: string;
  /** Candidate shared entity; conflict handling may retain aliasKey instead. */
  entityKey: string;
  /** Derived evidence for diagnostics only; the vault URL remains canonical. */
  normalizedUrl: string;
  normalizerVersion: number;
  provider: string | null;
  providerKey: string | null;
  evidence: UrlIdentityEvidence;
}

const TRACKING_PARAMS = new Set([
  '_ga',
  '_gl',
  'dclid',
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'msclkid',
]);

// Exact registrable hosts only. A pattern such as `google.<tld>` would let an
// unrelated lookalike domain assert a real Place ID and force a false merge.
// Extend this list with fixture evidence and bump URL_IDENTITY_VERSION.
const GOOGLE_MAPS_HOSTS = new Set([
  'google.at',
  'google.be',
  'google.ca',
  'google.ch',
  'google.co.in',
  'google.co.jp',
  'google.co.nz',
  'google.co.uk',
  'google.com',
  'google.com.au',
  'google.com.br',
  'google.com.mx',
  'google.de',
  'google.es',
  'google.fr',
  'google.ie',
  'google.it',
  'google.nl',
  'google.pt',
]);

const hashText = (value: string): Promise<string> =>
  contentHash(new TextEncoder().encode(value));

/** Original v1 identity, retained as the durable bridge for existing marks. */
export function rawUrlAliasKey(url: string): Promise<string> {
  return hashText(url.trim());
}

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const trackingKeys = [...new Set([...parsed.searchParams.keys()].filter(isTrackingParam))];
    for (const key of trackingKeys) parsed.searchParams.delete(key);
    return parsed.toString();
  } catch {
    // A scanner extraction should already yield http(s), but malformed input
    // remains distinct and indexable rather than becoming a scan failure.
    return raw;
  }
}

function isGoogleMapsHost(hostname: string): boolean {
  const labels = hostname.toLowerCase().split('.');
  if (labels[0] === 'www' || labels[0] === 'maps') labels.shift();
  return GOOGLE_MAPS_HOSTS.has(labels.join('.'));
}

/**
 * The bounded Google adapter accepts only the documented Maps Search URL
 * shape. It deliberately ignores directions, shortened links, CID/data blobs,
 * place names, and coordinates.
 */
function googleMapsPlaceId(normalizedUrl: string): string | null {
  try {
    const parsed = new URL(normalizedUrl);
    if (!isGoogleMapsHost(parsed.hostname)) return null;
    if (parsed.pathname.replace(/\/$/, '') !== '/maps/search') return null;
    if (parsed.searchParams.get('api') !== '1') return null;
    if (!parsed.searchParams.get('query')?.trim()) return null;
    const placeIds = parsed.searchParams.getAll('query_place_id');
    if (placeIds.length !== 1) return null;
    return placeIds[0]?.trim() || null;
  } catch {
    return null;
  }
}

export async function resolveUrlIdentity(url: string): Promise<UrlIdentity> {
  const raw = url.trim();
  const aliasKey = await hashText(raw);
  const normalizedUrl = normalizeUrl(raw);
  const placeId = googleMapsPlaceId(normalizedUrl);

  if (placeId) {
    return {
      aliasKey,
      entityKey: await hashText(`google-maps/place/v1/${placeId}`),
      normalizedUrl,
      normalizerVersion: URL_IDENTITY_VERSION,
      provider: 'google-maps',
      providerKey: placeId,
      evidence: 'google-maps-query-place-id',
    };
  }

  return {
    aliasKey,
    entityKey: await hashText(normalizedUrl),
    normalizedUrl,
    normalizerVersion: URL_IDENTITY_VERSION,
    provider: null,
    providerKey: null,
    evidence: 'normalized-url',
  };
}

/** Candidate key for non-scanner callers; scanner projection may retain an alias on conflict. */
export async function urlEntityKey(url: string): Promise<string> {
  return (await resolveUrlIdentity(url)).entityKey;
}
