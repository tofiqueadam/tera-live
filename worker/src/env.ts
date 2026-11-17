export interface Env {
  DB: D1Database;
  /** Secret salt for hashing device ids and IPs. Required in production. */
  HASH_SALT?: string;
  /** Comma-separated browser origins allowed by CORS. */
  ALLOWED_ORIGINS?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}
