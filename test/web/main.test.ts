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
