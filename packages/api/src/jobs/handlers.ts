// Queue consumers (PRD §7.3). Every handler is idempotent: it re-reads the game, does nothing if the
// game moved past the ply it was scheduled for, and commits through the same compare-and-set as players.
import { botCpuUsage, game } from "@carcassonne/db/schema/index";
import type { AiTier } from "@carcassonne/protocol";
import { eq, sql } from "drizzle-orm";

import type { Deps } from "../deps";
import { replayLoaded, loadGame, submitMove, isAutomated } from "../game/service";
import { tryMatch, retryIfWaiting } from "../matchmaking/service";
import type { JobHandlers, JobPayloads } from "../scheduler/types";

/** Bot think-time cap (PRD §7.3: ~1 s). */
export const BOT_BUDGET_MS = 1000;
/** Monthly server-bot CPU after which bots drop to Medium (PRD: ~2.5 CPU-h of the 4 h Hobby budget). */
export const BOT_CPU_CAP_MS = 2.5 * 3600 * 1000;
/** Budget for the Easy auto-move on timeout. */
const TIMEOUT_BUDGET_MS = 50;

export { monthKey } from "../util";
import { monthKey } from "../util";

const GOLDEN = BigInt("0x9e3779b97f4a7c15");

/** Deterministic per-turn AI seed so a redelivered job picks the same move. */
function turnSeed(gameSeed: string, ply: number) {
  return BigInt.asUintN(64, BigInt(gameSeed) ^ (BigInt(ply + 1) * GOLDEN));
}

export type JobOutcome = "stale" | "rescheduled" | "played" | "conflict" | "skipped";

export async function handleClockTimeout(deps: Deps, { gameId, ply }: JobPayloads["clock-timeout"]): Promise<JobOutcome> {
  const [g] = await deps.db.select().from(game).where(eq(game.id, gameId));
  if (!g || g.status !== "playing" || g.ply !== ply || !g.turnDeadline) return "stale";
  const remainingMs = g.turnDeadline.getTime() - deps.now();
  if (remainingMs > 250) {
    // Delivered early (or the deadline moved): try again at the real deadline.
    await deps.scheduler.enqueue(
      "clock-timeout",
      { gameId, ply },
      { delaySeconds: Math.ceil(remainingMs / 1000), idempotencyKey: `clock:${gameId}:${ply}:${g.turnDeadline.getTime()}` },
    );
    return "rescheduled";
  }
  const loaded = await loadGame(deps.db, gameId);
  if (!loaded || loaded.moves.length !== ply) return "stale";
  const eg = await replayLoaded(deps, loaded);
  let mv;
  try {
    // PRD §6.6: place the tile (Easy-AI choice) and no figure.
    mv = { ...eg.aiChoose("easy", TIMEOUT_BUDGET_MS, turnSeed(g.seed, ply)), figure: null };
  } finally {
    eg.free();
  }
  const r = await submitMove(deps, { gameId, ply, move: mv, actor: { kind: "system", source: "timeout" } });
  if (r.ok) return "played";
  if (r.code === "stale" || r.code === "conflict" || r.code === "not_playing") return "conflict";
  throw new Error(`timeout auto-move rejected: ${r.error}`); // retried by the queue
}

const STRONG: AiTier[] = ["hard", "expert"];

export async function handleBotMove(deps: Deps, { gameId, ply }: JobPayloads["bot-move"]): Promise<JobOutcome> {
  const loaded = await loadGame(deps.db, gameId);
  if (!loaded || loaded.game.status !== "playing" || loaded.moves.length !== ply) return "stale";
  const eg = await replayLoaded(deps, loaded);
  let mv;
  let cpuMs = 0;
  try {
    const seat = eg.view().currentPlayer;
    const p = loaded.players.find((x) => x.seat === seat);
    if (!isAutomated(p)) return "skipped";
    let tier: AiTier = p!.botTier ?? "easy"; // AFK humans are played by Easy
    const month = monthKey(deps.now());
    const [usage] = await deps.db.select().from(botCpuUsage).where(eq(botCpuUsage.month, month));
    if (STRONG.includes(tier) && (usage?.cpuMs ?? 0) >= BOT_CPU_CAP_MS) tier = "medium";
    const budget = STRONG.includes(tier) ? BOT_BUDGET_MS : 100;
    const before = process.cpuUsage();
    mv = eg.aiChoose(tier, budget, turnSeed(loaded.game.seed, ply));
    const d = process.cpuUsage(before);
    cpuMs = Math.ceil((d.user + d.system) / 1000);
    await deps.db
      .insert(botCpuUsage)
      .values({ month, cpuMs, moves: 1 })
      .onConflictDoUpdate({
        target: botCpuUsage.month,
        set: { cpuMs: sql`${botCpuUsage.cpuMs} + ${cpuMs}`, moves: sql`${botCpuUsage.moves} + 1` },
      });
  } finally {
    eg.free();
  }
  const r = await submitMove(deps, { gameId, ply, move: mv, actor: { kind: "system", source: "bot" } });
  if (r.ok) return "played";
  if (r.code === "stale" || r.code === "conflict" || r.code === "not_playing") return "conflict";
  throw new Error(`bot move rejected: ${r.error}`);
}

export async function handleMatchmakingRetry(deps: Deps, { queue }: JobPayloads["matchmaking-retry"]) {
  // Form as many matches as possible, then keep retrying while anyone is still waiting.
  while (await tryMatch(deps, queue)) {
    /* keep matching */
  }
  await retryIfWaiting(deps, queue);
}

export function createJobHandlers(deps: Deps): JobHandlers {
  return {
    "clock-timeout": async (p) => void (await handleClockTimeout(deps, p)),
    "bot-move": async (p) => void (await handleBotMove(deps, p)),
    "matchmaking-retry": (p) => handleMatchmakingRetry(deps, p),
  };
}
