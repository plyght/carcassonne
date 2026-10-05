// Stateless game service (PRD §7.3 "How a move flows"):
//   1. load (seed, ruleset, moves[]) from Postgres and replay with the engine,
//   2. validate the intent,
//   3. insert the move; the (game_id, ply) primary key is the compare-and-set,
//   4. NOTIFY game_<id> in the same transaction,
//   5. after commit, enqueue the clock's delayed message and a bot job if the next seat is a bot.
import type { Database, DbOrTx, Tx } from "@carcassonne/db";
import { game, gamePlayer, move, type ClockJson, type RoomSeatJson } from "@carcassonne/db/schema/index";
import type { EngineEvent, GameView, Move, Ruleset } from "@carcassonne/protocol";
import { and, asc, eq, gte, sql } from "drizzle-orm";

import type { Deps } from "../deps";
import type { Identity } from "../identity";
import { applyRankedResult } from "../ratings/apply";
import { placements } from "../ratings/glicko2";
import type { Job } from "../scheduler/types";
import { randomSeed, replay, type EngineGame } from "./engine";

export const COLORS = ["red", "blue", "green", "yellow", "black"] as const;
export const AFK_AFTER_TIMEOUTS = 3;

export type Actor = Identity | { kind: "system"; source: "timeout" | "bot" };

export type GameRow = typeof game.$inferSelect;
export type PlayerRow = typeof gamePlayer.$inferSelect;

export interface LoadedGame {
  game: GameRow;
  players: PlayerRow[];
  moves: Move[];
}

/** Payload of `NOTIFY game_<id>`. Kept tiny (NOTIFY payloads are capped at 8 KB). */
export type GameNotify =
  | { k: "move"; ply: number; deadline: number | null }
  | { k: "react"; seat: number | null; emoji: string; spectator: boolean }
  | { k: "presence" };

export const gameChannel = (gameId: string) => `game_${gameId}`;
export const userChannel = (userId: string) => `user_${userId}`;

export async function notify(db: DbOrTx, channel: string, payload: unknown) {
  await db.execute(sql`select pg_notify(${channel}, ${JSON.stringify(payload)})`);
}

export async function loadGame(db: DbOrTx, gameId: string): Promise<LoadedGame | null> {
  const [g] = await db.select().from(game).where(eq(game.id, gameId));
  if (!g) return null;
  const [players, moves] = await Promise.all([
    db.select().from(gamePlayer).where(eq(gamePlayer.gameId, gameId)).orderBy(asc(gamePlayer.seat)),
    db.select({ payload: move.payload }).from(move).where(eq(move.gameId, gameId)).orderBy(asc(move.ply)),
  ]);
  return { game: g, players, moves: moves.map((m) => m.payload as Move) };
}

export async function replayLoaded(deps: Pick<Deps, "engine">, l: LoadedGame): Promise<EngineGame> {
  const engine = await deps.engine();
  return replay(engine, {
    ruleset: l.game.ruleset as Ruleset,
    seed: BigInt(l.game.seed),
    players: l.game.players,
    moves: l.moves,
  });
}

/** Current view (replays the log). */
export async function getView(deps: Pick<Deps, "engine" | "db">, gameId: string) {
  const l = await loadGame(deps.db, gameId);
  if (!l) return null;
  const g = await replayLoaded(deps, l);
  try {
    return { loaded: l, view: g.view() };
  } finally {
    g.free();
  }
}

export async function getMovesSince(db: DbOrTx, gameId: string, fromPly: number) {
  return db
    .select({ ply: move.ply, seat: move.seat, payload: move.payload, events: move.events, at: move.at })
    .from(move)
    .where(and(eq(move.gameId, gameId), gte(move.ply, fromPly)))
    .orderBy(asc(move.ply));
}

export function seatOf(players: PlayerRow[], who: Identity): number | null {
  const p = players.find((p) =>
    who.kind === "user" ? p.userId === who.userId : p.guestId === who.guestId,
  );
  return p ? p.seat : null;
}

export const isAutomated = (p: PlayerRow | undefined) => !!p && (p.botTier !== null || p.afk);

// ---------------------------------------------------------------------------------------------
// Clock

function computeClock(
  clock: ClockJson,
  g: Pick<GameRow, "turnStartedAt">,
  mover: PlayerRow,
  next: PlayerRow | undefined,
  nowMs: number,
  ended: boolean,
): { deadline: Date | null; moverBankMs: number | null } {
  if (clock.type === "none") return { deadline: null, moverBankMs: null };
  if (clock.type === "turn") {
    return { deadline: ended ? null : new Date(nowMs + clock.turnSeconds * 1000), moverBankMs: null };
  }
  const started = g.turnStartedAt?.getTime() ?? nowMs;
  const moverBankMs = Math.max(0, (mover.bankMs ?? clock.bankSeconds * 1000) - (nowMs - started)) + clock.incrementSeconds * 1000;
  if (ended || !next) return { deadline: null, moverBankMs };
  const nextBank = next.seat === mover.seat ? moverBankMs : (next.bankMs ?? clock.bankSeconds * 1000);
  return { deadline: new Date(nowMs + nextBank), moverBankMs };
}

/** Jobs to enqueue after the transaction that started turn `ply` commits. */
function followUpsForTurn(gameId: string, ply: number, deadline: Date | null, next: PlayerRow | undefined, nowMs: number): Job[] {
  const jobs: Job[] = [];
  if (deadline) {
    jobs.push({
      topic: "clock-timeout",
      payload: { gameId, ply },
      opts: { delaySeconds: Math.max(0, Math.ceil((deadline.getTime() - nowMs) / 1000)), idempotencyKey: `clock:${gameId}:${ply}` },
    });
  }
  if (isAutomated(next)) {
    jobs.push({ topic: "bot-move", payload: { gameId, ply }, opts: { idempotencyKey: `bot:${gameId}:${ply}` } });
  }
  return jobs;
}

export async function runFollowUps(deps: Pick<Deps, "scheduler">, jobs: Job[]) {
  for (const j of jobs) {
    try {
      await deps.scheduler.enqueue(j.topic, j.payload as never, j.opts);
    } catch (err) {
      // The move is committed; a lost clock/bot job is recovered by the next reconnect/poll (see jobs/sweep).
      console.error(`[game] failed to enqueue ${j.topic}`, err);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Moves

export type SubmitResult =
  | { ok: true; ply: number; events: EngineEvent[]; ended: boolean }
  | { ok: false; code: "not_found" | "not_playing" | "stale" | "not_your_turn" | "illegal" | "conflict"; error: string };

export async function submitMove(
  deps: Deps,
  input: { gameId: string; ply: number; move: Move; actor: Actor },
): Promise<SubmitResult> {
  const loaded = await loadGame(deps.db, input.gameId);
  if (!loaded) return { ok: false, code: "not_found", error: "game not found" };
  const { game: g, players } = loaded;
  if (g.status !== "playing") return { ok: false, code: "not_playing", error: "game is not in progress" };
  if (input.ply !== loaded.moves.length) {
    return { ok: false, code: "stale", error: `expected ply ${loaded.moves.length}, got ${input.ply}` };
  }

  const eg = await replayLoaded(deps, loaded);
  let events: EngineEvent[];
  let view: GameView;
  let moverSeat: number;
  try {
    const seatToMove = eg.view().currentPlayer;
    moverSeat = seatToMove;
    if (input.actor.kind !== "system" && seatOf(players, input.actor) !== seatToMove) {
      return { ok: false, code: "not_your_turn", error: "not your turn" };
    }
    const r = eg.apply(input.move);
    if (!r.ok) return { ok: false, code: "illegal", error: r.error };
    events = r.events;
    view = eg.view();
  } finally {
    eg.free();
  }

  const nowMs = deps.now();
  const mover = players.find((p) => p.seat === moverSeat)!;
  const ended = view.status === "ended";
  const next = ended ? undefined : players.find((p) => p.seat === view.currentPlayer);
  const { deadline, moverBankMs } = computeClock(g.clock, g, mover, next, nowMs, ended);
  const newPly = input.ply + 1;
  const source = input.actor.kind === "system" ? input.actor.source : "player";
  const gameEnded = events.find((e): e is Extract<EngineEvent, { type: "gameEnded" }> => e.type === "gameEnded");

  const committed = await deps.db.transaction(async (tx) => {
    const ins = await tx
      .insert(move)
      .values({ gameId: g.id, ply: input.ply, seat: moverSeat, payload: input.move, events, source, at: new Date(nowMs) })
      .onConflictDoNothing()
      .returning({ ply: move.ply });
    if (ins.length === 0) return false; // another instance won the race for this ply

    const upd = await tx
      .update(game)
      .set({
        ply: newPly,
        turnStartedAt: ended ? null : new Date(nowMs),
        turnDeadline: deadline,
        ...(ended ? { status: "ended" as const, endedAt: new Date(nowMs), finalScores: gameEnded?.scores ?? null } : {}),
      })
      .where(and(eq(game.id, g.id), eq(game.ply, input.ply)))
      .returning({ id: game.id });
    if (upd.length === 0) throw new Error("game row out of sync with move log");

    const timeouts =
      source === "timeout" ? mover.consecutiveTimeouts + 1 : source === "player" ? 0 : mover.consecutiveTimeouts;
    await tx
      .update(gamePlayer)
      .set({
        consecutiveTimeouts: timeouts,
        afk: source === "player" ? false : mover.afk || timeouts >= AFK_AFTER_TIMEOUTS,
        ...(moverBankMs !== null ? { bankMs: moverBankMs } : {}),
      })
      .where(and(eq(gamePlayer.gameId, g.id), eq(gamePlayer.seat, moverSeat)));

    if (gameEnded) await finishGame(tx, g, players, gameEnded);

    await notify(tx, gameChannel(g.id), { k: "move", ply: newPly, deadline: deadline?.getTime() ?? null } satisfies GameNotify);
    return true;
  });
  if (!committed) return { ok: false, code: "conflict", error: "another move was committed first" };

  // Re-read the next seat so a freshly AFK'd player is driven by the bot.
  let nextAfterCommit = next;
  if (next && next.seat === moverSeat) {
    const [p] = await deps.db
      .select()
      .from(gamePlayer)
      .where(and(eq(gamePlayer.gameId, g.id), eq(gamePlayer.seat, moverSeat)));
    nextAfterCommit = p;
  }
  if (!ended) await runFollowUps(deps, followUpsForTurn(g.id, newPly, deadline, nextAfterCommit, nowMs));
  return { ok: true, ply: newPly, events, ended };
}

async function finishGame(
  tx: Tx,
  g: GameRow,
  players: PlayerRow[],
  ev: Extract<EngineEvent, { type: "gameEnded" }>,
) {
  const place = placements(ev.scores);
  for (const p of players) {
    await tx
      .update(gamePlayer)
      .set({ finalScore: ev.scores[p.seat] ?? 0, placement: place[p.seat] ?? null, breakdown: ev.breakdown[p.seat] ?? null })
      .where(and(eq(gamePlayer.gameId, g.id), eq(gamePlayer.seat, p.seat)));
  }
  if (g.ranked && g.queue) {
    const humans = players.filter((p) => p.userId);
    if (humans.length === players.length) {
      await applyRankedResult(
        tx,
        g.queue,
        humans.map((p) => ({ userId: p.userId!, score: ev.scores[p.seat] ?? 0 })),
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Game creation

export interface NewGameInput {
  roomId?: string | null;
  ruleset: Ruleset;
  clock: ClockJson;
  seats: RoomSeatJson[];
  ranked?: boolean;
  queue?: "ffa3" | "ffa4" | null;
  seed?: bigint;
}

/** Insert the game and its seats inside `tx`. Run the returned jobs after commit with `runFollowUps`. */
export async function createGameTx(
  tx: Tx,
  deps: Pick<Deps, "engine" | "now">,
  input: NewGameInput,
): Promise<{ gameId: string; jobs: Job[] }> {
  if (input.seats.length < 2 || input.seats.length > 5) throw new Error("2–5 players required");
  const engine = await deps.engine();
  const seed = input.seed ?? randomSeed();
  const eg = engine.createGame(input.ruleset, seed, input.seats.length);
  const first = eg.view().currentPlayer;
  eg.free();

  const nowMs = deps.now();
  const deadline =
    input.clock.type === "turn"
      ? new Date(nowMs + input.clock.turnSeconds * 1000)
      : input.clock.type === "bank"
        ? new Date(nowMs + input.clock.bankSeconds * 1000)
        : null;
  const [row] = await tx
    .insert(game)
    .values({
      roomId: input.roomId ?? null,
      engineVersion: engine.version,
      seed: seed.toString(),
      ruleset: input.ruleset,
      clock: input.clock,
      players: input.seats.length,
      ranked: input.ranked ?? false,
      queue: input.queue ?? null,
      turnStartedAt: new Date(nowMs),
      turnDeadline: deadline,
    })
    .returning();
  const gameId = row!.id;
  const playerRows = input.seats.map((s, seat) => ({
    gameId,
    seat,
    userId: s.kind === "human" ? s.userId : null,
    guestId: s.kind === "human" ? s.guestId : null,
    name: s.name,
    botTier: s.kind === "bot" ? s.tier : null,
    color: COLORS[seat]!,
    bankMs: input.clock.type === "bank" ? input.clock.bankSeconds * 1000 : null,
  }));
  const inserted = await tx.insert(gamePlayer).values(playerRows).returning();
  const next = inserted.find((p) => p.seat === first);
  return { gameId, jobs: followUpsForTurn(gameId, 0, deadline, next, nowMs) };
}

export async function createGame(deps: Deps, input: NewGameInput) {
  const res = await deps.db.transaction((tx) => createGameTx(tx, deps, input));
  await runFollowUps(deps, res.jobs);
  return res.gameId;
}

export type { Database };
