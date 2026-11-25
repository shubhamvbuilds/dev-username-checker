import type { Checker } from './types';
import { classifyHttp, fetchWithTimeout, makeResult, status404or200 } from '../http';

// Users and organizations share one namespace: free only if both are 404.
export const huggingface: Checker = {
  id: 'huggingface',
  check: async (name, deps) => {
    const n = encodeURIComponent(name);
    const urls = [
      `https://huggingface.co/api/users/${n}/overview`,
      `https://huggingface.co/api/organizations/${n}/overview`,
    ];
    const results = await Promise.all(
      urls.map(async (u) => classifyHttp(await fetchWithTimeout(deps.fetch, u), status404or200)),
    );
    if (results.some((r) => r.status === 'taken')) return makeResult('huggingface', name, { status: 'taken' });
    if (results.every((r) => r.status === 'free')) return makeResult('huggingface', name, { status: 'free' });
    const why = results.find((r) => r.status !== 'free');
    return makeResult('huggingface', name, { status: 'unknown', reason: why?.reason });
  },
};
