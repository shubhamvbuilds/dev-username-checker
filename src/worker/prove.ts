import { PLATFORMS } from '../shared/platforms';
import { RULES, validateFor } from '../shared/rules';
import type { PlatformId, Status } from '../shared/types';
import type { CheckDeps, Env } from './env';
import { CHECKERS } from './checkers';
import { fetchWithTimeout } from './http';

// Well-known, long-lived accounts. The owner can swap any that turn out wrong.
export const TAKEN_NAMES: Record<PlatformId, string> = {
  github: 'torvalds',
  gitlab: 'gitlab',
  npm: 'npm',
  devto: 'ben',
  hashnode: 'hashnode',
  bluesky: 'bsky', // resolves bsky.bsky.social
  huggingface: 'huggingface',
  youtube: 'youtube',
  reddit: 'spez',
  hackernews: 'pg',
  producthunt: 'rrhoover',
  peerlist: 'akash',
  x: 'x',
  linkedin: 'linkedin', // link-only: never requested
};

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
  const takenName = TAKEN_NAMES[id];
  const invalidName = invalidNameFor(id);
  const checker = CHECKERS[id]!;
  const linkOnly = PLATFORMS[id].method === 'link-only' || id === 'linkedin';
  const taken = (await checker.check(takenName, deps)).status;
  const free = (await checker.check(freeName, deps)).status;
  // Invalid comes from the rules, not a fetch. Link-only platforms are never checked.
  const invalid: Status = linkOnly ? 'unknown' : validateFor(id, invalidName).ok ? 'unknown' : 'invalid';
  const pass = linkOnly
    ? taken === 'unknown' && free === 'unknown' && invalid === 'unknown'
    : taken === 'taken' && free === 'free' && invalid === 'invalid';
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

async function observeX(name: string, f: typeof fetch) {
  const res = await fetchWithTimeout(f, `https://x.com/${name}`);
  if (res === 'timeout') return { httpStatus: null, notExistText: null, error: 'timeout' };
  let notExistText = false;
  try {
    notExistText = (await res.text()).includes("This account doesn't exist");
  } catch {
    // body unreadable: leave false
  }
  return { httpStatus: res.status, notExistText };
}

async function proveX(freeName: string, deps: CheckDeps) {
  const takenName = TAKEN_NAMES.x;
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
  const ids = (Object.keys(CHECKERS) as PlatformId[]).filter((id) => CHECKERS[id]);
  const entries = await mapLimit(ids, MAX_CONCURRENCY, (id) => proveOne(id, freeName, deps));
  const x = await proveX(freeName, deps);
  return Response.json([...entries, x]);
}
