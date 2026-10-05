import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export type { DatabaseConfig } from "./config";

export function createPool(env: DatabaseConfig, max = 5) {
  return new pg.Pool({ connectionString: env.DATABASE_URL, max, idleTimeoutMillis: 10_000 });
}

export function createDb(env: DatabaseConfig, pool: pg.Pool = createPool(env)) {
  return drizzle({ client: pool, relations });
}

export type Database = ReturnType<typeof createDb>;
/** A transaction handle; shares the query API with Database. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

export { pg };
