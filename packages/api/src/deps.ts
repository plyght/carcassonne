import type { Database } from "@carcassonne/db";

import type { Engine } from "./game/engine";
import type { Scheduler } from "./scheduler/types";

/** Everything the stateless server logic needs. Built once per process by apps/server (or by tests). */
export interface Deps {
  db: Database;
  scheduler: Scheduler;
  engine: () => Promise<Engine>;
  /** Epoch ms; injectable so clock tests can move time. */
  now: () => number;
  /** HMAC secret for guest tokens (BETTER_AUTH_SECRET). */
  guestSecret: string;
  /** Feature flags (Edge Config / env). */
  flags: () => Promise<Flags>;
}

export interface Flags {
  /** Force every new connection to HTTP polling (PRD §7.3 guard rails). */
  forcePolling: boolean;
  /** Pause new online games (90% of the free allowance). */
  pauseOnline: boolean;
}

export const DEFAULT_FLAGS: Flags = { forcePolling: false, pauseOnline: false };
