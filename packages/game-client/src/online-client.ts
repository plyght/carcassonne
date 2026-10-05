// Online games over the wire protocol (packages/protocol/src/wire.ts).
//
// - Resume: every (re)connect sends hello{gameId, lastPly}; the server answers with
//   welcome (full view) and/or the missed events.
// - Vercel caps a function (and so a socket) at 300 s. At ~280 s we open a second
//   socket, resume on it, then retire the old one, so no events are missed.
// - Unexpected closes reconnect with backoff. After repeated failures we fall back
//   to polling: GET /g/:id/ply every 2 s, then GET /g/:id/m/:ply per missed move.

import type {
  ClientMessage,
  EngineEvent,
  FigureOption,
  GameView,
  Move,
  Placement,
  ServerMessage,
} from "@carcassonne/protocol";

import { GameClient, realTimers, type PlayerMeta, type Timers } from "./client";
import { boardFromTiles, legalFiguresOn, legalPlacementsOn } from "./board";
import type { TileCatalog } from "./tiles";

/** Minimal WebSocket surface (browser WebSocket satisfies it; tests use a fake). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;
export type FetchLike = (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Response of GET /g/:id/m/:ply (immutable, CDN-cached). */
export interface PolledMove {
  ply: number;
  move?: Move;
  events: EngineEvent[];
}

export interface OnlineClientOptions {
  gameId: string;
  /** WebSocket URL, e.g. wss://host/ws */
  wsUrl: string;
  /** HTTP base for the polling fallback, e.g. https://host */
  httpBase: string;
  catalog: TileCatalog;
  players?: PlayerMeta[];
  socketFactory?: SocketFactory;
  fetch?: FetchLike;
  timers?: Timers;
  /** Proactively replace the socket after this long (Vercel max is 300 s). */
  rotateAfterMs?: number;
  pingIntervalMs?: number;
  pollIntervalMs?: number;
  /** Consecutive failed connects before switching to polling. */
  maxFailuresBeforePolling?: number;
  /** Start in polling mode (server flag "force polling"). */
  forcePolling?: boolean;
}

const OPEN = 1;

export class OnlineClient extends GameClient {
  private socket: SocketLike | null = null;
  /** Replacement socket opened during proactive rotation. */
  private incoming: SocketLike | null = null;
  private failures = 0;
  private rotateTimer: unknown = null;
  private pingTimer: unknown = null;
  private reconnectTimer: unknown = null;
  private pollTimer: unknown = null;
  private disposed = false;
  private o: Required<Omit<OnlineClientOptions, "players" | "socketFactory" | "fetch">> & {
    socketFactory: SocketFactory;
    fetch: FetchLike;
  };

  constructor(opts: OnlineClientOptions) {
    super(opts.catalog, opts.players ?? [], opts.timers ?? realTimers);
    this.o = {
      rotateAfterMs: 280_000,
      pingIntervalMs: 25_000,
      pollIntervalMs: 2_000,
      maxFailuresBeforePolling: 4,
      forcePolling: false,
      timers: realTimers,
      ...opts,
      socketFactory: opts.socketFactory ?? ((url) => new WebSocket(url) as unknown as SocketLike),
      fetch: opts.fetch ?? ((url, init) => globalThis.fetch(url, init)),
    } as typeof this.o;
    this.state = { ...this.state, connection: "connecting" };
  }

  get gameId() {
    return this.o.gameId;
  }

  start() {
    if (this.o.forcePolling) this.startPolling();
    else this.connect();
  }

  // ── socket lifecycle ────────────────────────────────────────────────────

  private lastPly(): number {
    return this.state.view?.ply ?? -1;
  }

  private openSocket(): SocketLike {
    const s = this.o.socketFactory(this.o.wsUrl);
    s.onopen = () => {
      this.sendOn(s, { t: "hello", gameId: this.o.gameId, lastPly: this.lastPly() });
      if (s === this.socket) this.onPrimaryOpen();
    };
    s.onmessage = (ev) => this.onMessage(s, ev.data);
    s.onerror = () => {};
    s.onclose = () => this.onSocketClosed(s);
    return s;
  }

  private connect() {
    if (this.disposed) return;
    this.setState({ connection: this.failures ? "reconnecting" : "connecting" });
    this.socket = this.openSocket();
  }

  private onPrimaryOpen() {
    this.failures = 0;
    this.setState({ connection: "open", phase: this.state.view ? "ready" : this.state.phase });
    this.schedulePing();
    this.scheduleRotate();
  }

  private scheduleRotate() {
    if (this.rotateTimer) this.timers.clearTimeout(this.rotateTimer);
    this.rotateTimer = this.timers.setTimeout(() => this.rotate(), this.o.rotateAfterMs);
  }

  private schedulePing() {
    if (this.pingTimer) this.timers.clearTimeout(this.pingTimer);
    this.pingTimer = this.timers.setTimeout(() => {
      if (this.socket?.readyState === OPEN) this.sendOn(this.socket, { t: "ping" });
      this.schedulePing();
    }, this.o.pingIntervalMs);
  }

  /** Proactive reconnect before the platform kills the socket. */
  private rotate() {
    if (this.disposed || this.incoming) return;
    this.incoming = this.openSocket();
  }

  /** The replacement socket is live: promote it and retire the old one. */
  private promote(s: SocketLike) {
    const old = this.socket;
    this.socket = s;
    this.incoming = null;
    if (old && old !== s) {
      old.onclose = null;
      old.onmessage = null;
      try {
        old.close(1000, "rotate");
      } catch {}
    }
    this.onPrimaryOpen();
  }

  private onSocketClosed(s: SocketLike) {
    if (this.disposed) return;
    if (s === this.incoming) {
      // Rotation attempt failed; keep the old socket and retry soon.
      this.incoming = null;
      this.rotateTimer = this.timers.setTimeout(() => this.rotate(), 5_000);
      return;
    }
    if (s !== this.socket) return;
    this.socket = null;
    if (this.rotateTimer) this.timers.clearTimeout(this.rotateTimer);
    if (this.pingTimer) this.timers.clearTimeout(this.pingTimer);
    if (this.incoming) {
      // Old one dropped first, the replacement takes over when it opens.
      const inc = this.incoming;
      if (inc.readyState === OPEN) this.promote(inc);
      else this.socket = inc;
      return;
    }
    this.failures++;
    if (this.failures >= this.o.maxFailuresBeforePolling) {
      this.startPolling();
      return;
    }
    this.setState({ connection: "reconnecting" });
    const delay = Math.min(10_000, 500 * 2 ** (this.failures - 1));
    this.reconnectTimer = this.timers.setTimeout(() => this.connect(), delay);
  }

  private sendOn(s: SocketLike, msg: ClientMessage) {
    try {
      s.send(JSON.stringify(msg));
    } catch {}
  }

  private send(msg: ClientMessage): boolean {
    if (this.socket?.readyState === OPEN) {
      this.sendOn(this.socket, msg);
      return true;
    }
    return false;
  }

  // ── messages ────────────────────────────────────────────────────────────

  private onMessage(s: SocketLike, raw: unknown) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      return;
    }
    if ("gameId" in msg && msg.gameId !== this.o.gameId) return;
    if (s === this.incoming && (msg.t === "welcome" || msg.t === "events")) this.promote(s);
    this.handle(msg);
  }

  /** Exposed for tests and for the polling path. */
  handle(msg: ServerMessage) {
    switch (msg.t) {
      case "welcome": {
        const seat = msg.seat;
        this.setState({ phase: "ready", localSeats: seat === null || seat === undefined ? [] : [seat] });
        const cur = this.state.view;
        if (!cur || msg.view.ply >= cur.ply) this.adoptView(msg.view);
        else this.refreshLegal();
        break;
      }
      case "events":
        this.onEvents(msg.fromPly, msg.toPly, msg.events);
        break;
      case "rejected":
        this.setState({ error: msg.error });
        // Our view may be stale; ask for a resync.
        this.send({ t: "hello", gameId: this.o.gameId, lastPly: this.lastPly() });
        break;
      case "reaction":
        this.pushReaction(msg.player, msg.emoji);
        break;
      case "presence": {
        const players = [...this.state.players];
        for (const e of msg.players) {
          const prev = players[e.player];
          players[e.player] = {
            name: e.name,
            color: prev?.color ?? (["red", "blue", "yellow", "green", "black", "pink"] as const)[e.player % 6]!,
            kind: prev?.kind ?? "remote",
            tier: prev?.tier,
            userId: e.userId,
            connected: e.connected,
          };
        }
        this.setState({ players });
        break;
      }
      case "clock":
        if (msg.ply === this.state.view?.ply) this.setState({ deadline: msg.deadline });
        break;
      case "pong":
        break;
    }
  }

  private adoptView(view: GameView) {
    this.applyEvents([], view);
    this.refreshLegal();
  }

  private onEvents(fromPly: number, toPly: number, events: EngineEvent[]) {
    const view = this.state.view;
    if (!view) return; // wait for welcome
    if (toPly <= view.ply) return; // duplicate
    if (fromPly !== view.ply) {
      // Gap or overlap: ask the server to resume from what we have.
      if (!this.send({ t: "hello", gameId: this.o.gameId, lastPly: view.ply })) void this.pollOnce();
      return;
    }
    this.applyEvents(events);
    if (this.state.view && this.state.view.ply !== toPly) {
      // Engine/reducer disagreement: trust the server.
      this.send({ t: "hello", gameId: this.o.gameId, lastPly: -1 });
    }
    this.setState({ deadline: null, error: null });
    this.refreshLegal();
  }

  private refreshLegal() {
    const v = this.state.view;
    if (!v || v.status !== "playing" || !v.currentTile || !this.state.localSeats.includes(v.currentPlayer)) {
      if (this.state.legalPlacements.length) this.setState({ legalPlacements: [] });
      return;
    }
    this.setState({ legalPlacements: legalPlacementsOn(boardFromTiles(v.board), this.catalog, v.currentTile) });
  }

  // ── polling fallback ────────────────────────────────────────────────────

  private startPolling() {
    if (this.disposed) return;
    this.setState({ connection: "polling" });
    const tick = async () => {
      if (this.disposed) return;
      await this.pollOnce();
      this.pollTimer = this.timers.setTimeout(tick, this.o.pollIntervalMs);
    };
    void tick();
  }

  async pollOnce(): Promise<void> {
    const base = `${this.o.httpBase.replace(/\/$/, "")}/g/${encodeURIComponent(this.o.gameId)}`;
    try {
      const res = await this.o.fetch(`${base}/ply`);
      if (!res.ok) return;
      const { ply } = (await res.json()) as { ply: number };
      while (!this.disposed && this.state.view && this.state.view.ply < ply) {
        const from = this.state.view.ply;
        const r = await this.o.fetch(`${base}/m/${from}`);
        if (!r.ok) return;
        const m = (await r.json()) as PolledMove;
        this.onEvents(from, from + 1, m.events);
        if (this.state.view.ply === from) return; // no progress, try next tick
      }
    } catch {
      /* network hiccup: next tick */
    }
  }

  // ── GameClient API ──────────────────────────────────────────────────────

  async legalFigures(p: Placement): Promise<FigureOption[]> {
    const v = this.state.view;
    if (!v?.currentTile) return [];
    const me = v.players[v.currentPlayer];
    if (!me) return [];
    return legalFiguresOn(boardFromTiles(v.board), this.catalog, v.currentTile, p, me, v.ruleset);
  }

  async submit(move: Move): Promise<void> {
    const v = this.state.view;
    if (!v) return;
    const intent: ClientMessage = { t: "intent", gameId: this.o.gameId, ply: v.ply, move };
    if (this.send(intent)) return;
    // Polling mode: post the intent over HTTP (server endpoint TBD with the server workstream).
    const base = `${this.o.httpBase.replace(/\/$/, "")}/g/${encodeURIComponent(this.o.gameId)}/intent`;
    try {
      const res = await this.o.fetch(base, {
        method: "POST",
        body: JSON.stringify(intent),
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) this.setState({ error: `move rejected (${res.status})` });
      await this.pollOnce();
    } catch (e) {
      this.setState({ error: String((e as Error)?.message ?? e) });
    }
  }

  react(emoji: string) {
    this.send({ t: "react", gameId: this.o.gameId, emoji });
  }

  dispose() {
    this.disposed = true;
    for (const t of [this.rotateTimer, this.pingTimer, this.reconnectTimer, this.pollTimer])
      if (t) this.timers.clearTimeout(t);
    for (const s of [this.socket, this.incoming]) {
      if (!s) continue;
      s.onclose = null;
      try {
        s.close(1000, "dispose");
      } catch {}
    }
    this.socket = null;
    this.incoming = null;
    this.setState({ connection: "offline" });
  }
}
