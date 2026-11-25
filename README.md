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
7. Open `/__prove` with your `PROVE_KEY`, at least 3 times, each at least 10 minutes apart. Fill in `docs/platform-proof.md` with the results and set the `enabled` flags in `src/shared/platforms.ts` accordingly, then redeploy.
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
| 3 | Cached results are served for up to 6 hours instead of 1, on top of level 2 behaviour. |

Set it with `npx wrangler deploy --var TRAFFIC_LEVEL:1`, or in the dashboard under Workers, your Worker, Settings, Variables. Note that a later plain `wrangler deploy` resets it to the value in config (unset = 0).

## Usage alerts

In the dashboard, under Notifications, add usage alerts at 70% of the free limits:

- Workers requests: 70,000 of 100,000 per day.
- D1 rows written: 70,000 of 100,000 per day.
- Browser Rendering: 7 of 10 minutes per day.

## Platform status

| Platform | Status | Notes |
| --- | --- | --- |
| GitHub | Checked | |
| YouTube | Checked | |
| DEV | Checked | |
| Bluesky | Checked | |
| GitLab | Checked | |
| Hugging Face | Checked | |
| Hacker News | Checked | |
| Reddit | Checked | |
| Product Hunt | Checked | |
| X | Link-only | No reliable unauthenticated check. |
| LinkedIn | Link-only | Login wall blocks automated checks. |
| npm | Link-only | No reliable check for user names. |
| Hashnode | Link-only | No reliable check for user names. |
| Peerlist | Link-only | No reliable check for user names. |
