import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { CHECKER_VERSION, getBlocks, getCached, putCached, recordBlock } from '../../src/worker/cache';
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

  it('takenMultiplier stretches taken expiry only: taken at +30h', async () => {
    const r = mk('taken');
    await putCached(env.DB, r);
    expect(await getCached(env.DB, r.platform, r.name, T0 + 30 * HOUR)).toBeNull();
    expect((await getCached(env.DB, r.platform, r.name, T0 + 30 * HOUR, 6))?.status).toBe('taken');
  });

  it('takenMultiplier never stretches free: free at +2h stays expired', async () => {
    const r = mk('free');
    await putCached(env.DB, r);
    expect(await getCached(env.DB, r.platform, r.name, T0 + 2 * HOUR, 6)).toBeNull();
  });

  it('putCached writes CHECKER_VERSION', async () => {
    const r = mk('free');
    await putCached(env.DB, r);
    const row = await env.DB.prepare('SELECT version FROM results WHERE platform = ?1 AND name = ?2').bind(r.platform, r.name).first<{ version: number }>();
    expect(CHECKER_VERSION).toBe(2);
    expect(row?.version).toBe(CHECKER_VERSION);
  });

  it('getCached ignores rows written by another checker version', async () => {
    const r = mk('free');
    await env.DB
      .prepare('INSERT INTO results (platform, name, status, reason, method, checked_at, version) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)')
      .bind(r.platform, r.name, 'free', 'api', T0, CHECKER_VERSION - 1)
      .run();
    expect(await getCached(env.DB, r.platform, r.name, T0)).toBeNull();
    await putCached(env.DB, r); // upsert rewrites the row at the current version
    expect((await getCached(env.DB, r.platform, r.name, T0))?.status).toBe('free');
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

describe('blocks', () => {
  it('records a 10 minute block, read back with one query', async () => {
    await recordBlock(env.DB, 'reddit', T0);
    expect((await getBlocks(env.DB, T0 + 9 * MIN)).has('reddit')).toBe(true);
    expect((await getBlocks(env.DB, T0 + 10 * MIN + 1)).has('reddit')).toBe(false);
  });
});
