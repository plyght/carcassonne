// ENGINE BINDING POINT. The only place that decides which engine the server runs.
//
//   ENGINE=fake (default)  → FakeEngine (packages/api/src/game/fake-engine.ts), not real rules.
//   ENGINE=wasm            → core.wasm loaded from CORE_WASM_PATH and bound through the WASM ABI
//                            (packages/api/src/game/wasm-engine.ts → loadWasmEngine).
//
// When `@carcassonne/core-wasm` merges, point `loadEngine` at the wasm bytes it ships (or its typed
// wrapper) and make "wasm" the default. On Vercel, add the .wasm file to the function bundle with
// `includeFiles` in vercel.json.
import path from "node:path";

import { getEngine, setEngine, type Engine } from "@carcassonne/api/game/engine";
import { loadWasmEngine } from "@carcassonne/api/game/wasm-engine";

export interface EngineConfig {
  kind?: "fake" | "wasm";
  wasmPath?: string;
  version?: string;
}

const DEFAULT_WASM = path.join(import.meta.dir, "../../../packages/core/zig-out/bin/core.wasm");

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
