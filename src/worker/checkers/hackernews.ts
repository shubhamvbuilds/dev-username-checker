import type { Checker } from './types';
import { is200, parseJson, simpleCheck } from '../http';

export const hackernews: Checker = {
  id: 'hackernews',
  check: (name, deps) =>
    simpleCheck('hackernews', name, deps, `https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(name)}.json`, {
      freeWhen: (r, b) => is200(r, b) && b.trim() === 'null',
      takenWhen: (r, b) =>
        is200(r, b) && typeof (parseJson(b) as { id?: string } | undefined)?.id === 'string',
    }),
};
