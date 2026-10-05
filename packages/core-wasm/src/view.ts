// Public-view and catalog helpers (integration workstream; additive to ./index.ts).
//
// - `CoreKit` instantiates core.wasm once and exposes the engine (`core`), the raw
//   instance (hand it to `new CoreGeo(instance)` from @carcassonne/core-geo for the
//   geo/anim exports, so an app ships one wasm), the tile catalog, and
// - `fromView(view)`: an engine game rebuilt from a public GameView. Online clients
//   never get the deck seed; this lets them ask the real engine for legal placements
//   and figure options (river and abbot rules included). The draw pile of such a
//   game is the view's remaining tiles in catalog order, so never use it to draw.
import type { FeatureKind, GameView, TileId } from "@carcassonne/protocol";

import { Core, DEFAULT_WASM_URL, EngineGame, type WasmSource } from "./index";

/** One tile type of the engine catalog (packages/core/src/engine/tiles*.zig). */
export interface CatalogTile {
  id: TileId;
  count: number;
  set: "base" | "river";
  special: "none" | "start" | "spring" | "lake";
  features: {
    kind: FeatureKind;
    /** 12-bit port mask (engine/tile.zig). */
    ports: number;
    pennants: number;
    /** Field only: city features of the same tile this field borders. */
    adjacentCities: number[];
  }[];
}

interface ViewExports {
  memory: WebAssembly.Memory;
  core_alloc(len: number): number;
  core_free(ptr: number, len: number): void;
  game_from_view(ptr: number, len: number): number;
  tiles_catalog(): number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function compileSource(source: WasmSource): Promise<WebAssembly.Module> {
  if (source instanceof WebAssembly.Module) return source;
  if (typeof Response !== "undefined" && source instanceof Response) return WebAssembly.compile(await source.arrayBuffer());
  if (typeof source === "string" || source instanceof URL) {
    const url = typeof source === "string" ? new URL(source, DEFAULT_WASM_URL) : source;
    if (url.protocol === "file:") {
      const fsName = "node:fs/promises";
      const fs = (await import(/* webpackIgnore: true */ /* @vite-ignore */ fsName)) as {
        readFile(path: URL): Promise<Uint8Array>;
      };
      return WebAssembly.compile((await fs.readFile(url)) as BufferSource);
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`core-wasm: failed to fetch ${url}: ${res.status}`);
    return WebAssembly.compile(await res.arrayBuffer());
  }
  return WebAssembly.compile(source as BufferSource);
}

export class CoreKit {
  readonly core: Core;
  readonly #x: ViewExports;
  #catalog: CatalogTile[] | null = null;

  constructor(readonly instance: WebAssembly.Instance) {
    this.core = new Core(instance);
    this.#x = instance.exports as unknown as ViewExports;
  }

  /** Whether this core.wasm build has the public-view exports. */
  get hasViewSupport(): boolean {
    return typeof this.#x.game_from_view === "function" && typeof this.#x.tiles_catalog === "function";
  }

  /** The engine tile catalog (cached). */
  tiles(): CatalogTile[] {
    if (!this.#catalog) {
      const ptr = this.#x.tiles_catalog();
      if (!ptr) throw new Error("core-wasm: tiles_catalog failed");
      this.#catalog = JSON.parse(this.#take(ptr)) as CatalogTile[];
    }
    return this.#catalog;
  }

  /** An engine game rebuilt from a public view. Call `free()` when done. */
  fromView(view: GameView): EngineGame {
    const bytes = enc.encode(JSON.stringify(view));
    const ptr = this.#x.core_alloc(bytes.length);
    if (!ptr) throw new Error("core-wasm: out of memory");
    new Uint8Array(this.#x.memory.buffer, ptr, bytes.length).set(bytes);
    let handle = 0;
    try {
      handle = this.#x.game_from_view(ptr, bytes.length);
    } finally {
      this.#x.core_free(ptr, bytes.length);
    }
    if (!handle) throw new Error("core-wasm: view rejected by the engine");
    return new EngineGame(this.core, handle);
  }

  #take(ptr: number): string {
    const len = new DataView(this.#x.memory.buffer).getUint32(ptr, true);
    const text = dec.decode(new Uint8Array(this.#x.memory.buffer, ptr + 4, len));
    this.#x.core_free(ptr, 4 + len);
    return text;
  }
}

/** Instantiate core.wasm once (default: the copy bundled with this package). */
export async function loadCoreKit(source: WasmSource = DEFAULT_WASM_URL): Promise<CoreKit> {
  const module = await compileSource(source);
  return new CoreKit(await WebAssembly.instantiate(module, {}));
}
