import { PLATFORMS } from '../shared/platforms';
import { isSearchable, normalizeName, validateFor } from '../shared/rules';
import type { CheckResult, PlatformId } from '../shared/types';
import { getBlocks, getCached, putCached, recordBlock } from './cache';
import { CHECKERS } from './checkers';
import type { Env } from './env';
import { BLOCKED_REASON } from './http';
import { trafficLevel } from './traffic';
import { verifyTurnstile } from './turnstile';

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

function requestedPlatforms(param: string | null): PlatformId[] {
  const enabled = (Object.keys(PLATFORMS) as PlatformId[]).filter((id) => PLATFORMS[id].enabled);
  const ids = (param ?? '').split(',').map((s) => s.trim()).filter((s): s is PlatformId => Object.hasOwn(PLATFORMS, s));
  return ids.length ? [...new Set(ids)] : enabled;
}

async function checkOne(
  id: PlatformId,
  name: string,
  env: Env,
  level: number,
  f: typeof fetch,
  blocked: Set<PlatformId>,
  now: number,
): Promise<CheckResult | null> {
  const meta = PLATFORMS[id];
  const base = { platform: id, name, url: meta.profileUrl(name) };
  if (!meta.enabled) return null;
  const rules = validateFor(id, name);
  if (!rules.ok) {
    return { ...base, status: 'invalid', reason: rules.rule, method: 'rules', checkedAt: Date.now() };
  }

  try {
    const cached = await getCached(env.DB, id, name, now, level >= 3 ? 6 : 1).catch(() => null);
    if (cached) return cached;

    const checker = CHECKERS[id];
    if (!checker || (id === 'x' && level >= 1)) {
      return {
        ...base,
        status: 'unknown',
        reason: level >= 1 ? 'High traffic: check it yourself' : 'Check it yourself',
        method: 'link-only',
        checkedAt: Date.now(),
      };
    }
    // Stop on a block: a platform that said 403/429 is left alone for a while.
    if (blocked.has(id)) {
      return { ...base, status: 'unknown', reason: BLOCKED_REASON, method: meta.method, checkedAt: now };
    }
    let result: CheckResult;
    try {
      result = await checker.check(name, { fetch: f, env });
    } catch {
      result = { ...base, status: 'unknown', reason: 'Check failed', method: meta.method, checkedAt: Date.now() };
    }
    if (result.status === 'unknown' && result.reason === BLOCKED_REASON) {
      await recordBlock(env.DB, id, now).catch(() => undefined);
    }
    // putCached skips unknown/invalid; a failed write must not lose the result.
    await putCached(env.DB, result).catch(() => undefined);
    return result;
  } catch {
    return { ...base, status: 'unknown', reason: 'Check failed', method: meta.method, checkedAt: Date.now() };
  }
}

export async function handleCheck(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  f: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown-ip';
  if (env.RATE_LIMITER) {
    try {
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return json(429, 'Too many searches, try again in a few minutes');
    } catch {
      // Fail open: a broken limiter must not take the checker down.
    }
  }

  const params = new URL(request.url).searchParams;
  const level = trafficLevel(env);

  const name = normalizeName(params.get('name') ?? '');
  const searchable = isSearchable(name);
  if (!searchable.ok) return json(400, searchable.error);
  if (level >= 2 && params.get('suggestion') === '1') return json(503, 'Suggestions paused due to high traffic');

  if (params.get('suggestion') === '1') {
    const ok = await verifyTurnstile(request.headers.get('cf-turnstile-response'), ip, env, f);
    if (!ok) return json(403, 'Verification failed');
  }

  const ids = requestedPlatforms(params.get('platforms'));
  // One query for every platform; a failed read just means nothing is blocked.
  const blocked = await getBlocks(env.DB, now).catch(() => new Set<PlatformId>());
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  // Each task writes its line as it settles; the stream closes after the last
  // task (including its cache write) so waitUntil keeps the writes alive.
  const pump = Promise.all(
    ids.map(async (id) => {
      const r = await checkOne(id, name, env, level, f, blocked, now);
      if (r) await writer.write(enc.encode(JSON.stringify(r) + '\n'));
    }),
  )
    .then(() => writer.close())
    .catch(() => writer.abort());
  ctx.waitUntil(pump);

  return new Response(readable, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
  });
}
