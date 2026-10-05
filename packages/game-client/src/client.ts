// Framework-agnostic game client base: holds the GameView, applies events, exposes
// an immutable state snapshot + subscribe() (fits React's useSyncExternalStore).

import type {
  AiTier,
  EngineEvent,
  FigureOption,
  GameView,
  Move,
  Placement,
  PlayerIndex,
} from "@carcassonne/protocol";

import { applyEvents } from "./apply-events";
import { analyzeBoard, boardFromTiles, findAbbot, type BoardAnalysis } from "./board";
import type { TileCatalog } from "./tiles";

export type PlayerColorId = "red" | "blue" | "yellow" | "green" | "black" | "pink";

export interface PlayerMeta {
  name: string;
  color: PlayerColorId;
  kind: "human" | "bot" | "remote";
  tier?: AiTier;
  userId?: string | null;
  connected?: boolean;
}

export interface Reaction {
  id: number;
  player: PlayerIndex | null;
  emoji: string;
  at: number;
}

export type ConnectionState = "local" | "connecting" | "open" | "reconnecting" | "polling" | "offline";

export interface EventBatch {
  seq: number;
  ply: number;
  events: EngineEvent[];
}

export interface GameClientState {
  phase: "loading" | "ready" | "error";
  connection: ConnectionState;
  view: GameView | null;
  players: PlayerMeta[];
  /** Seats this client may move for (hot-seat: all humans; online: own seat). */
  localSeats: PlayerIndex[];
  /** Legal placements for the current tile when a local seat is to move. */
  legalPlacements: Placement[];
  /** Most recent event batches (newest last), for animation and the log. */
  recent: EventBatch[];
  reactions: Reaction[];
  /** Epoch ms when the current turn began, and an optional server deadline. */
  turnStartedAt: number;
  deadline: number | null;
  thinking: boolean;
  canUndo: boolean;
  error: string | null;
}

export type Listener = (s: GameClientState) => void;

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  now(): number;
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

const MAX_RECENT = 40;
const REACTION_TTL = 4000;

export abstract class GameClient {
  protected state: GameClientState;
  private listeners = new Set<Listener>();
  private seq = 0;
  private reactionId = 0;
  private analysisCache: { view: GameView; analysis: BoardAnalysis } | null = null;

  constructor(
    readonly catalog: TileCatalog,
    players: PlayerMeta[],
    protected timers: Timers = realTimers,
  ) {
    this.state = {
      phase: "loading",
      connection: "local",
      view: null,
      players,
      localSeats: [],
      legalPlacements: [],
      recent: [],
      reactions: [],
      turnStartedAt: timers.now(),
      deadline: null,
      thinking: false,
      canUndo: false,
      error: null,
    };
  }

  getState = (): GameClientState => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  protected setState(patch: Partial<GameClientState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  /** Apply engine events to the held view (reducer path). */
  protected applyEvents(events: EngineEvent[], authoritative?: GameView): GameView | null {
    const prev = this.state.view;
    if (!prev && !authoritative) return null;
    const next = authoritative ?? applyEvents(prev!, events, this.catalog);
    const turnChanged = !prev || prev.ply !== next.ply || prev.currentPlayer !== next.currentPlayer;
    const recent = events.length
      ? [...this.state.recent, { seq: ++this.seq, ply: next.ply, events }].slice(-MAX_RECENT)
      : this.state.recent;
    this.setState({
      view: next,
      recent,
      turnStartedAt: turnChanged ? this.timers.now() : this.state.turnStartedAt,
    });
    return next;
  }

  protected pushReaction(player: PlayerIndex | null, emoji: string) {
    const r: Reaction = { id: ++this.reactionId, player, emoji, at: this.timers.now() };
    this.setState({ reactions: [...this.state.reactions, r].slice(-20) });
    this.timers.setTimeout(() => {
      this.setState({ reactions: this.state.reactions.filter((x) => x.id !== r.id) });
    }, REACTION_TTL);
  }

  /** Board feature graph for the current view (cached). */
  analysis(): BoardAnalysis | null {
    const view = this.state.view;
    if (!view) return null;
    if (this.analysisCache?.view !== view)
      this.analysisCache = { view, analysis: analyzeBoard(boardFromTiles(view.board), this.catalog) };
    return this.analysisCache.analysis;
  }

  isLocalTurn(): boolean {
    const v = this.state.view;
    return !!v && v.status === "playing" && this.state.localSeats.includes(v.currentPlayer);
  }

  /** Position of the current player's abbot, if recallable this turn. */
  recallableAbbot(): { x: number; y: number; feature: number } | null {
    const v = this.state.view;
    if (!v || !v.ruleset.abbot) return null;
    return findAbbot(boardFromTiles(v.board), v.currentPlayer);
  }

  abstract legalFigures(p: Placement): Promise<FigureOption[]>;
  abstract submit(move: Move): Promise<void>;
  abstract react(emoji: string): void;
  undo(): Promise<void> {
    return Promise.resolve();
  }
  abstract dispose(): void;
}
