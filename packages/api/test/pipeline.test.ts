import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { game, gamePlayer, move, rating } from "@carcassonne/db/schema/index";
import { DEFAULT_RULESET, type Move } from "@carcassonne/protocol";
import { asc, eq } from "drizzle-orm";

import { createGame, getView, submitMove } from "../src/game/service";
import { createTestEnv, createUser, truncateAll, type TestEnv } from "../src/testing";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv("carcassonne_test_api", { deckSize: 4 });
});
afterAll(async () => env.close());
beforeEach(async () => {
  await truncateAll(env.db);
  env.scheduler.clear();
});

async function twoPlayerGame(opts: { ranked?: boolean } = {}) {
  const a = await createUser(env.db, "alice");
  const b = await createUser(env.db, "bob");
  const gameId = await createGame(env.deps, {
    ruleset: DEFAULT_RULESET,
    clock: { type: "none" },
    seats: [
      { kind: "human", userId: a.userId, guestId: null, name: "Alice" },
      { kind: "human", userId: b.userId, guestId: null, name: "Bob" },
    ],
    ranked: opts.ranked,
    queue: opts.ranked ? "ffa3" : null,
    seed: 42n,
  });
  return { a, b, gameId };
}

const at = (x: number, y: number, figure: Move["figure"] = null): Move => ({ x, y, rot: 0, figure });

describe("move pipeline", () => {
  test("valid move commits, emits events and advances the ply", async () => {
    const { a, gameId } = await twoPlayerGame();
    const r = await submitMove(env.deps, { gameId, ply: 0, move: at(1, 0, { type: "meeple", feature: 0 }), actor: a });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ply).toBe(1);
    expect(r.events.map((e) => e.type)).toEqual(["tilePlaced", "figurePlaced", "turnStarted"]);
    const rows = await env.db.select().from(move).where(eq(move.gameId, gameId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual(at(1, 0, { type: "meeple", feature: 0 }));
    const [g] = await env.db.select().from(game).where(eq(game.id, gameId));
    expect(g!.ply).toBe(1);
    const res = await getView(env.deps, gameId);
    expect(res!.view.ply).toBe(1);
    expect(res!.view.currentPlayer).toBe(1);
  });

  test("rejects wrong player, stale ply and illegal moves", async () => {
    const { a, b, gameId } = await twoPlayerGame();
    expect(await submitMove(env.deps, { gameId, ply: 0, move: at(1, 0), actor: b })).toMatchObject({ ok: false, code: "not_your_turn" });
    expect(await submitMove(env.deps, { gameId, ply: 3, move: at(1, 0), actor: a })).toMatchObject({ ok: false, code: "stale" });
    expect(await submitMove(env.deps, { gameId, ply: 0, move: at(5, 5), actor: a })).toMatchObject({ ok: false, code: "illegal" });
    expect(await submitMove(env.deps, { gameId, ply: 0, move: at(0, 0), actor: a })).toMatchObject({ ok: false, code: "illegal" });
    const rows = await env.db.select().from(move).where(eq(move.gameId, gameId));
    expect(rows).toHaveLength(0);
  });

  test("concurrent intents for the same ply: exactly one wins", async () => {
    const { a, gameId } = await twoPlayerGame();
    const cells: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    // 16 racing intents (4 different legal moves × 4 copies), as if from several instances.
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) => {
        const [x, y] = cells[i % 4]!;
        return submitMove(env.deps, { gameId, ply: 0, move: at(x, y), actor: a });
      }),
    );
    const winners = results.filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    for (const r of results) if (!r.ok) expect(["conflict", "stale"]).toContain(r.code);
    const rows = await env.db.select().from(move).where(eq(move.gameId, gameId));
    expect(rows).toHaveLength(1);
    const [g] = await env.db.select().from(game).where(eq(game.id, gameId));
    expect(g!.ply).toBe(1);
  });

  test("game end records scores, placements and ranked ratings", async () => {
    const { a, b, gameId } = await twoPlayerGame({ ranked: true });
    const seq: [typeof a, Move][] = [
      [a, at(1, 0, { type: "meeple", feature: 0 })],
      [b, at(2, 0)],
      [a, at(3, 0)],
      [b, at(4, 0)],
    ];
    let last;
    for (let i = 0; i < seq.length; i++) {
      last = await submitMove(env.deps, { gameId, ply: i, move: seq[i]![1], actor: seq[i]![0] });
      expect(last.ok).toBe(true);
    }
    expect(last!.ok && last!.ended).toBe(true);
    const [g] = await env.db.select().from(game).where(eq(game.id, gameId));
    expect(g!.status).toBe("ended");
    expect(g!.finalScores).toEqual([4, 2]);
    const players = await env.db.select().from(gamePlayer).where(eq(gamePlayer.gameId, gameId)).orderBy(asc(gamePlayer.seat));
    expect(players.map((p) => p.placement)).toEqual([1, 2]);
    const ratings = await env.db.select().from(rating).orderBy(asc(rating.userId));
    expect(ratings).toHaveLength(2);
    const alice = ratings.find((r) => r.userId === "alice")!;
    const bob = ratings.find((r) => r.userId === "bob")!;
    expect(alice.mu).toBeGreaterThan(0);
    expect(bob.mu).toBeLessThan(0);
    expect(alice.games).toBe(1);
    // Further moves are refused.
    expect(await submitMove(env.deps, { gameId, ply: 4, move: at(5, 0), actor: a })).toMatchObject({ ok: false, code: "not_playing" });
  });
});
