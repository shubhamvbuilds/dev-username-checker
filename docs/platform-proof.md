# Platform proof (Task 3)

Template. The owner fills this in after running `/__prove` from Cloudflare (not localhost).

## How to run

1. `npx wrangler login`
2. `npx wrangler secret put PROVE_KEY` (choose any long random string)
3. `npm run deploy`
4. Run three times, at least 10 minutes apart:

```sh
curl "https://<worker>.workers.dev/__prove?key=<PROVE_KEY>" | jq .
```

Expected: a JSON object. `platforms` holds 13 platform entries plus an X entry; each platform entry has `takenStatus`, `freeStatus`, `invalidStatus` and `pass`. `traps` holds names that must never come back `free` (DEV `github`, GitLab `github`, Hugging Face `huggingface`, Hacker News `walterbright`); each needs `pass: true`. Run `jq '.platforms, .traps'` to read them.

A platform passes only if all 3 runs pass. For a failing platform, try the alternative from the spec (the npm page check is `www.npmjs.com/~{name}`). If it still fails, make it link-only (`method: 'link-only'` and remove it from `CHECKERS`) and record why below.

## Results

Cell format: `taken/free/invalid` statuses, then PASS or FAIL. Run times (UTC): run 1 ____, run 2 ____, run 3 ____.

| Platform | Run 1 | Run 2 | Run 3 | Decision (`checked` / `link-only`) | Reason |
| --- | --- | --- | --- | --- | --- |
| github |  |  |  |  |  |
| gitlab |  |  |  |  |  |
| npm |  |  |  |  |  |
| devto |  |  |  |  |  |
| hashnode |  |  |  |  |  |
| bluesky |  |  |  |  |  |
| huggingface |  |  |  |  |  |
| youtube |  |  |  |  |  |
| reddit |  |  |  |  |  |
| hackernews |  |  |  |  |  |
| producthunt |  |  |  |  |  |
| peerlist |  |  |  |  |  |
| linkedin (link-only; pass = all unknown) |  |  |  |  |  |

## Traps

| Trap | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| devto `github` (org) |  |  |  |
| gitlab `github` (group) |  |  |  |
| huggingface `huggingface` (org) |  |  |  |
| hackernews `walterbright` (case) |  |  |  |

## X decision: plain fetch / browser / neither (→ link-only, skip Task 8)

Raw observations from the `x` entry (`method: plain-fetch`):

| Run | taken HTTP status | taken has "This account doesn't exist" | free HTTP status | free has "This account doesn't exist" |
| --- | --- | --- | --- | --- |
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |

Decision: ______ (plain fetch / browser / neither)

Reason: ______

If **neither**, X ships link-only and Task 8 is skipped.
