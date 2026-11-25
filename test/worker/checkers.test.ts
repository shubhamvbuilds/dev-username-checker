import { describe, it, expect, vi } from 'vitest';
import { CHECKERS } from '../../src/worker/checkers';
import { PLATFORMS } from '../../src/shared/platforms';
import type { Env } from '../../src/worker/env';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const text = (b: string, status = 200) => new Response(b, { status });
const code = (s: number) => () => new Response('', { status: s });

type Fx = { free: (url: string) => Response; taken: (url: string) => Response; freeIsUnknown?: boolean };
const fixtures: Record<string, Fx> = {
  github: { free: code(404), taken: () => json({ login: 'x' }) },
  gitlab: {
    free: (u) => (u.includes('/groups/') ? new Response('', { status: 404 }) : json([])),
    taken: (u) => (u.includes('/groups/') ? new Response('', { status: 404 }) : json([{ id: 1 }])),
  },
  devto: { free: code(404), taken: () => text('<html></html>') },
  bluesky: {
    free: () => json({ error: 'InvalidRequest', message: 'Unable to resolve handle' }, 400),
    taken: () => json({ did: 'did:plc:abc' }),
  },
  huggingface: {
    free: code(404),
    taken: (u) => (u.includes('/api/users/') ? json({ name: 'x' }) : new Response('', { status: 404 })),
  },
  youtube: { free: code(404), taken: () => text('<html></html>') },
  reddit: { free: code(404), taken: () => json({ data: { is_suspended: true } }) },
  hackernews: { free: () => text('null'), taken: () => json({ id: 'x' }), freeIsUnknown: true },
  producthunt: { free: code(404), taken: () => text('<html></html>') },
};

const env = {} as Env;
const mk = (fx: (u: string) => Response) =>
  vi.fn(async (u: string | URL | Request) => fx(String(u)));

describe('checkers', () => {
  for (const [id, fx] of Object.entries(fixtures)) {
    describe(id, () => {
      const c = CHECKERS[id as keyof typeof CHECKERS]!;
      it('is registered', () => expect(c.id).toBe(id));
      it('free', async () => {
        const f = mk(fx.free);
        const r = await c.check('alice', { fetch: f as unknown as typeof fetch, env });
        // Hacker News is case-sensitive: a null body is never proof of "free".
        expect(r.status).toBe(fx.freeIsUnknown ? 'unknown' : 'free');
        expect(r.url).toBe(PLATFORMS[c.id].profileUrl('alice'));
        expect(r.method).toBe(PLATFORMS[c.id].method);
        expect(r.platform).toBe(id);
        expect(r.name).toBe('alice');
        expect(r.checkedAt).toBeGreaterThan(0);
      });
      it('taken', async () => {
        const f = mk(fx.taken);
        const r = await c.check('alice', { fetch: f as unknown as typeof fetch, env });
        expect(r.status).toBe('taken');
      });
      it('500 is unknown', async () => {
        const f = mk(() => new Response('err', { status: 500 }));
        const r = await c.check('alice', { fetch: f as unknown as typeof fetch, env });
        expect(r.status).toBe('unknown');
      });
      it('network failure is unknown', async () => {
        const f = vi.fn(async () => { throw new Error('net'); });
        const r = await c.check('alice', { fetch: f as unknown as typeof fetch, env });
        expect(r.status).toBe('unknown');
      });
      it('sends identifying User-Agent', async () => {
        const uas: (string | null)[] = [];
        const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
          uas.push(new Headers(init?.headers).get('user-agent'));
          return fx.free('');
        });
        await c.check('alice', { fetch: f as unknown as typeof fetch, env });
        expect(uas.length).toBeGreaterThan(0);
        for (const ua of uas) expect(ua).toBe('dev-username-checker (+https://github.com)');
      });
    });
  }

  it('does not register x', () => expect(CHECKERS.x).toBeUndefined());

  it('github 200 with unexpected body still taken only on 200; 403 is unknown', async () => {
    const r = await CHECKERS.github!.check('alice', { fetch: mk(code(403)) as unknown as typeof fetch, env });
    expect(r).toMatchObject({ status: 'unknown', reason: 'Rate limited or blocked' });
  });

  it('github sends Authorization when GITHUB_TOKEN set, and not otherwise', async () => {
    const f = vi.fn(async (_u: unknown, _i?: RequestInit) => new Response('', { status: 404 }));
    await CHECKERS.github!.check('alice', { fetch: f as unknown as typeof fetch, env: { GITHUB_TOKEN: 'tok' } as Env });
    expect(new Headers(f.mock.calls[0]![1]?.headers).get('authorization')).toBe('Bearer tok');
    f.mockClear();
    await CHECKERS.github!.check('alice', { fetch: f as unknown as typeof fetch, env });
    expect(new Headers(f.mock.calls[0]![1]?.headers).get('authorization')).toBeNull();
  });

  it('devto requests the profile page and a 200 (org or user) is taken', async () => {
    const f = mk(() => text('<html></html>'));
    const r = await CHECKERS.devto!.check('github', { fetch: f as unknown as typeof fetch, env });
    expect(f.mock.calls[0]![0]).toBe('https://dev.to/github');
    expect(r.status).toBe('taken');
  });

  it('devto 404 is free, 302 is unknown, 500 is unknown', async () => {
    const run = (s: number) => CHECKERS.devto!.check('alice', { fetch: mk(code(s)) as unknown as typeof fetch, env });
    expect((await run(404)).status).toBe('free');
    expect((await run(302)).status).toBe('unknown');
    expect((await run(500)).status).toBe('unknown');
  });

  describe('gitlab users + groups', () => {
    const gl = (users: () => Response, groups: () => Response) =>
      mk((u) => (u.includes('/api/v4/groups/') ? groups() : users())) as unknown as typeof fetch;
    const status = (f: typeof fetch) => CHECKERS.gitlab!.check('alice', { fetch: f, env }).then((r) => r.status);

    it('empty users array but group 200 is taken (regression: groups share the namespace)', async () => {
      expect(await status(gl(() => json([]), code(200)))).toBe('taken');
    });
    it('empty users array and group 404 is free', async () => {
      expect(await status(gl(() => json([]), code(404)))).toBe('free');
    });
    it('non-empty users array is taken', async () => {
      expect(await status(gl(() => json([{ id: 1 }]), code(404)))).toBe('taken');
    });
    it('users 500 is unknown', async () => {
      expect(await status(gl(code(500), code(404)))).toBe('unknown');
    });
    it('groups 403 is unknown', async () => {
      expect(await status(gl(() => json([]), code(403)))).toBe('unknown');
    });
    it('groups 500 is unknown', async () => {
      expect(await status(gl(() => json([]), code(500)))).toBe('unknown');
    });
  });

  it('npm, hashnode and peerlist have no checker', () => {
    expect(CHECKERS.npm).toBeUndefined();
    expect(CHECKERS.hashnode).toBeUndefined();
    expect(CHECKERS.peerlist).toBeUndefined();
  });

  it('gitlab 200 with non-array body is unknown', async () => {
    const r = await CHECKERS.gitlab!.check('alice', { fetch: mk((u) => (u.includes('/groups/') ? new Response('', { status: 404 }) : json({ x: 1 }))) as unknown as typeof fetch, env });
    expect(r.status).toBe('unknown');
  });

  it('bluesky 400 with a different message is unknown', async () => {
    const r = await CHECKERS.bluesky!.check('alice', { fetch: mk(() => json({ message: 'other' }, 400)) as unknown as typeof fetch, env });
    expect(r.status).toBe('unknown');
  });

  it('huggingface free requires both namespaces 404; one 500 makes it unknown', async () => {
    const f = mk((u) => (u.includes('/api/users/') ? new Response('', { status: 404 }) : new Response('', { status: 500 })));
    const r = await CHECKERS.huggingface!.check('alice', { fetch: f as unknown as typeof fetch, env });
    expect(r.status).toBe('unknown');
  });

  it('huggingface taken by an organization', async () => {
    const f = mk((u) => (u.includes('/api/organizations/') ? json({ name: 'x' }) : new Response('', { status: 404 })));
    const r = await CHECKERS.huggingface!.check('alice', { fetch: f as unknown as typeof fetch, env });
    expect(r.status).toBe('taken');
  });

  it('hackernews null body is unknown (names are case-sensitive), never free', async () => {
    const r = await CHECKERS.hackernews!.check('walterbright', { fetch: mk(() => text('null')) as unknown as typeof fetch, env });
    expect(r.status).toBe('unknown');
    expect(r.reason).toBe('Hacker News names are case-sensitive. Check it yourself');
  });

  it('hackernews JSON with an id is taken', async () => {
    const r = await CHECKERS.hackernews!.check('pg', { fetch: mk(() => json({ id: 'pg', karma: 1 })) as unknown as typeof fetch, env });
    expect(r.status).toBe('taken');
  });

  it('hackernews 200 with unexpected body is unknown', async () => {
    const r = await CHECKERS.hackernews!.check('alice', { fetch: mk(() => text('<html>')) as unknown as typeof fetch, env });
    expect(r.status).toBe('unknown');
  });

  it('login wall redirect is unknown for a page checker', async () => {
    const f = mk(() => new Response(null, { status: 302, headers: { location: 'https://www.youtube.com/login' } }));
    const r = await CHECKERS.youtube!.check('alice', { fetch: f as unknown as typeof fetch, env });
    expect(r).toMatchObject({ status: 'unknown', reason: 'Login wall' });
  });

  it('linkedin never fetches and is always unknown', async () => {
    const f = vi.fn();
    const r = await CHECKERS.linkedin!.check('alice', { fetch: f as unknown as typeof fetch, env });
    expect(f).not.toHaveBeenCalled();
    expect(r.status).toBe('unknown');
    expect(r.reason).toBe("LinkedIn can't be checked publicly");
    expect(r.method).toBe('link-only');
    expect(r.url).toBe(PLATFORMS.linkedin.profileUrl('alice'));
  });
});
