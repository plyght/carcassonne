export type DatabaseConfig = {
  /** Pooled connection string (Neon pooler in production). */
  DATABASE_URL: string;
  /** Direct (unpooled) connection, required for LISTEN. Falls back to DATABASE_URL. */
  DATABASE_URL_UNPOOLED?: string | undefined;
};
