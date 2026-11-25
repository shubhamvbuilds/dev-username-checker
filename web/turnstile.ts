// Invisible Turnstile. The site key is public and injected at build time; when it is
// unset (local dev) no script loads and getToken() resolves to null (no header sent).
interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || '';
const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TOKEN_TIMEOUT_MS = 10_000;

export const turnstileEnabled = SITE_KEY !== '';

let loading: Promise<TurnstileApi | null> | null = null;
function load(): Promise<TurnstileApi | null> {
  if (!turnstileEnabled) return Promise.resolve(null);
  loading ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => resolve(window.turnstile ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return loading;
}

/** Tokens are single-use, so each suggestion request renders its own invisible widget (in parallel). */
export async function getToken(): Promise<string | null> {
  const api = await load();
  if (!api) return null;
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.style.display = 'none';
    document.body.appendChild(host);
    let id: string | undefined;
    let done = false;
    const finish = (t: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (id) api.remove(id); } catch { /* ignore */ }
      host.remove();
      resolve(t);
    };
    const timer = setTimeout(() => finish(null), TOKEN_TIMEOUT_MS);
    try {
      id = api.render(host, {
        sitekey: SITE_KEY,
        size: 'invisible',
        callback: (t: string) => finish(t),
        'error-callback': () => finish(null),
        'timeout-callback': () => finish(null),
      });
    } catch { finish(null); }
  });
}
