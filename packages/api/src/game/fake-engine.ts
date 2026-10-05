// FAKE ENGINE — for tests and local dev only. NOT Carcassonne rules.
//
// Deterministic and tiny: a seeded deck of `deckSize` tiles, every placement on an empty cell
// orthogonally adjacent to the board is legal (any rotation), each tile scores 1 point and each
// placed meeple 2. It emits contract-shaped events so the whole server pipeline can run without
// `@carcassonne/core-wasm`.
import type {
  AiTier,
  ApplyResult,
  BoardTile,
  EngineEvent,
  FigureOption,
  GameView,
  Move,
  Placement,
  Ruleset,
  TileId,
} from "@carcassonne/protocol";

import type { Engine, EngineGame } from "./engine";

const LETTERS = "ABCEFGHIJKLMNOPQRSTUVWX".split(""); // every base tile id except the start tile D
const MEEPLES = 7;

// BigInt() calls instead of literals: apps/web type-checks this file with a pre-ES2020 target.
const GOLDEN = BigInt("0x9e3779b97f4a7c15");
const LCG_MUL = BigInt("6364136223846793005");
const LCG_INC = BigInt("1442695040888963407");

function lcg(seed: bigint) {
  let s = BigInt.asUintN(64, seed ^ GOLDEN);
  return () => {
    s = BigInt.asUintN(64, s * LCG_MUL + LCG_INC);
    return Number(s >> BigInt(33));
  };
}

interface FakeState {
  ruleset: Ruleset;
  seed: string;
  players: number;
  deckSize: number;
  moves: Move[];
}

export class FakeEngine implements Engine {
  readonly version: string;
  constructor(private readonly opts: { deckSize?: number; version?: string } = {}) {
    this.version = opts.version ?? "fake-1";
  }
  createGame(ruleset: Ruleset, seed: bigint, players: number): EngineGame {
    return new FakeGame({ ruleset, seed: seed.toString(), players, deckSize: this.opts.deckSize ?? 72, moves: [] });
  }
  restore(snapshot: string): EngineGame {
    const st = JSON.parse(snapshot) as FakeState;
    const g = new FakeGame({ ...st, moves: [] });
    for (const m of st.moves) g.apply(m);
    return g;
  }
}

class FakeGame implements EngineGame {
  private deck: TileId[];
  private board = new Map<string, BoardTile>();
  private scores: number[];
  private meeples: number[];
  private ended = false;

  constructor(private st: FakeState) {
    const rnd = lcg(BigInt(st.seed));
    this.deck = Array.from({ length: st.deckSize }, () => LETTERS[rnd() % LETTERS.length]!);
    this.board.set("0,0", { x: 0, y: 0, rot: 0, tile: "D", figures: [] });
    this.scores = Array(st.players).fill(0);
    this.meeples = Array(st.players).fill(MEEPLES);
  }

  private get ply() {
    return this.st.moves.length;
  }

  private isLegalCell(x: number, y: number) {
    if (this.board.has(`${x},${y}`)) return false;
    return [
      [x, y - 1],
      [x + 1, y],
      [x, y + 1],
      [x - 1, y],
    ].some(([a, b]) => this.board.has(`${a},${b}`));
  }

  apply(move: Move): ApplyResult {
    if (this.ended) return { ok: false, error: "game has ended" };
    if (![0, 1, 2, 3].includes(move.rot)) return { ok: false, error: "bad rotation" };
    if (!this.isLegalCell(move.x, move.y)) return { ok: false, error: "illegal placement" };
    const player = this.ply % this.st.players;
    const tile = this.deck[this.ply]!;
    if (move.figure && move.figure.type === "meeple" && this.meeples[player]! <= 0) {
      return { ok: false, error: "no meeples left" };
    }
    const events: EngineEvent[] = [];
    const placed: BoardTile = { x: move.x, y: move.y, rot: move.rot, tile, figures: [] };
    this.board.set(`${move.x},${move.y}`, placed);
    this.scores[player]! += 1;
    events.push({ type: "tilePlaced", player, x: move.x, y: move.y, rot: move.rot, tile });
    if (move.figure && (move.figure.type === "meeple" || move.figure.type === "abbot")) {
      placed.figures.push({ player, feature: move.figure.feature, figure: move.figure.type });
      if (move.figure.type === "meeple") this.meeples[player]! -= 1;
      this.scores[player]! += 2;
      events.push({
        type: "figurePlaced",
        player,
        x: move.x,
        y: move.y,
        feature: move.figure.feature,
        figure: move.figure.type,
      });
    }
    this.st.moves.push(move);
    if (this.ply >= this.deck.length) {
      this.ended = true;
      events.push({ type: "gameEnded", scores: [...this.scores], breakdown: this.breakdown() });
    } else {
      events.push({ type: "turnStarted", player: this.ply % this.st.players, tile: this.deck[this.ply]! });
    }
    return { ok: true, events };
  }

  private breakdown() {
    return this.scores.map((s) => ({ road: 0, city: s, cloister: 0, garden: 0, field: 0 }));
  }

  view(): GameView {
    const remaining: Record<TileId, number> = {};
    for (const t of this.deck.slice(this.ply + 1)) remaining[t] = (remaining[t] ?? 0) + 1;
    const bd = this.breakdown();
    return {
      ply: this.ply,
      status: this.ended ? "ended" : "playing",
      ruleset: this.st.ruleset,
      players: this.scores.map((score, i) => ({
        score,
        meeples: this.meeples[i]!,
        abbotAvailable: this.st.ruleset.abbot,
        breakdown: bd[i]!,
      })),
      currentPlayer: this.ply % this.st.players,
      currentTile: this.ended ? null : this.deck[this.ply]!,
      board: [...this.board.values()].map((t) => ({ ...t, figures: [...t.figures] })),
      remaining,
    };
  }

  legalPlacements(): Placement[] {
    if (this.ended) return [];
    const cells = new Set<string>();
    for (const t of this.board.values()) {
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        if (this.isLegalCell(t.x + dx, t.y + dy)) cells.add(`${t.x + dx},${t.y + dy}`);
      }
    }
    const out: Placement[] = [];
    for (const c of [...cells].sort()) {
      const [x, y] = c.split(",").map(Number) as [number, number];
      for (const rot of [0, 1, 2, 3] as const) out.push({ x, y, rot });
    }
    return out;
  }

  legalFigures(_p: Placement): FigureOption[] {
    const player = this.ply % this.st.players;
    return this.meeples[player]! > 0 ? [0, 1, 2, 3].map((feature) => ({ type: "meeple", feature })) : [];
  }

  snapshot(): string {
    return JSON.stringify(this.st);
  }

  aiChoose(tier: AiTier, _budgetMs: number, seed: bigint): Move {
    const legal = this.legalPlacements();
    if (legal.length === 0) throw new Error("no legal placements");
    const p = legal[lcg(seed)() % legal.length]!;
    const player = this.ply % this.st.players;
    const figure = tier !== "easy" && this.meeples[player]! > 0 ? { type: "meeple" as const, feature: 0 } : null;
    return { ...p, figure };
  }

  free() {}
}
