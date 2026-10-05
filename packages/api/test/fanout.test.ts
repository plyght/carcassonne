// NOTIFY fan-out across two simulated "instances": each has its own GameHub and its own direct LISTEN
// connection, exactly like two Vercel Function instances holding sockets for the same game.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { DEFAULT_RULESET, type ServerMessage } from "@carcassonne/protocol";

import { createGame, submitMove } from "../src/game/service";
import { GameHub, type Conn } from "../src/realtime/hub";
import { PgListener } from "../src/realtime/listener";
import { createTestEnv, createUser, truncateAll, type TestEnv } from "../src/testing";

let env: TestEnv;
let listeners: PgListener[] = [];
beforeAll(async () => {
  env = await createTestEnv("carcassonne_test_api");
});
afterAll(async () => env.close());
beforeEach(async () => {
  await truncateAll(env.db);
  env.scheduler.clear();
});

class FakeConn implements Conn {
  inbox: ServerMessage[] = [];
  closed = false;
  constructor(readonly id: string) {}
  send(data: string) {
    this.inbox.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  of<T extends ServerMessage["t"]>(t: T) {
    return this.inbox.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
  }
  async waitFor<T extends ServerMessage["t"]>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms = 3000) {
    const end = Date.now() + ms;
    for (;;) {
      const hit = this.of(t).find(pred);
      if (hit) return hit;
      if (Date.now() > end) throw new Error(`timeout waiting for ${t}; inbox=${JSON.stringify(this.inbox)}`);
      await Bun.sleep(10);
    }
  }
}

function instance(name: string) {
  const l = new PgListener(env.url);
  listeners.push(l);
  return new GameHub(env.deps, l, { instanceId: name, presenceIntervalMs: 60_000, usageIntervalMs: 60_000 });
}

describe("NOTIFY fan-out", () => {
  test("a move committed anywhere reaches sockets on both instances", async () => {
    const a = await createUser(env.db, "alice", "Alice");
    const b = await createUser(env.db, "bob", "Bob");
    const gameId = await createGame(env.deps, {
      ruleset: DEFAULT_RULESET,
      clock: { type: "none" },
      seats: [
        { kind: "human", userId: a.userId, guestId: null, name: "Alice" },
        { kind: "human", userId: b.userId, guestId: null, name: "Bob" },
      ],
      seed: 3n,
    });

    const hub1 = instance("i1");
    const hub2 = instance("i2");
    const alice = new FakeConn("c-alice");
    const bob = new FakeConn("c-bob");
    const spectator = new FakeConn("c-spec");
    hub1.open(alice, a);
    hub2.open(bob, b);
    hub2.open(spectator, null);
    await hub1.message(alice, JSON.stringify({ t: "hello", gameId, lastPly: 0 }));
    await hub2.message(bob, JSON.stringify({ t: "hello", gameId, lastPly: 0 }));
    await hub2.message(spectator, JSON.stringify({ t: "hello", gameId, lastPly: 0 }));
    expect(alice.of("welcome")[0]).toMatchObject({ gameId, ply: 0, seat: 0 });
    expect(bob.of("welcome")[0]).toMatchObject({ seat: 1 });
    expect(spectator.of("welcome")[0]).toMatchObject({ seat: null });

    // Alice's intent goes through instance 1; Bob and the spectator live on instance 2.
    await hub1.message(alice, JSON.stringify({ t: "intent", gameId, ply: 0, move: { x: 1, y: 0, rot: 0, figure: null } }));
    for (const c of [alice, bob, spectator]) {
      const ev = await c.waitFor("events", (m) => m.toPly === 1);
      expect(ev).toMatchObject({ gameId, fromPly: 0, toPly: 1 });
      expect(ev.events[0]).toMatchObject({ type: "tilePlaced", player: 0, x: 1, y: 0 });
    }

    // A move committed by neither hub (e.g. a queue consumer) also fans out.
    expect((await submitMove(env.deps, { gameId, ply: 1, move: { x: 2, y: 0, rot: 0, figure: null }, actor: b })).ok).toBe(true);
    await alice.waitFor("events", (m) => m.fromPly === 1 && m.toPly === 2);
    await bob.waitFor("events", (m) => m.fromPly === 1 && m.toPly === 2);

    // Out-of-turn intent is rejected only to the sender.
    await hub2.message(bob, JSON.stringify({ t: "intent", gameId, ply: 2, move: { x: 3, y: 0, rot: 0, figure: null } }));
    expect(bob.of("rejected")).toHaveLength(1);
    expect(alice.of("rejected")).toHaveLength(0);

    // Reactions: players' reach everyone; spectators' reach only spectators.
    await hub1.message(alice, JSON.stringify({ t: "react", gameId, emoji: "🏰" }));
    await bob.waitFor("reaction", (m) => m.emoji === "🏰" && m.player === 0);
    await spectator.waitFor("reaction", (m) => m.emoji === "🏰");
    await hub2.message(spectator, JSON.stringify({ t: "react", gameId, emoji: "👀" }));
    await spectator.waitFor("reaction", (m) => m.emoji === "👀");
    await Bun.sleep(100);
    expect(alice.of("reaction").some((m) => m.emoji === "👀")).toBe(false);
    // Non-curated emoji are ignored.
    await hub1.message(alice, JSON.stringify({ t: "react", gameId, emoji: "💩" }));

    // Presence: both seats connected; after Bob leaves, his seat is offline.
    const pres = await alice.waitFor("presence", (m) => m.players.every((p) => p.connected));
    expect(pres.players.map((p) => p.name)).toEqual(["Alice", "Bob"]);
    await hub2.close(bob);
    await alice.waitFor("presence", (m) => m.players[1]!.connected === false);

    // Ping/pong and malformed input.
    await hub1.message(alice, JSON.stringify({ t: "ping" }));
    expect(alice.of("pong")).toHaveLength(1);
    await hub1.message(alice, "{nope");
    expect(alice.of("rejected").at(-1)).toMatchObject({ error: "malformed message" });

    await hub1.shutdown();
    await hub2.shutdown();
    for (const l of listeners) await l.close();
    listeners = [];
  });
});
