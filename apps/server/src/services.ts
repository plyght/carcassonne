// Process-wide services. Pure factory (no env access) so tests can build isolated instances;
// src/bootstrap.ts builds the default one from varlock ENV.
import type { Deps, Flags } from "@carcassonne/api/deps";
import type { Engine } from "@carcassonne/api/game/engine";
import { createJobHandlers } from "@carcassonne/api/jobs/handlers";
import { GameHub } from "@carcassonne/api/realtime/hub";
import { PgListener } from "@carcassonne/api/realtime/listener";
import { InProcessScheduler } from "@carcassonne/api/scheduler/in-process";
import type { Scheduler } from "@carcassonne/api/scheduler/types";
import { VercelQueueScheduler } from "@carcassonne/api/scheduler/vercel";
import { createAuth } from "@carcassonne/auth";
import { createDb, createPool } from "@carcassonne/db";
import { attachDatabasePool } from "@vercel/functions";

export interface ServerConfig {
  databaseUrl: string;
  databaseUrlUnpooled?: string;
  authSecret: string;
  authUrl: string;
  corsOrigin: string;
  scheduler: "vercel" | "local" | Scheduler;
  engine: () => Promise<Engine>;
  flags: () => Promise<Flags>;
  adminEmails?: string[];
  instanceId?: string;
  now?: () => number;
}

export function createServices(cfg: ServerConfig) {
  const pool = createPool({ DATABASE_URL: cfg.databaseUrl }, 5);
  // Fluid compute: let Vercel close idle pool clients before the instance is suspended.
  if (process.env.VERCEL) attachDatabasePool(pool);
  const db = createDb({ DATABASE_URL: cfg.databaseUrl }, pool);
  const auth = createAuth(
    { BETTER_AUTH_SECRET: cfg.authSecret, BETTER_AUTH_URL: cfg.authUrl, CORS_ORIGIN: cfg.corsOrigin },
    db,
  );

  let scheduler: Scheduler;
  let local: InProcessScheduler | null = null;
  if (cfg.scheduler === "vercel") scheduler = new VercelQueueScheduler();
  else if (cfg.scheduler === "local") scheduler = local = new InProcessScheduler({ auto: true });
  else scheduler = cfg.scheduler;

  const deps: Deps = {
    db,
    scheduler,
    engine: cfg.engine,
    now: cfg.now ?? Date.now,
    guestSecret: cfg.authSecret,
    flags: cfg.flags,
  };
  // Local dev: the in-process scheduler calls the same handlers the Vercel Queues consumers use.
  local?.setHandlers(createJobHandlers(deps));

  const instanceId = cfg.instanceId ?? `${process.env.VERCEL_REGION ?? "local"}-${crypto.randomUUID().slice(0, 8)}`;
  let listener: PgListener | null = null;
  let hub: GameHub | null = null;

  return {
    cfg,
    pool,
    db,
    auth,
    deps,
    instanceId,
    adminEmails: new Set((cfg.adminEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)),
    /** One direct LISTEN connection and one hub per instance, created on the first socket. */
    hub(): GameHub {
      if (!hub) {
        listener = new PgListener(cfg.databaseUrlUnpooled || cfg.databaseUrl);
        hub = new GameHub(deps, listener, { instanceId });
      }
      return hub;
    },
    async close() {
      if (hub) await hub.shutdown();
      if (listener) await listener.close();
      await pool.end();
    },
  };
}

export type Services = ReturnType<typeof createServices>;
