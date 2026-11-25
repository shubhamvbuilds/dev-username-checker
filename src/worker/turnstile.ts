import type { Env } from './env';
import { fetchWithTimeout } from './http';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Unset secret (local dev) accepts everything. With a secret set, any missing token,
// error or timeout fails closed. Tokens are single-use, so the client sends one per request.
export async function verifyTurnstile(
  token: string | null,
  ip: string,
  env: Env,
  f: typeof fetch,
): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const res = await fetchWithTimeout(f, SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    if (res === 'timeout' || !res.ok) return false;
    const data = (await res.json()) as { success?: unknown };
    return data.success === true;
  } catch {
    return false;
  }
}
