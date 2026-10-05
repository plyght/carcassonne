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
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  await runMigrations({ DATABASE_URL: url });
  console.log("migrations applied");
}
