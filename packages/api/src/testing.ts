// Test harness: a real local Postgres, the fake engine, an in-process scheduler and a movable clock.
// Used by packages/api/test and apps/server/test. Not imported by production code.
import { createDb, createPool, type Database } from "@carcassonne/db";
import { runMigrations } from "@carcassonne/db/migrate";
import { user } from "@carcassonne/db/schema/index";
import { sql } from "drizzle-orm";
import pg from "pg";

import { DEFAULT_FLAGS, type Deps, type Flags } from "./deps";
import { FakeEngine } from "./game/fake-engine";
import { createJobHandlers } from "./jobs/handlers";
import { InProcessScheduler } from "./scheduler/in-process";

const BASE_URL = process.env.TEST_DATABASE_BASE_URL ?? "postgresql://postgres:password@localhost:5432";

/** Create (if needed) and migrate a dedicated database, so parallel packages don't collide. */
export async function setupTestDatabase(name: string) {
  const admin = new pg.Client({ connectionString: `${BASE_URL}/postgres` });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [name]);
    if (!rowCount) await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = `${BASE_URL}/${name}`;
  await runMigrations({ DATABASE_URL: url });
  return url;
}

export async function truncateAll(db: Database) {
  await db.execute(sql`truncate table move, game_player, game, room, queue_ticket, rating, profile, presence,
    instance_usage, bot_cpu_usage, session, account, verification, "user" restart identity cascade`);
}

export interface TestEnv {
  url: string;
  db: Database;
  pool: pg.Pool;
  deps: Deps;
  scheduler: InProcessScheduler;
  clock: { now: number; advance(ms: number): void };
  flags: Flags;
  close(): Promise<void>;
}

export async function createTestEnv(dbName: string, opts: { deckSize?: number } = {}): Promise<TestEnv> {
  const url = await setupTestDatabase(dbName);
  const pool = createPool({ DATABASE_URL: url }, 10);
  const db = createDb({ DATABASE_URL: url }, pool);
  const clock = {
    now: Date.parse("2026-10-01T12:00:00Z"),
    advance(ms: number) {
      this.now += ms;
    },
  };
  const scheduler = new InProcessScheduler({ now: () => clock.now });
  const engine = new FakeEngine({ deckSize: opts.deckSize ?? 6 });
  const flags: Flags = { ...DEFAULT_FLAGS };
  const deps: Deps = {
    db,
    scheduler,
    engine: async () => engine,
    now: () => clock.now,
    guestSecret: "test-secret-test-secret-test-secret-123",
    flags: async () => flags,
  };
  scheduler.setHandlers(createJobHandlers(deps));
  return { url, db, pool, deps, scheduler, clock, flags, close: () => pool.end() };
}

export async function createUser(db: Database, id: string, name = id) {
  await db.insert(user).values({ id, name, email: `${id}@example.test`, emailVerified: true });
  return { kind: "user" as const, userId: id, name };
}
