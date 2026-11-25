import { describe, it, expect } from 'vitest';
import { handleProve } from '../../src/worker/prove';
import worker from '../../src/worker/index';
import { PLATFORMS } from '../../src/shared/platforms';
import type { Env } from '../../src/worker/env';

const mkEnv = (extra: Partial<Env> = {}) => ({ ...extra }) as Env;
const req = (qs = '') => new Request(`https://example.test/__prove${qs}`);
const stub = (status: number, body = ''): typeof fetch => async () => new Response(body, { status });

describe('/__prove', () => {
  it('404 when PROVE_KEY is not set', async () => {
    const res = await handleProve(req('?key=anything'), mkEnv(), stub(404));
    expect(res.status).toBe(404);
  });

  it('404 when PROVE_KEY is not set and no key given', async () => {
    const res = await handleProve(req(), mkEnv(), stub(404));
    expect(res.status).toBe(404);
  });

  it('404 with the wrong key', async () => {
    const res = await handleProve(req('?key=nope'), mkEnv({ PROVE_KEY: 'secret' }), stub(404));
    expect(res.status).toBe(404);
  });

  it('is routed from the worker and 404s unauthenticated', async () => {
    const res = await (worker.fetch as (r: Request, e: Env) => Promise<Response>)(req('?key=x'), mkEnv({ PROVE_KEY: 'secret' }));
    expect(res.status).toBe(404);
  });

  it('200 with an entry for every platform plus X', async () => {
    const res = await handleProve(req('?key=secret'), mkEnv({ PROVE_KEY: 'secret' }), stub(404));
    expect(res.status).toBe(200);
    const { platforms: body } = (await res.json()) as { platforms: Array<Record<string, unknown>> };
    expect(Array.isArray(body)).toBe(true);
    const ids = body.map((e) => e.platform).sort();
    expect(ids).toEqual(Object.keys(PLATFORMS).sort());
    expect(body).toHaveLength(14);
    const x = body.find((e) => e.platform === 'x')!;
    expect(x.method).toBe('plain-fetch');
    const gh = body.find((e) => e.platform === 'github')!;
    expect(gh.invalidStatus).toBe('invalid');
  });

  it('pass is false when the checker returns unknown for the taken name', async () => {
    const res = await handleProve(req('?key=secret'), mkEnv({ PROVE_KEY: 'secret' }), stub(429));
    const { platforms: body } = (await res.json()) as { platforms: Array<Record<string, unknown>> };
    const gh = body.find((e) => e.platform === 'github')!;
    expect(gh.takenStatus).toBe('unknown');
    expect(gh.pass).toBe(false);
    const li = body.find((e) => e.platform === 'linkedin')!;
    expect(li.pass).toBe(true);
  });

  it('free name is 14 lowercase letters, differing per request', async () => {
    const run = async () => {
      const res = await handleProve(req('?key=secret'), mkEnv({ PROVE_KEY: 'secret' }), stub(404));
      const body = (await res.json()) as { platforms: Array<{ freeName: string }> };
      return body.platforms[0]!.freeName;
    };
    const a = await run();
    const b = await run();
    expect(a).toMatch(/^[a-z]{14}$/);
    expect(a).not.toBe(b);
  });

  describe('traps (namespace and case)', () => {
    type Trap = { platform: string; name: string; status: string; pass: boolean };
    const traps = async (f: typeof fetch) => {
      const res = await handleProve(req('?key=secret'), mkEnv({ PROVE_KEY: 'secret' }), f);
      return ((await res.json()) as { traps: Trap[] }).traps;
    };
    const key = (t: Trap) => `${t.platform}:${t.name}`;

    it('covers DEV github, GitLab github, Hugging Face huggingface and HN walterbright', async () => {
      const t = await traps(stub(404));
      expect(t.map(key).sort()).toEqual(['devto:github', 'gitlab:github', 'hackernews:walterbright', 'huggingface:huggingface']);
    });

    it('a trap that comes back free fails; HN null is unknown and passes', async () => {
      const t = await traps(async (u) =>
        String(u).includes('hacker-news') ? new Response('null') : new Response('', { status: 404 }));
      for (const x of t) expect(x.pass).toBe(x.status !== 'free');
      expect(t.find((x) => x.platform === 'devto')).toMatchObject({ status: 'free', pass: false });
      expect(t.find((x) => x.platform === 'hackernews')).toMatchObject({ status: 'unknown', pass: true });
    });

    it('traps that come back taken pass', async () => {
      const t = await traps(async (u) => {
        const s = String(u);
        if (s.includes('gitlab.com/api/v4/users')) return new Response('[]', { status: 200 });
        if (s.includes('hacker-news')) return new Response('{"id":"walterbright"}', { status: 200 });
        return new Response('{}', { status: 200 });
      });
      for (const x of t) expect(x).toMatchObject({ status: 'taken', pass: true });
    });
  });
});
