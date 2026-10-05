// End-to-end over a real Bun.serve with the exact options api/server.ts uses: better-auth sign-up,
// tRPC room flow, guest token, WebSocket protocol happy path + resume, polling endpoints, kill switch.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { FakeEngine } from "@carcassonne/api/game/fake-engine";
import { createJobHandlers } from "@carcassonne/api/jobs/handlers";
import { InProcessScheduler } from "@carcassonne/api/scheduler/in-process";
import { setupTestDatabase, truncateAll } from "@carcassonne/api/testing";
import type { ServerMessage } from "@carcassonne/protocol";

import { createServeOptions } from "../src/main";
import { createServices, type Services } from "../src/services";

let services: Services;
let server: ReturnType<typeof Bun.serve>;
let base: string;
const flags = { forcePolling: false, pauseOnline: false };

beforeAll(async () => {
  const url = await setupTestDatabase("carcassonne_test_server");
  const port = 40000 + Math.floor(Math.random() * 10000);
  base = `http://localhost:${port}`;
  const engine = new FakeEngine({ deckSize: 8 });
  const scheduler = new InProcessScheduler();
  services = createServices({
    databaseUrl: url,
    authSecret: "test-secret-test-secret-test-secret-123",
    authUrl: base,
    corsOrigin: base,
    scheduler,
    engine: async () => engine,
    flags: async () => flags,
    instanceId: "test",
  });
  scheduler.setHandlers(createJobHandlers(services.deps));
  await truncateAll(services.db);
  server = Bun.serve({ port, ...createServeOptions(services) });
});

afterAll(async () => {
  server?.stop(true);
  await services?.close();
});

async function trpc<T>(path: string, input: unknown, headers: Record<string, string> = {}, method: "POST" | "GET" = "POST") {
  const res =
    method === "POST"
      ? await fetch(`${base}/trpc/${path}`, { method, headers: { "content-type": "application/json", origin: base, ...headers }, body: JSON.stringify(input) })
      : await fetch(`${base}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { origin: base, ...headers } });
  const body = (await res.json()) as { result?: { data: T }; error?: unknown };
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(body.error)}`);
  return body.result!.data;
}

class Client {
  inbox: ServerMessage[] = [];
  ws: WebSocket;
  opened: Promise<void>;
  constructor(url: string, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url, { headers } as unknown as string[]);
    this.ws.onmessage = (e) => this.inbox.push(JSON.parse(String(e.data)));
    this.opened = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(e);
    });
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async waitFor<T extends ServerMessage["t"]>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) {
    const end = Date.now() + 3000;
    for (;;) {
      const hit = this.inbox.find((m): m is Extract<ServerMessage, { t: T }> => m.t === t && pred(m as never));
      if (hit) return hit;
      if (Date.now() > end) throw new Error(`timeout waiting for ${t}: ${JSON.stringify(this.inbox)}`);
      await Bun.sleep(10);
    }
  }
  close() {
    this.ws.close();
  }
}

describe("WebSocket protocol", () => {
  test("auth + room + guest → hello/welcome, intents fan out, resume replays missed moves", async () => {
    // Account sign-up through better-auth (mounted at /api/auth/*).
    const signup = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ email: "alice@example.test", password: "correct-horse-battery", name: "Alice" }),
    });
    expect(signup.status).toBe(200);
    const cookie = signup.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const auth = { cookie };

    const room = await trpc<{ id: string; code: string }>("room.create", { clock: { type: "turn", turnSeconds: 60 } }, auth);
    const joined = await trpc<{ guestToken: string }>("room.joinAsGuest", { code: room.code, nickname: "Gus" });
    const { gameId } = await trpc<{ gameId: string }>("room.start", { roomId: room.id }, auth);

    const alice = new Client(`${base.replace("http", "ws")}/ws`, auth);
    const gus = new Client(`${base.replace("http", "ws")}/ws?guest=${encodeURIComponent(joined.guestToken)}`);
    await Promise.all([alice.opened, gus.opened]);
    alice.send({ t: "hello", gameId, lastPly: 0 });
    gus.send({ t: "hello", gameId, lastPly: 0 });
    expect(await alice.waitFor("welcome")).toMatchObject({ gameId, ply: 0, seat: 0 });
    expect(await gus.waitFor("welcome")).toMatchObject({ gameId, ply: 0, seat: 1 });
    await alice.waitFor("clock", (m) => m.ply === 0 && typeof m.deadline === "number");

    alice.send({ t: "ping" });
    await alice.waitFor("pong");

    alice.send({ t: "intent", gameId, ply: 0, move: { x: 1, y: 0, rot: 1, figure: { type: "meeple", feature: 2 } } });
    for (const c of [alice, gus]) {
      const ev = await c.waitFor("events", (m) => m.toPly === 1);
      expect(ev.events.map((e) => e.type)).toEqual(["tilePlaced", "figurePlaced", "turnStarted"]);
      await c.waitFor("clock", (m) => m.ply === 1);
    }

    // Wrong turn is rejected to the sender only.
    alice.send({ t: "intent", gameId, ply: 1, move: { x: 2, y: 0, rot: 0, figure: null } });
    expect(await alice.waitFor("rejected")).toMatchObject({ ply: 1, error: "not your turn" });

    gus.send({ t: "intent", gameId, ply: 1, move: { x: 2, y: 0, rot: 0, figure: null } });
    await alice.waitFor("events", (m) => m.toPly === 2);
    await gus.waitFor("events", (m) => m.toPly === 2);

    // Reactions relay to everyone in the game.
    gus.send({ t: "react", gameId, emoji: "🐑" });
    await alice.waitFor("reaction", (m) => m.emoji === "🐑" && m.player === 1);

    // Gus drops; Alice moves while he is away; Gus resumes on a fresh socket with lastPly=2.
    gus.close();
    await alice.waitFor("presence", (m) => m.players[1]?.connected === false);
    alice.send({ t: "intent", gameId, ply: 2, move: { x: 3, y: 0, rot: 0, figure: null } });
    await alice.waitFor("events", (m) => m.toPly === 3);

    const gus2 = new Client(`${base.replace("http", "ws")}/ws?guest=${encodeURIComponent(joined.guestToken)}`);
    await gus2.opened;
    gus2.send({ t: "hello", gameId, lastPly: 2 });
    const welcome = await gus2.waitFor("welcome");
    expect(welcome).toMatchObject({ ply: 3, seat: 1 });
    expect(welcome.view.board).toHaveLength(4);
    const missed = await gus2.waitFor("events");
    expect(missed).toMatchObject({ fromPly: 2, toPly: 3 });
    expect(missed.events[0]).toMatchObject({ type: "tilePlaced", x: 3, y: 0 });
    await alice.waitFor("presence", (m) => m.players.every((p) => p.connected));

    // Polling fallback: tiny CDN-cached ply endpoint + immutable move URLs.
    const ply = await fetch(`${base}/g/${gameId}/ply`);
    expect(ply.headers.get("cache-control")).toContain("s-maxage=1");
    expect(await ply.json()).toMatchObject({ ply: 3, status: "playing" });
    const m0 = await fetch(`${base}/g/${gameId}/m/0`);
    expect(m0.headers.get("cache-control")).toContain("immutable");
    expect(await m0.json()).toMatchObject({ ply: 0, seat: 0, move: { x: 1, y: 0, rot: 1 } });
    const m9 = await fetch(`${base}/g/${gameId}/m/9`);
    expect(m9.status).toBe(404);
    expect(m9.headers.get("cache-control")).not.toContain("immutable");
    expect((await fetch(`${base}/g/not-a-uuid/ply`)).status).toBe(404);

    // tRPC catch-up path used by polling clients.
    const state = await trpc<{ ply: number; seat: number | null; events: unknown[] }>("game.get", { gameId, sincePly: 1 }, auth, "GET");
    expect(state.ply).toBe(3);
    expect(state.seat).toBe(0);
    expect(state.events.length).toBeGreaterThan(0);

    alice.close();
    gus2.close();
  });

  test("kill switch: forcePolling refuses new sockets and advertises polling", async () => {
    flags.forcePolling = true;
    try {
      const res = await fetch(`${base}/ws`, { headers: { upgrade: "websocket", connection: "Upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" } });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ transport: "polling" });
      expect(await (await fetch(`${base}/config`)).json()).toMatchObject({ transport: "polling" });
    } finally {
      flags.forcePolling = false;
    }
  });

  test("the /api/server function prefix is tolerated", async () => {
    expect(await (await fetch(`${base}/api/server/healthz`)).text()).toBe("OK");
  });
});
