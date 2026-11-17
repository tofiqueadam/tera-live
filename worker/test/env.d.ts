declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    HASH_SALT: string;
    TELEGRAM_WEBHOOK_SECRET: string;
    ALLOWED_ORIGINS: string;
  }
}
