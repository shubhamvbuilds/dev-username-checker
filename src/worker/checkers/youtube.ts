import type { Checker } from './types';
import { simpleCheck, status404or200 } from '../http';

export const youtube: Checker = {
  id: 'youtube',
  check: (name, deps) =>
    simpleCheck('youtube', name, deps, `https://www.youtube.com/@${encodeURIComponent(name)}`, status404or200),
};
