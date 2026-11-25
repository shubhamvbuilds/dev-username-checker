import type { Checker } from './types';
import { is200, parseJson, simpleCheck } from '../http';

const isArray = (body: string) => Array.isArray(parseJson(body));
const isEmpty = (body: string) => (parseJson(body) as unknown[]).length === 0;

export const gitlab: Checker = {
  id: 'gitlab',
  check: (name, deps) =>
    simpleCheck('gitlab', name, deps, `https://gitlab.com/api/v4/users?username=${encodeURIComponent(name)}`, {
      freeWhen: (r, b) => is200(r, b) && isArray(b) && isEmpty(b),
      takenWhen: (r, b) => is200(r, b) && isArray(b) && !isEmpty(b),
    }),
};
