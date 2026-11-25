import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('turnstile loader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key');
    document.head.replaceChildren();
  });

  const scripts = () => document.head.querySelectorAll('script');

  it('retries the script load after a load failure', async () => {
    const { getToken } = await import('../../web/turnstile');
    const first = getToken();
    expect(scripts()).toHaveLength(1);
    scripts()[0]!.onerror!(new Event('error'));
    expect(await first).toBeNull();

    const second = getToken();
    expect(scripts()).toHaveLength(2);
    scripts()[1]!.onerror!(new Event('error'));
    expect(await second).toBeNull();
  });

  it('does not reload while a load is in flight', async () => {
    const { getToken } = await import('../../web/turnstile');
    void getToken();
    void getToken();
    expect(scripts()).toHaveLength(1);
  });
});
