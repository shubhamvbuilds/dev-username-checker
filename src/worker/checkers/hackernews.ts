import type { Checker } from './types';
import { classifyHttp, fetchWithTimeout, is200, makeResult, parseJson } from '../http';

export const HN_CASE_REASON = 'Hacker News names are case-sensitive. Check it yourself';

// The Firebase API is case-sensitive: /user/WalterBright.json is the account but
// /user/walterbright.json is null. We only ever hold the lowercased name, so a
// null body proves nothing and must never read as free.
export const hackernews: Checker = {
  id: 'hackernews',
  check: async (name, deps) => {
    const res = await fetchWithTimeout(
      deps.fetch,
      `https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(name)}.json`,
    );
    const c = await classifyHttp(res, {
      freeWhen: (r, b) => is200(r, b) && b.trim() === 'null',
      takenWhen: (r, b) => is200(r, b) && typeof (parseJson(b) as { id?: string } | undefined)?.id === 'string',
    });
    return makeResult('hackernews', name, c.status === 'free' ? { status: 'unknown', reason: HN_CASE_REASON } : c);
  },
};
