import type { Checker } from './types';
import { simpleCheck, status404or200 } from '../http';

export const producthunt: Checker = {
  id: 'producthunt',
  check: (name, deps) =>
    simpleCheck('producthunt', name, deps, `https://www.producthunt.com/@${encodeURIComponent(name)}`, status404or200),
};
