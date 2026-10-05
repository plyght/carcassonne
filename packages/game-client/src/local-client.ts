// Hot-seat and vs-AI games. The engine runs behind an AsyncEngine, normally a
// Web Worker (see ./worker/engine-worker.ts) so bots never block the UI.

import type { EngineEvent, FigureOption, GameView, Move, Placement, Ruleset } from "@carcassonne/protocol";

import { GameClient, realTimers, type PlayerMeta, type Timers } from "./client";
import type { AsyncEngine, GameHandle } from "./engine-port";
import { seedFromString } from "./engine-port";
import type { TileCatalog } from "./tiles";

export interface LocalGameConfig {
  ruleset: Ruleset;
  /** Shareable seed string; see seedFromString. */
  seed: string;
  players: PlayerMeta[];
  /** Moves already played (resume / replay). */
  moves?: Move[];
  /** Pause before a bot moves, so humans can follow. */
  aiDelayMs?: number;
}

export interface LocalClientOptions {
  catalog: TileCatalog;
  timers?: Timers;
  /** Called after every committed or undone move (persist the game). */
  onMoves?: (moves: Move[], view: GameView) => void;
}

export class LocalEngineClient extends GameClient {
  private handle: GameHandle = 0;
  private moves: Move[] = [];
  private movers: number[] = [];
  private eventLog: EngineEvent[][] = [];
  private generation = 0;
  private busy = false;
  private disposed = false;

  constructor(
    private engine: AsyncEngine,
    private config: LocalGameConfig,
    private opts: LocalClientOptions,
  ) {
    super(opts.catalog, config.players, opts.timers ?? realTimers);
    this.state = {
      ...this.state,
      connection: "local",
      localSeats: config.players.flatMap((p, i) => (p.kind === "human" ? [i] : [])),
    };
  }

  get history(): readonly Move[] {
    return this.moves;
  }
  get events(): readonly EngineEvent[][] {
    return this.eventLog;
  }

  async start(): Promise<void> {
    try {
      await this.rebuild(this.config.moves ?? []);
      this.setState({ phase: "ready" });
      this.maybeRunBot();
    } catch (e) {
      this.setState({ phase: "error", error: String((e as Error)?.message ?? e) });
    }
  }

  private async rebuild(moves: Move[]) {
    if (this.handle) await this.engine.freeGame(this.handle);
    this.handle = await this.engine.createGame(
      this.config.ruleset,
      seedFromString(this.config.seed),
      this.config.players.length,
    );
    this.moves = [];
    this.movers = [];
    this.eventLog = [];
    for (const m of moves) {
      const v = await this.engine.view(this.handle);
      const r = await this.engine.apply(this.handle, m);
      if (!r.ok) throw new Error(`replay failed at ply ${this.moves.length}: ${r.error}`);
      this.moves.push(m);
      this.movers.push(v.currentPlayer);
      this.eventLog.push(r.events);
    }
    const view = await this.engine.view(this.handle);
    this.setState({ view, recent: [], turnStartedAt: this.timers.now() });
    await this.refreshLegal();
  }

  private async refreshLegal() {
    const view = this.state.view;
    const local = !!view && view.status === "playing" && this.state.localSeats.includes(view.currentPlayer);
    const legal = local ? await this.engine.legalPlacements(this.handle) : [];
    const humanMoved = this.movers.some((p) => this.config.players[p]?.kind === "human");
    this.setState({ legalPlacements: legal, canUndo: humanMoved && !this.state.thinking });
  }

  legalFigures(p: Placement): Promise<FigureOption[]> {
    return this.engine.legalFigures(this.handle, p.x, p.y, p.rot);
  }

  async submit(move: Move): Promise<void> {
    if (this.busy) return;
    const view = this.state.view;
    if (!view || view.status !== "playing") return;
    this.busy = true;
    try {
      await this.commit(move);
    } finally {
      this.busy = false;
    }
    this.maybeRunBot();
  }

  private async commit(move: Move) {
    const mover = this.state.view!.currentPlayer;
    const r = await this.engine.apply(this.handle, move);
    if (!r.ok) {
      this.setState({ error: r.error });
      return;
    }
    this.moves.push(move);
    this.movers.push(mover);
    this.eventLog.push(r.events);
    // Reducer keeps animations/logs in sync; the engine view stays authoritative.
    const view = await this.engine.view(this.handle);
    this.applyEvents(r.events, view);
    this.setState({ error: null });
    await this.refreshLegal();
    this.opts.onMoves?.(this.moves, view);
  }

  private maybeRunBot() {
    const view = this.state.view;
    if (this.disposed || !view || view.status !== "playing") return;
    const seat = this.config.players[view.currentPlayer];
    if (!seat || seat.kind !== "bot") return;
    const gen = ++this.generation;
    this.setState({ thinking: true, canUndo: false });
    this.timers.setTimeout(async () => {
      if (gen !== this.generation || this.disposed) return;
      try {
        const seed = seedFromString(`${this.config.seed}:ai:${view.ply}`);
        const move = await this.engine.aiChoose(this.handle, seat.tier ?? "medium", 1000, seed);
        if (gen !== this.generation || this.disposed) return;
        this.busy = true;
        await this.commit(move);
      } catch (e) {
        this.setState({ error: `bot failed: ${String((e as Error)?.message ?? e)}` });
      } finally {
        this.busy = false;
        if (gen === this.generation) this.setState({ thinking: false });
      }
      if (gen === this.generation) {
        await this.refreshLegal();
        this.maybeRunBot();
      }
    }, this.config.aiDelayMs ?? 650);
  }

  /** Best move for the current (human) player according to the medium bot. */
  async hint(): Promise<Move | null> {
    const view = this.state.view;
    if (!view || view.status !== "playing" || this.busy || this.state.thinking) return null;
    return this.engine.aiChoose(this.handle, "medium", 300, seedFromString(`${this.config.seed}:hint:${view.ply}`));
  }

  /** Take back to the last human move (unlimited in local games). */
  async undo(): Promise<void> {
    if (!this.moves.length || this.busy) return;
    this.generation++;
    let n = this.moves.length - 1;
    // Drop bot replies, then the human move before them.
    while (n > 0 && this.config.players[this.movers[n]!]?.kind === "bot") n--;
    const keep = this.moves.slice(0, n);
    this.busy = true;
    try {
      this.setState({ thinking: false });
      await this.rebuild(keep);
    } finally {
      this.busy = false;
    }
    this.opts.onMoves?.(this.moves, this.state.view!);
    this.maybeRunBot();
  }

  react(emoji: string) {
    const v = this.state.view;
    this.pushReaction(v ? v.currentPlayer : null, emoji);
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    if (this.handle) void this.engine.freeGame(this.handle).catch(() => {});
  }
}
