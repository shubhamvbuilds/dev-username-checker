import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { handleCheck } from '../../src/worker/api';
import { CHECKERS } from '../../src/worker/checkers';
import { trafficLevel } from '../../src/worker/traffic';
import { putCached, getCached } from '../../src/worker/cache';
import { PLATFORMS } from '../../src/shared/platforms';
import type { CheckResult } from '../../src/shared/types';
import type { Env } from '../../src/worker/env';

const mkEnv = (extra: Partial<Env> = {}): Env => ({ DB: env.DB, ...extra }) as Env;
const ctx = () => {
  const ps: Promise<unknown>[] = [];
  return { c: { waitUntil: (p: Promise<unknown>) => void ps.push(p), passThroughOnException() {} } as unknown as ExecutionContext, ps };
};
const req = (qs: string, headers: Record<string, string> = {}) =>
  new Request(`https://example.test/api/check?${qs}`, { headers });
// github: 404 => free
const freeFetch = () => vi.fn(async (..._a: unknown[]) => new Response('', { status: 404 }));

async function run(qs: string, e: Env = mkEnv(), f: ReturnType<typeof freeFetch> = freeFetch(), headers = {}) {
  const { c, ps } = ctx();
  const res = await handleCheck(req(qs, headers), e, c, f as unknown as typeof fetch);
  const text = await res.text();
  await Promise.all(ps);
  const lines = text ? text.trim().split('\n').map((l) => JSON.parse(l) as CheckResult) : [];
  return { res, lines, f, text };
}

describe('trafficLevel', () => {
  it('defaults to 0 and rejects invalid', () => {
    expect(trafficLevel(mkEnv())).toBe(0);
    expect(trafficLevel(mkEnv({ TRAFFIC_LEVEL: 'x' }))).toBe(0);
    expect(trafficLevel(mkEnv({ TRAFFIC_LEVEL: '9' }))).toBe(0);
    expect(trafficLevel(mkEnv({ TRAFFIC_LEVEL: '2' }))).toBe(2);
    expect(trafficLevel(mkEnv({ TRAFFIC_LEVEL: '3' }))).toBe(3);
  });
});

describe('/api/check', () => {
  it('streams NDJSON with the normalized name', async () => {
    const { res, lines } = await run('name=%20@ShubhamV&platforms=github,npm');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.name).toBe('shubhamv');
      expect(l.url).not.toBe('');
    }
  });

  it.each([['name='], [`name=${'a'.repeat(300)}`], ['name=%D1%88%D1%83%D0%B1%D1%85%D0%B0%D0%BC']])(
    '400 and zero fetches for %s',
    async (qs) => {
      const { res, f, text } = await run(qs);
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(typeof (JSON.parse(text) as { error: string }).error).toBe('string');
      expect(f).toHaveBeenCalledTimes(0);
    },
  );

  it('invalid X name stays invalid with no fetch; github is checked', async () => {
    const { lines, f } = await run('name=shubhamvbuilds12&platforms=x,github');
    const x = lines.find((l) => l.platform === 'x')!;
    expect(x.status).toBe('invalid');
    expect(x.method).toBe('rules');
    expect(x.reason).toContain('15');
    const g = lines.find((l) => l.platform === 'github')!;
    expect(g.status).toBe('free');
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0]![0])).not.toContain('x.com');
  });

  it('X with no checker is link-only unknown', async () => {
    const { lines, f } = await run('name=alice1&platforms=x');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      platform: 'x', status: 'unknown', reason: 'Check it yourself', method: 'link-only', url: 'https://x.com/alice1',
    });
    expect(f).toHaveBeenCalledTimes(0);
  });

  it('level 1: X says high traffic', async () => {
    const { lines } = await run('name=alice1&platforms=x', mkEnv({ TRAFFIC_LEVEL: '1' }));
    expect(lines[0]).toMatchObject({ status: 'unknown', reason: 'High traffic: check it yourself' });
  });

  it('returns a cached taken result without fetching', async () => {
    await putCached(env.DB, {
      platform: 'github', name: 'cachedguy', status: 'taken', url: '', method: 'api', checkedAt: Date.now(),
    });
    const { lines, f } = await run('name=cachedguy&platforms=github');
    expect(lines[0]!.status).toBe('taken');
    expect(f).toHaveBeenCalledTimes(0);
  });

  it('level 3 multiplies the cache ttl by 6', async () => {
    const old = Date.now() - 2 * 3_600_000; // free ttl is 1h
    await putCached(env.DB, { platform: 'github', name: 'stale1', status: 'free', url: '', method: 'api', checkedAt: old });
    const a = await run('name=stale1&platforms=github');
    expect(a.f).toHaveBeenCalledTimes(1);
    await putCached(env.DB, { platform: 'github', name: 'stale2', status: 'free', url: '', method: 'api', checkedAt: old });
    const b = await run('name=stale2&platforms=github', mkEnv({ TRAFFIC_LEVEL: '3' }));
    expect(b.f).toHaveBeenCalledTimes(0);
    expect(b.lines[0]!.status).toBe('free');
  });

  it('writes definitive results to the cache', async () => {
    await run('name=writeme&platforms=github');
    expect((await getCached(env.DB, 'github', 'writeme', Date.now()))?.status).toBe('free');
  });

  it('does not cache unknown: a second request fetches again', async () => {
    const f = vi.fn(async () => new Response('', { status: 500 }));
    const a = await run('name=flaky&platforms=github', mkEnv(), f);
    expect(a.lines[0]!.status).toBe('unknown');
    await run('name=flaky&platforms=github', mkEnv(), f);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it.each(['npm', 'hashnode', 'peerlist'])('%s is link-only: unknown "Check it yourself", no fetch', async (id) => {
    const { lines, f } = await run(`name=alice1&platforms=${id}`);
    expect(lines[0]).toMatchObject({ platform: id, status: 'unknown', reason: 'Check it yourself', method: 'link-only' });
    expect(f).not.toHaveBeenCalled();
  });

  it('a throwing checker becomes unknown "Check failed" and is not cached', async () => {
    const orig = CHECKERS.github;
    CHECKERS.github = { id: 'github', check: async () => { throw new Error('boom'); } };
    try {
      const { lines } = await run('name=thrower&platforms=github');
      expect(lines[0]).toMatchObject({ platform: 'github', name: 'thrower', status: 'unknown', reason: 'Check failed' });
      expect(await getCached(env.DB, 'github', 'thrower', Date.now())).toBeNull();
    } finally {
      CHECKERS.github = orig;
    }
  });

  it('disabled platforms produce no line', async () => {
    const orig = PLATFORMS.npm.enabled;
    PLATFORMS.npm.enabled = false;
    try {
      const { lines } = await run('name=alice1&platforms=github,npm');
      expect(lines.map((l) => l.platform)).toEqual(['github']);
    } finally {
      PLATFORMS.npm.enabled = orig;
    }
  });

  it('disabled platform requested with an invalid name emits no line', async () => {
    const orig = PLATFORMS.x.enabled;
    PLATFORMS.x.enabled = false;
    try {
      const { lines } = await run('name=shubhamvbuilds12&platforms=x,github');
      expect(lines.map((l) => l.platform)).toEqual(['github']);
    } finally {
      PLATFORMS.x.enabled = orig;
    }
  });

  it('prototype keys in platforms are ignored', async () => {
    const { res, lines } = await run('name=alice1&platforms=constructor,__proto__,github');
    expect(res.status).toBe(200);
    expect(lines.map((l) => l.platform)).toEqual(['github']);
  });

  it('level 2: invalid name with suggestion=1 gets 400, not 503', async () => {
    const { res } = await run('name=&suggestion=1', mkEnv({ TRAFFIC_LEVEL: '2' }));
    expect(res.status).toBe(400);
  });

  it('ignores unknown ids; empty param means all enabled', async () => {
    const a = await run('name=alice1&platforms=nope,github');
    expect(a.lines.map((l) => l.platform)).toEqual(['github']);
    const b = await run('name=alice1');
    const enabled = Object.values(PLATFORMS).filter((p) => p.enabled).length;
    expect(b.lines).toHaveLength(enabled);
  });

  it('level 2 + suggestion=1 gets 503', async () => {
    const { res, f, text } = await run('name=alice1&suggestion=1', mkEnv({ TRAFFIC_LEVEL: '2' }));
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(text)).toEqual({ error: 'Suggestions paused due to high traffic' });
    expect(f).toHaveBeenCalledTimes(0);
    const ok = await run('name=alice1&platforms=github&suggestion=1', mkEnv({ TRAFFIC_LEVEL: '1' }));
    expect(ok.res.status).toBe(200);
  });

  it('429 when the rate limiter says no, keyed by CF-Connecting-IP, before validation', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const { res, f, text } = await run('name=', mkEnv({ RATE_LIMITER: { limit } }), freeFetch(), { 'CF-Connecting-IP': '1.2.3.4' });
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(text)).toEqual({ error: 'Too many searches, try again in a few minutes' });
    expect(limit).toHaveBeenCalledWith({ key: '1.2.3.4' });
    expect(f).toHaveBeenCalledTimes(0);
  });

  it('falls back to unknown-ip and allows when limiter succeeds or is absent', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const a = await run('name=alice1&platforms=github', mkEnv({ RATE_LIMITER: { limit } }));
    expect(a.res.status).toBe(200);
    expect(limit).toHaveBeenCalledWith({ key: 'unknown-ip' });
  });
});
