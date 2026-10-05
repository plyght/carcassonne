// The engine surface the client needs. Mirrors the core-wasm API in docs/CONTRACT.md
// ("WASM ABI"): handles are numbers, everything else is the JSON shapes from
// @carcassonne/protocol. Both the TS dev engine and core-wasm implement it.

import type {
  AiTier,
  ApplyResult,
  FigureOption,
  GameView,
  Move,
  Placement,
  Ruleset,
} from "@carcassonne/protocol";

export type GameHandle = number;

export interface EnginePort {
  /** Implementation id, e.g. "dev-ts" or "core-wasm". */
  readonly name: string;
  /** game_new(ruleset, seed_lo, seed_hi, players) */
  createGame(ruleset: Ruleset, seed: bigint, players: number): GameHandle;
  /** game_free(handle) */
  freeGame(handle: GameHandle): void;
  /** game_apply(handle, move) */
  apply(handle: GameHandle, move: Move): ApplyResult;
  /** game_view(handle) */
  view(handle: GameHandle): GameView;
  /** game_legal_placements(handle) */
  legalPlacements(handle: GameHandle): Placement[];
  /** game_legal_figures(handle, x, y, rot) */
  legalFigures(handle: GameHandle, x: number, y: number, rot: 0 | 1 | 2 | 3): FigureOption[];
  /** ai_choose(handle, tier, budget_ms, seed_lo, seed_hi) */
  aiChoose(handle: GameHandle, tier: AiTier, budgetMs: number, seed: bigint): Move;
}

type Promisify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : T[K];
};

/** Same surface, asynchronous: the engine may live in a Web Worker. */
export type AsyncEngine = Promisify<EnginePort> & { dispose(): void };

/** Run an engine on the calling thread (tests, SSR-safe fallback). */
export function inlineEngine(port: EnginePort): AsyncEngine {
  const wrap =
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (...a: A): Promise<R> => {
      try {
        return Promise.resolve(fn(...a));
      } catch (e) {
        return Promise.reject(e);
      }
    };
  return {
    name: port.name,
    createGame: wrap(port.createGame.bind(port)),
    freeGame: wrap(port.freeGame.bind(port)),
    apply: wrap(port.apply.bind(port)),
    view: wrap(port.view.bind(port)),
    legalPlacements: wrap(port.legalPlacements.bind(port)),
    legalFigures: wrap(port.legalFigures.bind(port)),
    aiChoose: wrap(port.aiChoose.bind(port)),
    dispose() {},
  };
}

/** Turn a shareable seed string ("river-cats-42", "12345") into a u64. */
export function seedFromString(seed: string): bigint {
  const trimmed = seed.trim();
  if (/^\d+$/.test(trimmed)) return BigInt(trimmed) & 0xffff_ffff_ffff_ffffn;
  // FNV-1a 64
  let h = 0xcbf29ce484222325n;
  for (const ch of new TextEncoder().encode(trimmed)) {
    h ^= BigInt(ch);
    h = (h * 0x100000001b3n) & 0xffff_ffff_ffff_ffffn;
  }
  return h;
}

const WORDS = [
  "abbey", "bridge", "castle", "cloister", "farmer", "field", "knight", "meadow", "mill",
  "monk", "pennant", "river", "road", "sheep", "thief", "tower", "village", "wall",
];

export function randomSeedString(): string {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)]!;
  return `${pick()}-${pick()}-${Math.floor(Math.random() * 900 + 100)}`;
}
