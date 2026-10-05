// Free-tier counters and guard rails (PRD §7.3). Vercel's own usage dashboard is the source of truth;
// these are conservative estimates we can act on automatically.
import { botCpuUsage, game, instanceUsage, move } from "@carcassonne/db/schema/index";
import { and, eq, gte, sql } from "drizzle-orm";

import type { Deps, Flags } from "../deps";
import { monthKey } from "../util";

/** Hobby: 360 GB-hrs of provisioned memory per month; functions run with 2 GB. */
export const HOBBY_GB_HOURS = 360;
export const FUNCTION_GB = 2;
export const HOBBY_CPU_HOURS = 4;
export const BOT_CPU_CAP_HOURS = 2.5;
export const POLLING_AT = 0.7;
export const PAUSE_AT = 0.9;

export async function computeUsage(deps: Pick<Deps, "db" | "now">) {
  const nowMs = deps.now();
  const month = monthKey(nowMs);
  const monthStart = new Date(`${month}-01T00:00:00Z`);
  const [inst] = await deps.db
    .select({
      seconds: sql<number>`coalesce(sum(extract(epoch from (${instanceUsage.lastHeartbeat} - ${instanceUsage.startedAt}))), 0)::float8`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(instanceUsage)
    .where(eq(instanceUsage.month, month));
  const [bot] = await deps.db.select().from(botCpuUsage).where(eq(botCpuUsage.month, month));
  const [moves] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(move)
    .where(gte(move.at, monthStart));
  const [games] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(game)
    .where(and(gte(game.startedAt, monthStart)));

  const socketInstanceHours = (inst?.seconds ?? 0) / 3600;
  const gbHours = socketInstanceHours * FUNCTION_GB;
  const botCpuHours = (bot?.cpuMs ?? 0) / 3_600_000;
  const memoryFraction = gbHours / HOBBY_GB_HOURS;
  return {
    month,
    socketInstanceHours,
    socketSessions: inst?.sessions ?? 0,
    estimatedGbHours: gbHours,
    memoryFraction,
    botCpuHours,
    botMoves: bot?.moves ?? 0,
    botCpuFraction: botCpuHours / BOT_CPU_CAP_HOURS,
    movesThisMonth: moves?.n ?? 0,
    gamesThisMonth: games?.n ?? 0,
    /** ~3–4 queue operations per turn (PRD §7.3). */
    estimatedQueueOps: (moves?.n ?? 0) * 4,
    limits: {
      gbHours: HOBBY_GB_HOURS,
      cpuHours: HOBBY_CPU_HOURS,
      botCpuCapHours: BOT_CPU_CAP_HOURS,
      queueOps: 1_000_000,
      pollingAt: POLLING_AT,
      pauseAt: PAUSE_AT,
    },
  };
}

/** Combine the configured flags (Edge Config / env) with the automatic usage thresholds. */
export async function effectiveFlags(deps: Pick<Deps, "db" | "now" | "flags">): Promise<Flags & { reason: string | null }> {
  const base = await deps.flags();
  let memoryFraction = 0;
  try {
    memoryFraction = (await computeUsage(deps)).memoryFraction;
  } catch {
    /* usage tables unavailable: fall back to configured flags */
  }
  const forcePolling = base.forcePolling || memoryFraction >= POLLING_AT;
  const pauseOnline = base.pauseOnline || memoryFraction >= PAUSE_AT;
  return {
    forcePolling,
    pauseOnline,
    reason: base.forcePolling || base.pauseOnline ? "flag" : forcePolling ? "usage" : null,
  };
}
