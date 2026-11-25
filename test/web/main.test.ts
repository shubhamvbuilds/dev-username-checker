import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PLATFORMS } from '../../src/shared/platforms';
import type { CheckResult, PlatformId } from '../../src/shared/types';

describe('main search orchestration', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    const html = readFileSync('web/index.html', 'utf8');
    document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1].replace(/<script[\s\S]*?<\/script>/, '');
  });

  it('re-enables Check when a newer search finishes early while an older one is in flight', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // run A never settles
    const ids = (Object.keys(PLATFORMS) as PlatformId[]).filter((i) => PLATFORMS[i].enabled);
    const cached: CheckResult[] = ids.map((platform) => ({
      platform, name: 'cachedname', status: 'free', url: 'https://e.test/', method: 'api', checkedAt: 1,
    }));
    localStorage.setItem('uc:v1:cachedname', JSON.stringify({ at: Date.now(), results: cached }));

    await import('../../web/main');
    const input = document.getElementById('name') as HTMLInputElement;
    const form = document.getElementById('form') as HTMLFormElement;
    const go = document.getElementById('go') as HTMLButtonElement;

    input.value = 'freshname';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(go.disabled).toBe(true);

    input.value = 'cachedname';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(go.disabled).toBe(false);
  });
});

describe('suggestions wiring', () => {
  const ndjson = (rs: CheckResult[]) => new Response(rs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const res = (platform: PlatformId, name: string, status: CheckResult['status'], method: CheckResult['method'] = 'api'): CheckResult =>
    ({ platform, name, status, url: 'https://e.test/', method, checkedAt: 1 });

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem('uc:platforms', JSON.stringify(['github', 'x']));
    const html = readFileSync('web/index.html', 'utf8');
    document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1].replace(/<script[\s\S]*?<\/script>/, '');
  });

  const submit = (name: string) => {
    (document.getElementById('name') as HTMLInputElement).value = name;
    document.getElementById('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  };
  const tick = () => new Promise((r) => setTimeout(r, 20));

  it('aborts search A fetches (main and suggestions) when search B starts, and renders nothing from A', async () => {
    const calls: { url: string; signal: AbortSignal }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: { signal?: AbortSignal }) => {
      calls.push({ url, signal: init!.signal! });
      const name = new URL(url, 'http://l').searchParams.get('name')!;
      if (!url.includes('suggestion=1') && name === 'alpha') return Promise.resolve(ndjson([res('github', 'alpha', 'taken')]));
      return new Promise<Response>((_, rej) => init!.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))));
    }));
    await import('../../web/main');
    submit('alpha');
    await tick();
    const aCalls = calls.filter((c) => c.url.includes('suggestion=1'));
    expect(aCalls.length).toBe(6);
    expect(aCalls.every((c) => !c.signal.aborted)).toBe(true);

    submit('beta');
    await tick();
    expect(calls.filter((c) => c.url.includes('name=alpha')).every((c) => c.signal.aborted)).toBe(true);
    expect(document.querySelectorAll('#suggestion-list li').length).toBe(0);
    expect((document.getElementById('error') as HTMLElement).hidden).toBe(true);
  });

  it('shows qualifying suggestions with an X control, and a plain link when X is link-only', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const p = new URL(url, 'http://l').searchParams;
      const name = p.get('name')!;
      if (p.get('platforms') === 'x') return ndjson([res('x', name, 'unknown', 'link-only')]);
      if (p.get('suggestion') === '1') return ndjson([res('github', name, 'free')]);
      return ndjson([res('github', name, 'taken'), res('x', name, 'unknown', 'link-only')]);
    }));
    await import('../../web/main');
    submit('alpha');
    await tick();
    const items = document.querySelectorAll('#suggestion-list li');
    expect(items.length).toBe(6);
    const btn = items[0].querySelector('button') as HTMLButtonElement;
    expect(btn.textContent).toBe('X: check →');
    btn.click();
    await tick();
    const a = items[0].querySelector('a') as HTMLAnchorElement;
    expect(a.textContent).toBe('Check on X →');
    expect(a.href).toBe(`https://x.com/${items[0].getAttribute('data-name')}`);
  });

  it('does not run suggestions when nothing is taken, and hides the X control when X is not selected', async () => {
    localStorage.setItem('uc:platforms', JSON.stringify(['github']));
    const fetchMock = vi.fn(async (url: string) => {
      const p = new URL(url, 'http://l').searchParams;
      const name = p.get('name')!;
      if (name === 'alpha') return ndjson([res('github', name, 'free')]);
      return ndjson([res('github', name, p.get('suggestion') ? 'free' : 'taken')]);
    });
    vi.stubGlobal('fetch', fetchMock);
    await import('../../web/main');
    submit('alpha');
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    submit('beta');
    await tick();
    const items = document.querySelectorAll('#suggestion-list li');
    expect(items.length).toBe(6);
    expect(items[0].querySelector('button')).toBeNull();
  });

  it('shows "Couldn\'t confirm" for unknown platforms on a qualifying suggestion', async () => {
    localStorage.setItem('uc:platforms', JSON.stringify(['github', 'reddit']));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const p = new URL(url, 'http://l').searchParams;
      const name = p.get('name')!;
      if (p.get('suggestion')) return ndjson([res('github', name, 'free'), res('reddit', name, 'unknown')]);
      return ndjson([res('github', name, 'taken'), res('reddit', name, 'free')]);
    }));
    await import('../../web/main');
    submit('alpha');
    await tick();
    const items = document.querySelectorAll('#suggestion-list li');
    expect(items.length).toBe(6);
    expect(items[0].textContent).toContain("Couldn't confirm: Reddit");
  });

  it('shows the no-variation message and hides the heading when nothing qualifies', async () => {
    localStorage.setItem('uc:platforms', JSON.stringify(['github']));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const name = new URL(url, 'http://l').searchParams.get('name')!;
      return ndjson([res('github', name, 'taken')]);
    }));
    await import('../../web/main');
    submit('alpha');
    await tick();
    expect(document.getElementById('suggestions')!.hidden).toBe(false);
    expect(document.getElementById('suggestions-title')!.hidden).toBe(true);
    expect(document.getElementById('suggestions-msg')!.textContent).toBe('No variation is free on every checked platform. Try a different name.');
  });

  it('lists link-only platforms and X under "Not checked automatically"', async () => {
    localStorage.setItem('uc:platforms', JSON.stringify(['github', 'x', 'npm', 'hashnode', 'peerlist', 'linkedin']));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const p = new URL(url, 'http://l').searchParams;
      const name = p.get('name')!;
      if (p.get('suggestion')) return ndjson([res('github', name, 'free')]);
      return ndjson([res('github', name, 'taken')]);
    }));
    await import('../../web/main');
    submit('alpha');
    await tick();
    const note = document.getElementById('suggestions-note')!;
    expect(note.hidden).toBe(false);
    for (const l of ['LinkedIn', 'npm', 'Hashnode', 'Peerlist', 'X']) expect(note.textContent).toContain(l);
    expect(note.textContent!.startsWith('Not checked automatically: ')).toBe(true);
  });

  it('shows the paused and rate-limit messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('suggestion=1')) return new Response('{"error":"x"}', { status: 503 });
      const name = new URL(url, 'http://l').searchParams.get('name')!;
      return ndjson([res('github', name, 'taken')]);
    }));
    await import('../../web/main');
    submit('alpha');
    await tick();
    expect(document.getElementById('suggestions')!.textContent).toContain('Suggestions paused due to high traffic');
    expect(document.getElementById('suggestions-title')!.hidden).toBe(true);
  });
});
