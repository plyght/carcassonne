// ENGINE BINDING POINT. The only place that decides which engine the server runs.
//
//   ENGINE=wasm (default)  → the real Zig engine: core.wasm shipped by @carcassonne/core-wasm (or
//                            CORE_WASM_PATH), bound through the WASM ABI (packages/api/src/game/wasm-engine.ts).
//   ENGINE=fake            → FakeEngine (packages/api/src/game/fake-engine.ts), for tests only.

import { getEngine, setEngine, type Engine } from "@carcassonne/api/game/engine";
import { loadWasmEngine } from "@carcassonne/api/game/wasm-engine";

export interface EngineConfig {
  kind?: "fake" | "wasm";
  wasmPath?: string;
  version?: string;
}

// Resolved through the package so Vercel's file tracing bundles the committed core.wasm.
const DEFAULT_WASM = Bun.fileURLToPath(import.meta.resolve("@carcassonne/core-wasm/core.wasm"));

export function engineLoader(cfg: EngineConfig): () => Promise<Engine> {
  let loading: Promise<Engine> | null = null;
  return () => {
    loading ??= (async () => {
      if (cfg.kind === "wasm") {
        const bytes = new Uint8Array(await Bun.file(cfg.wasmPath ?? DEFAULT_WASM).arrayBuffer());
        const engine = await loadWasmEngine(bytes, cfg.version ?? "core-dev");
        setEngine(engine);
        return engine;
      }
      return getEngine();
    })();
    return loading;
  };
}
