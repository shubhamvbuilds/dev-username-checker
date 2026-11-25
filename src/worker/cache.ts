import { PLATFORMS } from '../shared/platforms';
import type { CheckResult, Method, PlatformId, Status } from '../shared/types';

// Only definitive answers are cached; `unknown` and `invalid` never are.
export const TTL = { free: 3_600_000, taken: 86_400_000 } as const;

interface Row {
  status: Status;
  reason: string | null;
  method: Method;
  checked_at: number;
}

export async function getCached(
  db: D1Database,
  platform: PlatformId,
  name: string,
  now: number,
  ttlMultiplier = 1,
): Promise<CheckResult | null> {
  const row = await db
    .prepare('SELECT status, reason, method, checked_at FROM results WHERE platform = ?1 AND name = ?2')
    .bind(platform, name)
    .first<Row>();
  if (!row) return null;
  if (row.status !== 'free' && row.status !== 'taken') return null;
  if (now - row.checked_at > TTL[row.status] * ttlMultiplier) return null;
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
      `INSERT INTO results (platform, name, status, reason, method, checked_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(platform, name) DO UPDATE SET
         status = excluded.status,
         reason = excluded.reason,
         method = excluded.method,
         checked_at = excluded.checked_at`,
    )
    .bind(r.platform, r.name, r.status, r.reason ?? null, r.method, r.checkedAt)
    .run();
}
