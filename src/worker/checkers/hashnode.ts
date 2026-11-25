import type { Checker } from './types';
import { is200, parseJson, simpleCheck } from '../http';

type Resp = { data?: { user?: { id?: string } | null }; errors?: unknown[] };
const parse = (body: string) => parseJson(body) as Resp | undefined;
const user = (body: string) => parse(body)?.data?.user;
const noErrors = (body: string) => !(parse(body)?.errors?.length);

export const hashnode: Checker = {
  id: 'hashnode',
  check: (name, deps) =>
    simpleCheck(
      'hashnode',
      name,
      deps,
      'https://gql.hashnode.com',
      {
        freeWhen: (r, b) => is200(r, b) && noErrors(b) && user(b) === null,
        takenWhen: (r, b) => is200(r, b) && typeof user(b)?.id === 'string',
      },
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: 'query($username: String!) { user(username: $username) { id } }',
          variables: { username: name },
        }),
      },
    ),
};
