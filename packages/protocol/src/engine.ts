// Engine JSON I/O. Mirrors docs/CONTRACT.md; the Zig engine must emit exactly these shapes.

export type PlayerIndex = number;
export type TileId = string; // "A".."X", "R1".."R12"
export type FieldEdition = 1 | 2 | 3;

export interface Ruleset {
  fieldEdition: FieldEdition;
  river: boolean;
  abbot: boolean;
  /** Tiles held in hand (1 = standard). */
  handSize: number;
}

export const DEFAULT_RULESET: Ruleset = { fieldEdition: 3, river: true, abbot: true, handSize: 1 };

export type FeatureKind = "road" | "city" | "field" | "cloister" | "garden" | "river";
export type FigureKind = "meeple" | "abbot";

export type FigureAction =
  | null
  | { type: "meeple"; feature: number }
  | { type: "abbot"; feature: number }
  | { type: "recallAbbot"; x: number; y: number };

export interface Move {
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
  figure: FigureAction;
}

export interface Placement {
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
}

export interface FigureOption {
  type: "meeple" | "abbot";
  feature: number;
}

export interface PlacedFigure {
  player: PlayerIndex;
  feature: number;
  figure: FigureKind;
}

export interface BoardTile {
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
  tile: TileId;
  figures: PlacedFigure[];
}

export interface ScoreBreakdown {
  road: number;
  city: number;
  cloister: number;
  garden: number;
  field: number;
}

export interface PlayerView {
  score: number;
  meeples: number; // in supply
  abbotAvailable: boolean;
  breakdown: ScoreBreakdown;
}

export interface GameView {
  ply: number;
  status: "playing" | "ended";
  ruleset: Ruleset;
  players: PlayerView[];
  currentPlayer: PlayerIndex;
  /** Tile the current player must place, null when the game has ended. */
  currentTile: TileId | null;
  board: BoardTile[];
  /** Remaining tiles in the draw pile, by id (order is hidden). */
  remaining: Record<TileId, number>;
}

export type FigureRef = { player: PlayerIndex; x: number; y: number; feature: number; figure: FigureKind };

export type EngineEvent =
  | { type: "turnStarted"; player: PlayerIndex; tile: TileId }
  | { type: "tileDiscarded"; tile: TileId }
  | { type: "tilePlaced"; player: PlayerIndex; x: number; y: number; rot: 0 | 1 | 2 | 3; tile: TileId }
  | { type: "figurePlaced"; player: PlayerIndex; x: number; y: number; feature: number; figure: FigureKind }
  | {
      type: "featureScored";
      kind: FeatureKind;
      cells: [number, number][];
      winners: PlayerIndex[];
      points: number;
      returned: FigureRef[];
      final: boolean;
    }
  | { type: "abbotRecalled"; player: PlayerIndex; x: number; y: number; points: number }
  | { type: "gameEnded"; scores: number[]; breakdown: ScoreBreakdown[] };

export type ApplyResult = { ok: true; events: EngineEvent[] } | { ok: false; error: string };

export type AiTier = "easy" | "medium" | "hard" | "expert";
