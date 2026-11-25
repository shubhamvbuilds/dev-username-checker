// Shape of the Workers Rate Limiting binding.
export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  GITHUB_TOKEN?: string;
  TRAFFIC_LEVEL?: string;
  TURNSTILE_SECRET?: string;
  BROWSER?: Fetcher;
  PROVE_KEY?: string;
  RATE_LIMITER?: RateLimiter;
}

export interface CheckDeps {
  fetch: typeof fetch;
  env: Env;
}
