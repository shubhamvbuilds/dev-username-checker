import { describe, it, expect, vi } from 'vitest';
import { findSuggestions } from '../../web/suggestions';
import type { CheckResult, PlatformId } from '../../src/shared/types';

const line = (platform: PlatformId, name: string, status: CheckResult['status']): CheckResult => ({
  platform, name, status, url: 'https://e.test/', method: 'api', checkedAt: 1,
});
const ndjson = (rs: CheckResult[]) => new Response(rs.map((r) => JSON.stringify(r)).join('\n') + '\n');

describe('findSuggestions', () => {
  it('requests with suggestion=1 and without x, and keeps only all-free suggestions', async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      urls.push(url);
      const name = new URL(url, 'http://l').searchParams.get('name')!;
      const bad = name.endsWith('dev');
      return ndjson([line('github', name, 'free'), line('npm', name, bad ? 'taken' : 'free')]);
    });
    const got: string[] = [];
    const out = await findSuggestions({
      name: 'shubham', platforms: ['github', 'npm', 'x'], fetch: fetchFn,
      signal: new AbortController().signal, onSuggestion: (s) => got.push(s.name),
    });
    expect(out).toBe('done');
    expect(fetchFn).toHaveBeenCalledTimes(6);
    for (const u of urls) {
      expect(u).toContain('suggestion=1');
      expect(u).toContain('platforms=github%2Cnpm');
      expect(u).not.toMatch(/x(,|$|&)/);
    }
    expect(got).toHaveLength(5);
    expect(got).not.toContain('shubhamdev');
  });

  it('disqualifies a suggestion with any unknown or invalid line', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const name = new URL(url, 'http://l').searchParams.get('name')!;
      return ndjson([line('github', name, 'free'), line('npm', name, name.endsWith('hq') ? 'unknown' : 'free')]);
    });
    const got: string[] = [];
    await findSuggestions({ name: 'shubham', platforms: ['github', 'npm'], fetch: fetchFn, signal: new AbortController().signal, onSuggestion: (s) => got.push(s.name) });
    expect(got).not.toContain('shubhamhq');
    expect(got).toHaveLength(5);
  });

  it('reports paused on 503', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ error: 'Suggestions paused due to high traffic' }), { status: 503 }));
    const got: string[] = [];
    const out = await findSuggestions({ name: 'shubham', platforms: ['github'], fetch: fetchFn, signal: new AbortController().signal, onSuggestion: (s) => got.push(s.name) });
    expect(out).toBe('paused');
    expect(got).toEqual([]);
  });

  it('stops remaining requests on 429', async () => {
    const signals: AbortSignal[] = [];
    const fetchFn = vi.fn((url: string, init?: { signal?: AbortSignal }) => {
      signals.push(init!.signal!);
      if (signals.length === 1) return Promise.resolve(new Response('{}', { status: 429 }));
      return new Promise<Response>((_, rej) => init!.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))));
    });
    const got: string[] = [];
    const out = await findSuggestions({ name: 'shubham', platforms: ['github'], fetch: fetchFn, signal: new AbortController().signal, onSuggestion: (s) => got.push(s.name) });
    expect(out).toBe('rate-limited');
    expect(signals.slice(1).every((s) => s.aborted)).toBe(true);
    expect(got).toEqual([]);
  });
});
