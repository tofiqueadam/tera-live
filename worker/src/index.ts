import type { Env } from './env';

export default {
  async fetch(_req: Request, _env: Env): Promise<Response> {
    return new Response('Tera Live API', { status: 200 });
  },
} satisfies ExportedHandler<Env>;
