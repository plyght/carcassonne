// Typed wrapper around core.wasm (the Zig rules engine). Works in Bun, Node and
// browsers. See docs/CONTRACT.md "WASM ABI" for the raw exports.
import {
  DEFAULT_RULESET,
  type ApplyResult,
  type FigureOption,
  type GameView,
  type Move,
  type Placement,
  type Ruleset,
} from "@carcassonne/protocol";

/** Opaque full-state snapshot (server only). Includes the deck order. */
export interface EngineSnapshot {
  v: 1;
  /** Hex u64 state hash, checked on restore. */
  hash: string;
  /** Base64 canonical state bytes. */
  state: string;
}

export type WasmSource = BufferSource | WebAssembly.Module | Response | URL | string;

interface CoreExports {
  memory: WebAssembly.Memory;
  core_alloc(len: number): number;
  core_free(ptr: number, len: number): void;
  core_abi_version(): number;
  game_new(rulesetPtr: number, rulesetLen: number, seedLo: number, seedHi: number, players: number): number;
  game_free(handle: number): void;
  game_apply(handle: number, movePtr: number, moveLen: number): number;
  game_view(handle: number): number;
  game_legal_placements(handle: number): number;
  game_legal_figures(handle: number, x: number, y: number, rot: number): number;
  game_snapshot(handle: number): number;
  game_restore(ptr: number, len: number): number;
  game_hash(handle: number): bigint;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Default location of the bundled core.wasm (next to this package's src/). */
export const DEFAULT_WASM_URL = new URL("../core.wasm", import.meta.url);

async function readFileUrl(url: URL): Promise<Uint8Array> {
  // Indirect specifier so browser bundlers do not try to resolve node:fs.
  const fsName = "node:fs/promises";
  const fs = (await import(/* webpackIgnore: true */ /* @vite-ignore */ fsName)) as {
    readFile(path: URL): Promise<Uint8Array>;
  };
  return fs.readFile(url);
}

async function compile(source: WasmSource): Promise<WebAssembly.Module> {
  if (source instanceof WebAssembly.Module) return source;
  if (typeof Response !== "undefined" && source instanceof Response) {
    return WebAssembly.compile(await source.arrayBuffer());
  }
  if (typeof source === "string" || source instanceof URL) {
    const url = typeof source === "string" ? new URL(source, DEFAULT_WASM_URL) : source;
    if (url.protocol === "file:") return WebAssembly.compile(await readFileUrl(url) as BufferSource);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`core-wasm: failed to fetch ${url}: ${res.status}`);
    return WebAssembly.compile(await res.arrayBuffer());
  }
  return WebAssembly.compile(source as BufferSource);
}

/** Load and instantiate core.wasm. Defaults to the copy bundled with this package. */
export async function loadCore(source: WasmSource = DEFAULT_WASM_URL): Promise<Core> {
  const module = await compile(source);
  return new Core(new WebAssembly.Instance(module, {}));
}

/** Synchronous instantiation from an already compiled module or bytes. */
export function loadCoreSync(source: WebAssembly.Module | BufferSource): Core {
  const module = source instanceof WebAssembly.Module ? source : new WebAssembly.Module(source);
  return new Core(new WebAssembly.Instance(module, {}));
}

function splitSeed(seed: number | bigint): [number, number] {
  const s = BigInt.asUintN(64, BigInt(seed));
  return [Number(s & 0xffffffffn), Number(s >> 32n)];
}

export class Core {
  readonly #x: CoreExports;

  constructor(instance: WebAssembly.Instance) {
    this.#x = instance.exports as unknown as CoreExports;
  }

  get abiVersion(): number {
    return this.#x.core_abi_version();
  }

  /** Copy `text` into WASM memory; the caller frees [ptr, len]. */
  #write(text: string): [number, number] {
    const bytes = encoder.encode(text);
    if (bytes.length === 0) return [0, 0];
    const ptr = this.#x.core_alloc(bytes.length);
    if (ptr === 0) throw new Error("core-wasm: out of memory");
    new Uint8Array(this.#x.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  }

  #withInput<T>(text: string, fn: (ptr: number, len: number) => T): T {
    const [ptr, len] = this.#write(text);
    try {
      return fn(ptr, len);
    } finally {
      if (len > 0) this.#x.core_free(ptr, len);
    }
  }

  /** Read and free a length-prefixed JSON result. */
  #read<T>(ptr: number): T {
    if (ptr === 0) throw new Error("core-wasm: call failed (bad handle or out of memory)");
    const len = new DataView(this.#x.memory.buffer).getUint32(ptr, true);
    const text = decoder.decode(new Uint8Array(this.#x.memory.buffer, ptr + 4, len));
    this.#x.core_free(ptr, 4 + len);
    return JSON.parse(text) as T;
  }

  /** Start a game. `players` is 2..5. Seeds are 64-bit. */
  createGame(ruleset: Ruleset = DEFAULT_RULESET, seed: number | bigint, players: number): EngineGame {
    const [lo, hi] = splitSeed(seed);
    const handle = this.#withInput(JSON.stringify(ruleset), (p, l) => this.#x.game_new(p, l, lo, hi, players));
    if (handle === 0) throw new Error("core-wasm: invalid ruleset or player count");
    return new EngineGame(this, handle);
  }

  /** Rebuild a game from `snapshot()` output. */
  restore(snapshot: EngineSnapshot | string): EngineGame {
    const text = typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot);
    const handle = this.#withInput(text, (p, l) => this.#x.game_restore(p, l));
    if (handle === 0) throw new Error("core-wasm: invalid snapshot");
    return new EngineGame(this, handle);
  }

  /** @internal */
  _apply(handle: number, move: Move): ApplyResult {
    return this.#read(this.#withInput(JSON.stringify(move), (p, l) => this.#x.game_apply(handle, p, l)));
  }
  /** @internal */
  _view(handle: number): GameView {
    return this.#read(this.#x.game_view(handle));
  }
  /** @internal */
  _legalPlacements(handle: number): Placement[] {
    return this.#read(this.#x.game_legal_placements(handle));
  }
  /** @internal */
  _legalFigures(handle: number, p: Placement): FigureOption[] {
    return this.#read(this.#x.game_legal_figures(handle, p.x, p.y, p.rot));
  }
  /** @internal */
  _snapshot(handle: number): EngineSnapshot {
    return this.#read(this.#x.game_snapshot(handle));
  }
  /** @internal */
  _hash(handle: number): bigint {
    return BigInt.asUintN(64, this.#x.game_hash(handle));
  }
  /** @internal */
  _free(handle: number): void {
    this.#x.game_free(handle);
  }
}

/** One engine game living inside WASM memory. Call `free()` when done. */
export class EngineGame {
  #core: Core;
  #handle: number;

  constructor(core: Core, handle: number) {
    this.#core = core;
    this.#handle = handle;
  }

  get handle(): number {
    return this.#handle;
  }

  #live(): number {
    if (this.#handle === 0) throw new Error("core-wasm: game already freed");
    return this.#handle;
  }

  /** Place the current tile and do one figure action. Never throws on illegal moves. */
  apply(move: Move): ApplyResult {
    return this.#core._apply(this.#live(), move);
  }

  view(): GameView {
    return this.#core._view(this.#live());
  }

  legalPlacements(): Placement[] {
    return this.#core._legalPlacements(this.#live());
  }

  /** Figure options if the current tile were placed at `p` (empty if `p` is illegal). */
  legalFigures(p: Placement): FigureOption[] {
    return this.#core._legalFigures(this.#live(), p);
  }

  /** Full state including the deck order: keep it server-side. */
  snapshot(): EngineSnapshot {
    return this.#core._snapshot(this.#live());
  }

  /** Deterministic 64-bit state hash. */
  hash(): bigint {
    return this.#core._hash(this.#live());
  }

  free(): void {
    if (this.#handle !== 0) this.#core._free(this.#handle);
    this.#handle = 0;
  }
}

export type { ApplyResult, FigureOption, GameView, Move, Placement, Ruleset };
