import type { Checker } from './types';
import { simpleCheck, status404or200 } from '../http';

export const reddit: Checker = {
  id: 'reddit',
  check: (name, deps) =>
    simpleCheck('reddit', name, deps, `https://www.reddit.com/user/${encodeURIComponent(name)}/about.json`, status404or200),
};
