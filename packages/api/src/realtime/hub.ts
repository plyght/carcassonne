// Transport-agnostic WebSocket hub implementing packages/protocol/src/wire.ts. The Bun glue in
// apps/server/src/ws.ts feeds it open/message/close; tests feed it fake connections.
//
// Fan-out: a committed move NOTIFYs `game_<id>`; every instance with local sockets for that game is
// LISTENing on one shared direct connection (PgListener), reads the new move rows and pushes them.
import { gamePlayer, instanceUsage, presence } from "@carcassonne/db/schema/index";
import { REACTIONS, type ClientMessage, type EngineEvent, type PresenceEntry, type ServerMessage } from "@carcassonne/protocol";
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";

import type { Deps } from "../deps";
import {
  gameChannel,
  getMovesSince,
  getView,
  notify,
  seatOf,
  submitMove,
  type GameNotify,
} from "../game/service";
import type { Identity } from "../identity";
import { monthKey } from "../util";
import type { PgListener } from "./listener";

export const PRESENCE_TTL_MS = 30_000;

export interface Conn {
  readonly id: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface ConnState {
  conn: Conn;
  identity: Identity | null;
  gameId: string | null;
  seat: number | null;
  /** Ply the client has seen up to (exclusive upper bound of applied moves). */
  lastPly: number;
  reactTokens: number;
  reactAt: number;
}

interface GameSub {
  conns: Set<ConnState>;
  unlisten: Promise<() => Promise<void>>;
  chain: Promise<void>;
}

const moveSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  rot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  figure: z
    .union([
      z.object({ type: z.enum(["meeple", "abbot"]), feature: z.number().int().min(0) }),
      z.object({ type: z.literal("recallAbbot"), x: z.number().int(), y: z.number().int() }),
    ])
    .nullable(),
});

export const clientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello"), gameId: z.string().uuid(), lastPly: z.number().int().min(0) }),
  z.object({ t: z.literal("intent"), gameId: z.string().uuid(), ply: z.number().int().min(0), move: moveSchema }),
  z.object({ t: z.literal("react"), gameId: z.string().uuid(), emoji: z.string().max(16) }),
  z.object({ t: z.literal("ping") }),
]);

const REACT_BURST = 5;
const REACT_REFILL_MS = 1500;

export class GameHub {
  private conns = new Map<string, ConnState>();
  private games = new Map<string, GameSub>();
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private usageTimer: ReturnType<typeof setInterval> | null = null;
  private session = 0;
  private sessionId: string | null = null;
  private peak = 0;

  constructor(
    private readonly deps: Deps,
    private readonly listener: PgListener,
    private readonly opts: { instanceId: string; presenceIntervalMs?: number; usageIntervalMs?: number },
  ) {}

  get size() {
    return this.conns.size;
  }

  // -------------------------------------------------------------------------------------------
  // Socket lifecycle

  open(conn: Conn, identity: Identity | null) {
    this.conns.set(conn.id, {
      conn,
      identity,
      gameId: null,
      seat: null,
      lastPly: 0,
      reactTokens: REACT_BURST,
      reactAt: this.deps.now(),
    });
    this.peak = Math.max(this.peak, this.conns.size);
    if (this.conns.size === 1) this.startTimers();
  }

  async close(conn: Conn) {
    const st = this.conns.get(conn.id);
    if (!st) return;
    this.conns.delete(conn.id);
    if (st.gameId) await this.leaveGame(st);
    if (this.conns.size === 0) await this.stopTimers();
  }

  async message(conn: Conn, raw: string | Buffer | ArrayBuffer | Uint8Array) {
    const st = this.conns.get(conn.id);
    if (!st) return;
    let msg: ClientMessage;
    try {
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw as ArrayBuffer);
      msg = clientMessageSchema.parse(JSON.parse(text)) as ClientMessage;
    } catch {
      this.send(st, { t: "rejected", gameId: "", ply: -1, error: "malformed message" });
      return;
    }
    try {
      switch (msg.t) {
        case "ping":
          this.send(st, { t: "pong" });
          return;
        case "hello":
          return await this.hello(st, msg.gameId, msg.lastPly);
        case "intent":
          return await this.intent(st, msg);
        case "react":
          return await this.react(st, msg.gameId, msg.emoji);
      }
    } catch (err) {
      console.error("[hub] error handling", msg.t, err);
      this.send(st, { t: "rejected", gameId: "gameId" in msg ? msg.gameId : "", ply: -1, error: "internal error" });
    }
  }

  async shutdown() {
    for (const st of [...this.conns.values()]) {
      st.conn.close(1001, "server shutting down");
      await this.close(st.conn);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Messages

  private send(st: ConnState, m: ServerMessage) {
    try {
      st.conn.send(JSON.stringify(m));
    } catch {
      /* socket already closed */
    }
  }

  private async hello(st: ConnState, gameId: string, lastPly: number) {
    if (st.gameId && st.gameId !== gameId) await this.leaveGame(st);
    // Subscribe before reading so no move can fall between the read and LISTEN.
    if (st.gameId !== gameId) await this.subscribe(st, gameId);
    const res = await getView(this.deps, gameId);
    if (!res) {
      await this.leaveGame(st);
      this.send(st, { t: "rejected", gameId, ply: -1, error: "game not found" });
      return;
    }
    const { loaded, view } = res;
    st.seat = st.identity ? seatOf(loaded.players, st.identity) : null;
    this.send(st, { t: "welcome", gameId, view, ply: view.ply, seat: st.seat });
    // Resume: replay the events the client missed so it can animate them.
    if (lastPly > 0 && lastPly < view.ply) {
      const missed = await getMovesSince(this.deps.db, gameId, lastPly);
      this.send(st, {
        t: "events",
        gameId,
        fromPly: lastPly,
        toPly: view.ply,
        events: missed.flatMap((m) => m.events as EngineEvent[]),
      });
    }
    st.lastPly = view.ply;
    if (loaded.game.turnDeadline && loaded.game.status === "playing") {
      this.send(st, { t: "clock", gameId, ply: view.ply, deadline: loaded.game.turnDeadline.getTime() });
    }
    await this.deps.db
      .insert(presence)
      .values({
        connId: st.conn.id,
        gameId,
        instanceId: this.opts.instanceId,
        userId: st.identity?.kind === "user" ? st.identity.userId : null,
        guestId: st.identity?.kind === "guest" ? st.identity.guestId : null,
        seat: st.seat,
        name: st.identity?.name ?? "Spectator",
        lastSeen: new Date(this.deps.now()),
      })
      .onConflictDoUpdate({
        target: presence.connId,
        set: { gameId, seat: st.seat, lastSeen: new Date(this.deps.now()) },
      });
    await notify(this.deps.db, gameChannel(gameId), { k: "presence" } satisfies GameNotify);
  }

  private async intent(st: ConnState, msg: Extract<ClientMessage, { t: "intent" }>) {
    if (st.gameId !== msg.gameId || !st.identity) {
      this.send(st, { t: "rejected", gameId: msg.gameId, ply: msg.ply, error: st.identity ? "send hello first" : "spectators cannot move" });
      return;
    }
    const r = await submitMove(this.deps, { gameId: msg.gameId, ply: msg.ply, move: msg.move, actor: st.identity });
    if (!r.ok) this.send(st, { t: "rejected", gameId: msg.gameId, ply: msg.ply, error: r.error });
    // On success the NOTIFY delivers `events` to every socket, this one included.
  }

  private async react(st: ConnState, gameId: string, emoji: string) {
    if (st.gameId !== gameId) return;
    if (!(REACTIONS as readonly string[]).includes(emoji)) return;
    const now = this.deps.now();
    st.reactTokens = Math.min(REACT_BURST, st.reactTokens + (now - st.reactAt) / REACT_REFILL_MS);
    st.reactAt = now;
    if (st.reactTokens < 1) return; // rate-limited: silently dropped
    st.reactTokens -= 1;
    await notify(this.deps.db, gameChannel(gameId), {
      k: "react",
      seat: st.seat,
      emoji,
      spectator: st.seat === null,
    } satisfies GameNotify);
  }

  // -------------------------------------------------------------------------------------------
  // Subscriptions and fan-out

  private async subscribe(st: ConnState, gameId: string) {
    st.gameId = gameId;
    let sub = this.games.get(gameId);
    if (!sub) {
      const created: GameSub = { conns: new Set(), unlisten: Promise.resolve(async () => {}), chain: Promise.resolve() };
      created.unlisten = this.listener.listen(gameChannel(gameId), (payload) => {
        // Serialise per game so events go out in ply order.
        created.chain = created.chain.then(() => this.onNotify(gameId, payload)).catch((err) => {
          console.error("[hub] fan-out error", err);
        });
      });
      this.games.set(gameId, created);
      sub = created;
    }
    sub.conns.add(st);
    await sub.unlisten;
  }

  private async leaveGame(st: ConnState) {
    const gameId = st.gameId;
    if (!gameId) return;
    st.gameId = null;
    st.seat = null;
    const sub = this.games.get(gameId);
    if (sub) {
      sub.conns.delete(st);
      if (sub.conns.size === 0) {
        this.games.delete(gameId);
        await (await sub.unlisten)();
      }
    }
    await this.deps.db.delete(presence).where(eq(presence.connId, st.conn.id));
    await notify(this.deps.db, gameChannel(gameId), { k: "presence" } satisfies GameNotify);
  }

  private async onNotify(gameId: string, payload: string) {
    const sub = this.games.get(gameId);
    if (!sub || sub.conns.size === 0) return;
    const n = JSON.parse(payload) as GameNotify;
    if (n.k === "move") {
      const behind = [...sub.conns].filter((c) => c.lastPly < n.ply);
      if (behind.length === 0) return;
      const from = Math.min(...behind.map((c) => c.lastPly));
      const moves = await getMovesSince(this.deps.db, gameId, from);
      if (moves.length === 0) return;
      const toPly = moves[moves.length - 1]!.ply + 1;
      for (const c of behind) {
        if (c.gameId !== gameId) continue;
        const mine = moves.filter((m) => m.ply >= c.lastPly);
        if (mine.length === 0) continue;
        this.send(c, {
          t: "events",
          gameId,
          fromPly: c.lastPly,
          toPly,
          events: mine.flatMap((m) => m.events as EngineEvent[]),
        });
        c.lastPly = toPly;
        if (toPly === n.ply) this.send(c, { t: "clock", gameId, ply: n.ply, deadline: n.deadline });
      }
    } else if (n.k === "react") {
      for (const c of sub.conns) {
        // Spectator reactions are only shown to other spectators (PRD §6.8).
        if (n.spectator && c.seat !== null) continue;
        this.send(c, { t: "reaction", gameId, player: n.seat, emoji: n.emoji });
      }
    } else if (n.k === "presence") {
      const players = await this.presenceFor(gameId);
      for (const c of sub.conns) this.send(c, { t: "presence", gameId, players });
    }
  }

  async presenceFor(gameId: string): Promise<PresenceEntry[]> {
    const cutoff = new Date(this.deps.now() - PRESENCE_TTL_MS);
    const [players, live] = await Promise.all([
      this.deps.db.select().from(gamePlayer).where(eq(gamePlayer.gameId, gameId)).orderBy(asc(gamePlayer.seat)),
      this.deps.db
        .select({ seat: presence.seat })
        .from(presence)
        .where(and(eq(presence.gameId, gameId), gt(presence.lastSeen, cutoff))),
    ]);
    const online = new Set(live.map((p) => p.seat));
    return players.map((p) => ({
      player: p.seat,
      userId: p.userId,
      name: p.name,
      connected: p.botTier !== null || online.has(p.seat),
    }));
  }

  // -------------------------------------------------------------------------------------------
  // Heartbeats: presence TTL (30 s) and instance live time for the free-tier guard rails.

  private startTimers() {
    this.sessionId = `${this.opts.instanceId}:${++this.session}:${this.deps.now()}`;
    this.peak = this.conns.size;
    void this.usageBeat();
    this.presenceTimer = setInterval(() => void this.presenceBeat(), this.opts.presenceIntervalMs ?? 15_000);
    this.usageTimer = setInterval(() => void this.usageBeat(), this.opts.usageIntervalMs ?? 60_000);
  }

  private async stopTimers() {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    if (this.usageTimer) clearInterval(this.usageTimer);
    this.presenceTimer = this.usageTimer = null;
    await this.usageBeat();
    this.sessionId = null;
  }

  async presenceBeat() {
    const ids = [...this.conns.values()].filter((c) => c.gameId).map((c) => c.conn.id);
    try {
      if (ids.length) {
        await this.deps.db
          .update(presence)
          .set({ lastSeen: new Date(this.deps.now()) })
          .where(inArray(presence.connId, ids));
      }
      // Garbage-collect rows left by crashed instances.
      await this.deps.db.delete(presence).where(lt(presence.lastSeen, new Date(this.deps.now() - 10 * PRESENCE_TTL_MS)));
    } catch (err) {
      console.error("[hub] presence heartbeat failed", err);
    }
  }

  async usageBeat() {
    if (!this.sessionId) return;
    const now = new Date(this.deps.now());
    try {
      await this.deps.db
        .insert(instanceUsage)
        .values({ instanceId: this.sessionId, month: monthKey(now.getTime()), startedAt: now, lastHeartbeat: now, peakSockets: this.peak })
        .onConflictDoUpdate({
          target: instanceUsage.instanceId,
          set: { lastHeartbeat: now, peakSockets: sql`greatest(${instanceUsage.peakSockets}, ${this.peak})` },
        });
    } catch (err) {
      console.error("[hub] usage heartbeat failed", err);
    }
  }
}
