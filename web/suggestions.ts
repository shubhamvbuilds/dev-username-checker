import { PLATFORMS } from '../src/shared/platforms';
import { generateSuggestions } from '../src/shared/suggest';
import type { CheckResult, PlatformId } from '../src/shared/types';
import { parseNdjsonStream } from './stream';

export const PAUSED_MSG = 'Suggestions paused due to high traffic';
export const RATE_LIMIT_MSG = 'Too many searches, try again in a few minutes';

export type FetchFn = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>;
export type SuggestionOutcome = 'done' | 'paused' | 'rate-limited' | 'failed';

export interface Suggestion {
  name: string;
  results: CheckResult[];
  /** Checked platforms that came back `unknown` for this suggestion. */
  unknown: PlatformId[];
}

/** Platforms a suggestion request can actually check: no X, no link-only. */
export function checkablePlatforms(platforms: PlatformId[]): PlatformId[] {
  return platforms.filter((p) => p !== 'x' && PLATFORMS[p].method !== 'link-only');
}

export interface FindOptions {
  name: string;
  platforms: PlatformId[];
  fetch: FetchFn;
  /** Resolves a single-use Turnstile token per suggestion request; null/undefined sends no header. */
  getToken?: () => Promise<string | null>;
  /** True when Turnstile is configured: a missing token then counts as a failed request. */
  requireToken?: boolean;
  /** Platforms where the typed name was taken: a suggestion must be `free` (not unknown) on each. */
  takenOn?: PlatformId[];
  signal: AbortSignal;
  /** Called once per suggestion, only after its stream finished and it is free everywhere (X excluded). */
  onSuggestion: (s: Suggestion) => void;
}

/**
 * Returns the unknown platforms if the lines qualify, else null. Qualifies when every
 * requested platform has exactly one line for this name, none is taken/invalid, and at least one is free.
 */
function qualify(name: string, checked: PlatformId[], results: CheckResult[], mustBeFree: PlatformId[]): PlatformId[] | null {
  if (results.length !== checked.length) return null;
  const seen = new Set<PlatformId>();
  for (const r of results) {
    if (r.name !== name || !checked.includes(r.platform) || seen.has(r.platform)) return null;
    if (r.status !== 'free' && r.status !== 'unknown') return null;
    if (r.status === 'unknown' && mustBeFree.includes(r.platform)) return null;
    seen.add(r.platform);
  }
  if (!results.some((r) => r.status === 'free')) return null;
  return results.filter((r) => r.status === 'unknown').map((r) => r.platform);
}

/** Checks up to 6 alternatives in parallel; X is never requested here (checked on click). */
export async function findSuggestions(opts: FindOptions): Promise<SuggestionOutcome> {
  const checked = checkablePlatforms(opts.platforms);
  if (checked.length === 0) return 'done';
  const names = generateSuggestions(opts.name, opts.platforms);

  const inner = new AbortController();
  const stop = () => inner.abort();
  if (opts.signal.aborted) return 'done';
  opts.signal.addEventListener('abort', stop);
  let outcome: SuggestionOutcome = 'done';
  const mustBeFree = (opts.takenOn ?? []).filter((p) => checked.includes(p));
  let failed = false;
  let qualified = 0;

  await Promise.all(names.map(async (name) => {
    try {
      const url = `/api/check?name=${encodeURIComponent(name)}&platforms=${encodeURIComponent(checked.join(','))}&suggestion=1`;
      const token = opts.getToken ? await opts.getToken() : null;
      if (inner.signal.aborted) return;
      if (!token && opts.requireToken) { failed = true; return; }
      const res = await opts.fetch(url, {
        signal: inner.signal,
        ...(token ? { headers: { 'cf-turnstile-response': token } } : {}),
      });
      if (res.status === 503 || res.status === 429) {
        if (outcome === 'done') outcome = res.status === 503 ? 'paused' : 'rate-limited';
        inner.abort();
        return;
      }
      if (!res.ok || !res.body) { failed = true; return; }
      const results: CheckResult[] = [];
      await parseNdjsonStream(res.body, (r) => results.push(r));
      if (inner.signal.aborted) return;
      const q = qualify(name, checked, results, mustBeFree);
      if (q) { qualified++; opts.onSuggestion({ name, results, unknown: q }); }
    } catch {
      // Aborted (superseded or stopped): not a failure. Anything else is.
      if (!inner.signal.aborted) failed = true;
    }
  }));

  opts.signal.removeEventListener('abort', stop);
  // Doubt is not "no variation is free": if requests failed and none qualified, say so.
  if (outcome === 'done' && failed && qualified === 0) return 'failed';
  return outcome;
}

/** Checks a single name on X. Returns null on failure. */
export async function checkOnX(name: string, fetchFn: FetchFn, signal: AbortSignal): Promise<CheckResult | null> {
  try {
    const res = await fetchFn(`/api/check?name=${encodeURIComponent(name)}&platforms=x`, { signal });
    if (!res.ok || !res.body) return null;
    let got: CheckResult | null = null;
    await parseNdjsonStream(res.body, (r) => { if (r.platform === 'x') got = r; });
    return got;
  } catch {
    return null;
  }
}
