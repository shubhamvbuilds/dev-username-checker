import type { Checker } from './types';
import { classifyHttp, fetchWithTimeout, is200, makeResult, parseJson } from '../http';

const isArray = (body: string) => Array.isArray(parseJson(body));
const isEmpty = (body: string) => (parseJson(body) as unknown[]).length === 0;

// Users and groups share one namespace on GitLab, so both must be checked.
// Taken: users non-empty OR group 200. Free: users 200 [] AND group 404.
// Known limitation: private groups also return 404 from the groups API, so a
// name held by a private group can read as free; the UI's "may still reserve"
// note covers this.
export const gitlab: Checker = {
  id: 'gitlab',
  check: async (name, deps) => {
    const n = encodeURIComponent(name);
    const [usersRes, groupsRes] = await Promise.all([
      fetchWithTimeout(deps.fetch, `https://gitlab.com/api/v4/users?username=${n}`),
      fetchWithTimeout(deps.fetch, `https://gitlab.com/api/v4/groups/${n}`),
    ]);
    const users = await classifyHttp(usersRes, {
      freeWhen: (r, b) => is200(r, b) && isArray(b) && isEmpty(b),
      takenWhen: (r, b) => is200(r, b) && isArray(b) && !isEmpty(b),
    });
    const groups = await classifyHttp(groupsRes, { freeWhen: (r) => r.status === 404, takenWhen: is200 });
    if (users.status === 'taken' || groups.status === 'taken') return makeResult('gitlab', name, { status: 'taken' });
    if (users.status === 'free' && groups.status === 'free') return makeResult('gitlab', name, { status: 'free' });
    return makeResult('gitlab', name, users.status !== 'free' ? users : groups);
  },
};
