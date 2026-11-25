import { PLATFORMS } from '../shared/platforms';
import type { CheckResult, PlatformId, Status } from '../shared/types';
import type { CheckDeps } from './env';

export const USER_AGENT = 'dev-username-checker (+https://github.com)';

type Predicate = (res: Response, body: string) => boolean;
export interface ClassifyOpts {
  freeWhen: Predicate;
  takenWhen: Predicate;
  /** Decide from the status alone: the body is cancelled, never read, and predicates see ''. */
  statusOnly?: boolean;
}
export interface Classification {
  status: Status;
  reason?: string;
}

export const BLOCKED_REASON = 'Rate limited or blocked';

// The timeout stays armed after fetch resolves so the body read is bounded too;
// classifyHttp (or readBody) disarms it once the response is consumed.
const inFlight = new WeakMap<Response, { signal: AbortSignal; disarm: () => void }>();

function discard(res: Response): void {
  inFlight.get(res)?.disarm();
  try {
    void res.body?.cancel().catch(() => undefined);
  } catch {
    // locked or already closed: nothing to cancel
  }
}

/** Reads the body as text within the request's timeout; null means it timed out. */
export async function readBody(res: Response): Promise<string | null> {
  const t = inFlight.get(res);
  if (!t) return res.text();
  if (t.signal.aborted) {
    discard(res);
    return null;
  }
  let onAbort = () => {};
  const aborted = new Promise<null>((resolve) => {
    onAbort = () => resolve(null);
    t.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const text = res.text();
    text.catch(() => undefined); // if the abort wins, a later rejection is expected
    const body = await Promise.race([text, aborted]);
    if (body === null) discard(res);
    return body;
  } catch (e) {
    if (t.signal.aborted) return null;
    throw e;
  } finally {
    t.signal.removeEventListener('abort', onAbort);
    t.disarm();
  }
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
    const res = await f(url, { redirect: 'manual', ...init, headers, signal: ctrl.signal });
    inFlight.set(res, { signal: ctrl.signal, disarm: () => clearTimeout(timer) });
    return res;
  } catch {
    clearTimeout(timer);
    return 'timeout';
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
    discard(res);
    return { status: 'unknown', reason: BLOCKED_REASON };
  }
  const location = res.headers.get('location') ?? '';
  if ((res.status >= 300 && res.status < 400 && LOGIN_RE.test(location)) || LOGIN_RE.test(res.url)) {
    discard(res);
    return { status: 'unknown', reason: 'Login wall' };
  }
  if (res.status >= 500) {
    discard(res);
    return { status: 'unknown', reason: `Server error (${res.status})` };
  }
  try {
    let body = '';
    if (opts.statusOnly) discard(res);
    else {
      const read = await readBody(res);
      if (read === null) return { status: 'unknown', reason: 'Timed out' };
      body = read;
    }
    const free = opts.freeWhen(res, body);
    const taken = opts.takenWhen(res, body);
    if (free && !taken) return { status: 'free' };
    if (taken && !free) return { status: 'taken' };
  } catch {
    // unreadable body: fall through to unknown
    discard(res);
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
// Status-only: the body is never needed for these.
export const status404or200: ClassifyOpts = { freeWhen: is404, takenWhen: is200, statusOnly: true };
