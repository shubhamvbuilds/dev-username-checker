import { describe, it, expect, vi } from 'vitest';
import { CHECKERS } from '../../src/worker/checkers';
import { PLATFORMS } from '../../src/shared/platforms';
import type { Env } from '../../src/worker/env';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const text = (b: string, status = 200) => new Response(b, { status });
const code = (s: number) => () => new Response('', { status: s });

type Fx = { free: (url: string) => Response; taken: (url: string) => Response };
const fixtures: Record<string, Fx> = {
  github: { free: code(404), taken: () => json({ login: 'x' }) },
  gitlab: { free: () => json([]), taken: () => json([{ id: 1 }]) },
  npm: { free: code(404), taken: () => json({ name: 'x' }) },
  devto: { free: code(404), taken: () => json({ id: 1 }) },
  hashnode: { free: () => json({ data: { user: null } }), taken: () => json({ data: { user: { id: 'a' } } }) },
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
  hackernews: { free: () => text('null'), taken: () => json({ id: 'x' }) },
  producthunt: { free: code(404), taken: () => text('<html></html>') },
  peerlist: { free: code(404), taken: () => text('<html></html>') },
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
        expect(r.status).toBe('free');
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
        const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
          expect(new Headers(init?.headers).get('user-agent')).toBe('dev-username-checker (+https://github.com)');
          return fx.free('');
        });
        await c.check('alice', { fetch: f as unknown as typeof fetch, env });
        expect(f).toHaveBeenCalled();
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

  it('hashnode POSTs the graphql query', async () => {
    const f = vi.fn(async (_u: unknown, _i?: RequestInit) => json({ data: { user: null } }));
    await CHECKERS.hashnode!.check('alice', { fetch: f as unknown as typeof fetch, env });
    expect(f.mock.calls[0]![0]).toBe('https://gql.hashnode.com');
    expect(f.mock.calls[0]![1]?.method).toBe('POST');
    expect(String(f.mock.calls[0]![1]?.body)).toContain('alice');
  });

  it('hashnode with errors and no data is unknown', async () => {
    const r = await CHECKERS.hashnode!.check('alice', { fetch: mk(() => json({ errors: [{}] })) as unknown as typeof fetch, env });
    expect(r.status).toBe('unknown');
  });

  it('gitlab 200 with non-array body is unknown', async () => {
    const r = await CHECKERS.gitlab!.check('alice', { fetch: mk(() => json({ x: 1 })) as unknown as typeof fetch, env });
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
