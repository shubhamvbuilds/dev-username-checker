# Developer username checker: design

Date: 2026-11-25
Status: draft, awaiting approval
Working name: TBD (product name not chosen yet)

## Intent

A free website where a developer types a username and sees, on one screen, whether it's free on every platform where developers have a presence: GitHub, X, npm, Hugging Face and others. When the name is taken somewhere, it suggests close variations that are free on all of them.

**Why:** the owner wants to build a tool that genuinely helps people. The idea came from finding a handle by hand. Checking one name was easy. The hard part was trying 25 names to find one (`shubhamvbuilds`) free on every platform. Existing checkers (Namechk, KnowEm, Instant Username) only answer "is this one name free?". Nothing popular solves "find me a name that's free everywhere".

**Who:** developers choosing a handle: someone starting to build in public, rebranding, or naming a side project. Developer-first was a deliberate choice. These platforms mostly have public APIs (cheap, reliable checks), the audience is easy to reach for the owner (dev X, r/SideProject, Peerlist, Product Hunt), and the pitch is distinctive.

## Goals

1. Check one username across the launch platforms in a single search and show the result per platform.
2. When the name is taken anywhere, suggest variations that are free on every platform the user selected.
3. Results are honest: every platform shows one of
   - ✅ **Free**
   - ❌ **Taken**
   - ⚠️ **Couldn't confirm**, with a short reason ("rate limited", "daily check limit reached", "this platform can't be checked publicly")
   - 🚫 **Not allowed here**: the name breaks this platform's rules (too long, invalid characters), with the rule shown.
4. Every row links to the platform: the signup or rename page when the name is free, the profile when it's taken.
5. Runs at ₹0 per month on free tiers, with no credit card, until traffic justifies paying.
6. No signup or login needed to search.

## Non-goals (for launch)

- General social platforms (Instagram, TikTok, Facebook, Snapchat, Threads). Phase 2.
- Domain availability (.com, .dev). Out of scope for now.
- The "check 600+ more sites" button built on WhatsMyName or Sherlock data. Phase 2, after a license check.
- Browser extension. Phase 2.
- User accounts, saved searches, watchlists or "notify me when this frees up".
- Claiming or registering names on the user's behalf.

## Anti-goals (failure even if it technically works)

- **Saying "Free" when the name is actually taken.** One wrong "free" costs more trust than a missing platform. When unsure, show ⚠️.
- Becoming a free scraping API for bots. Abuse controls are required at launch.
- The whole site going down under load. Degrade feature by feature instead.
- Anything that needs the user's credentials or logs in to platforms on their behalf.

## Launch platforms

A platform ships only after its check is proven against a known-taken and a known-free name, plus a name breaking that platform's rules. Platforms that fail testing are dropped from launch, not shipped with a guess.

| # | Platform | Check method (expected) | Status today |
|---|---|---|---|
| 1 | GitHub | REST API `GET /users/{name}` (404 = free) | Tested by hand this session ✅ |
| 2 | X | Browser-free endpoint if it proves out, else headless browser looking for "This account doesn't exist" | Profile page tested by hand ✅. Browser-free endpoint **untested** |
| 3 | YouTube | `GET youtube.com/@{name}` (404 = free) | Tested by hand ✅ |
| 4 | Dev.to | Public API | Untested |
| 5 | Hashnode | Public API (GraphQL) | Untested |
| 6 | Bluesky | Public handle-resolve API for `{name}.bsky.social` | Untested |
| 7 | npm | Registry user lookup | Untested |
| 8 | GitLab | Public users API | Untested |
| 9 | Hugging Face | Public API | Untested |
| 10 | Reddit | Public profile data URL | Untested |
| 11 | Product Hunt | Profile page | Untested |
| 12 | Hacker News | Profile page / public API | Untested |
| 13 | Peerlist | Profile page | Untested |
| - | LinkedIn | Can't be checked publicly. Always ⚠️ with a "check it yourself" link | Confirmed: login wall |

**If X can't be checked reliably (owner's decision):** X still ships at launch, as ⚠️ "Check it yourself" with a direct link to `x.com/{name}`, the same treatment as LinkedIn. Launch is not delayed for X. If a reliable method is found later, X switches to automatic checks. This also means build step 5 (X browser checker) is only built if build step 1 shows the browser approach works from Cloudflare.

**Terms-of-service stance (owner's decision):** light checks of public profile pages are acceptable where no official API exists (X, Product Hunt, Peerlist, Reddit, Hacker News). They must stay low-volume: cache results, send one request per name per platform, stop on a block or rate-limit response, and fall back to ⚠️ plus a "check it yourself" link. Never use evasion techniques (rotating proxies, faked identities, CAPTCHA solving). If a platform objects or blocks the tool, it becomes a "check it yourself" link.

**Per-platform rules** (length, allowed characters, case) live in one shared table used by the front end (to show 🚫 immediately) and the suggestion generator (so it never suggests invalid names). Example: X allows at most 15 characters. GitHub allows letters, digits and single hyphens only.

**What ✅ means (Claude's call):** ✅ means "no account found", not "guaranteed registrable". Platforms can reserve names, hold names of deleted or suspended accounts, or keep retention periods (GitHub, YouTube, Reddit, Hacker News all do some of this), and there is no public way to check registrability. The UI says this plainly: the label reads "No account found", with a short note that the platform may still reserve it, and the signup link is the final confirmation. Test names for build step 1: "known-free" means a random string that is very unlikely to have ever existed (for example 14 random letters), not a name we merely believe is unused.

**API tokens (Claude's call):** the owner's own free developer tokens may be used where they're needed or raise limits (GitHub: 60 to 5,000 requests per hour; Twitch-style APIs). They're stored as Cloudflare Worker secrets, never in the front end. All of these are free and need no card.

**Case and normalization:** treat names as case-insensitive on platforms that are (most). Store the rule per platform.

## User experience

```
┌──────────────────────────────────────────────┐
│  [ shubhambuilds              ] [Check]      │
│  Platforms: ☑ all 13   (edit)                │
├──────────────────────────────────────────────┤
│  shubhambuilds                               │
│  ✅ GitHub     ❌ X (taken)     ✅ npm        │
│  ✅ Dev.to     ⚠️ LinkedIn (check yourself)  │
│  …                                           │
├──────────────────────────────────────────────┤
│  Free on every selected platform:            │
│   shubhamvbuilds   ✅ all 12  (X: check →)   │
│   shubhamvcodes    ✅ all 12  (X: check →)   │
│   …                                          │
└──────────────────────────────────────────────┘
```

- Results stream in per platform as they finish. No waiting for the slowest one.
- Users can deselect platforms they don't care about. Suggestions only need to be free on the selected ones.
- **Suggestions:** generated in the browser from the typed name using patterns (prefix and suffix words like `builds`, `codes`, `dev`, `hq`, `labs`, `ships`, `hey`, `the`, `iam`, plus initial-letter variations like `shubhamv`). Filtered by platform rules before any network call. Show about 5 to 8.
- **X for suggestions is on demand.** X needs the scarce browser check, so suggestions show "X: check →" and the browser check runs only when the user clicks it. If the browser-free X endpoint proves reliable, X is checked automatically like the others.
- Copy-friendly: one click copies the name, and each ✅ row links to signup.

## Approaches considered

1. **All checks from one simple server app (Next.js on Vercel).** Fastest to build, but X will block datacenter servers and results silently go wrong. Vercel Hobby also forbids commercial use. Rejected.
2. **Headless browser for every platform, with paid proxies.** Most accurate, but slow and costs money from day one. Rejected (violates the ₹0 goal).
3. **Hybrid on Cloudflare's free plan (chosen).** Plain API and HTTP checks for almost every platform. A headless browser (Cloudflare Browser Rendering) only for X, and only when needed. Aggressive caching. No card required.

**Chosen: 3.** The owner handed the technical choices to Claude and required zero cost with no card verification. Oracle Cloud Always Free was rejected because signup requires a card. Hugging Face Spaces was rejected because Docker Spaces now need a paid plan.

## Architecture (all Cloudflare Workers Free, no card)

- **Front end:** static site served as Cloudflare static assets. Static asset requests don't count toward the Workers request limit. Suggestion generation, rule checks and a local result cache (localStorage, a few hours) all run in the browser.
- **Check API:** a Cloudflare Worker. **One request checks one name** against the selected platforms, because free Workers allow at most 50 outside calls per request. The browser fires one request per name in parallel.
- **X checker:** the Worker first tries the browser-free method, if it is proven. Otherwise it uses Cloudflare Browser Rendering (free: 10 browser-minutes a day, 3 at once), reusing one open browser session across checks.
- **Cache:** Cloudflare D1, with one row per (platform, name) holding result, checked_at and method. Suggested TTLs: free results 1 hour, taken results 24 hours (taken names rarely become free). **Not Workers KV**: its free tier allows only 1,000 writes a day, which would cap the tool at roughly 55 users.
- **Abuse protection:** Cloudflare Turnstile (free, no card) before suggestion runs or heavy use, plus a per-visitor limit on searches per hour.
- **Language and tooling:** TypeScript throughout (the owner's usual stack). Framework choice is left to the builder, as long as it deploys as static assets plus Workers.

## Capacity on the free plan (estimates)

Assumption: one user makes 3 searches. Each search checks the typed name plus about 5 suggestions on 13 platforms.

| Free limit | Approximate daily users |
|---|---|
| Workers: 100,000 requests/day | ~5,500 |
| D1: 100,000 row writes/day | ~5,500 (fewer with good cache hits) |
| Browser Rendering: 10 min/day (~200 X checks) | ~200 typed-name X checks per day, if X needs the browser |

The browser limit only matters for X. If the browser-free X check works, the tool supports roughly 5,000 users a day for free.

## Scaling and going viral

Limits run out in a known order. Each has a prepared response.

1. **Usage alerts** at 70% of each daily free limit (Cloudflare analytics or notifications).
2. **High-traffic mode,** one config switch with escalating levels:
   - Level 1: X browser checks off. X shows ⚠️ plus a "check it yourself" link to `x.com/{name}`.
   - Level 2: automatic suggestions off (on-demand only).
   - Level 3: typed-name checks only, with longer cache TTLs.

   The point is to never reach the 100,000-requests-a-day limit, because past it Cloudflare returns error 1027 and **the whole site goes down** until midnight UTC.
3. **Paid upgrade path:** if growth is sustained, move to Cloudflare Workers Paid ($5/month, needs a card). Estimated cost at 50,000 users a day is about $10/month, **as long as X doesn't use the browser.** Browser checks at that scale would cost about $675/month, so at that point X must use the browser-free method, the phase 2 extension, or the "check it yourself" link.
4. **Covering costs without charging users:** affiliate links on claim buttons where they exist, a small sponsor slot, or a "buy me a coffee" link. Optional, and only once costs exist.

## Build order

1. **Prove the checks first.** A small script that runs every launch platform's check against a known-taken name, a known-free name and a rule-breaking name, from a Cloudflare Worker, not a laptop, because platforms treat datacenter IPs differently. Include the browser-free X method. Platforms that fail are dropped from launch.
2. Check API Worker plus D1 cache.
3. Front end: search, streaming results, platform selection.
4. Suggestion generator with rule filtering.
5. X browser checker, on demand.
6. Turnstile, rate limits, high-traffic switch, usage alerts.
7. Launch.

## Decided by the owner

- Purpose: help people, with money not a goal at launch.
- Developer-first launch audience, with general social platforms later.
- Suggestions (the "find a name free everywhere" feature) are core, not just checking.
- ₹0 cost, no credit-card verification.
- Technical choices delegated to Claude.
- X ships as ⚠️ with a "check it yourself" link if it can't be checked reliably. Launch isn't delayed for it.
- Light, low-volume checks of public pages are acceptable where no official API exists.

## Claude's calls (owner to confirm while reading)

- ✅ means "no account found", not "guaranteed registrable", and the UI says so.
- The owner's own free developer tokens (GitHub and others) are used where needed, stored as Worker secrets.
- Cloudflare for everything, with D1 rather than KV for the cache.
- 13 launch platforms plus LinkedIn as a link only. Instagram, TikTok and the 600-site button wait for phase 2.
- X is checked on demand for suggestions, to save scarce browser minutes.

## Left to the builder

- Front-end framework and UI design details.
- Exact check implementation per platform (endpoint, parsing), within the "proven against known-taken and known-free names" rule.
- Exact cache TTLs, rate-limit numbers and suggestion patterns (sensible defaults are above).
- Product name and domain. The owner hasn't chosen them yet. Launching on a free `*.workers.dev` or `*.pages.dev` address is fine.
