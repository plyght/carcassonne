import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { botCpuUsage, game, gamePlayer, move } from "@carcassonne/db/schema/index";
import { DEFAULT_RULESET, type AiTier } from "@carcassonne/protocol";
import { and, asc, eq } from "drizzle-orm";

import type { Engine } from "../src/game/engine";
import { createGame, submitMove } from "../src/game/service";
import { BOT_CPU_CAP_MS, handleBotMove, handleClockTimeout, monthKey } from "../src/jobs/handlers";
import { createTestEnv, createUser, truncateAll, type TestEnv } from "../src/testing";

let env: TestEnv;
const tiersAsked: AiTier[] = [];
beforeAll(async () => {
  env = await createTestEnv("carcassonne_test_api", { deckSize: 12 });
  // Record the tier the bot consumer asks the engine for.
  const inner = await env.deps.engine();
  const spy: Engine = {
    version: inner.version,
    restore: (s) => inner.restore(s),
    createGame: (r, s, p) => {
      const g = inner.createGame(r, s, p);
      const choose = g.aiChoose.bind(g);
      g.aiChoose = (tier, budget, seed) => {
        tiersAsked.push(tier);
        return choose(tier, budget, seed);
      };
      return g;
    },
  };
  env.deps.engine = async () => spy;
});
afterAll(async () => env.close());
beforeEach(async () => {
  await truncateAll(env.db);
  env.scheduler.clear();
  tiersAsked.length = 0;
});

async function clockGame() {
  const a = await createUser(env.db, "alice");
  const b = await createUser(env.db, "bob");
  const gameId = await createGame(env.deps, {
    ruleset: DEFAULT_RULESET,
    clock: { type: "turn", turnSeconds: 30 },
    seats: [
      { kind: "human", userId: a.userId, guestId: null, name: "Alice" },
      { kind: "human", userId: b.userId, guestId: null, name: "Bob" },
    ],
    seed: 7n,
  });
  return { a, b, gameId };
}

const movesOf = (gameId: string) =>
  env.db.select().from(move).where(eq(move.gameId, gameId)).orderBy(asc(move.ply));

describe("clock timeout consumer", () => {
  test("enqueues a delayed message at the deadline and auto-plays with no figure", async () => {
    const { gameId } = await clockGame();
    expect(env.scheduler.log).toEqual([{ topic: "clock-timeout", payload: { gameId, ply: 0 }, delaySeconds: 30 }]);

    // Not due yet: nothing happens.
    env.clock.advance(29_000);
    expect(await env.scheduler.runDue()).toBe(0);

    env.clock.advance(1_000);
    expect(await env.scheduler.runDue("clock-timeout")).toBe(1);
    const rows = await movesOf(gameId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("timeout");
    expect((rows[0]!.payload as { figure: unknown }).figure).toBeNull();
    const [p0] = await env.db.select().from(gamePlayer).where(and(eq(gamePlayer.gameId, gameId), eq(gamePlayer.seat, 0)));
    expect(p0!.consecutiveTimeouts).toBe(1);
    // The next turn's clock was scheduled.
    expect(env.scheduler.pendingJobs()).toEqual([
      { topic: "clock-timeout", payload: { gameId, ply: 1 }, dueAt: env.clock.now + 30_000 },
    ]);
  });

  test("is a no-op when the player moved in time, and idempotent on redelivery", async () => {
    const { a, gameId } = await clockGame();
    env.clock.advance(10_000);
    expect((await submitMove(env.deps, { gameId, ply: 0, move: { x: 1, y: 0, rot: 0, figure: null }, actor: a })).ok).toBe(true);
    expect(await handleClockTimeout(env.deps, { gameId, ply: 0 })).toBe("stale");
    expect(await handleClockTimeout(env.deps, { gameId, ply: 0 })).toBe("stale");
    expect(await movesOf(gameId)).toHaveLength(1);
    // Early delivery for the current ply reschedules instead of playing.
    expect(await handleClockTimeout(env.deps, { gameId, ply: 1 })).toBe("rescheduled");
    expect(await movesOf(gameId)).toHaveLength(1);
  });

  test("three consecutive timeouts mark the seat AFK and a bot takes over", async () => {
    const { b, gameId } = await clockGame();
    // Seat 0 times out; seat 1 plays; repeat.
    for (let round = 0; round < 3; round++) {
      env.clock.advance(30_000);
      await env.scheduler.runDue("clock-timeout");
      const ply = round * 2 + 1;
      const r = await submitMove(env.deps, { gameId, ply, move: { x: -(round + 1), y: 0, rot: 0, figure: null }, actor: b });
      expect(r.ok).toBe(true);
    }
    const [p0] = await env.db.select().from(gamePlayer).where(and(eq(gamePlayer.gameId, gameId), eq(gamePlayer.seat, 0)));
    expect(p0!.afk).toBe(true);
    // Seat 0 is up at ply 6 and is now driven by a bot job.
    expect(env.scheduler.pendingJobs().some((j) => j.topic === "bot-move")).toBe(true);
    await env.scheduler.runDue("bot-move");
    const rows = await movesOf(gameId);
    expect(rows).toHaveLength(7);
    expect(rows[6]!.source).toBe("bot");
    expect(tiersAsked.at(-1)).toBe("easy");
  });
});

describe("bot consumer", () => {
  async function botGame(tier: AiTier) {
    const a = await createUser(env.db, "alice");
    return createGame(env.deps, {
      ruleset: DEFAULT_RULESET,
      clock: { type: "none" },
      seats: [
        { kind: "bot", tier, name: "Bot" },
        { kind: "human", userId: a.userId, guestId: null, name: "Alice" },
      ],
      seed: 1n,
    });
  }

  test("plays the bot seat, counts CPU, and is idempotent", async () => {
    const gameId = await botGame("hard");
    expect(env.scheduler.log.map((j) => j.topic)).toEqual(["bot-move"]);
    await env.scheduler.runDue();
    expect(await movesOf(gameId)).toHaveLength(1);
    expect(tiersAsked).toEqual(["hard"]);
    // Redelivery of the same job does nothing.
    expect(await handleBotMove(env.deps, { gameId, ply: 0 })).toBe("stale");
    const [u] = await env.db.select().from(botCpuUsage).where(eq(botCpuUsage.month, monthKey(env.clock.now)));
    expect(u!.moves).toBe(1);
    // A human seat is never played by the bot consumer.
    expect(await handleBotMove(env.deps, { gameId, ply: 1 })).toBe("skipped");
  });

  test("drops strong bots to Medium past the monthly CPU cap", async () => {
    await env.db.insert(botCpuUsage).values({ month: monthKey(env.clock.now), cpuMs: BOT_CPU_CAP_MS, moves: 10 });
    const gameId = await botGame("expert");
    await env.scheduler.runDue();
    expect(await movesOf(gameId)).toHaveLength(1);
    expect(tiersAsked).toEqual(["medium"]);
    const [g] = await env.db.select().from(game).where(eq(game.id, gameId));
    expect(g!.ply).toBe(1);
  });
});
