import type { Env } from './env';
import { handleProve } from './prove';

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/__prove') return handleProve(request, env);
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
