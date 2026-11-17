import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Setup files run outside isolated storage and may run more than once;
// applyD1Migrations only applies migrations that have not been applied yet.
await applyD1Migrations(env.DB, (env as any).TEST_MIGRATIONS);
