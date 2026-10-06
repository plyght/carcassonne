// The real rules engine: core.wasm (Zig) through @carcassonne/core-wasm, behind the
// EnginePort surface the clients use. Runs in a Web Worker in the browser
// (./worker/engine-worker.ts), on the main thread in tests.

import { loadCoreKit, type CoreKit, type EngineGame, type WasmSource } from "@carcassonne/core-wasm";
import type { AiTier, FigureOption, GameView, Move, Placement, Ruleset } from "@carcassonne/protocol";

import type { EnginePort, GameHandle } from "./engine-port";
import { createCatalog, type TileCatalog, type TileDef } from "./tiles";

/** SplitMix64, for the fallback bot. */
function splitmix(seed: bigint) {
  let s = BigInt.asUintN(64, seed);
  return () => {
    s = BigInt.asUintN(64, s + 0x9e3779b97f4a7c15n);
    let z = s;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    return Number((z ^ (z >> 31n)) >> 11n) / 2 ** 53;
  };
}

/**
 * Seeded random legal move: a random legal placement, then (most of the time) a
 * random legal figure. Stand-in for `ai_choose` until the AI workstream ships it.
 */
export function randomLegalMove(game: Pick<EngineGame, "legalPlacements" | "legalFigures">, seed: bigint, tier: AiTier = "easy"): Move {
  const rnd = splitmix(seed);
  const placements = game.legalPlacements();
  if (!placements.length) throw new Error("no legal placement");
  const p = placements[Math.floor(rnd() * placements.length)]!;
  const figures = game.legalFigures(p);
  const eager = tier === "easy" ? 0.6 : 0.4;
  let figure: Move["figure"] = null;
  if (figures.length && rnd() < eager) {
    const f = figures[Math.floor(rnd() * figures.length)]!;
    figure = { type: f.type, feature: f.feature };
  }
  return { ...p, figure };
}

export class CoreEnginePort implements EnginePort {
  readonly name = "core-wasm";
  private games = new Map<GameHandle, EngineGame>();
  private next = 1;

  constructor(readonly kit: CoreKit) {}

  private get(h: GameHandle): EngineGame {
    const g = this.games.get(h);
    if (!g) throw new Error(`unknown game handle ${h}`);
    return g;
  }

  createGame(ruleset: Ruleset, seed: bigint, players: number): GameHandle {
    const h = this.next++;
    this.games.set(h, this.kit.core.createGame(ruleset, seed, players));
    return h;
  }
  /** Rebuild a game from a public view (online clients: legality only). */
  createFromView(view: GameView): GameHandle {
    const h = this.next++;
    this.games.set(h, this.kit.fromView(view));
    return h;
  }
  freeGame(h: GameHandle) {
    this.games.get(h)?.free();
    this.games.delete(h);
  }
  apply(h: GameHandle, move: Move) {
    return this.get(h).apply(move);
  }
  view(h: GameHandle) {
    return this.get(h).view();
  }
  legalPlacements(h: GameHandle) {
    return this.get(h).legalPlacements();
  }
  legalFigures(h: GameHandle, x: number, y: number, rot: 0 | 1 | 2 | 3) {
    return this.get(h).legalFigures({ x, y, rot });
  }
  aiChoose(h: GameHandle, tier: AiTier, budgetMs: number, seed: bigint): Move {
    const g = this.get(h);
    // core/ai answers null only once the game has ended; fall back so callers always get a move.
    return g.aiChoose(tier, budgetMs, seed) ?? randomLegalMove(g, seed, tier);
  }
}

/** Load core.wasm (default: the copy shipped in @carcassonne/core-wasm) as an EnginePort. */
export async function loadEngine(source?: WasmSource): Promise<CoreEnginePort> {
  return new CoreEnginePort(await loadCoreKit(source));
}

/** The engine's tile table as a TileCatalog (ids A–X, garden variants, R1–R12). */
export function catalogFromKit(kit: CoreKit): TileCatalog {
  return createCatalog(kit.tiles() as TileDef[]);
}

/** Legal moves computed by the real engine from a public view (online clients). */
export interface ViewRules {
  legalPlacements(view: GameView): Placement[];
  legalFigures(view: GameView, p: Placement): FigureOption[];
}

export function viewRules(kit: CoreKit): ViewRules {
  let cache: { view: GameView; game: EngineGame } | null = null;
  const gameFor = (view: GameView) => {
    if (cache?.view !== view) {
      cache?.game.free();
      cache = { view, game: kit.fromView(view) };
    }
    return cache.game;
  };
  return {
    legalPlacements: (view) => (view.status === "playing" && view.currentTile ? gameFor(view).legalPlacements() : []),
    legalFigures: (view, p) => (view.status === "playing" && view.currentTile ? gameFor(view).legalFigures(p) : []),
  };
}

export { loadCoreKit, type CoreKit };
