import type { Checker } from './types';
import { simpleCheck, status404or200 } from '../http';

export const npm: Checker = {
  id: 'npm',
  check: (name, deps) =>
    simpleCheck('npm', name, deps, `https://registry.npmjs.org/-/user/org.couchdb.user:${encodeURIComponent(name)}`, status404or200),
};
