// REAL ENGINE ADAPTER — binds `core.wasm` (packages/core, `zig build wasm`) through the WASM ABI in
// docs/CONTRACT.md. It deliberately depends only on that ABI, not on the `@carcassonne/core-wasm`
// TS wrapper (not merged yet). When that package lands, either:
//   (a) keep this file and feed it the wasm bytes the package ships, or
//   (b) replace the body of `loadWasmEngine` with the package's typed wrapper.
// Either way the rest of the server only sees the `Engine` interface.
import type { AiTier, ApplyResult, FigureOption, GameView, Move, Placement, Ruleset } from "@carcassonne/protocol";

import { splitSeed, type Engine, type EngineGame } from "./engine";

/** Exports defined by docs/CONTRACT.md "WASM ABI". */
export interface CoreWasmExports {
  memory: WebAssembly.Memory;
  core_alloc(len: number): number;
  core_free(ptr: number, len: number): void;
  game_new(rulesetPtr: number, rulesetLen: number, seedLo: number, seedHi: number, players: number): number;
  game_free(handle: number): void;
  game_apply(handle: number, movePtr: number, moveLen: number): number;
  game_view(handle: number): number;
  game_legal_placements(handle: number): number;
  game_legal_figures(handle: number, x: number, y: number, rot: number): number;
  game_snapshot(handle: number): number;
  game_restore(ptr: number, len: number): number;
  /** Optional until the AI workstream lands; see `fallbackChoose`. */
  ai_choose?(handle: number, tier: number, budgetMs: number, seedLo: number, seedHi: number): number;
}

const TIERS: Record<AiTier, number> = { easy: 0, medium: 1, hard: 2, expert: 3 };
const enc = new TextEncoder();
const dec = new TextDecoder();

class Abi {
  constructor(readonly x: CoreWasmExports) {}
  /** Copy a string into wasm memory; caller frees with core_free(ptr, len). */
  put(s: string): [number, number] {
    const bytes = enc.encode(s);
    const ptr = this.x.core_alloc(bytes.length);
    if (!ptr && bytes.length) throw new Error("core_alloc failed");
    new Uint8Array(this.x.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  }
  withString<T>(s: string, f: (ptr: number, len: number) => T): T {
    const [ptr, len] = this.put(s);
    try {
      return f(ptr, len);
    } finally {
      this.x.core_free(ptr, len);
    }
  }
  /** Read a `[u32 LE length][utf8]` result and free it. */
  takeJson<T>(ptr: number): T {
    if (!ptr) throw new Error("engine returned null");
    const len = new DataView(this.x.memory.buffer).getUint32(ptr, true);
    const text = dec.decode(new Uint8Array(this.x.memory.buffer, ptr + 4, len).slice());
    this.x.core_free(ptr, 4 + len);
    return JSON.parse(text) as T;
  }
}

class WasmGame implements EngineGame {
  private handle: number;
  constructor(
    private abi: Abi,
    handle: number,
  ) {
    if (!handle) throw new Error("engine returned handle 0");
    this.handle = handle;
  }
  apply(move: Move): ApplyResult {
    return this.abi.withString(JSON.stringify(move), (p, l) =>
      this.abi.takeJson<ApplyResult>(this.abi.x.game_apply(this.handle, p, l)),
    );
  }
  view(): GameView {
    return this.abi.takeJson(this.abi.x.game_view(this.handle));
  }
  legalPlacements(): Placement[] {
    return this.abi.takeJson(this.abi.x.game_legal_placements(this.handle));
  }
  legalFigures(p: Placement): FigureOption[] {
    return this.abi.takeJson(this.abi.x.game_legal_figures(this.handle, p.x, p.y, p.rot));
  }
  snapshot(): string {
    return JSON.stringify(this.abi.takeJson<unknown>(this.abi.x.game_snapshot(this.handle)));
  }
  aiChoose(tier: AiTier, budgetMs: number, seed: bigint): Move {
    const [lo, hi] = splitSeed(seed);
    if (!this.abi.x.ai_choose) return this.fallbackChoose(seed);
    return this.abi.takeJson(this.abi.x.ai_choose(this.handle, TIERS[tier], Math.max(1, Math.round(budgetMs)), lo, hi));
  }
  /** Seeded random legal placement, no figure. Used for clock timeouts and until core/ai ships. */
  private fallbackChoose(seed: bigint): Move {
    const placements = this.legalPlacements();
    if (placements.length === 0) throw new Error("no legal placement");
    const n = BigInt(placements.length);
    const p = placements[Number(((seed % n) + n) % n)]!;
    return { ...p, figure: null };
  }
  free() {
    if (this.handle) this.abi.x.game_free(this.handle);
    this.handle = 0;
  }
}

export class WasmEngine implements Engine {
  private abi: Abi;
  constructor(
    exports: CoreWasmExports,
    readonly version: string,
  ) {
    this.abi = new Abi(exports);
  }
  createGame(ruleset: Ruleset, seed: bigint, players: number): EngineGame {
    const [lo, hi] = splitSeed(seed);
    return this.abi.withString(
      JSON.stringify(ruleset),
      (p, l) => new WasmGame(this.abi, this.abi.x.game_new(p, l, lo, hi, players)),
    );
  }
  restore(snapshot: string): EngineGame {
    return this.abi.withString(snapshot, (p, l) => new WasmGame(this.abi, this.abi.x.game_restore(p, l)));
  }
}

/** Instantiate `core.wasm` (freestanding: no imports) and wrap it. */
export async function loadWasmEngine(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>, version: string): Promise<Engine> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return new WasmEngine(instance.exports as unknown as CoreWasmExports, version);
}
