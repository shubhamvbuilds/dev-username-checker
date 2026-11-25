import { PLATFORMS } from '../shared/platforms';
import type { CheckResult, PlatformId, Status } from '../shared/types';
import type { CheckDeps } from './env';

export const USER_AGENT = 'dev-username-checker (+https://github.com)';

type Predicate = (res: Response, body: string) => boolean;
export interface ClassifyOpts {
  freeWhen: Predicate;
  takenWhen: Predicate;
}
export interface Classification {
  status: Status;
  reason?: string;
}

// Redirects are not followed so a bounce to a login page is visible.
// Any network error or timeout collapses to 'timeout' (-> unknown).
export async function fetchWithTimeout(
  f: typeof fetch,
  url: string,
  init: RequestInit = {},
  ms = 5000,
): Promise<Response | 'timeout'> {
  const headers = new Headers(init.headers);
  if (!headers.has('user-agent')) headers.set('user-agent', USER_AGENT);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await f(url, { redirect: 'manual', ...init, headers, signal: ctrl.signal });
  } catch {
    return 'timeout';
  } finally {
    clearTimeout(timer);
  }
}

const LOGIN_RE = /\/(log-?in|sign-?in|sign_in|accounts?\/login|authwall|uas\/login)\b/i;

// Never returns 'free' unless freeWhen is true on a non-blocked, non-5xx response.
export async function classifyHttp(
  res: Response | 'timeout',
  opts: ClassifyOpts,
): Promise<Classification> {
  if (res === 'timeout') return { status: 'unknown', reason: 'Timed out' };
  if (res.status === 429 || res.status === 403) {
    return { status: 'unknown', reason: 'Rate limited or blocked' };
  }
  const location = res.headers.get('location') ?? '';
  if ((res.status >= 300 && res.status < 400 && LOGIN_RE.test(location)) || LOGIN_RE.test(res.url)) {
    return { status: 'unknown', reason: 'Login wall' };
  }
  if (res.status >= 500) return { status: 'unknown', reason: `Server error (${res.status})` };
  try {
    const body = await res.text();
    const free = opts.freeWhen(res, body);
    const taken = opts.takenWhen(res, body);
    if (free && !taken) return { status: 'free' };
    if (taken && !free) return { status: 'taken' };
  } catch {
    // unparsable body: fall through to unknown
  }
  return { status: 'unknown', reason: `Unexpected response (${res.status})` };
}

export function makeResult(
  id: PlatformId,
  name: string,
  c: Classification,
  method = PLATFORMS[id].method,
): CheckResult {
  return {
    platform: id,
    name,
    status: c.status,
    ...(c.reason ? { reason: c.reason } : {}),
    url: PLATFORMS[id].profileUrl(name),
    method,
    checkedAt: Date.now(),
  };
}

export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

// Single GET-style request classified with the given predicates.
export async function simpleCheck(
  id: PlatformId,
  name: string,
  deps: CheckDeps,
  url: string,
  opts: ClassifyOpts,
  init?: RequestInit,
): Promise<CheckResult> {
  const res = await fetchWithTimeout(deps.fetch, url, init);
  return makeResult(id, name, await classifyHttp(res, opts));
}

export const is404: Predicate = (r) => r.status === 404;
export const is200: Predicate = (r) => r.status === 200;
export const status404or200 = { freeWhen: is404, takenWhen: is200 };
