export interface Env {
  DB: D1Database;
  GITHUB_TOKEN?: string;
  TRAFFIC_LEVEL?: string;
  TURNSTILE_SECRET?: string;
  BROWSER?: Fetcher;
  PROVE_KEY?: string;
}

export interface CheckDeps {
  fetch: typeof fetch;
  env: Env;
}
