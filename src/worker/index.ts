import type { Env } from './env';
import { handleCheck } from './api';
import { handleProve } from './prove';

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/__prove') return handleProve(request, env);
    if (pathname === '/api/check') return handleCheck(request, env, ctx);
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
