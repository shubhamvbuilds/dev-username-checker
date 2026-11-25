import type { Checker } from './types';
import { is200, parseJson, simpleCheck } from '../http';

type Resp = { data?: { user?: { id?: string } | null } };
const user = (body: string) => (parseJson(body) as Resp | undefined)?.data?.user;

export const hashnode: Checker = {
  id: 'hashnode',
  check: (name, deps) =>
    simpleCheck(
      'hashnode',
      name,
      deps,
      'https://gql.hashnode.com',
      {
        freeWhen: (r, b) => is200(r, b) && user(b) === null,
        takenWhen: (r, b) => is200(r, b) && typeof user(b)?.id === 'string',
      },
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: `{ user(username: ${JSON.stringify(name)}) { id } }` }),
      },
    ),
};
