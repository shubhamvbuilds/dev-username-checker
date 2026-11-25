import { describe, it, expect, beforeEach } from 'vitest';
import { localGet, localPut } from '../../web/local-cache';
import type { CheckResult } from '../../src/shared/types';

const r = (platform: CheckResult['platform'], status: CheckResult['status'], checkedAt = 1000): CheckResult => ({
  platform, name: 'abc', status, url: 'https://x.test/abc', method: 'api', checkedAt,
});

describe('local cache', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips and skips unknown results', () => {
    localPut('abc', [r('github', 'free'), r('npm', 'unknown'), r('x', 'taken')], 1000);
    const got = localGet('abc', 2000)!;
    expect(got.map((x) => x.platform)).toEqual(['github', 'x']);
    expect(localStorage.getItem('uc:v2:abc')).not.toBeNull();
  });

  it('returns null when expired (1 hour)', () => {
    localPut('abc', [r('github', 'free')], 1000);
    expect(localGet('abc', 1000 + 3600_000 - 1)).not.toBeNull();
    expect(localGet('abc', 1000 + 3600_000 + 1)).toBeNull();
  });

  it('expiry counts from the oldest stored checkedAt, not the time of writing', () => {
    localPut('abc', [r('github', 'free', 1000), r('x', 'taken', 5000)], 4_000_000);
    expect(localGet('abc', 1000 + 3600_000 - 1)).not.toBeNull();
    expect(localGet('abc', 1000 + 3600_000 + 1)).toBeNull();
  });

  it('uses the v2 key prefix', () => {
    localPut('abc', [r('github', 'free')], 1000);
    expect(localStorage.getItem('uc:v1:abc')).toBeNull();
  });

  it('returns null when missing or corrupt', () => {
    expect(localGet('nope')).toBeNull();
    localStorage.setItem('uc:v2:bad', '{not json');
    expect(localGet('bad')).toBeNull();
  });
});
