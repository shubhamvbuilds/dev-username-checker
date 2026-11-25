import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { getCached, putCached } from '../../src/worker/cache';
import type { CheckResult, Status } from '../../src/shared/types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = 1_700_000_000_000;

let n = 0;
const mk = (status: Status, extra: Partial<CheckResult> = {}): CheckResult => ({
  platform: 'github',
  name: `user${++n}`,
  status,
  url: '',
  method: 'api',
  checkedAt: T0,
  ...extra,
});

describe('d1 cache', () => {
  it('free: found at +59min, gone at +61min', async () => {
    const r = mk('free');
    await putCached(env.DB, r);
    expect((await getCached(env.DB, r.platform, r.name, T0 + 59 * MIN))?.status).toBe('free');
    expect(await getCached(env.DB, r.platform, r.name, T0 + 61 * MIN)).toBeNull();
  });

  it('taken: found at +23h', async () => {
    const r = mk('taken');
    await putCached(env.DB, r);
    expect((await getCached(env.DB, r.platform, r.name, T0 + 23 * HOUR))?.status).toBe('taken');
  });

  it('never caches unknown', async () => {
    const r = mk('unknown');
    await putCached(env.DB, r);
    expect(await getCached(env.DB, r.platform, r.name, T0)).toBeNull();
  });

  it('never caches invalid', async () => {
    const r = mk('invalid');
    await putCached(env.DB, r);
    expect(await getCached(env.DB, r.platform, r.name, T0)).toBeNull();
  });

  it('ttlMultiplier stretches expiry: free at +2h', async () => {
    const r = mk('free');
    await putCached(env.DB, r);
    expect(await getCached(env.DB, r.platform, r.name, T0 + 2 * HOUR)).toBeNull();
    expect((await getCached(env.DB, r.platform, r.name, T0 + 2 * HOUR, 6))?.status).toBe('free');
  });

  it('rebuilds url, keeps reason, method and checkedAt', async () => {
    const r = mk('taken', { reason: 'http 200', method: 'page' });
    await putCached(env.DB, r);
    const got = await getCached(env.DB, r.platform, r.name, T0 + MIN);
    expect(got).toEqual({
      platform: 'github',
      name: r.name,
      status: 'taken',
      reason: 'http 200',
      url: `https://github.com/${r.name}`,
      method: 'page',
      checkedAt: T0,
    });
  });

  it('omits reason when null', async () => {
    const r = mk('free');
    await putCached(env.DB, r);
    const got = await getCached(env.DB, r.platform, r.name, T0);
    expect(got && 'reason' in got).toBe(false);
  });

  it('upserts: second put replaces the first', async () => {
    const r = mk('free');
    await putCached(env.DB, r);
    await putCached(env.DB, { ...r, status: 'taken', checkedAt: T0 + MIN });
    const got = await getCached(env.DB, r.platform, r.name, T0 + 2 * MIN);
    expect(got?.status).toBe('taken');
    expect(got?.checkedAt).toBe(T0 + MIN);
  });
});
