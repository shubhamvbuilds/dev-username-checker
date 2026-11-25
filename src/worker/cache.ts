import { PLATFORMS } from '../shared/platforms';
import type { CheckResult, Method, PlatformId, Status } from '../shared/types';

// Only definitive answers are cached; `unknown` and `invalid` never are.
export const TTL = { free: 3_600_000, taken: 86_400_000 } as const;

// Bump when a checker fix means old cached answers can no longer be trusted.
export const CHECKER_VERSION = 2;

// How long a platform is left alone after it answers 403/429.
export const BLOCK_MS = 10 * 60_000;

interface Row {
  status: Status;
  reason: string | null;
  method: Method;
  checked_at: number;
  version: number;
}

export async function getCached(
  db: D1Database,
  platform: PlatformId,
  name: string,
  now: number,
  takenMultiplier = 1,
): Promise<CheckResult | null> {
  const row = await db
    .prepare('SELECT status, reason, method, checked_at, version FROM results WHERE platform = ?1 AND name = ?2')
    .bind(platform, name)
    .first<Row>();
  if (!row || row.version !== CHECKER_VERSION) return null;
  if (row.status !== 'free' && row.status !== 'taken') return null;
  // Only a taken answer may be served stale under load; a free one never is.
  const ttl = row.status === 'taken' ? TTL.taken * takenMultiplier : TTL.free;
  if (now - row.checked_at > ttl) return null;
  const result: CheckResult = {
    platform,
    name,
    status: row.status,
    url: PLATFORMS[platform].profileUrl(name),
    method: row.method,
    checkedAt: row.checked_at,
  };
  if (row.reason !== null) result.reason = row.reason;
  return result;
}

export async function putCached(db: D1Database, r: CheckResult): Promise<void> {
  if (r.status !== 'free' && r.status !== 'taken') return;
  await db
    .prepare(
      `INSERT INTO results (platform, name, status, reason, method, checked_at, version)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(platform, name) DO UPDATE SET
         status = excluded.status,
         reason = excluded.reason,
         method = excluded.method,
         checked_at = excluded.checked_at,
         version = excluded.version`,
    )
    .bind(r.platform, r.name, r.status, r.reason ?? null, r.method, r.checkedAt, CHECKER_VERSION)
    .run();
}

/** Platforms currently blocked, from one query for all of them. */
export async function getBlocks(db: D1Database, now: number): Promise<Set<PlatformId>> {
  const { results } = await db
    .prepare('SELECT platform FROM blocks WHERE until > ?1')
    .bind(now)
    .all<{ platform: PlatformId }>();
  return new Set(results.map((r) => r.platform));
}

export async function recordBlock(db: D1Database, platform: PlatformId, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO blocks (platform, until) VALUES (?1, ?2)
       ON CONFLICT(platform) DO UPDATE SET until = excluded.until`,
    )
    .bind(platform, now + BLOCK_MS)
    .run();
}
