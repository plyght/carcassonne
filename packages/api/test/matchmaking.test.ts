import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { game, gamePlayer, queueTicket } from "@carcassonne/db/schema/index";
import { eq } from "drizzle-orm";

import type { Context } from "../src/context";
import type { Identity } from "../src/identity";
import { joinQueue, queueStatus, ratingWindow } from "../src/matchmaking/service";
import { appRouter } from "../src/routers/index";
import { createTestEnv, createUser, truncateAll, type TestEnv } from "../src/testing";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv("carcassonne_test_api");
});
afterAll(async () => env.close());
beforeEach(async () => {
  await truncateAll(env.db);
  env.scheduler.clear();
});

function caller(identity: Identity | null) {
  const session =
    identity?.kind === "user"
      ? ({ user: { id: identity.userId, name: identity.name }, session: { id: "s", userId: identity.userId } } as unknown as Context["session"])
      : null;
  return appRouter.createCaller({ db: env.db, deps: env.deps, identity, session, isAdmin: false });
}

describe("matchmaking", () => {
  test("three players in ffa3 form one ranked game", async () => {
    const users = await Promise.all(["u1", "u2", "u3"].map((id) => createUser(env.db, id)));
    expect((await joinQueue(env.deps, "u1", "ffa3")).status).toBe("waiting");
    expect((await joinQueue(env.deps, "u2", "ffa3")).status).toBe("waiting");
    const s = await joinQueue(env.deps, "u3", "ffa3");
    expect(s.status).toBe("matched");
    const gameId = (s as { gameId: string }).gameId;
    const [g] = await env.db.select().from(game).where(eq(game.id, gameId));
    expect(g).toMatchObject({ ranked: true, queue: "ffa3", players: 3 });
    const seats = await env.db.select().from(gamePlayer).where(eq(gamePlayer.gameId, gameId));
    expect(seats.map((p) => p.userId).sort()).toEqual(users.map((u) => u.userId).sort());
    for (const u of users) expect((await queueStatus(env.deps, u.userId)).status).toBe("matched");
  });

  test("no match → delayed retry; the retry consumer matches later joiners", async () => {
    await Promise.all(["u1", "u2"].map((id) => createUser(env.db, id)));
    await joinQueue(env.deps, "u1", "ffa3");
    await joinQueue(env.deps, "u2", "ffa3");
    const retries = env.scheduler.log.filter((j) => j.topic === "matchmaking-retry");
    expect(retries).toHaveLength(1); // deduped by idempotency key
    expect(retries[0]!.delaySeconds).toBe(15);

    // A third player's ticket appears without its own join running a match (e.g. their instance died).
    await createUser(env.db, "u3");
    await env.db.insert(queueTicket).values({ userId: "u3", queue: "ffa3", rating: 1500, createdAt: new Date(env.clock.now) });
    env.clock.advance(15_000);
    await env.scheduler.runDue("matchmaking-retry");
    const tickets = await env.db.select().from(queueTicket);
    expect(tickets.every((t) => t.status === "matched")).toBe(true);
    expect(new Set(tickets.map((t) => t.gameId)).size).toBe(1);
  });

  test("concurrent joins: every player lands in exactly one game", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    for (const id of ids) await createUser(env.db, id);
    await Promise.all(ids.map((id) => joinQueue(env.deps, id, "ffa4")));
    // Leftovers (if a join's match attempt lost the SKIP LOCKED race) are picked up by the retry.
    env.clock.advance(15_000);
    await env.scheduler.runDue("matchmaking-retry");
    const tickets = await env.db.select().from(queueTicket);
    expect(tickets.every((t) => t.status === "matched")).toBe(true);
    const seats = await env.db.select().from(gamePlayer);
    expect(seats).toHaveLength(12);
    expect(new Set(seats.map((s) => s.userId)).size).toBe(12);
    expect(new Set(seats.map((s) => s.gameId)).size).toBe(3);
  });

  test("rating window widens with wait time", () => {
    expect(ratingWindow(0)).toBe(150);
    expect(ratingWindow(30_000)).toBe(450);
    expect(ratingWindow(10 * 60_000)).toBe(1000);
  });

  test("ranked needs an account; leaving cancels the ticket", async () => {
    const guest: Identity = { kind: "guest", guestId: "g_x", name: "Guest" };
    await expect(caller(guest).matchmaking.joinQueue({ queue: "ffa3" })).rejects.toThrow(/Authentication required/);
    const u = await createUser(env.db, "solo");
    expect((await caller(u).matchmaking.joinQueue({ queue: "ffa4" })).status).toBe("waiting");
    expect((await caller(u).matchmaking.leaveQueue()).status).toBe("idle");
  });
});

describe("rooms", () => {
  test("create with bots, guest joins by code, host kicks/starts; bot seat gets a job", async () => {
    const host = await createUser(env.db, "host", "Host");
    const r = await caller(host).room.create({ bots: ["easy"], clock: { type: "turn", turnSeconds: 30 } });
    expect(r.isHost).toBe(true);
    expect(r.seats).toHaveLength(2);

    const joined = await caller(null).room.joinAsGuest({ code: r.code.toLowerCase(), nickname: "  Gus  " });
    expect(joined.room.seats).toHaveLength(3);
    expect(joined.guestToken).toContain(".");
    const guest: Identity = { kind: "guest", guestId: joined.guestId, name: "Gus" };
    // Joining twice is idempotent.
    expect((await caller(guest).room.join({ code: r.code })).seats).toHaveLength(3);
    await expect(caller(guest).room.start({ roomId: r.id })).rejects.toThrow(/host/);

    const configured = await caller(host).room.configure({ roomId: r.id, bots: ["medium", "easy"] });
    expect(configured.seats.map((s) => s.kind)).toEqual(["human", "human", "bot", "bot"]);
    const kicked = await caller(host).room.kick({ roomId: r.id, seat: 3 });
    expect(kicked.seats).toHaveLength(3);

    const { gameId } = await caller(host).room.start({ roomId: r.id });
    const view = await caller(guest).game.get({ gameId });
    expect(view.seat).toBe(1);
    expect(view.players.map((p) => p.botTier)).toEqual([null, null, "medium"]);
    expect(env.scheduler.log.some((j) => j.topic === "clock-timeout")).toBe(true);
    await expect(caller(guest).room.join({ code: r.code })).resolves.toBeDefined(); // already seated
    const intruder = await createUser(env.db, "late");
    await expect(caller(intruder).room.join({ code: r.code })).rejects.toThrow(/already started/);
  });

  test("guest token round-trip and polling-mode intent over tRPC", async () => {
    const host = await createUser(env.db, "host", "Host");
    const r = await caller(host).room.create({});
    const { guestId } = await caller(null).room.joinAsGuest({ code: r.code, nickname: "Gus" });
    const { gameId } = await caller(host).room.start({ roomId: r.id });
    const guest: Identity = { kind: "guest", guestId, name: "Gus" };
    await expect(caller(guest).game.submitMove({ gameId, ply: 0, move: { x: 1, y: 0, rot: 0, figure: null } })).rejects.toThrow(/not your turn/);
    const ok = await caller(host).game.submitMove({ gameId, ply: 0, move: { x: 1, y: 0, rot: 0, figure: null } });
    expect(ok.ply).toBe(1);
    const legal = await caller(null).game.legal({ gameId });
    expect(legal.placements.length).toBeGreaterThan(0);
    await expect(caller(null).game.replay({ gameId })).rejects.toThrow(/in progress/);
    const mine = await caller(guest).game.listMine();
    expect(mine.items.map((i) => i.gameId)).toEqual([gameId]);
  });
});
