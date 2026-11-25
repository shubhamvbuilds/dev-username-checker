# Dev Username Checker

A free web page that checks whether a username is available across developer platforms (GitHub, YouTube, DEV, Bluesky and others) and suggests variations that are free on every platform you selected. It runs as one Cloudflare Worker with static assets, a D1 cache and no accounts.

## Local dev

```
npm install
npx wrangler d1 migrations apply DB --local
npm run dev
npm test
```

Without `VITE_TURNSTILE_SITE_KEY` the page skips Turnstile, and without `TURNSTILE_SECRET` the Worker accepts suggestion requests without a token.

## What the status marks mean

A check mark means "No account found" on that platform at the time of the check. It is not a guarantee: the name may be reserved, banned, or registered a moment later. Check the platform itself before relying on it.

## Owner deploy checklist

Do these in order.

1. `npx wrangler login`
2. `npx wrangler d1 create dev-username-checker`, then put the returned id in `database_id` in `wrangler.jsonc`.
3. `npx wrangler d1 migrations apply DB --remote`
4. Set secrets (each prompts for the value):
   - `npx wrangler secret put GITHUB_TOKEN`: a fine-grained personal access token with no scopes.
   - `npx wrangler secret put PROVE_KEY`: any random string.
   - `npx wrangler secret put TURNSTILE_SECRET`: from the Turnstile widget in step 5. Create the widget first if you do not have the secret yet.
5. In the Cloudflare dashboard create a Turnstile widget (mode: invisible) for your domain. Its site key is public; pass it at build time: `VITE_TURNSTILE_SITE_KEY=<site key> npm run build`. Its secret is `TURNSTILE_SECRET`.
6. `VITE_TURNSTILE_SITE_KEY=<site key> npm run deploy` (the deploy script builds first and inherits the variable).
7. Open `/__prove` with your `PROVE_KEY`, at least 3 times, each at least 10 minutes apart. The response has `platforms` (taken/free/invalid per platform) and `traps` (names that must never come back free: every trap must show `pass: true`). Fill in `docs/platform-proof.md` with the results. A platform that fails becomes link-only (`method: 'link-only'` in `src/shared/platforms.ts`, and remove it from `CHECKERS`). Then redeploy.
8. Rotate or delete `PROVE_KEY` afterwards (`npx wrangler secret delete PROVE_KEY`).

### Turnstile

Only suggestion requests (`suggestion=1`) are verified; typed-name checks never need a token. Tokens are single-use, so the page renders one invisible widget per suggestion request and sends the token in the `cf-turnstile-response` header. If verification errors or times out, the Worker rejects the request with 403.

## Rate limiting

`wrangler.jsonc` declares a Workers Rate Limiting binding (`RATE_LIMITER`, 30 requests per 60 s per IP). Before deploying:

- Replace the placeholder `namespace_id` with a real, unique number for your account.
- Confirm the binding is available on the Free plan. If it is not, remove the `ratelimits` block and add one WAF rate-limiting rule in the dashboard: about 60 requests per 10 minutes per IP on `/api/check`.

## Traffic levels

`TRAFFIC_LEVEL` is a plain variable, 0 to 3. Invalid or unset means 0.

| Level | Effect |
| --- | --- |
| 0 | Normal. |
| 1 | X checks become link-only ("check it yourself"). |
| 2 | Suggestions are paused (503). |
| 3 | Cached taken results are served for up to 6 days instead of 1 (free results always expire after 1 hour), on top of level 2 behaviour. |

Set it with `npx wrangler deploy --var TRAFFIC_LEVEL:1`, or in the dashboard under Workers, your Worker, Settings, Variables. Note that a later plain `wrangler deploy` resets it to the value in config (unset = 0).

## D1 write capacity

D1's free plan allows 100,000 rows written per day. Only definitive answers (free or taken) are cached, one row per platform and name, and a cache hit never writes. A search writes roughly (1 + suggestions) x fetching platforms rows. About 6 to 8 platforms are cached (Hacker News is never cached, and Reddit and Product Hunt are often blocked), and suggestions (up to 6 names) only run when the typed name is taken.

- Search with suggestions: about 7 x 7 = 50 writes, so roughly 2,000 searches a day.
- Search without suggestions (the name is free): about 7 writes, so up to roughly 14,000 a day.
- Repeated names inside the cache window cost nothing.

Plan for roughly 2,000 to 5,000 searches a day in practice. Past that, raise `TRAFFIC_LEVEL`. A 403 or 429 from a platform also writes one row to `blocks` and pauses that platform for 10 minutes.

## Usage alerts

In the dashboard, under Notifications, add usage alerts at 70% of the free limits:

- Workers requests: 70,000 of 100,000 per day.
- D1 rows written: 70,000 of 100,000 per day.
- Browser Rendering: 7 of 10 minutes per day.

## Platform status

The whole table is pending the owner's `/__prove` run: nothing here is proven against the live sites yet.

| Platform | Status | Notes |
| --- | --- | --- |
| GitHub | Checked | |
| YouTube | Checked | |
| DEV | Checked | |
| Bluesky | Checked | |
| GitLab | Checked | Private groups are invisible, so a free result carries a warning. |
| Hugging Face | Checked | |
| Hacker News | Checked | Names are case-sensitive, so a missing account is shown as unknown, never free. |
| Reddit | Checked, often blocked (shows ⚠️) | |
| Product Hunt | Checked, often blocked (shows ⚠️) | |
| X | Link-only | No reliable unauthenticated check. |
| LinkedIn | Link-only | Login wall blocks automated checks. |
| npm | Link-only | No reliable check for user names. |
| Hashnode | Link-only | No reliable check for user names. |
| Peerlist | Link-only | No reliable check for user names. |
