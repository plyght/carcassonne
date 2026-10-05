// Applies Drizzle migrations from ./migrations (used by `db:migrate:run`, tests and deploys).
import path from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDb, createPool, type DatabaseConfig } from "./index";

export const MIGRATIONS_DIR = path.join(import.meta.dir, "migrations");

export async function runMigrations(env: DatabaseConfig) {
  const pool = createPool(env, 1);
  try {
    await migrate(createDb(env, pool), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  // DDL goes over the direct connection (Neon: DATABASE_URL_UNPOOLED), not the pooler.
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    // Vercel build without a connected database (e.g. first deploy): don't fail the build.
    console.warn("[migrate] DATABASE_URL not set; skipping migrations");
  } else {
    await runMigrations({ DATABASE_URL: url });
    console.log("[migrate] migrations applied");
  }
}
