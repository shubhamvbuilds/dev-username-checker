import type { Checker } from './types';
import { simpleCheck, status404or200 } from '../http';

// Profile page, not the API: /api/users/by_username covers users only, but
// organizations share the namespace (dev.to/github is an org and returns 200 here).
// redirect: 'manual' (fetchWithTimeout default) makes any 3xx unknown.
export const devto: Checker = {
  id: 'devto',
  check: (name, deps) =>
    simpleCheck('devto', name, deps, `https://dev.to/${encodeURIComponent(name)}`, status404or200),
};
