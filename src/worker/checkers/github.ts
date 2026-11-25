import type { Checker } from './types';
import { simpleCheck, status404or200 } from '../http';

export const github: Checker = {
  id: 'github',
  check: (name, deps) => {
    const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
    if (deps.env.GITHUB_TOKEN) headers.authorization = `Bearer ${deps.env.GITHUB_TOKEN}`;
    return simpleCheck(
      'github',
      name,
      deps,
      `https://api.github.com/users/${encodeURIComponent(name)}`,
      status404or200,
      { headers },
    );
  },
};
