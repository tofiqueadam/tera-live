import type { Env } from './env';
import { error } from './http';

export async function handleTelegram(_req: Request, _env: Env, _ctx: ExecutionContext, _now: number): Promise<Response> {
  return error(501, 'telegram not implemented yet');
}
