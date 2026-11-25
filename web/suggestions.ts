import { PLATFORMS } from '../src/shared/platforms';
import { generateSuggestions } from '../src/shared/suggest';
import type { CheckResult, PlatformId } from '../src/shared/types';
import { parseNdjsonStream } from './stream';

export const PAUSED_MSG = 'Suggestions paused due to high traffic';
export const RATE_LIMIT_MSG = 'Too many searches, try again in a few minutes';

export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
export type SuggestionOutcome = 'done' | 'paused' | 'rate-limited';

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
  signal: AbortSignal;
  /** Called once per suggestion, only after its stream finished and it is free everywhere (X excluded). */
  onSuggestion: (s: Suggestion) => void;
}

/**
 * Returns the unknown platforms if the lines qualify, else null. Qualifies when every
 * requested platform has exactly one line for this name, none is taken/invalid, and at least one is free.
 */
function qualify(name: string, checked: PlatformId[], results: CheckResult[]): PlatformId[] | null {
  if (results.length !== checked.length) return null;
  const seen = new Set<PlatformId>();
  for (const r of results) {
    if (r.name !== name || !checked.includes(r.platform) || seen.has(r.platform)) return null;
    if (r.status !== 'free' && r.status !== 'unknown') return null;
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

  await Promise.all(names.map(async (name) => {
    try {
      const url = `/api/check?name=${encodeURIComponent(name)}&platforms=${encodeURIComponent(checked.join(','))}&suggestion=1`;
      const res = await opts.fetch(url, { signal: inner.signal });
      if (res.status === 503 || res.status === 429) {
        if (outcome === 'done') outcome = res.status === 503 ? 'paused' : 'rate-limited';
        inner.abort();
        return;
      }
      if (!res.ok || !res.body) return;
      const results: CheckResult[] = [];
      await parseNdjsonStream(res.body, (r) => results.push(r));
      if (inner.signal.aborted) return;
      const q = qualify(name, checked, results);
      if (q) opts.onSuggestion({ name, results, unknown: q });
    } catch { /* aborted or network failure: this suggestion is simply dropped */ }
  }));

  opts.signal.removeEventListener('abort', stop);
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
