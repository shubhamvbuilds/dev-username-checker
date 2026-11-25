import { PLATFORMS } from '../shared/platforms';
import { RULES, validateFor } from '../shared/rules';
import type { PlatformId, Status } from '../shared/types';
import type { CheckDeps, Env } from './env';
import { CHECKERS } from './checkers';
import { fetchWithTimeout, readBody } from './http';

// Well-known, long-lived accounts. The owner can swap any that turn out wrong.
export const TAKEN_NAMES: Partial<Record<PlatformId, string>> = {
  github: 'torvalds',
  gitlab: 'gitlab',
  devto: 'ben',
  bluesky: 'theshubham', // theshubham.bsky.social exists (bsky.bsky.social does not)
  huggingface: 'huggingface',
  youtube: 'youtube',
  reddit: 'spez',
  hackernews: 'pg',
  producthunt: 'rrhoover',
  x: 'x',
};

// Names that must NEVER come back `free`: they are taken in a shared namespace
// (org vs user) or only differ by case. A `free` here is a false "free" bug.
export const TRAPS: ReadonlyArray<{ platform: PlatformId; name: string }> = [
  { platform: 'devto', name: 'github' }, // an organization, not in the users API
  { platform: 'gitlab', name: 'github' }, // a group; users and groups share one namespace
  { platform: 'huggingface', name: 'huggingface' }, // an organization
  { platform: 'hackernews', name: 'walterbright' }, // the account is WalterBright; HN is case-sensitive
];

export interface TrapEntry {
  platform: PlatformId;
  name: string;
  status: Status;
  pass: boolean;
}

const MAX_CONCURRENCY = 3;

export interface ProveEntry {
  platform: PlatformId;
  takenName: string;
  takenStatus: Status;
  freeName: string;
  freeStatus: Status;
  invalidName: string;
  invalidStatus: Status;
  pass: boolean;
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

// Hash both sides so lengths match, then compare without early exit.
async function keyMatches(given: string | null, expected: string | undefined): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given ?? ''), sha256(expected ?? '')]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0 && given !== null && !!expected;
}

export function randomFreeName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => String.fromCharCode(97 + (b % 26))).join('');
}

function invalidNameFor(id: PlatformId): string {
  return 'a'.repeat(RULES[id].max + 1);
}

async function proveOne(id: PlatformId, freeName: string, deps: CheckDeps): Promise<ProveEntry> {
  const takenName = TAKEN_NAMES[id] ?? '';
  const invalidName = invalidNameFor(id);
  const checker = CHECKERS[id];
  const linkOnly = PLATFORMS[id].method === 'link-only';
  // Link-only platforms are never fetched; they are expected to be unknown.
  const taken: Status = linkOnly || !checker ? 'unknown' : (await checker.check(takenName, deps)).status;
  const free: Status = linkOnly || !checker ? 'unknown' : (await checker.check(freeName, deps)).status;
  // Invalid comes from the rules, not a fetch. Link-only platforms are never checked.
  const invalid: Status = linkOnly ? 'unknown' : validateFor(id, invalidName).ok ? 'unknown' : 'invalid';
  // Hacker News never reports free (names are case-sensitive), so its expected free result is unknown.
  const expectedFree: Status = id === 'hackernews' ? 'unknown' : 'free';
  const pass = linkOnly
    ? taken === 'unknown' && free === 'unknown' && invalid === 'unknown'
    : taken === 'taken' && free === expectedFree && invalid === 'invalid';
  return {
    platform: id,
    takenName,
    takenStatus: taken,
    freeName,
    freeStatus: free,
    invalidName,
    invalidStatus: invalid,
    pass,
  };
}

async function proveTrap(t: { platform: PlatformId; name: string }, deps: CheckDeps): Promise<TrapEntry> {
  const checker = CHECKERS[t.platform];
  const status: Status = checker ? (await checker.check(t.name, deps)).status : 'unknown';
  return { platform: t.platform, name: t.name, status, pass: status !== 'free' };
}

async function observeX(name: string, f: typeof fetch) {
  const res = await fetchWithTimeout(f, `https://x.com/${name}`);
  if (res === 'timeout') return { httpStatus: null, notExistText: null, error: 'timeout' };
  let notExistText = false;
  try {
    notExistText = ((await readBody(res)) ?? '').includes("This account doesn't exist");
  } catch {
    // body unreadable: leave false
  }
  return { httpStatus: res.status, notExistText };
}

async function proveX(freeName: string, deps: CheckDeps) {
  const takenName = TAKEN_NAMES.x!;
  const invalidName = invalidNameFor('x');
  const taken = await observeX(takenName, deps.fetch);
  const free = await observeX(freeName, deps.fetch);
  return {
    platform: 'x' as const,
    method: 'plain-fetch' as const,
    takenName,
    freeName,
    invalidName,
    invalidStatus: (validateFor('x', invalidName).ok ? 'unknown' : 'invalid') as Status,
    taken,
    free,
    browser: deps.env.BROWSER
      ? 'BROWSER binding present: browser checking deferred to Task 8'
      : 'no BROWSER binding configured',
    // Heuristic only: the owner judges from the raw observations above.
    pass: taken.httpStatus === 200 && taken.notExistText === false && free.notExistText === true,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function handleProve(request: Request, env: Env, f: typeof fetch = fetch): Promise<Response> {
  const key = new URL(request.url).searchParams.get('key');
  if (!(await keyMatches(key, env.PROVE_KEY))) return new Response('Not found', { status: 404 });

  const deps: CheckDeps = { fetch: f, env };
  const freeName = randomFreeName();
  const ids = (Object.keys(PLATFORMS) as PlatformId[]).filter((id) => id !== 'x' && PLATFORMS[id].enabled);
  const entries = await mapLimit(ids, MAX_CONCURRENCY, (id) => proveOne(id, freeName, deps));
  const x = await proveX(freeName, deps);
  const traps = await mapLimit([...TRAPS], MAX_CONCURRENCY, (t) => proveTrap(t, deps));
  return Response.json({ platforms: [...entries, x], traps });
}
