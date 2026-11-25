import { describe, it, expect, vi } from 'vitest';
import { classifyHttp, fetchWithTimeout } from '../../src/worker/http';

const opts = {
  freeWhen: (r: Response) => r.status === 404,
  takenWhen: (r: Response) => r.status === 200,
};

describe('classifyHttp', () => {
  it('free when 404 matches freeWhen', async () => {
    expect((await classifyHttp(new Response('', { status: 404 }), opts)).status).toBe('free');
  });
  it('taken when 200 matches takenWhen', async () => {
    expect((await classifyHttp(new Response('ok', { status: 200 }), opts)).status).toBe('taken');
  });
  it('unknown when neither matches', async () => {
    const r = await classifyHttp(new Response('x', { status: 200 }), {
      freeWhen: () => false,
      takenWhen: () => false,
    });
    expect(r.status).toBe('unknown');
  });
  it('429 and 403 are rate limited or blocked, even if predicates would match', async () => {
    const all = { freeWhen: () => true, takenWhen: () => true };
    for (const s of [429, 403]) {
      const r = await classifyHttp(new Response('', { status: s }), all);
      expect(r).toEqual({ status: 'unknown', reason: 'Rate limited or blocked' });
    }
  });
  it('5xx is unknown', async () => {
    const all = { freeWhen: () => true, takenWhen: () => true };
    expect((await classifyHttp(new Response('', { status: 500 }), all)).status).toBe('unknown');
  });
  it('timeout is unknown', async () => {
    expect(await classifyHttp('timeout', opts)).toEqual({ status: 'unknown', reason: 'Timed out' });
  });
  it('redirect to a login URL is a login wall', async () => {
    const res = new Response(null, { status: 302, headers: { location: '/login?next=/x' } });
    const all = { freeWhen: () => true, takenWhen: () => true };
    expect(await classifyHttp(res, all)).toEqual({ status: 'unknown', reason: 'Login wall' });
  });
  it('final URL on a login page is a login wall', async () => {
    const res = new Response('', { status: 200 });
    Object.defineProperty(res, 'url', { value: 'https://example.com/accounts/login/' });
    const all = { freeWhen: () => true, takenWhen: () => true };
    expect((await classifyHttp(res, all)).reason).toBe('Login wall');
  });
});

describe('bounded body reads', () => {
  it('a stalled body is unknown "Timed out" (the timeout covers the body read)', async () => {
    const f = (async () => new Response(new ReadableStream({ start() {} }), { status: 200 })) as unknown as typeof fetch;
    const res = await fetchWithTimeout(f, 'https://x.test', {}, 20);
    expect(res).not.toBe('timeout');
    expect(await classifyHttp(res, opts)).toEqual({ status: 'unknown', reason: 'Timed out' });
  });
  it('statusOnly cancels the body instead of reading it', async () => {
    const cancel = vi.fn();
    const res = new Response(new ReadableStream({ start() {}, cancel }), { status: 404 });
    const c = await classifyHttp(res, { ...opts, statusOnly: true });
    expect(c.status).toBe('free');
    expect(cancel).toHaveBeenCalled();
  });
  it('statusOnly with a stalled body still classifies (no read, no hang)', async () => {
    const f = (async () => new Response(new ReadableStream({ start() {} }), { status: 200 })) as unknown as typeof fetch;
    const res = await fetchWithTimeout(f, 'https://x.test', {}, 20);
    expect((await classifyHttp(res, { ...opts, statusOnly: true })).status).toBe('taken');
  });
});

describe('fetchWithTimeout', () => {
  it('returns timeout when fetch never resolves', async () => {
    const f = ((_u: string, init?: RequestInit) =>
      new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort'))))) as unknown as typeof fetch;
    expect(await fetchWithTimeout(f, 'https://x.test', {}, 20)).toBe('timeout');
  });
  it('returns timeout when fetch throws', async () => {
    const f = (() => Promise.reject(new Error('boom'))) as unknown as typeof fetch;
    expect(await fetchWithTimeout(f, 'https://x.test')).toBe('timeout');
  });
  it('sends the identifying User-Agent', async () => {
    let ua = '';
    const f = (async (_u: string, init?: RequestInit) => {
      ua = new Headers(init?.headers).get('user-agent') ?? '';
      return new Response('');
    }) as unknown as typeof fetch;
    await fetchWithTimeout(f, 'https://x.test');
    expect(ua).toBe('dev-username-checker (+https://github.com)');
  });
});
