import { describe, it, expect, vi } from 'vitest';
import { findSuggestions, type Suggestion } from '../../web/suggestions';
import type { CheckResult, PlatformId } from '../../src/shared/types';

const line = (platform: PlatformId, name: string, status: CheckResult['status']): CheckResult => ({
  platform, name, status, url: 'https://e.test/', method: 'api', checkedAt: 1,
});
const ndjson = (rs: CheckResult[]) => new Response(rs.map((r) => JSON.stringify(r)).join('\n') + '\n');
const nameOf = (url: string) => new URL(url, 'http://l').searchParams.get('name')!;

async function run(platforms: PlatformId[], respond: (name: string) => CheckResult[]) {
  const urls: string[] = [];
  const fetchFn = vi.fn(async (url: string) => { urls.push(url); return ndjson(respond(nameOf(url))); });
  const got: Suggestion[] = [];
  const out = await findSuggestions({ name: 'shubham', platforms, fetch: fetchFn, signal: new AbortController().signal, onSuggestion: (s) => got.push(s) });
  return { out, got, urls, fetchFn };
}

describe('findSuggestions', () => {
  it('excludes x and link-only platforms from the request', async () => {
    const { urls, fetchFn } = await run(['github', 'reddit', 'npm', 'hashnode', 'peerlist', 'linkedin', 'x'],
      (n) => [line('github', n, 'free'), line('reddit', n, 'free')]);
    expect(fetchFn).toHaveBeenCalledTimes(6);
    for (const u of urls) {
      expect(u).toContain('suggestion=1');
      expect(new URL(u, 'http://l').searchParams.get('platforms')).toBe('github,reddit');
    }
  });

  it('keeps all-free suggestions and drops one with a taken line', async () => {
    const { out, got } = await run(['github', 'reddit'], (n) => [line('github', n, 'free'), line('reddit', n, n.endsWith('dev') ? 'taken' : 'free')]);
    expect(out).toBe('done');
    expect(got).toHaveLength(5);
    expect(got.map((s) => s.name)).not.toContain('shubhamdev');
    expect(got[0].unknown).toEqual([]);
  });

  it('qualifies free plus one unknown and reports the unknown platform', async () => {
    const { got } = await run(['github', 'reddit'], (n) => [line('github', n, 'free'), line('reddit', n, 'unknown')]);
    expect(got).toHaveLength(6);
    expect(got[0].unknown).toEqual(['reddit']);
  });

  it('disqualifies an invalid line', async () => {
    const { got } = await run(['github', 'reddit'], (n) => [line('github', n, 'free'), line('reddit', n, 'invalid')]);
    expect(got).toHaveLength(0);
  });

  it('disqualifies a truncated stream (missing platform line)', async () => {
    const { got } = await run(['github', 'reddit'], (n) => [line('github', n, 'free')]);
    expect(got).toHaveLength(0);
  });

  it('disqualifies a duplicate platform line', async () => {
    const { got } = await run(['github', 'reddit'], (n) => [line('github', n, 'free'), line('github', n, 'free')]);
    expect(got).toHaveLength(0);
  });

  it('disqualifies a line for a different name', async () => {
    const { got } = await run(['github'], () => [line('github', 'other', 'free')]);
    expect(got).toHaveLength(0);
  });

  it('disqualifies all-unknown (zero free)', async () => {
    const { got } = await run(['github', 'reddit'], (n) => [line('github', n, 'unknown'), line('reddit', n, 'unknown')]);
    expect(got).toHaveLength(0);
  });

  it('reports paused on 503', async () => {
    const fetchFn = vi.fn(async () => new Response('{"error":"x"}', { status: 503 }));
    const out = await findSuggestions({ name: 'shubham', platforms: ['github'], fetch: fetchFn, signal: new AbortController().signal, onSuggestion: () => {} });
    expect(out).toBe('paused');
  });

  it('stops remaining requests on 429', async () => {
    const signals: AbortSignal[] = [];
    const fetchFn = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      signals.push(init!.signal!);
      if (signals.length === 1) return Promise.resolve(new Response('{}', { status: 429 }));
      return new Promise<Response>((_, rej) => init!.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))));
    });
    const got: Suggestion[] = [];
    const out = await findSuggestions({ name: 'shubham', platforms: ['github'], fetch: fetchFn, signal: new AbortController().signal, onSuggestion: (s) => got.push(s) });
    expect(out).toBe('rate-limited');
    expect(signals.slice(1).every((s) => s.aborted)).toBe(true);
    expect(got).toEqual([]);
  });
});
