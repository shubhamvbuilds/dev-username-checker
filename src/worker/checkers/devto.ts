import type { Checker } from './types';
import { simpleCheck, status404or200 } from '../http';

export const devto: Checker = {
  id: 'devto',
  check: (name, deps) =>
    simpleCheck('devto', name, deps, `https://dev.to/api/users/by_username?url=${encodeURIComponent(name)}`, status404or200),
};
