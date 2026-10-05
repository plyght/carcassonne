// TEMPORARY: TypeScript reference engine implementing EnginePort, so the UI is
// playable before @carcassonne/core-wasm lands. Delete this folder once the swap in
// ../engine.ts points at core-wasm.

import type { AiTier, Move, Ruleset } from "@carcassonne/protocol";

import type { EnginePort, GameHandle } from "../engine-port";
import type { TileCatalog } from "../tiles";
import { chooseMove } from "./ai";
import { applyMove, legalFigures, legalPlacements, newGame, viewOf, type DevGame } from "./rules";
import { baseCatalog } from "./tiles-base";

export class DevEngine implements EnginePort {
  readonly name = "dev-ts";
  private games = new Map<GameHandle, DevGame>();
  private nextHandle = 1;

  constructor(private catalog: TileCatalog = baseCatalog) {}

  private get(h: GameHandle): DevGame {
    const g = this.games.get(h);
    if (!g) throw new Error(`unknown game handle ${h}`);
    return g;
  }

  createGame(ruleset: Ruleset, seed: bigint, players: number): GameHandle {
    const h = this.nextHandle++;
    this.games.set(h, newGame(ruleset, this.catalog, seed, players));
    return h;
  }
  freeGame(h: GameHandle) {
    this.games.delete(h);
  }
  apply(h: GameHandle, move: Move) {
    return applyMove(this.get(h), move);
  }
  view(h: GameHandle) {
    return viewOf(this.get(h));
  }
  legalPlacements(h: GameHandle) {
    return legalPlacements(this.get(h));
  }
  legalFigures(h: GameHandle, x: number, y: number, rot: 0 | 1 | 2 | 3) {
    return legalFigures(this.get(h), { x, y, rot });
  }
  aiChoose(h: GameHandle, tier: AiTier, _budgetMs: number, seed: bigint) {
    return chooseMove(this.get(h), tier, seed);
  }
}

export async function loadDevEngine(): Promise<EnginePort> {
  return new DevEngine();
}

export { baseCatalog, BASE_TILES, START_TILE } from "./tiles-base";
