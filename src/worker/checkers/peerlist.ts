import type { Checker } from './types';
import { simpleCheck, status404or200 } from '../http';

export const peerlist: Checker = {
  id: 'peerlist',
  check: (name, deps) =>
    simpleCheck('peerlist', name, deps, `https://peerlist.io/${encodeURIComponent(name)}`, status404or200),
};
