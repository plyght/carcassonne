// The interactive tutorial: short scripted lessons on crafted boards, played on the
// real engine. Each lesson is a public GameView rebuilt with `game_from_view`, so
// placement legality, figure options and scoring all come from core.wasm; the script
// only decides which tile is in hand, where it may go and which figure is allowed.
//
// The bot ("a passive opponent") never claims anything: between your moves it lays a
// scripted tile so you see turns alternate.

import type { CoreKit, EngineGame } from "@carcassonne/core-wasm";
import type {
  BoardTile,
  EngineEvent,
  FeatureKind,
  FigureOption,
  GameView,
  Move,
  Placement,
  PlayerView,
  Ruleset,
  TileId,
} from "@carcassonne/protocol";

import { GameClient, realTimers, type PlayerMeta, type Timers } from "./client";
import type { Rot, TileCatalog } from "./tiles";

export const TUTORIAL_RULESET: Ruleset = { fieldEdition: 3, river: false, abbot: false, handSize: 1 };

export interface TutorialFigureRule {
  /** The feature kind the figure must go on. */
  kind: FeatureKind;
  /** Restrict to one feature index of the placed tile (e.g. the field above the road). */
  feature?: number;
}

export interface TutorialStep {
  id: string;
  tile: TileId;
  /** Where the tile may go; `rots` narrows the rotations (default: every legal one). */
  cells: { x: number; y: number; rots?: Rot[] }[];
  /** null: the step only teaches placement, so the figure choice is "skip". */
  figure: TutorialFigureRule | null;
  /** Snap the preview to a legal rotation on hover (off for the rotation lesson). */
  snap?: boolean;
  /** Rotation of the tile in hand when the step starts. */
  startRot?: Rot;
  /** The bot's reply after this step: a tile laid at a cell, no figure. */
  bot?: { tile: TileId; x: number; y: number };
}

export interface TutorialChapter {
  id: string;
  /** Tiles already on the table, in placement order (each must touch an earlier one). */
  board: BoardTile[];
  /** Draw pile shown in the HUD; empty means the tile in hand is the last one. */
  remaining: Record<TileId, number>;
  steps: TutorialStep[];
}

const t = (tile: TileId, x: number, y: number, rot: Rot = 0): BoardTile => ({ tile, x, y, rot, figures: [] });
const PILE = { U: 4, V: 5, E: 3, B: 2, K: 2 };

/**
 * The lessons. Board coordinates: x grows east, y grows south; rotations are clockwise
 * quarter turns. Tile ids are the engine's (D = the start tile, U = straight road,
 * V = bend, A = cloister with a road, B = cloister, W = junction, E = city edge,
 * M = city corner with a shield).
 */
export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
  {
    id: "place",
    board: [t("D", 0, 0)],
    remaining: PILE,
    steps: [{ id: "place", tile: "U", cells: [{ x: 1, y: 0 }, { x: -1, y: 0 }], figure: null, bot: { tile: "B", x: 0, y: 1 } }],
  },
  {
    id: "rotate",
    board: [t("D", 0, 0), t("U", 1, 0, 1)],
    remaining: PILE,
    steps: [{ id: "rotate", tile: "V", cells: [{ x: 2, y: 0 }], figure: null, snap: false, startRot: 2, bot: { tile: "B", x: 1, y: 1 } }],
  },
  {
    id: "road",
    board: [t("D", 0, 0), t("A", 1, 0, 1)],
    remaining: PILE,
    steps: [
      { id: "road-claim", tile: "U", cells: [{ x: -1, y: 0 }], figure: { kind: "road" }, bot: { tile: "B", x: 0, y: 1 } },
      { id: "road-finish", tile: "W", cells: [{ x: -2, y: 0 }], figure: null },
    ],
  },
  {
    id: "city",
    board: [t("D", 0, 0), t("U", -1, 0, 1), t("E", -1, -1, 1)],
    remaining: PILE,
    steps: [{ id: "city", tile: "M", cells: [{ x: 0, y: -1 }], figure: { kind: "city" } }],
  },
  {
    id: "cloister",
    board: [t("E", 0, -1, 0), t("E", -1, -1, 0), t("E", 1, -1, 0), t("E", -1, 0, 3), t("E", 1, 0, 1), t("E", -1, 1, 2), t("E", 1, 1, 2)],
    remaining: PILE,
    steps: [
      { id: "cloister-claim", tile: "B", cells: [{ x: 0, y: 0 }], figure: { kind: "cloister" }, bot: { tile: "B", x: -2, y: -1 } },
      { id: "cloister-finish", tile: "E", cells: [{ x: 0, y: 1 }], figure: null },
    ],
  },
  {
    id: "farmer",
    board: [t("D", 0, 0), t("E", 0, -1, 2)],
    remaining: {},
    steps: [{ id: "farmer", tile: "U", cells: [{ x: 1, y: 0, rots: [1] }], figure: { kind: "field", feature: 1 } }],
  },
];

export interface TutorialProgress {
  chapter: number;
  step: number;
  /** The current chapter's moves are all played. */
  chapterDone: boolean;
  /** Events of the human's last move (scoring to celebrate). */
  lastEvents: EngineEvent[];
  /** Why the last attempt was refused, in plain words. */
  refusal: string | null;
}

const emptyPlayer = (): PlayerView => ({ score: 0, meeples: 7, abbotAvailable: false, breakdown: { road: 0, city: 0, cloister: 0, garden: 0, field: 0 } });

/** A playable GameView for a chapter step (the engine recomputes meeples from the board). */
export function tutorialView(chapter: TutorialChapter, tile: TileId, players: PlayerView[], ply = 0, currentPlayer = 0): GameView {
  return {
    ply,
    status: "playing",
    ruleset: TUTORIAL_RULESET,
    players,
    currentPlayer,
    currentTile: tile,
    board: chapter.board.map((b) => ({ ...b, figures: [...b.figures] })),
    remaining: { ...chapter.remaining },
  };
}

export interface TutorialClientOptions {
  catalog: TileCatalog;
  timers?: Timers;
  /** Pause before the bot lays its tile. */
  botDelayMs?: number;
  chapters?: TutorialChapter[];
}

export class TutorialClient extends GameClient {
  readonly chapters: TutorialChapter[];
  private game: EngineGame | null = null;
  private progressState: TutorialProgress = { chapter: 0, step: 0, chapterDone: false, lastEvents: [], refusal: null };
  private gen = 0;
  private disposed = false;

  constructor(
    private kit: Pick<CoreKit, "fromView">,
    players: PlayerMeta[],
    private opts: TutorialClientOptions,
  ) {
    super(opts.catalog, players, opts.timers ?? realTimers);
    this.chapters = opts.chapters ?? TUTORIAL_CHAPTERS;
    this.state = { ...this.state, connection: "local", localSeats: [0] };
  }

  get progress(): TutorialProgress {
    return this.progressState;
  }

  getProgress = (): TutorialProgress => this.progressState;

  get chapter(): TutorialChapter {
    return this.chapters[this.progressState.chapter]!;
  }

  get step(): TutorialStep | null {
    return this.progressState.chapterDone ? null : (this.chapter.steps[this.progressState.step] ?? null);
  }

  private setProgress(p: Partial<TutorialProgress>) {
    this.progressState = { ...this.progressState, ...p };
    this.setState({});
  }

  start(chapter = 0) {
    this.loadChapter(chapter);
    this.setState({ phase: "ready" });
  }

  /** Restart a chapter (scores carry over from where the previous chapter ended). */
  loadChapter(i: number) {
    this.gen++;
    const chapter = this.chapters[i];
    if (!chapter) return;
    const players = this.state.view?.players.map((p) => ({ ...p, meeples: 7 })) ?? this.state.players.map(emptyPlayer);
    this.progressState = { chapter: i, step: 0, chapterDone: false, lastEvents: [], refusal: null };
    this.mount(tutorialView(chapter, chapter.steps[0]!.tile, players, this.state.view?.ply ?? 0), true);
  }

  next() {
    if (this.progressState.chapter + 1 < this.chapters.length) this.loadChapter(this.progressState.chapter + 1);
  }

  /** Rebuild the engine game from `view` and publish it. */
  private mount(view: GameView, fresh: boolean) {
    this.game?.free();
    this.game = this.kit.fromView(view);
    const v = this.game.view();
    this.setState({
      view: v,
      recent: fresh ? [] : this.state.recent,
      turnStartedAt: this.timers.now(),
      thinking: false,
      error: null,
    });
    this.refreshLegal();
  }

  private refreshLegal() {
    const step = this.step;
    const v = this.state.view;
    if (!step || !this.game || !v || v.status !== "playing" || v.currentPlayer !== 0) {
      this.setState({ legalPlacements: [] });
      return;
    }
    const legal = this.game.legalPlacements().filter((p) => this.allowedCell(step, p));
    this.setState({ legalPlacements: legal });
  }

  private allowedCell(step: TutorialStep, p: Placement): boolean {
    return step.cells.some((c) => c.x === p.x && c.y === p.y && (!c.rots || c.rots.includes(p.rot)));
  }

  private allowedFigure(step: TutorialStep, o: { type: string; feature: number }): boolean {
    if (!step.figure || o.type !== "meeple") return false;
    const kind = this.catalog.get(step.tile)?.features[o.feature]?.kind;
    return kind === step.figure.kind && (step.figure.feature === undefined || step.figure.feature === o.feature);
  }

  async legalFigures(p: Placement): Promise<FigureOption[]> {
    const step = this.step;
    if (!step || !this.game) return [];
    return this.game.legalFigures(p).filter((o) => this.allowedFigure(step, o));
  }

  /** Whether the current step lets the player place no figure. */
  get skipAllowed(): boolean {
    return !this.step?.figure;
  }

  async submit(move: Move): Promise<void> {
    const step = this.step;
    const view = this.state.view;
    if (!step || !view || !this.game || view.status !== "playing" || view.currentPlayer !== 0) return;
    if (!this.allowedCell(step, move)) return this.refuse("Put the tile on the glowing spot.");
    if (step.figure && !(move.figure && move.figure.type === "meeple" && this.allowedFigure(step, move.figure)))
      return this.refuse(`Claim the ${step.figure.kind} with a meeple to continue.`);
    if (!step.figure && move.figure) return this.refuse("No meeple this time: choose Skip.");
    const r = this.game.apply(move);
    if (!r.ok) return this.refuse(r.error);
    this.applyEvents(r.events, this.game.view());
    this.progressState = { ...this.progressState, lastEvents: r.events, refusal: null };
    this.setState({ legalPlacements: [] });
    if (step.bot && this.state.view?.status === "playing") {
      const gen = ++this.gen;
      this.setState({ thinking: true });
      this.timers.setTimeout(() => {
        if (gen !== this.gen || this.disposed) return;
        this.botMove(step.bot!);
        this.advance();
      }, this.opts.botDelayMs ?? 900);
    } else this.advance();
  }

  private refuse(reason: string) {
    this.setProgress({ refusal: reason });
  }

  private botMove(bot: { tile: TileId; x: number; y: number }) {
    const v = this.state.view!;
    this.mount({ ...v, currentPlayer: 1, currentTile: bot.tile }, false);
    const p = this.game!.legalPlacements().find((q) => q.x === bot.x && q.y === bot.y);
    if (!p) {
      this.setState({ thinking: false });
      return;
    }
    const r = this.game!.apply({ ...p, figure: null });
    if (r.ok) this.applyEvents(r.events, this.game!.view());
    this.setState({ thinking: false });
  }

  private advance() {
    const nextStep = this.progressState.step + 1;
    const chapter = this.chapter;
    const v = this.state.view!;
    if (nextStep < chapter.steps.length && v.status === "playing") {
      this.progressState = { ...this.progressState, step: nextStep };
      this.mount({ ...v, currentPlayer: 0, currentTile: chapter.steps[nextStep]!.tile }, false);
    } else {
      this.setProgress({ chapterDone: true });
      this.setState({ legalPlacements: [] });
    }
  }

  react(emoji: string) {
    this.pushReaction(0, emoji);
  }

  dispose() {
    this.disposed = true;
    this.gen++;
    this.game?.free();
    this.game = null;
  }
}
