// Scheduler port (PRD §7.3 "Beta risk"): delayed jobs for clocks, server bots and matchmaking retries.
// Production: Vercel Queues (./vercel.ts). Tests and plain `bun dev`: in-process (./in-process.ts).

export interface JobPayloads {
  /** Fires at the turn deadline of `ply`; no-op if the game moved on. */
  "clock-timeout": { gameId: string; ply: number };
  /** Plays the bot (or AFK) seat whose turn starts at `ply`. */
  "bot-move": { gameId: string; ply: number };
  /** Retries forming a match for a ranked queue. */
  "matchmaking-retry": { queue: "ffa3" | "ffa4" };
}

export type Topic = keyof JobPayloads;
export const TOPICS = ["clock-timeout", "bot-move", "matchmaking-retry"] as const satisfies readonly Topic[];

export interface EnqueueOptions {
  delaySeconds?: number;
  /** Deduplicates repeated publishes (Vercel Queues: window min(retention, 24 h)). */
  idempotencyKey?: string;
}

export interface Job<T extends Topic = Topic> {
  topic: T;
  payload: JobPayloads[T];
  opts?: EnqueueOptions;
}

export interface Scheduler {
  enqueue<T extends Topic>(topic: T, payload: JobPayloads[T], opts?: EnqueueOptions): Promise<void>;
}

export type JobHandlers = { [T in Topic]: (payload: JobPayloads[T], meta: { deliveryCount: number }) => Promise<void> };
