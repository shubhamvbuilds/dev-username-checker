import type { Checker } from './types';
import { is200, parseJson, simpleCheck } from '../http';

export const bluesky: Checker = {
  id: 'bluesky',
  check: (name, deps) =>
    simpleCheck(
      'bluesky',
      name,
      deps,
      `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(name)}.bsky.social`,
      {
        freeWhen: (r, b) => r.status === 400 && b.includes('Unable to resolve handle'),
        takenWhen: (r, b) =>
          is200(r, b) && typeof (parseJson(b) as { did?: string } | undefined)?.did === 'string',
      },
    ),
};
