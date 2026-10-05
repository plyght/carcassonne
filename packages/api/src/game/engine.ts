// Engine port (PRD §7.3, docs/CONTRACT.md "Engine JSON I/O").
//
// The server is stateless: every call rebuilds a game from (engineVersion, ruleset, seed, players, moves[])
// through this interface. Two implementations exist:
//   - `FakeEngine` (./fake-engine.ts): tiny in-memory stand-in for tests and local dev.
//   - `WasmEngine` (./wasm-engine.ts): binds `core.wasm` through the WASM ABI in docs/CONTRACT.md.
// `getEngine()` below is the single place that chooses one.
import type {
  AiTier,
  ApplyResult,
  FigureOption,
  GameView,
  Move,
  Placement,
  Ruleset,
} from "@carcassonne/protocol";

export interface EngineGame {
  apply(move: Move): ApplyResult;
  view(): GameView;
  legalPlacements(): Placement[];
  legalFigures(placement: Placement): FigureOption[];
  /** Full state including the deck order. Server only, never sent to clients. */
  snapshot(): string;
  /** Pick a move for the current player. `seed` makes the choice reproducible. */
  aiChoose(tier: AiTier, budgetMs: number, seed: bigint): Move;
  /** Release native resources (WASM handle). Safe to call twice. */
  free(): void;
}

export interface Engine {
  /** Recorded on every game so replays run on the version that produced them (PRD §6.9). */
  readonly version: string;
  createGame(ruleset: Ruleset, seed: bigint, players: number): EngineGame;
  restore(snapshot: string): EngineGame;
}

/** Rebuild a game from its move log. Throws if a logged move no longer applies (engine drift). */
export function replay(
  engine: Engine,
  args: { ruleset: Ruleset; seed: bigint; players: number; moves: readonly Move[] },
): EngineGame {
  const g = engine.createGame(args.ruleset, args.seed, args.players);
  for (let i = 0; i < args.moves.length; i++) {
    const r = g.apply(args.moves[i]!);
    if (!r.ok) {
      g.free();
      throw new Error(`replay failed at ply ${i}: ${r.error}`);
    }
  }
  return g;
}

let current: Engine | null = null;

/** Override the engine (tests, or the server bootstrap once core.wasm is loaded). */
export function setEngine(engine: Engine) {
  current = engine;
}

/**
 * The engine in use. Defaults to the fake engine until `setEngine(await loadWasmEngine(...))`
 * is called by the server bootstrap — see apps/server/src/engine.ts.
 */
export async function getEngine(): Promise<Engine> {
  if (!current) {
    const { FakeEngine } = await import("./fake-engine");
    current = new FakeEngine();
  }
  return current;
}

/** Split a u64 seed into the (lo, hi) u32 pair the WASM ABI takes. */
export function splitSeed(seed: bigint): [number, number] {
  const s = BigInt.asUintN(64, seed);
  return [Number(s & BigInt(0xffffffff)), Number(s >> BigInt(32))];
}

export function randomSeed(): bigint {
  const b = new BigUint64Array(1);
  crypto.getRandomValues(b);
  return b[0]!;
}
