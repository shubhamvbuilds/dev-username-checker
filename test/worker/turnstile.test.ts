import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { handleCheck } from '../../src/worker/api';
import { verifyTurnstile } from '../../src/worker/turnstile';
import type { Env } from '../../src/worker/env';

const mkEnv = (extra: Partial<Env> = {}): Env => ({ DB: env.DB, ...extra }) as Env;
const siteverify = (body: unknown, status = 200) =>
  vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify(body), { status }));

describe('verifyTurnstile', () => {
  it('returns true without calling out when no secret is set', async () => {
    const f = siteverify({ success: false });
    expect(await verifyTurnstile(null, '1.1.1.1', mkEnv(), f as unknown as typeof fetch)).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
  it('returns false for a missing token when the secret is set', async () => {
    const f = siteverify({ success: true });
    expect(await verifyTurnstile(null, '1.1.1.1', mkEnv({ TURNSTILE_SECRET: 's' }), f as unknown as typeof fetch)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('returns true on success and posts secret, response and remoteip', async () => {
    const f = siteverify({ success: true });
    expect(await verifyTurnstile('tok', '9.9.9.9', mkEnv({ TURNSTILE_SECRET: 's' }), f as unknown as typeof fetch)).toBe(true);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('secret')).toBe('s');
    expect(body.get('response')).toBe('tok');
    expect(body.get('remoteip')).toBe('9.9.9.9');
  });
  it('returns false when verification fails, errors, or times out', async () => {
    const e = mkEnv({ TURNSTILE_SECRET: 's' });
    expect(await verifyTurnstile('t', 'ip', e, siteverify({ success: false }) as unknown as typeof fetch)).toBe(false);
    expect(await verifyTurnstile('t', 'ip', e, siteverify({}, 500) as unknown as typeof fetch)).toBe(false);
    expect(await verifyTurnstile('t', 'ip', e, (async () => { throw new Error('x'); }) as unknown as typeof fetch)).toBe(false);
  });
});

describe('/api/check turnstile gate', () => {
  const run = async (qs: string, e: Env, f: typeof fetch, headers: Record<string, string> = {}) => {
    const ps: Promise<unknown>[] = [];
    const c = { waitUntil: (p: Promise<unknown>) => void ps.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    const res = await handleCheck(new Request(`https://example.test/api/check?${qs}`, { headers }), e, c, f);
    const text = await res.text();
    await Promise.all(ps);
    return { res, text };
  };
  const e = () => mkEnv({ TURNSTILE_SECRET: 's' });

  it('403s a suggestion call with a bad token', async () => {
    const f = vi.fn(async (u: unknown) =>
      String(u).includes('siteverify') ? new Response(JSON.stringify({ success: false })) : new Response('', { status: 404 }));
    const { res, text } = await run('name=alice&platforms=github&suggestion=1', e(), f as unknown as typeof fetch, { 'cf-turnstile-response': 'bad' });
    expect(res.status).toBe(403);
    expect(JSON.parse(text)).toEqual({ error: 'Verification failed' });
  });
  it('403s a suggestion call with no token', async () => {
    const { res } = await run('name=alice&platforms=github&suggestion=1', e(), vi.fn() as unknown as typeof fetch);
    expect(res.status).toBe(403);
  });
  it('lets a suggestion call with a valid token through', async () => {
    const f = vi.fn(async (u: unknown) =>
      String(u).includes('siteverify') ? new Response(JSON.stringify({ success: true })) : new Response('', { status: 404 }));
    const { res, text } = await run('name=alice&platforms=github&suggestion=1', e(), f as unknown as typeof fetch, { 'cf-turnstile-response': 'good' });
    expect(res.status).toBe(200);
    expect(text).toContain('"free"');
  });
  it('typed-name checks never need a token', async () => {
    const f = vi.fn(async (..._a: unknown[]) => new Response('', { status: 404 }));
    const { res } = await run('name=alice&platforms=github', e(), f as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(f.mock.calls.some((c) => String(c[0]).includes('siteverify'))).toBe(false);
  });
});
