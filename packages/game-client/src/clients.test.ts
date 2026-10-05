import { describe, expect, test } from "bun:test";

import { DEFAULT_RULESET, type ClientMessage, type ServerMessage } from "@carcassonne/protocol";

import type { PlayerMeta, Timers } from "./client";
import { DevEngine } from "./dev-engine";
import { baseCatalog } from "./dev-engine/tiles-base";
import { inlineEngine, seedFromString } from "./engine-port";
import { LocalEngineClient } from "./local-client";
import { OnlineClient, type FetchLike, type SocketLike } from "./online-client";
import { simulateReplay, viewAtPly } from "./replay";

const RULES = { ...DEFAULT_RULESET, river: false };

class FakeTimers implements Timers {
  t = 0;
  private q: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.q.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(id: unknown) {
    this.q = this.q.filter((e) => e.id !== id);
  }
  now() {
    return this.t;
  }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at);
      const e = this.q[0];
      if (!e || e.at > end) break;
      this.q.shift();
      this.t = e.at;
      e.fn();
    }
    this.t = end;
  }
}

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: ClientMessage[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({});
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.close();
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const HUMANS: PlayerMeta[] = [
  { name: "Ada", color: "red", kind: "human" },
  { name: "Bo", color: "blue", kind: "human" },
];

/** A server-side engine to produce realistic views and events. */
function serverGame() {
  const eng = new DevEngine();
  const h = eng.createGame(RULES, seedFromString("wire"), 2);
  return {
    view: () => eng.view(h),
    step() {
      const before = eng.view(h).ply;
      const move = eng.aiChoose(h, "easy", 10, 1n);
      const r = eng.apply(h, move);
      if (!r.ok) throw new Error(r.error);
      return { fromPly: before, toPly: before + 1, events: r.events };
    },
  };
}

describe("LocalEngineClient", () => {
  test("hot-seat: submit, undo, legal placements", async () => {
    const timers = new FakeTimers();
    const saved: number[] = [];
    const c = new LocalEngineClient(
      inlineEngine(new DevEngine()),
      { ruleset: RULES, seed: "hotseat", players: HUMANS },
      { catalog: baseCatalog, timers, onMoves: (m) => saved.push(m.length) },
    );
    await c.start();
    const s0 = c.getState();
    expect(s0.phase).toBe("ready");
    expect(s0.localSeats).toEqual([0, 1]);
    expect(s0.legalPlacements.length).toBeGreaterThan(0);
    const p = s0.legalPlacements[0]!;
    const figs = await c.legalFigures(p);
    expect(figs.length).toBeGreaterThan(0);
    await c.submit({ ...p, figure: figs[0]! });
    const s1 = c.getState();
    expect(s1.view!.ply).toBe(1);
    expect(s1.view!.currentPlayer).toBe(1);
    expect(s1.recent.at(-1)!.events.some((e) => e.type === "tilePlaced")).toBe(true);
    expect(s1.canUndo).toBe(true);
    await c.undo();
    expect(c.getState().view!.ply).toBe(0);
    expect(c.getState().view!.board.length).toBe(1);
    expect(saved).toEqual([1, 0]);
  });

  test("vs AI: bot answers after the delay, undo rewinds past the bot", async () => {
    const timers = new FakeTimers();
    const c = new LocalEngineClient(
      inlineEngine(new DevEngine()),
      {
        ruleset: RULES,
        seed: "ai",
        players: [HUMANS[0]!, { name: "Bot", color: "green", kind: "bot", tier: "easy" }],
        aiDelayMs: 500,
      },
      { catalog: baseCatalog, timers },
    );
    await c.start();
    const p = c.getState().legalPlacements[0]!;
    await c.submit({ ...p, figure: null });
    expect(c.getState().thinking).toBe(true);
    expect(c.getState().legalPlacements.length).toBe(0);
    timers.advance(500);
    for (let i = 0; i < 20 && c.getState().thinking; i++) await tick();
    expect(c.getState().view!.ply).toBe(2);
    expect(c.getState().view!.currentPlayer).toBe(0);
    await c.undo();
    expect(c.getState().view!.ply).toBe(0);
  });
});

describe("OnlineClient", () => {
  function setup(extra: Partial<ConstructorParameters<typeof OnlineClient>[0]> = {}) {
    const timers = new FakeTimers();
    const sockets: FakeSocket[] = [];
    const client = new OnlineClient({
      gameId: "g1",
      wsUrl: "ws://test/ws",
      httpBase: "http://test",
      catalog: baseCatalog,
      timers,
      socketFactory: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      ...extra,
    });
    return { timers, sockets, client };
  }

  test("hello on open, welcome adopts view, events advance it", () => {
    const srv = serverGame();
    const { sockets, client } = setup();
    client.start();
    expect(client.getState().connection).toBe("connecting");
    sockets[0]!.open();
    expect(sockets[0]!.sent[0]).toEqual({ t: "hello", gameId: "g1", lastPly: -1 });
    sockets[0]!.receive({ t: "welcome", gameId: "g1", view: srv.view(), ply: 0, seat: 0 });
    expect(client.getState().phase).toBe("ready");
    expect(client.getState().localSeats).toEqual([0]);
    expect(client.getState().legalPlacements.length).toBeGreaterThan(0);
    const b = srv.step();
    sockets[0]!.receive({ t: "events", gameId: "g1", ...b });
    expect(client.getState().view!.ply).toBe(1);
    expect(client.getState().view!.board.length).toBe(srv.view().board.length);
    // Duplicate batch is ignored.
    sockets[0]!.receive({ t: "events", gameId: "g1", ...b });
    expect(client.getState().view!.ply).toBe(1);
  });

  test("gap in plies triggers a resume hello", () => {
    const srv = serverGame();
    const { sockets, client } = setup();
    client.start();
    sockets[0]!.open();
    sockets[0]!.receive({ t: "welcome", gameId: "g1", view: srv.view(), ply: 0, seat: 1 });
    srv.step();
    const b2 = srv.step();
    sockets[0]!.receive({ t: "events", gameId: "g1", ...b2 });
    expect(client.getState().view!.ply).toBe(0);
    expect(sockets[0]!.sent.at(-1)).toEqual({ t: "hello", gameId: "g1", lastPly: 0 });
  });

  test("reconnects with backoff and resumes from lastPly", () => {
    const srv = serverGame();
    const { timers, sockets, client } = setup();
    client.start();
    sockets[0]!.open();
    sockets[0]!.receive({ t: "welcome", gameId: "g1", view: srv.view(), ply: 0, seat: 0 });
    sockets[0]!.receive({ t: "events", gameId: "g1", ...srv.step() });
    sockets[0]!.drop();
    expect(client.getState().connection).toBe("reconnecting");
    expect(sockets.length).toBe(1);
    timers.advance(499);
    expect(sockets.length).toBe(1);
    timers.advance(1);
    expect(sockets.length).toBe(2);
    sockets[1]!.open();
    expect(sockets[1]!.sent[0]).toEqual({ t: "hello", gameId: "g1", lastPly: 1 });
    expect(client.getState().connection).toBe("open");
  });

  test("proactively rotates the socket at ~280 s without dropping events", () => {
    const srv = serverGame();
    const { timers, sockets, client } = setup();
    client.start();
    sockets[0]!.open();
    sockets[0]!.receive({ t: "welcome", gameId: "g1", view: srv.view(), ply: 0, seat: 0 });
    timers.advance(279_999);
    expect(sockets.length).toBe(1);
    timers.advance(1);
    expect(sockets.length).toBe(2);
    // Old socket still delivers while the new one connects.
    sockets[0]!.receive({ t: "events", gameId: "g1", ...srv.step() });
    sockets[1]!.open();
    expect(sockets[1]!.sent[0]).toEqual({ t: "hello", gameId: "g1", lastPly: 1 });
    expect(sockets[0]!.closed).toBe(false);
    sockets[1]!.receive({ t: "welcome", gameId: "g1", view: srv.view(), ply: 1, seat: 0 });
    expect(sockets[0]!.closed).toBe(true);
    // Retiring the old socket must not trigger a reconnect.
    timers.advance(20_000);
    expect(sockets.length).toBe(2);
    expect(client.getState().connection).toBe("open");
    // Intents now go over the new socket.
    void client.submit({ x: 0, y: 1, rot: 0, figure: null });
    expect(sockets[1]!.sent.at(-1)!.t).toBe("intent");
  });

  test("falls back to polling after repeated failures", async () => {
    const srv = serverGame();
    const steps = [srv.step(), srv.step()];
    const urls: string[] = [];
    const fetch: FetchLike = async (url) => {
      urls.push(url);
      if (url.endsWith("/ply")) return { ok: true, status: 200, json: async () => ({ ply: 2 }) };
      const ply = Number(url.split("/").at(-1));
      return { ok: true, status: 200, json: async () => ({ ply, events: steps[ply]!.events }) };
    };
    const fresh = serverGame();
    const { timers, sockets, client } = setup({ fetch, maxFailuresBeforePolling: 2 });
    client.start();
    sockets[0]!.open();
    sockets[0]!.receive({ t: "welcome", gameId: "g1", view: fresh.view(), ply: 0, seat: 0 });
    sockets[0]!.drop();
    timers.advance(500);
    sockets[1]!.drop(); // never opened
    expect(client.getState().connection).toBe("polling");
    for (let i = 0; i < 10; i++) await tick();
    expect(urls[0]).toBe("http://test/g/g1/ply");
    expect(urls).toContain("http://test/g/g1/m/0");
    expect(urls).toContain("http://test/g/g1/m/1");
    expect(client.getState().view!.ply).toBe(2);
    client.dispose();
  });

  test("reactions expire", () => {
    const { timers, sockets, client } = setup();
    client.start();
    sockets[0]!.open();
    sockets[0]!.receive({ t: "reaction", gameId: "g1", player: 1, emoji: "🐑" });
    expect(client.getState().reactions.map((r) => r.emoji)).toEqual(["🐑"]);
    timers.advance(5000);
    expect(client.getState().reactions).toEqual([]);
  });
});

describe("replay", () => {
  test("re-simulates and scrubs", async () => {
    const eng = new DevEngine();
    const h = eng.createGame(RULES, seedFromString("replay"), 2);
    const moves = [];
    for (let i = 0; i < 6; i++) {
      const m = eng.aiChoose(h, "easy", 1, BigInt(i));
      eng.apply(h, m);
      moves.push(m);
    }
    const rep = await simulateReplay(inlineEngine(new DevEngine()), {
      id: "r",
      engine: "dev-ts",
      ruleset: RULES,
      seed: "replay",
      players: HUMANS,
      moves,
      startedAt: 0,
      finishedAt: null,
      scores: [],
    });
    expect(rep.plies.length).toBe(6);
    expect(viewAtPly(rep, 0).board.length).toBe(1);
    expect(viewAtPly(rep, 6, baseCatalog).board.length).toBe(eng.view(h).board.length);
    expect(viewAtPly(rep, 6, baseCatalog).players.map((p) => p.score)).toEqual(eng.view(h).players.map((p) => p.score));
  });
});
