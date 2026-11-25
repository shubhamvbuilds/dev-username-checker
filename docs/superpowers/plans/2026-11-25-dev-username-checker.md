# Developer Username Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free website where a developer types a username and sees whether it's free on 13 developer platforms, plus suggested variations that are free on all of them.

**Architecture:** One Cloudflare Worker project on the free plan. The Worker serves a static front end (static assets) and a JSON check API, where one API request checks one name. Platform rules and suggestion generation are shared TypeScript modules that run in the browser. Results are cached in D1. X uses Cloudflare Browser Rendering only if Task 3 proves it works; otherwise it's link-only.

**Tech Stack:** TypeScript, Cloudflare Workers (Wrangler), D1, Browser Rendering (`@cloudflare/puppeteer`, Task 8 only), Turnstile, Vite for the front end, Vitest with `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/2026-11-25-dev-username-checker-design.md`

## Global Constraints

- ₹0 a month, on Cloudflare Workers **Free**, no credit card. Don't use any paid product or binding.
- Statuses are exactly `free` (UI: "No account found"), `taken`, `unknown` (UI: ⚠️ "Couldn't confirm" plus a reason), and `invalid` (UI: 🚫 plus the broken rule).
- **Never return `free` on doubt.** Any non-definitive response (timeout, 403, 429, 5xx, login wall, unexpected body) is `unknown`.
- One API request checks **one name** (the free plan allows at most 50 outside calls per request).
- Cache in **D1**, never KV. TTLs: `free` 1 hour, `taken` 24 hours, and `unknown` **never cached**.
- Light public-page checks only: one request per name per platform, and stop on a block. **No** rotating proxies, faked identities or CAPTCHA solving.
- Owner tokens (e.g. `GITHUB_TOKEN`) are Worker secrets only, never sent to the browser.
- No signup or login needed to search.
- LinkedIn is always `unknown` with reason "LinkedIn can't be checked publicly" and a link to the profile URL.
- If X can't be checked reliably, it is link-only (`unknown`, "Check it yourself") and launch isn't blocked.
- The ✅ label reads "No account found", with the note "The platform may still reserve this name. Signup confirms it."

## Review Focus

1. **Soft 404s and login walls:** a platform returns 200 with a "not found" page, or redirects to login. Expected: `unknown`, never `taken` or `free`. Test owned by Task 2 (`classifyHttp` redirect and body-marker cases).
2. **Messy input** like `" @ShubhamV "`, `ShubhamV` vs `shubhamv`. Expected: normalized to `shubhamv` before rules, cache keys and checks. Test owned by Task 1 (`normalizeName`).
3. **Name valid on some platforms, invalid on others** (e.g. a 16-character name on X, `a_b` on GitHub). Expected: `invalid` with the rule text on those platforms, no network call for them, and the others checked normally. Tests owned by Task 1 and Task 5.
4. **Transient failures must not poison the cache.** A 429 or timeout result must not be stored, so the next search retries. Test owned by Task 4.
5. **Empty, huge or non-ASCII input** (`""`, 300 characters, `шубхам`). Expected: the API returns 400 without any platform calls, and the UI shows the message. Tests owned by Task 5 and Task 6.

---

## File Structure

```
package.json, tsconfig.json, wrangler.jsonc, vitest.config.ts, vite.config.ts
migrations/0001_cache.sql
src/shared/types.ts        PlatformId, Status, CheckResult, PlatformMeta
src/shared/platforms.ts    PLATFORMS metadata (label, urls, enabled, method)
src/shared/rules.ts        normalizeName, RULES, validateFor
src/shared/suggest.ts      generateSuggestions
src/worker/http.ts         classifyHttp, fetchWithTimeout
src/worker/checkers/*.ts   one file per platform, each exports a Checker
src/worker/checkers/index.ts  CHECKERS registry
src/worker/cache.ts        getCached, putCached
src/worker/api.ts          handleCheck (GET /api/check)
src/worker/traffic.ts      trafficLevel, rate limiting
src/worker/turnstile.ts    verifyTurnstile
src/worker/x-browser.ts    Task 8 only
src/worker/prove.ts        /__prove route (dev only)
src/worker/index.ts        fetch router
web/index.html, web/main.ts, web/render.ts, web/local-cache.ts, web/styles.css
test/**                    mirrors src/
docs/platform-proof.md     Task 3 output
```

---

### Task 1: Project setup, shared types, platform metadata and rules

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`, `.gitignore`
- Create: `src/shared/types.ts`, `src/shared/platforms.ts`, `src/shared/rules.ts`
- Test: `test/shared/rules.test.ts`

**Interfaces:**
- Produces:
  - `type PlatformId = 'github'|'x'|'youtube'|'devto'|'hashnode'|'bluesky'|'npm'|'gitlab'|'huggingface'|'reddit'|'producthunt'|'hackernews'|'peerlist'|'linkedin'`
  - `type Status = 'free'|'taken'|'unknown'|'invalid'`
  - `type Method = 'api'|'page'|'browser'|'link-only'|'rules'`
  - `interface CheckResult { platform: PlatformId; name: string; status: Status; reason?: string; url: string; method: Method; checkedAt: number }`
  - `interface PlatformMeta { id: PlatformId; label: string; profileUrl(name: string): string; signupUrl: string; enabled: boolean; method: Method }`
  - `PLATFORMS: Record<PlatformId, PlatformMeta>`. All `enabled: true` until Task 3. LinkedIn is `method: 'link-only'`.
  - `normalizeName(raw: string): string`: trim, strip one leading `@`, lowercase.
  - `RULES: Record<PlatformId, { min: number; max: number; pattern: RegExp; describe: string }>`
  - `validateFor(platform: PlatformId, name: string): { ok: true } | { ok: false; rule: string }`
  - `isSearchable(name: string): { ok: true } | { ok: false; error: string }`: 1 to 39 characters, ASCII letters, digits, `_`, `-`, `.` only.

- [ ] **Step 1: Set up the project.** Run `git init`. Install `wrangler`, `typescript`, `vitest`, `@cloudflare/vitest-pool-workers` and `vite`. In `wrangler.jsonc` set `main: "src/worker/index.ts"`, an assets directory `dist/web`, and a D1 binding `DB`. Add npm scripts `test`, `dev` and `deploy`.
- [ ] **Step 2: Write the failing tests** in `test/shared/rules.test.ts`:

```ts
expect(normalizeName('  @ShubhamV ')).toBe('shubhamv');
expect(validateFor('x', 'shubhamvbuilds12')).toEqual({ ok: false, rule: expect.stringContaining('15') }); // 16 chars
expect(validateFor('x', 'shubhamvbuilds')).toEqual({ ok: true });
expect(validateFor('github', 'a_b').ok).toBe(false);
expect(validateFor('github', '-abc').ok).toBe(false);
expect(validateFor('github', 'shubham-v').ok).toBe(true);
expect(isSearchable('').ok).toBe(false);
expect(isSearchable('a'.repeat(300)).ok).toBe(false);
expect(isSearchable('шубхам').ok).toBe(false);
```

- [ ] **Step 3: Run `npm test`.** Expected: FAIL (modules not found).
- [ ] **Step 4: Implement types, `PLATFORMS` and `RULES`.** Starting rule values: X 4 to 15 characters, `[a-z0-9_]`. GitHub 1 to 39 characters, alphanumerics and single inner hyphens. Bluesky 3 to 18 characters, `[a-z0-9-]` (the label before `.bsky.social`). npm `[a-z0-9-._]`, 1 to 214 characters. For every other platform, read the limits off its signup form or docs, write them in, and put the source URL in a comment next to each rule.
- [ ] **Step 5: Run `npm test`.** Expected: PASS.
- [ ] **Step 6: Commit** with the message `feat: shared types, platform metadata and username rules`.

---

### Task 2: HTTP classifier and the 13 platform checkers

**Files:**
- Create: `src/worker/http.ts`, `src/worker/checkers/{github,gitlab,npm,devto,hashnode,bluesky,huggingface,youtube,reddit,hackernews,producthunt,peerlist,linkedin}.ts`, `src/worker/checkers/index.ts`
- Test: `test/worker/http.test.ts`, `test/worker/checkers.test.ts`

**Interfaces:**
- Consumes: Task 1 types and `PLATFORMS`.
- Produces:
  - `interface Env { DB: D1Database; GITHUB_TOKEN?: string; TRAFFIC_LEVEL?: string; TURNSTILE_SECRET?: string; BROWSER?: Fetcher; PROVE_KEY?: string }`
  - `interface CheckDeps { fetch: typeof fetch; env: Env }`
  - `interface Checker { id: PlatformId; check(name: string, deps: CheckDeps): Promise<CheckResult> }`
  - `fetchWithTimeout(f: typeof fetch, url: string, init?: RequestInit, ms = 5000): Promise<Response | 'timeout'>`
  - `classifyHttp(res: Response | 'timeout', opts: { freeWhen: (res: Response, body: string) => boolean; takenWhen: (res: Response, body: string) => boolean }): Promise<{ status: Status; reason?: string }>`: returns `free` only if `freeWhen` is true, `taken` only if `takenWhen` is true, and otherwise `unknown`. 429 and 403 give reason "Rate limited or blocked". A timeout gives "Timed out". Redirects to a login URL give "Login wall".
  - `CHECKERS: Partial<Record<PlatformId, Checker>>` (X is added in Task 8).

Expected detection per platform. Task 3 confirms or replaces each one:

| Platform | Request | free when | taken when |
|---|---|---|---|
| github | `api.github.com/users/{n}` with `Authorization: Bearer GITHUB_TOKEN` if set, plus a `User-Agent` | 404 | 200 |
| gitlab | `gitlab.com/api/v4/users?username={n}` | 200 and `[]` | 200 and non-empty array |
| npm | `registry.npmjs.org/-/user/org.couchdb.user:{n}` | 404 | 200 |
| devto | `dev.to/api/users/by_username?url={n}` | 404 | 200 |
| hashnode | POST `gql.hashnode.com` `{ user(username:"{n}") { id } }` | `data.user === null` | `data.user.id` present |
| bluesky | `public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle={n}.bsky.social` | 400 with body containing "Unable to resolve handle" | 200 with `did` |
| huggingface | `huggingface.co/api/users/{n}/overview` **and** `/api/organizations/{n}/overview` (shared namespace) | both 404 | either 200 |
| youtube | `www.youtube.com/@{n}` | 404 | 200 |
| reddit | `www.reddit.com/user/{n}/about.json` | 404 | 200 (including `is_suspended: true`) |
| hackernews | `hacker-news.firebaseio.com/v0/user/{n}.json` | body `null` | JSON with `id` |
| producthunt | `www.producthunt.com/@{n}` | 404 | 200 |
| peerlist | `peerlist.io/{n}` | 404 | 200 |
| linkedin | no request | never | never (always `unknown`, "LinkedIn can't be checked publicly") |

- [ ] **Step 1: Write the failing `classifyHttp` tests** with fake `Response` objects:
  - a 404 where `freeWhen` matches gives `free`
  - a 200 where `takenWhen` matches gives `taken`
  - a 200 where neither matches gives `unknown`
  - a 429 gives `unknown` with "Rate limited or blocked"
  - `'timeout'` gives `unknown` with "Timed out"
  - a 302 to `/login` gives `unknown` with "Login wall"
- [ ] **Step 2: Write the failing checker tests.** For each checker, stub `deps.fetch` to return the "free" and "taken" fixture responses and assert the status, plus a 500 asserting `unknown`. Add one LinkedIn test asserting `unknown` with the exact reason, and that `fetch` was never called. Add one GitHub test asserting the `Authorization` header is sent when `GITHUB_TOKEN` is set.
- [ ] **Step 3: Run `npm test`.** Expected: FAIL.
- [ ] **Step 4: Implement** `http.ts` and each checker. Each checker sets `url` to `PLATFORMS[id].profileUrl(name)`.
- [ ] **Step 5: Run `npm test`.** Expected: PASS.
- [ ] **Step 6: Commit** with the message `feat: platform checkers with conservative http classification`.

---

### Task 3: Prove every check from Cloudflare (gate for launch)

**Files:**
- Create: `src/worker/prove.ts`, `docs/platform-proof.md`
- Modify: `src/worker/index.ts` (route `/__prove`), `src/shared/platforms.ts` (the `enabled` flags)

**Interfaces:**
- Consumes: `CHECKERS`, `Env.PROVE_KEY`.
- Produces: `GET /__prove?key=…` returns `{ platform, takenName, takenStatus, freeName, freeStatus, invalidName, invalidStatus, pass: boolean }[]`. Returns 404 unless `key === env.PROVE_KEY`.

- [ ] **Step 1: Implement `/__prove`.** For each platform, use a known-taken name (a big, real account on that platform, chosen per platform), a known-free name of 14 random lowercase letters generated at request time, and a name that breaks that platform's rule. `pass` is true only if they come back `taken`, `free` and `invalid` respectively. Also attempt X: a plain `fetch` of `x.com/{n}` and, if a `BROWSER` binding is configured, a Browser Rendering check that looks for the text "This account doesn't exist".
- [ ] **Step 2: Deploy and run from Cloudflare,** not localhost: `npx wrangler secret put PROVE_KEY`, then `npm run deploy`, then `curl "https://<worker>.workers.dev/__prove?key=…"`. Expected: a JSON array with 13 entries plus an X entry.
- [ ] **Step 3: Run it 3 times, at least 10 minutes apart.** Record each platform's results in `docs/platform-proof.md`. A platform passes only if all 3 runs pass.
- [ ] **Step 4: Fix and record.** For each failing platform, try the alternative from the spec (the page check for npm is `www.npmjs.com/~{n}`). If it still fails, set `enabled: false` in `PLATFORMS` and record why. Record whether X works via plain fetch, browser, or neither. **Neither** means X ships link-only and Task 8 is skipped.
- [ ] **Step 5: Commit** with the message `chore: prove platform checks from cloudflare, record results`.

---

### Task 4: D1 cache

**Files:**
- Create: `migrations/0001_cache.sql`, `src/worker/cache.ts`
- Test: `test/worker/cache.test.ts`

**Interfaces:**
- Produces:
  - Table `results(platform TEXT, name TEXT, status TEXT, reason TEXT, method TEXT, checked_at INTEGER, PRIMARY KEY(platform, name))`
  - `getCached(db: D1Database, platform: PlatformId, name: string, now: number): Promise<CheckResult | null>`: returns null if the entry has expired.
  - `putCached(db: D1Database, r: CheckResult): Promise<void>`: no-op for `unknown` and `invalid`.
  - `TTL = { free: 3_600_000, taken: 86_400_000 }`

- [ ] **Step 1: Write the failing tests** (D1 comes from the vitest pool):
  - Put a `free` result. It's found at `now + 59 min` and gone at `now + 61 min`.
  - Put a `taken` result. It's found at `now + 23 h`.
  - **Put an `unknown` result, then `getCached` returns null** (Review Focus 4).
  - Put an `invalid` result, then `getCached` returns null.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement** with `INSERT … ON CONFLICT(platform, name) DO UPDATE`. Apply the migration with `npx wrangler d1 migrations apply DB` (locally and remotely).
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat: d1 result cache with per-status ttl`.

---

### Task 5: Check API, traffic levels and rate limiting

**Files:**
- Create: `src/worker/api.ts`, `src/worker/traffic.ts`
- Modify: `src/worker/index.ts`
- Test: `test/worker/api.test.ts`

**Interfaces:**
- Consumes: `CHECKERS`, `PLATFORMS`, `validateFor`, `isSearchable`, `normalizeName`, `getCached`, `putCached`.
- Produces:
  - `GET /api/check?name={raw}&platforms={comma-separated ids}` returns 200 with `Content-Type: application/x-ndjson`, one `CheckResult` JSON object per line, **written as each platform finishes**, so the UI can stream rows from a single request. `CheckResult.name` carries the normalized name. Invalid names get 400 with `{ error: string }`, and rate-limited visitors get 429 with `{ error: "Too many searches, try again in a few minutes" }`.
  - `trafficLevel(env: Env): 0|1|2|3`, parsed from `TRAFFIC_LEVEL` (default 0, anything invalid means 0).
  - Level ≥ 1: X returns `unknown`, "High traffic: check it yourself", with no browser call. Level ≥ 2: the API rejects requests flagged `suggestion=1` with 503 `{ error: "Suggestions paused due to high traffic" }`. Level 3: cache TTLs are multiplied by 6.
  - Rate limit: 60 `/api/check` calls per IP (`CF-Connecting-IP`) per 10 minutes, using the Workers Rate Limiting binding. In Step 3, confirm it's available on the Free plan. If it isn't, use one Cloudflare WAF rate-limiting rule with the same numbers and note it in `README.md`.

- [ ] **Step 1: Write the failing tests:**
  - `name=%20@ShubhamV` gets NDJSON lines, each with `name: "shubhamv"`.
  - `name=` gets 400. A 300-character name gets 400. `name=шубхам` gets 400. **The fetch stub is called 0 times in all three.**
  - `name=shubhamvbuilds12&platforms=x,github`: X is `invalid` with the 15-character rule and makes no fetch for X, and GitHub is checked.
  - A cached `taken` result is returned without calling fetch.
  - Disabled platforms produce no line.
  - `TRAFFIC_LEVEL=2` with `suggestion=1` gets 503.
  - Every result has a non-empty `url`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Tests parse the NDJSON body into lines and assert on the parsed results. Run the checkers in parallel, writing each result to a `TransformStream` as it settles, and close the stream after the last one. A cache hit skips the checker. A checker that throws becomes `unknown` with "Check failed".
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat: check api with validation, cache, traffic levels and rate limit`.

---

### Task 6: Front end: search, streaming results, platform selection

**Files:**
- Create: `vite.config.ts` (output `dist/web`), `web/index.html`, `web/main.ts`, `web/render.ts`, `web/local-cache.ts`, `web/styles.css`
- Test: `test/web/render.test.ts`, `test/web/local-cache.test.ts`

**Interfaces:**
- Consumes: `/api/check`, `PLATFORMS`, `isSearchable`, `normalizeName`, `validateFor`.
- Produces:
  - `renderRow(r: CheckResult): HTMLElement`
  - `localGet(name: string): CheckResult[] | null` and `localPut(name: string, results: CheckResult[]): void`, stored in localStorage under key `uc:v1:{name}` with a 1-hour expiry, skipping `unknown` results.
  - Selected platforms are saved in localStorage under `uc:platforms`.

- [ ] **Step 1: Write the failing tests** (jsdom):
  - `renderRow` for `free` contains "No account found", the reserve note text from Global Constraints, and a link to `signupUrl`.
  - `taken` contains "Taken" and links to `url`.
  - `unknown` contains "Couldn't confirm" plus the reason text, and links to `url`.
  - `invalid` contains the rule text and no link.
  - The LinkedIn row text includes "Check it yourself".
  - `localPut` followed by `localGet` round-trips, and an expired entry returns null.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Validate on submit with `isSearchable`, showing the error inline without calling the API. Show `invalid` rows immediately from `validateFor`. Call `/api/check` once for the typed name, read the NDJSON body with a stream reader, and render each row as its line arrives. Add platform checkboxes and a copy-name button. Layout follows the sketch in the spec's "User experience" section.
- [ ] **Step 4: Run `npm test`, then `npm run dev`** and search `shubhamvbuilds` and `github` by hand. Expected: rows render. `github` shows Taken on GitHub, and LinkedIn shows Check it yourself.
- [ ] **Step 5: Commit** with the message `feat: search ui with streaming results and platform selection`.

---

### Task 7: Suggestions

**Files:**
- Create: `src/shared/suggest.ts`
- Modify: `web/main.ts`, `web/render.ts`
- Test: `test/shared/suggest.test.ts`

**Interfaces:**
- Produces: `generateSuggestions(base: string, platforms: PlatformId[], count = 6): string[]`. Uses suffixes `builds, codes, dev, hq, labs, ships`, prefixes `hey, the, iam`, and a `{base}{firstLetterOfSecondPart}` form when the input has a separator. Returns only names that pass `validateFor` on **every** selected platform, deduplicated, never the base itself, in the stated pattern order.

- [ ] **Step 1: Write the failing tests:**
  - `generateSuggestions('shubham', ['x','github'])` has length 6, and every item passes `validateFor('x', …)` and `validateFor('github', …)`.
  - It doesn't contain `'shubham'`.
  - For a 13-character base with `x` selected, no result is longer than 15 characters.
  - The output is deterministic (same input, same output).
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `generateSuggestions`.** In the UI, when any selected platform is `taken`, call `/api/check` for each suggestion in parallel with `suggestion=1` and **without X**. List only suggestions free on all selected non-X platforms. Show X as an "X: check →" button that calls `/api/check?name=…&platforms=x` on click. If X is link-only, show a plain link to `x.com/{name}`. A 503 hides the section and shows "Suggestions paused due to high traffic".
- [ ] **Step 4: Run `npm test`, then `npm run dev`** and search `shubham`. Expected: up to 6 suggestions, each free on every selected platform.
- [ ] **Step 5: Commit** with the message `feat: suggestions free on every selected platform`.

---

### Task 8: X check (only if Task 3 proved a method)

Skip this task entirely if `docs/platform-proof.md` says X failed both methods. In that case, add `x` to `CHECKERS` as link-only (`unknown`, "Check it yourself"), commit, and continue to Task 9.

**Files:**
- Create: `src/worker/checkers/x.ts`, plus `src/worker/x-browser.ts` if the browser method won
- Modify: `src/worker/checkers/index.ts`, and `wrangler.jsonc` (`browser` binding `BROWSER`) if needed
- Test: `test/worker/x.test.ts`

**Interfaces:**
- Produces: `xChecker: Checker`. Free when the page text contains "This account doesn't exist", taken when it contains `@{name}` in the profile header, and otherwise `unknown`. If the browser returns a quota or limit error, the result is `unknown` with "Daily check limit reached. Check it yourself".

- [ ] **Step 1: Write the failing tests** with a stubbed page-text provider: the not-exists text gives `free`, profile text gives `taken`, a login-wall text gives `unknown`, a quota error gives `unknown` with the limit reason, and `TRAFFIC_LEVEL=1` gives `unknown` with no provider call.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** When using the browser, reuse one session per Worker isolate (`puppeteer.connect` to an existing session if one is open), and close pages after each check.
- [ ] **Step 4: Run `npm test`, deploy, and check `/api/check?name=github&platforms=x`.** Expected: `taken`.
- [ ] **Step 5: Commit** with the message `feat: x check via proven method`.

---

### Task 9: Turnstile, alerts, launch

**Files:**
- Create: `src/worker/turnstile.ts`, `README.md`
- Modify: `src/worker/api.ts`, `web/main.ts`, `web/index.html`
- Test: `test/worker/turnstile.test.ts`

**Interfaces:**
- Produces: `verifyTurnstile(token: string | null, ip: string, env: Env, f: typeof fetch): Promise<boolean>`, which POSTs to `challenges.cloudflare.com/turnstile/v0/siteverify`. When `TURNSTILE_SECRET` is unset (local dev), it returns true.
- Requests with `suggestion=1` require a valid `cf-turnstile-response` header, otherwise they get 403 `{ error: "Verification failed" }`.

- [ ] **Step 1: Write the failing tests:** a missing token with the secret set gives false. A stubbed `success: true` gives true. The API with `suggestion=1` and a bad token gives 403. Typed-name checks don't need a token.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use an invisible Turnstile widget on the page, getting a token before suggestion calls.
- [ ] **Step 4: Write `README.md` covering:**
  - setup (secrets: `GITHUB_TOKEN`, `TURNSTILE_SECRET`, `PROVE_KEY`)
  - deploy commands
  - how to change `TRAFFIC_LEVEL` (`wrangler deploy --var TRAFFIC_LEVEL:1`, or the dashboard)
  - setting dashboard notifications at 70% of daily Workers requests (100,000), D1 rows written (100,000) and Browser Rendering minutes (10)
- [ ] **Step 5: Run `npm test`, `npm run deploy`, then smoke-test the live URL** with `github` (taken nearly everywhere), a 14-random-letter name (free nearly everywhere), and `шубхам` (error message). Expected: all three behave as described.
- [ ] **Step 6: Commit** with the message `feat: turnstile on suggestions, readme, launch`.
